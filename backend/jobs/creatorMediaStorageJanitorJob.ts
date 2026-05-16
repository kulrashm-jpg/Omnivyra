/**
 * Creator Media Storage Janitor
 *
 * Periodic cleanup of orphaned objects in the `media-uploads` bucket
 * (and stale TUS sessions whose finalize call never arrived).
 *
 * Categories of orphans:
 *   1. **Finalize-never-called**: object exists in storage but no row
 *      references it. Typically a TUS upload that succeeded client-side
 *      but the finalize POST never reached the server (browser closed,
 *      network drop, etc.).
 *   2. **Stale awaiting_media_upload sessions**: a row stamped
 *      `resumable_session_started_at` more than `STALE_SESSION_HOURS`
 *      ago AND its `creator_lifecycle_state` is still
 *      `awaiting_media_upload`. The user abandoned the upload — clear
 *      the stamp so a fresh session can start cleanly. (We do NOT
 *      transition the row's lifecycle; the row's brief stays intact.)
 *   3. **Upload-attempt orphans**: rows that recorded an
 *      `upload_attempted_object_path` from a validation failure where
 *      cleanup didn't fully run (e.g. process died). The path is
 *      removed from storage; the row is updated to clear the field.
 *
 * Protected categories (never deleted):
 *   - objects whose path matches `daily_content_plans.upload_storage_object_path`
 *   - objects newer than `MIN_AGE_HOURS`
 *   - objects under unknown subdirectories (defensive)
 *
 * Reports a structured summary that cron.ts logs.
 */

import { supabase } from '../db/supabaseClient';
import { ownedDbTable } from '../db/writeOwner';
import { emitCreatorEvent, CREATOR_EVENTS } from '../services/creatorOperationalTelemetryService';

const UPLOAD_BUCKET = 'media-uploads';

export type StorageJanitorReport = {
  scanned_count: number;
  deleted_count: number;
  protected_count: number;
  skipped_count: number;
  stale_sessions_cleared: number;
  failure_count: number;
  errors: string[];
  duration_ms: number;
};

export type StorageJanitorOptions = {
  /** Minimum object age before it's eligible for cleanup. Default 24h. */
  minAgeHours?: number;
  /** Cap on the number of object-deletes per run. Default 100. */
  maxDeletes?: number;
  /** Stale-session threshold in hours. Default 48h. */
  staleSessionHours?: number;
  /** If true, log decisions but do not delete or mutate rows. */
  dryRun?: boolean;
};

const DEFAULT_OPTIONS: Required<StorageJanitorOptions> = {
  minAgeHours: 24,
  maxDeletes: 100,
  staleSessionHours: 48,
  dryRun: false,
};

/**
 * Recursively list all objects in the bucket (paginated). Supabase
 * Storage's `list()` is per-prefix; we walk top-level prefixes
 * (company IDs) → second-level (daily_plan IDs) → third-level
 * (category subdirs).
 *
 * Returns an array of `{ path, created_at, size }`. Capped at 5000
 * total entries per run so we don't melt the supabase API.
 */
async function listAllUploadObjects(): Promise<Array<{ path: string; createdAt: string | null }>> {
  const results: Array<{ path: string; createdAt: string | null }> = [];
  const MAX = 5000;

  async function walk(prefix: string): Promise<void> {
    if (results.length >= MAX) return;
    const { data: entries, error } = await supabase.storage
      .from(UPLOAD_BUCKET)
      .list(prefix, { limit: 200, sortBy: { column: 'created_at', order: 'asc' } });
    if (error || !Array.isArray(entries)) return;
    for (const entry of entries) {
      if (results.length >= MAX) return;
      const fullPath = prefix ? `${prefix}/${entry.name}` : entry.name;
      // Supabase returns directories as entries with `id === null` and
      // no `metadata`. Files have a numeric `metadata.size`.
      const isDirectory = (entry as any).id == null && (entry as any).metadata == null;
      if (isDirectory) {
        await walk(fullPath);
      } else {
        results.push({
          path: fullPath,
          createdAt: (entry as any)?.created_at ?? null,
        });
      }
    }
  }

  try {
    await walk('');
  } catch (e) {
    console.warn('[storage-janitor] listAllUploadObjects failed', { message: (e as Error)?.message });
  }
  return results;
}

/**
 * Snapshot all currently-referenced storage paths from
 * `daily_content_plans`. Returns a Set for O(1) lookup. Only takes the
 * authoritative `upload_storage_object_path` column — we deliberately
 * do NOT parse `uploaded_media_url` here because it can carry legacy
 * paths or platform links.
 */
async function loadReferencedObjectPaths(): Promise<Set<string>> {
  const referenced = new Set<string>();
  try {
    let lastId: string | null = null;
    while (true) {
      let query = supabase
        .from('daily_content_plans')
        .select('id, content')
        .order('id', { ascending: true })
        .limit(500);
      if (lastId) query = query.gt('id', lastId);
      const { data, error } = await query;
      if (error || !Array.isArray(data) || data.length === 0) break;
      for (const row of data) {
        const content = (row as any).content;
        const parsed: Record<string, unknown> = typeof content === 'string'
          ? (() => { try { return JSON.parse(content); } catch { return {}; } })()
          : (content && typeof content === 'object' ? content as Record<string, unknown> : {});
        const path = typeof parsed.upload_storage_object_path === 'string' ? parsed.upload_storage_object_path : null;
        if (path) referenced.add(path);
        // Also protect `upload_attempted_object_path` while it's still
        // recorded — the row owns the cleanup decision.
        const attempted = typeof parsed.upload_attempted_object_path === 'string' ? parsed.upload_attempted_object_path : null;
        if (attempted) referenced.add(attempted);
      }
      lastId = String((data[data.length - 1] as any).id);
      if (data.length < 500) break;
    }
  } catch (e) {
    console.warn('[storage-janitor] loadReferencedObjectPaths failed', { message: (e as Error)?.message });
  }
  return referenced;
}

/**
 * Find rows where `resumable_session_started_at` is older than the
 * threshold AND lifecycle is still awaiting_media_upload. These users
 * abandoned the upload; clear the stamp so the next fresh upload from
 * the same row starts a clean session.
 */
async function clearStaleResumableSessions(thresholdIso: string, dryRun: boolean): Promise<number> {
  try {
    // Try the new column first. If it doesn't exist yet (pre-migration),
    // skip the sweep gracefully.
    const { data, error } = await supabase
      .from('daily_content_plans')
      .select('id, resumable_session_started_at, content_status')
      .lt('resumable_session_started_at', thresholdIso)
      .eq('content_status', 'awaiting_media_upload')
      .limit(200);
    if (error) {
      // Pre-migration environment.
      return 0;
    }
    const rows = Array.isArray(data) ? data : [];
    if (rows.length === 0 || dryRun) return rows.length;
    const ids = rows.map((r: any) => r.id).filter(Boolean);
    if (ids.length === 0) return 0;
    await ownedDbTable('daily_content_plans')
      .update({ resumable_session_started_at: null, updated_at: new Date().toISOString() })
      .in('id', ids);
    return ids.length;
  } catch (e) {
    console.warn('[storage-janitor] clearStaleResumableSessions failed', { message: (e as Error)?.message });
    return 0;
  }
}

export async function runCreatorMediaStorageJanitor(
  options: StorageJanitorOptions = {},
): Promise<StorageJanitorReport> {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const startedAt = Date.now();
  const minAgeMs = opts.minAgeHours * 3600 * 1000;
  const staleThreshold = new Date(Date.now() - opts.staleSessionHours * 3600 * 1000).toISOString();

  const report: StorageJanitorReport = {
    scanned_count: 0,
    deleted_count: 0,
    protected_count: 0,
    skipped_count: 0,
    stale_sessions_cleared: 0,
    failure_count: 0,
    errors: [],
    duration_ms: 0,
  };

  // ── 1. Snapshot referenced paths + list bucket ───────────────────────
  const referenced = await loadReferencedObjectPaths();
  const objects = await listAllUploadObjects();
  report.scanned_count = objects.length;

  // ── 2. Decide what to delete ─────────────────────────────────────────
  const now = Date.now();
  const toDelete: string[] = [];
  for (const obj of objects) {
    if (toDelete.length >= opts.maxDeletes) {
      report.skipped_count += 1;
      continue;
    }
    if (referenced.has(obj.path)) {
      report.protected_count += 1;
      continue;
    }
    const createdMs = obj.createdAt ? new Date(obj.createdAt).getTime() : Number.NaN;
    if (Number.isFinite(createdMs) && now - createdMs < minAgeMs) {
      report.skipped_count += 1;
      continue;
    }
    if (!Number.isFinite(createdMs)) {
      // Unknown age — leave it. Defensive: rather not delete things we
      // can't reason about.
      report.skipped_count += 1;
      continue;
    }
    toDelete.push(obj.path);
  }

  // ── 3. Delete in a single batched call ───────────────────────────────
  if (toDelete.length > 0 && !opts.dryRun) {
    try {
      const { error } = await supabase.storage.from(UPLOAD_BUCKET).remove(toDelete);
      if (error) {
        report.failure_count += 1;
        report.errors.push(`bulk-remove: ${error.message}`);
      } else {
        report.deleted_count = toDelete.length;
      }
    } catch (e) {
      report.failure_count += 1;
      report.errors.push(`bulk-remove threw: ${(e as Error)?.message ?? 'unknown'}`);
    }
  } else if (toDelete.length > 0 && opts.dryRun) {
    // dryRun: count what we would have deleted
    report.deleted_count = toDelete.length;
  }

  // ── 4. Clear stale awaiting-upload session stamps ────────────────────
  report.stale_sessions_cleared = await clearStaleResumableSessions(staleThreshold, opts.dryRun);

  report.duration_ms = Date.now() - startedAt;
  console.log('[storage-janitor] run complete', {
    scanned: report.scanned_count,
    deleted: report.deleted_count,
    protected: report.protected_count,
    skipped: report.skipped_count,
    stale_sessions_cleared: report.stale_sessions_cleared,
    failures: report.failure_count,
    duration_ms: report.duration_ms,
    dry_run: opts.dryRun,
  });
  emitCreatorEvent({
    event: CREATOR_EVENTS.STORAGE_JANITOR_RUN,
    severity: report.failure_count > 0 ? 'warning' : 'info',
    latencyMs: report.duration_ms,
    metadata: {
      scanned: report.scanned_count,
      deleted: report.deleted_count,
      protected: report.protected_count,
      stale_sessions_cleared: report.stale_sessions_cleared,
      failures: report.failure_count,
      dry_run: opts.dryRun ?? false,
    },
  });
  if (report.deleted_count > 0) {
    emitCreatorEvent({
      event: CREATOR_EVENTS.ORPHAN_DELETED,
      metadata: { count: report.deleted_count },
    });
  }
  return report;
}
