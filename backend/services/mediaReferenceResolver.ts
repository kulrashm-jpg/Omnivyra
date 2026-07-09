/**
 * Durable media reference resolver (Round-4 items 3 + 4).
 *
 * Publish-time media URL resolution that survives signed-URL expiry:
 *   - If a row has durable `media_storage_refs` [{bucket,path,url?}] →
 *     mint a FRESH short-lived signed URL per ref at publish time.
 *   - Else → fall back to the existing `media_urls` (100% backward
 *     compatible — pre-migration / non-durable rows are unchanged).
 *
 * Feature-flagged: `DURABLE_MEDIA_REFS` (default OFF) so this is inert
 * until the additive migration 20260677 is applied to the DB. Never
 * throws — a refresh failure falls back to the last-known URL so it can
 * never make publishing WORSE than today.
 *
 * Pure-ish + reusable across publisher / scheduler / calendar.
 */

import { logPipelineEvent } from '../../lib/shared/observability';
import {
  PipelineErrorCode,
  pipelineError,
  type PipelineError,
} from '../../lib/shared/pipelineErrorCodes';

export interface MediaStorageRef {
  bucket: string;
  path: string;
  /** Last-known URL — fallback if a fresh signed URL can't be minted. */
  url?: string;
}

export interface ResolvableMediaRow {
  media_urls?: string[] | null;
  media_storage_refs?: unknown;
}

const FRESH_SIGNED_URL_TTL_S = 60 * 60 * 6; // 6h — comfortably covers publish

function durableEnabled(): boolean {
  return String(process.env.DURABLE_MEDIA_REFS ?? '0') === '1';
}

function parseRefs(raw: unknown): MediaStorageRef[] {
  let v: unknown = raw;
  if (typeof v === 'string') {
    try { v = JSON.parse(v); } catch { return []; }
  }
  if (!Array.isArray(v)) return [];
  return v
    .filter((r): r is MediaStorageRef =>
      !!r && typeof r === 'object' &&
      typeof (r as MediaStorageRef).bucket === 'string' &&
      typeof (r as MediaStorageRef).path === 'string')
    .map((r) => ({ bucket: r.bucket, path: r.path, url: typeof r.url === 'string' ? r.url : undefined }));
}

/**
 * Resolve the media URLs to actually publish. Always returns something
 * usable: durable→fresh-signed, else last-known, else legacy media_urls.
 */
export async function resolvePublishMediaUrls(
  row: ResolvableMediaRow,
): Promise<string[]> {
  const legacy = Array.isArray(row.media_urls)
    ? row.media_urls.filter((u): u is string => typeof u === 'string' && u.trim().length > 0)
    : [];

  if (!durableEnabled()) return legacy;
  const refs = parseRefs(row.media_storage_refs);
  if (refs.length === 0) return legacy;

  let supabase: any;
  try {
    ({ supabase } = await import('../db/supabaseClient'));
  } catch {
    return legacy.length > 0 ? legacy : refs.map((r) => r.url).filter((u): u is string => !!u);
  }

  const out: string[] = [];
  let refreshed = 0;
  let fellBack = 0;
  for (const ref of refs) {
    try {
      const { data, error } = await supabase.storage
        .from(ref.bucket)
        .createSignedUrl(ref.path, FRESH_SIGNED_URL_TTL_S);
      if (!error && data?.signedUrl) {
        out.push(data.signedUrl);
        refreshed++;
        continue;
      }
    } catch {
      /* fall through to last-known */
    }
    if (ref.url) { out.push(ref.url); fellBack++; }
  }
  // If durable resolution produced nothing usable, never regress: use legacy.
  const result = out.length > 0 ? out : legacy;
  logPipelineEvent('media.refresh', fellBack > 0 ? 'warn' : 'info', {
    refs: refs.length, refreshed, fell_back: fellBack, used: result.length,
  }, { dedupeKey: 'media_refresh', throttleMs: 30_000 });
  return result;
}

/**
 * Activation entry point (Round-5 item 3). Called right before the
 * platform adapter on BOTH publish paths (manual + scheduled) for
 * parity. Flag-gated by DURABLE_MEDIA_REFS (default OFF → no-op, so it
 * is inert until migration 20260677 is applied).
 *
 * When durable refs exist: mints fresh signed URLs and writes them into
 * `scheduled_posts.media_urls` in place so the existing adapter (which
 * re-reads the row by id) publishes the fresh URLs WITHOUT any adapter
 * change. Fail-open: never overwrites with fewer/empty URLs, never
 * throws — a refresh problem can never make publishing worse than the
 * pre-existing legacy behavior. Returns the resolved urls (or null when
 * inert / nothing changed).
 */
export async function refreshDurableMediaBeforePublish(
  scheduledPostId: string,
): Promise<string[] | null> {
  if (!durableEnabled()) return null;
  try {
    const { supabase } = await import('../db/supabaseClient');
    const { data: row } = await supabase
      .from('scheduled_posts')
      .select('id, media_urls, media_storage_refs')
      .eq('id', scheduledPostId)
      .maybeSingle();
    if (!row) return null;
    const refs = parseRefs((row as ResolvableMediaRow).media_storage_refs);
    if (refs.length === 0) return null; // no durable refs → leave legacy untouched
    const legacy = Array.isArray((row as ResolvableMediaRow).media_urls)
      ? ((row as ResolvableMediaRow).media_urls as string[]).filter(
          (u) => typeof u === 'string' && u.trim().length > 0)
      : [];
    const resolved = await resolvePublishMediaUrls(row as ResolvableMediaRow);
    // Fail-open: only patch when we produced at least as many usable URLs.
    if (resolved.length === 0 || resolved.length < legacy.length) {
      logPipelineEvent('media.refresh', 'warn', {
        scheduled_post_id: scheduledPostId, resolved: resolved.length,
        legacy: legacy.length, action: 'kept_legacy',
      }, { dedupeKey: 'refresh_keep_legacy', throttleMs: 30_000 });
      return null;
    }
    if (JSON.stringify(resolved) !== JSON.stringify(legacy)) {
      await supabase
        .from('scheduled_posts')
        .update({ media_urls: resolved })
        .eq('id', scheduledPostId);
      logPipelineEvent('media.refresh', 'info', {
        scheduled_post_id: scheduledPostId, refreshed: resolved.length,
      }, { dedupeKey: 'refresh_applied', throttleMs: 30_000 });
    }
    return resolved;
  } catch (err) {
    logPipelineEvent('media.refresh', 'warn', {
      scheduled_post_id: scheduledPostId, error: (err as Error)?.message,
      action: 'failed_open',
    }, { dedupeKey: 'refresh_error' });
    return null; // fail-open
  }
}

/**
 * Pre-publish dead-link check over the RESOLVED urls. Best-effort HEAD;
 * a confirmed 4xx/5xx on every url returns a structured error so the
 * caller can fail explicitly instead of a false publish success.
 * Network/timeout = inconclusive (never false-block).
 */
export async function detectDeadMedia(
  urls: string[],
  timeoutMs = 4000,
): Promise<PipelineError | null> {
  const valid = urls.filter((u) => typeof u === 'string' && /^https?:\/\//i.test(u));
  if (valid.length === 0) return null;
  let confirmedDead = 0;
  for (const url of valid) {
    try {
      // HARDEN-005: media URLs are generated/user content — validate via the
      // SSRF-safe fetcher. A blocked (internal-pointing) URL throws and is
      // treated as inconclusive by the catch below (no internal request made).
      const { safeFetch } = await import('../../lib/security/safeFetch');
      const r = await safeFetch(url, { method: 'HEAD' }, { timeoutMs });
      if (r.status >= 400) confirmedDead++;
    } catch {
      /* inconclusive — ignore */
    }
  }
  if (confirmedDead > 0 && confirmedDead === valid.length) {
    logPipelineEvent('media.dead_link', 'warn', { total: valid.length, dead: confirmedDead }, { throttleMs: 0 });
    return pipelineError(
      PipelineErrorCode.MEDIA_ASSET_INACCESSIBLE,
      `All attached media (${confirmedDead}) is inaccessible (likely expired URLs). Refresh the asset before publishing.`,
      { dead: confirmedDead },
    );
  }
  return null;
}
