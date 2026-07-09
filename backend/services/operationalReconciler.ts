/**
 * Lightweight deterministic reconcilers (Round-5 item 4).
 *
 * DETECTION-FIRST. The only auto-fix performed is itself already-safe,
 * deterministic, idempotent and feature-flagged (durable media refresh).
 * Everything else is detect + operator-visible structured log — NO
 * destructive auto-actions. Read-mostly, throttled, never throws.
 *
 *  - reconcileOrphanPending()        : pending-creator rows stale, no progress
 *  - reconcileExpiredMedia()         : scheduled posts whose media likely expired
 *  - reconcileUnresolvedDependencies(): scheduled posts whose creator dep unresolved
 *  - runReconciliationPass()         : all three + summary (cron-wired)
 */

import { logPipelineEvent } from '../../lib/shared/observability';
import { resolveCanonicalState, CanonicalContentState } from '../../lib/shared/contentLifecycle';
import { refreshDurableMediaBeforePublish } from './mediaReferenceResolver';

const STALE_DAYS = 7;

export interface ReconcileResult {
  job: string;
  detected: number;
  autoFixed: number;
  ok: boolean;
  detail?: string;
}

async function db() {
  const { supabase } = await import('../db/supabaseClient');
  return supabase;
}

/** Pending-creator rows that have made no progress for STALE_DAYS. Detect + log only. */
export async function reconcileOrphanPending(): Promise<ReconcileResult> {
  try {
    const supabase = await db();
    const cutoff = new Date(Date.now() - STALE_DAYS * 86400_000).toISOString();
    const { data, error } = await supabase
      .from('daily_content_plans')
      .select('id, campaign_id, content_status, content, scheduled_post_id, updated_at')
      .is('scheduled_post_id', null)
      .in('content_status', ['awaiting_media_upload', 'upload_failed', 'guidance_ready'])
      .lt('updated_at', cutoff)
      .limit(500);
    if (error) return { job: 'orphan_pending', detected: 0, autoFixed: 0, ok: false, detail: error.message };
    const orphans = (data || []).filter((r) =>
      resolveCanonicalState({ content_status: r.content_status, content: r.content, scheduled_post_id: null })
        === CanonicalContentState.PENDING_CREATOR);
    if (orphans.length > 0) {
      logPipelineEvent('orphan.recovery', 'warn', {
        job: 'orphan_pending', detected: orphans.length, stale_days: STALE_DAYS,
        sample: orphans.slice(0, 5).map((o) => o.id),
        action: 'operator_review_required', // no destructive auto-action
      }, { throttleMs: 0 });
    }
    return { job: 'orphan_pending', detected: orphans.length, autoFixed: 0, ok: true };
  } catch (e) {
    return { job: 'orphan_pending', detected: 0, autoFixed: 0, ok: false, detail: (e as Error)?.message };
  }
}

/** Scheduled future posts whose media URL looks like an expired signed URL.
 *  Safe deterministic auto-fix: ONLY the already-safe, flag-gated durable
 *  refresh (no-op unless DURABLE_MEDIA_REFS + refs present). */
export async function reconcileExpiredMedia(): Promise<ReconcileResult> {
  try {
    const supabase = await db();
    const nowIso = new Date().toISOString();
    const { data, error } = await supabase
      .from('scheduled_posts')
      .select('id, media_urls, scheduled_for, status')
      .eq('status', 'scheduled')
      .gt('scheduled_for', nowIso)
      .limit(500);
    if (error) return { job: 'expired_media', detected: 0, autoFixed: 0, ok: false, detail: error.message };
    // Heuristic: signed URL with an expiry/token query param.
    const SIGNED_RE = /[?&](token|X-Amz-Expires|Expires|se|sig)=/i;
    const suspects = (data || []).filter(
      (r) => Array.isArray(r.media_urls) &&
        r.media_urls.some((u: unknown) => typeof u === 'string' && SIGNED_RE.test(u)));
    // HARDEN-004: per-suspect refreshes are independent — bounded concurrency
    // instead of strictly sequential awaits. Same per-post call, same counting.
    const { mapWithConcurrency, getSchedulerConcurrency } = await import('../scheduler/schedulerBatching');
    const refreshResults = await mapWithConcurrency(
      suspects,
      getSchedulerConcurrency(),
      (s) => refreshDurableMediaBeforePublish(s.id), // safe/flag-gated/no-op by default
    );
    const autoFixed = refreshResults.filter((r) => r.ok && r.value).length;
    if (suspects.length > 0) {
      logPipelineEvent('orphan.recovery', autoFixed < suspects.length ? 'warn' : 'info', {
        job: 'expired_media', detected: suspects.length, autoFixed,
        unresolved: suspects.length - autoFixed,
        action: autoFixed < suspects.length ? 'operator_review_required' : 'durable_refreshed',
      }, { throttleMs: 0 });
    }
    return { job: 'expired_media', detected: suspects.length, autoFixed, ok: true };
  } catch (e) {
    return { job: 'expired_media', detected: 0, autoFixed: 0, ok: false, detail: (e as Error)?.message };
  }
}

/** Scheduled posts whose linked daily plan is still PENDING_CREATOR. Detect + log only. */
export async function reconcileUnresolvedDependencies(): Promise<ReconcileResult> {
  try {
    const supabase = await db();
    const { data, error } = await supabase
      .from('daily_content_plans')
      .select('id, content_status, content, scheduled_post_id')
      .not('scheduled_post_id', 'is', null)
      .in('content_status', ['awaiting_media_upload', 'upload_failed'])
      .limit(500);
    if (error) return { job: 'unresolved_dep', detected: 0, autoFixed: 0, ok: false, detail: error.message };
    const unresolved = (data || []).filter((r) =>
      resolveCanonicalState({ content_status: r.content_status, content: r.content, scheduled_post_id: r.scheduled_post_id })
        === CanonicalContentState.PENDING_CREATOR);
    if (unresolved.length > 0) {
      logPipelineEvent('orphan.recovery', 'warn', {
        job: 'unresolved_dep', detected: unresolved.length,
        sample: unresolved.slice(0, 5).map((u) => u.id),
        action: 'operator_review_required',
      }, { throttleMs: 0 });
    }
    return { job: 'unresolved_dep', detected: unresolved.length, autoFixed: 0, ok: true };
  } catch (e) {
    return { job: 'unresolved_dep', detected: 0, autoFixed: 0, ok: false, detail: (e as Error)?.message };
  }
}

export async function runReconciliationPass(): Promise<ReconcileResult[]> {
  const results = await Promise.all([
    reconcileOrphanPending(),
    reconcileExpiredMedia(),
    reconcileUnresolvedDependencies(),
  ]);
  logPipelineEvent('reconciliation.summary', results.every((r) => r.ok) ? 'info' : 'warn', {
    jobs: results.map((r) => ({ job: r.job, detected: r.detected, autoFixed: r.autoFixed, ok: r.ok })),
  }, { throttleMs: 0 });
  return results;
}
