/**
 * Creator Audit Trail Service
 *
 * Immutable append-only audit log for creator-workflow domain events:
 * uploads, schedules, reschedules, unschedules, publish attempts,
 * lifecycle transitions, retries, janitor deletions, admin overrides.
 *
 * Persists to `creator_audit_log` (DB enforces append-only via trigger).
 * Failure to persist NEVER throws — audit trail is observational, not
 * a request gate. The companion telemetry service emits the same events
 * as observable signals; the audit log is the permanent, immutable record
 * for forensic reconstruction and compliance review.
 *
 * Replay safety:
 *   - Every entry includes `correlation_id` so a publish→retry→success
 *     chain stays linkable across days.
 *   - `previous_state` + `new_state` snapshots enable reconstruction of
 *     any row's history without traversing live tables.
 */

import { supabase } from '../db/supabaseClient';
import { logger } from './logger';
import { getCurrentTrace } from './creatorOperationalTelemetryService';

export type CreatorAuditAction =
  | 'upload_initiated'
  | 'upload_completed'
  | 'upload_failed'
  | 'upload_validation_rejected'
  | 'upload_resumed'
  | 'upload_discarded'
  | 'lifecycle_transition'
  | 'schedule_attached'
  | 'schedule_rescheduled'
  | 'schedule_unscheduled'
  | 'publish_attempted'
  | 'publish_succeeded'
  | 'publish_failed'
  | 'queue_cancelled'
  | 'queue_reenqueued'
  | 'queue_dlq_routed'
  | 'janitor_object_deleted'
  | 'janitor_session_cleared'
  | 'admin_override'
  | 'integrity_repair_applied'
  | (string & { __opaque?: never });

export type CreatorAuditActorKind = 'user' | 'system' | 'cron' | 'worker' | 'admin';

export type CreatorAuditEntry = {
  action: CreatorAuditAction;
  actorUserId?: string | null;
  actorKind?: CreatorAuditActorKind;
  dailyPlanId?: string | null;
  scheduledPostId?: string | null;
  campaignId?: string | null;
  companyId?: string | null;
  source?: 'api' | 'cron' | 'worker' | 'admin' | 'webhook' | 'system';
  correlationId?: string | null;
  traceId?: string | null;
  previousState?: Record<string, unknown> | null;
  newState?: Record<string, unknown> | null;
  metadata?: Record<string, unknown>;
};

// Batched insert; same flush cadence as telemetry but separate buffer so
// audit and telemetry can fail independently.
const BATCH_MAX = 25;
const BATCH_FLUSH_MS = 1500;
const _queue: Array<Record<string, unknown>> = [];
let _flushTimer: NodeJS.Timeout | null = null;

function scheduleFlush() {
  if (_flushTimer) return;
  _flushTimer = setTimeout(flush, BATCH_FLUSH_MS);
  _flushTimer.unref?.();
}

async function flush() {
  _flushTimer = null;
  if (_queue.length === 0) return;
  const batch = _queue.splice(0, _queue.length);
  try {
    await supabase.from('creator_audit_log').insert(batch);
  } catch (err) {
    logger.warn('creatorAuditTrail.flush_failed', {
      surface: 'creatorAuditTrail',
      error: (err as Error)?.message ?? String(err),
      batch_size: batch.length,
    });
  }
}

/**
 * Append a single audit-trail entry. Best-effort; never throws.
 *
 * Reuses ambient trace + correlation IDs from the telemetry service so
 * a single request produces one connected audit chain even if the call
 * sites pass minimal context.
 */
export function recordAuditEntry(entry: CreatorAuditEntry): void {
  try {
    const ambient = getCurrentTrace();
    const row = {
      action: entry.action,
      actor_user_id: entry.actorUserId ?? ambient?.actorUserId ?? null,
      actor_kind: entry.actorKind ?? (entry.actorUserId ? 'user' : 'system'),
      daily_plan_id: entry.dailyPlanId ?? null,
      scheduled_post_id: entry.scheduledPostId ?? null,
      campaign_id: entry.campaignId ?? null,
      company_id: entry.companyId ?? ambient?.companyId ?? null,
      source: entry.source ?? ambient?.source ?? 'api',
      correlation_id: entry.correlationId ?? ambient?.correlationId ?? null,
      trace_id: entry.traceId ?? ambient?.traceId ?? null,
      previous_state: entry.previousState ?? null,
      new_state: entry.newState ?? null,
      metadata: entry.metadata ?? {},
    };

    _queue.push(row);
    if (_queue.length >= BATCH_MAX) {
      void flush();
    } else {
      scheduleFlush();
    }
  } catch (err) {
    try {
      logger.warn('creatorAuditTrail.record_failed', {
        surface: 'creatorAuditTrail',
        error: (err as Error)?.message ?? String(err),
      });
    } catch { /* silence */ }
  }
}

/** Force-flush the audit buffer. */
export async function flushCreatorAuditTrail(): Promise<void> {
  if (_flushTimer) {
    clearTimeout(_flushTimer);
    _flushTimer = null;
  }
  await flush();
}

/** TEST ONLY. */
export function __resetCreatorAuditTrailForTests(): void {
  if (_flushTimer) clearTimeout(_flushTimer);
  _flushTimer = null;
  _queue.length = 0;
}

// ──────────────────────────────────────────────────────────────────────
// Forensic reconstruction helpers
// ──────────────────────────────────────────────────────────────────────

/** Reconstruct the audit history for a single daily_content_plan row. */
export async function getAuditHistoryForPlan(
  dailyPlanId: string,
  options: { limit?: number } = {},
): Promise<Array<Record<string, unknown>>> {
  const limit = Math.max(1, Math.min(options.limit ?? 200, 1000));
  try {
    const { data } = await supabase
      .from('creator_audit_log')
      .select('*')
      .eq('daily_plan_id', dailyPlanId)
      .order('created_at', { ascending: true })
      .limit(limit);
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

/** Reconstruct the audit history for a single scheduled_post. */
export async function getAuditHistoryForScheduledPost(
  scheduledPostId: string,
  options: { limit?: number } = {},
): Promise<Array<Record<string, unknown>>> {
  const limit = Math.max(1, Math.min(options.limit ?? 200, 1000));
  try {
    const { data } = await supabase
      .from('creator_audit_log')
      .select('*')
      .eq('scheduled_post_id', scheduledPostId)
      .order('created_at', { ascending: true })
      .limit(limit);
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}
