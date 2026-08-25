/**
 * Creator Operational Telemetry Service
 *
 * Centralized structured-event emitter for the BOLT Creator workflow.
 * Every meaningful operational moment — upload start, validation pass,
 * queue contention, publish failure, lifecycle transition, janitor run —
 * funnels through `emitCreatorEvent()` so the observability + alerting
 * layers have a single canonical stream to aggregate.
 *
 * Events are written to `creator_operational_events` AND echoed to the
 * structured logger (so log-aggregation pipelines see them too). DB write
 * failures NEVER throw — telemetry must not break the user request.
 *
 * Correlation:
 *   - Each request should mint a `trace_id` (UUID) on entry and propagate
 *     it through all telemetry emissions in that request.
 *   - `correlation_id` is reserved for cross-request lineage (e.g. an
 *     upload that later becomes a publish job retains the same value).
 *   - `withTrace()` provides AsyncLocalStorage-style ambient propagation
 *     so deep service layers don't have to pass trace ids manually.
 */

import { randomUUID } from 'crypto';
import { AsyncLocalStorage } from 'async_hooks';
import { supabase } from '../db/supabaseClient';
import { logger } from './logger';

// ──────────────────────────────────────────────────────────────────────
// Event-type registry (closed set — keeps observability dashboards sane)
// ──────────────────────────────────────────────────────────────────────
export const CREATOR_EVENTS = {
  // Upload lifecycle
  UPLOAD_STARTED: 'upload_started',
  UPLOAD_RESUMED: 'upload_resumed',
  UPLOAD_CANCELLED: 'upload_cancelled',
  UPLOAD_FAILED: 'upload_failed',
  UPLOAD_COMPLETED: 'upload_completed',
  UPLOAD_VALIDATION_FAILED: 'upload_validation_failed',
  UPLOAD_MIME_SPOOF: 'upload_mime_spoof',
  // Resumable
  RESUMABLE_SESSION_DETECTED: 'resumable_session_detected',
  RESUMABLE_SESSION_RECOVERED: 'resumable_session_recovered',
  RESUMABLE_SESSION_DISCARDED: 'resumable_session_discarded',
  // Storage
  ORPHAN_DELETED: 'orphan_deleted',
  STORAGE_JANITOR_RUN: 'storage_janitor_run',
  STALE_SESSION_CLEARED: 'stale_session_cleared',
  // Queue
  QUEUE_LOCK_ACQUIRED: 'queue_lock_acquired',
  QUEUE_LOCK_CONTENTION: 'queue_lock_contention',
  QUEUE_REENQUEUE_SUCCESS: 'queue_reenqueue_success',
  QUEUE_REENQUEUE_FAILURE: 'queue_reenqueue_failure',
  QUEUE_JOB_POISONED: 'queue_job_poisoned',
  QUEUE_JOB_RETIRED: 'queue_job_retired',
  QUEUE_DRIFT_DETECTED: 'queue_drift_detected',
  // Publish path
  PUBLISH_VALIDATION_PASSED: 'publish_validation_passed',
  PUBLISH_VALIDATION_FAILED: 'publish_validation_failed',
  ATTACHMENT_PUBLISH_SUCCESS: 'attachment_publish_success',
  ATTACHMENT_PUBLISH_FAILURE: 'attachment_publish_failure',
  // Schedule operations
  RESCHEDULE_REQUESTED: 'reschedule_requested',
  UNSCHEDULE_REQUESTED: 'unschedule_requested',
  ATTACHMENT_READY_FOR_SCHEDULE: 'attachment_ready_for_schedule',
  // Audits + alerts
  INTEGRITY_AUDIT_RUN: 'integrity_audit_run',
  INTEGRITY_VIOLATION: 'integrity_violation',
  ALERT_FIRED: 'alert_fired',
  ALERT_DEDUPED: 'alert_deduped',
  ALERT_RESOLVED: 'alert_resolved',
  // Security
  RATE_LIMIT_BLOCKED: 'rate_limit_blocked',
  ABUSE_DETECTED: 'abuse_detected',
  // Composition references
  //
  // A user attached an asset and routing could not use it. Counted rather than
  // warned because the failure is invisible from the outside: generation still
  // succeeds, so without this there is no way to measure how often a person's
  // upload is discarded, or which reason dominates.
  REFERENCE_ROUTING_REJECTED: 'reference_routing_rejected',
  //
  // A reference PASSED routing, reached the provider, and still could not be
  // applied — the edit call failed or returned nothing usable, and generation
  // fell back. Distinct from the rejection above, which happens before the
  // provider is ever called. The `category` field carries which of the two,
  // and the fallback is implied rather than counted separately.
  CONDITION_REFERENCE_DEGRADED: 'condition_reference_degraded',
} as const;

export type CreatorEventType =
  | typeof CREATOR_EVENTS[keyof typeof CREATOR_EVENTS]
  | (string & { __opaque?: never });

export type CreatorEventSeverity = 'info' | 'warning' | 'critical';

export type CreatorEventInput = {
  event: CreatorEventType;
  severity?: CreatorEventSeverity;
  traceId?: string;
  correlationId?: string;
  companyId?: string | null;
  campaignId?: string | null;
  dailyPlanId?: string | null;
  scheduledPostId?: string | null;
  actorUserId?: string | null;
  creatorFormat?: string | null;
  lifecycleState?: string | null;
  executionMode?: 'autonomous' | 'attachment' | 'mixed' | null;
  workerId?: string | null;
  queueJobId?: string | null;
  retryCount?: number | null;
  latencyMs?: number | null;
  metadata?: Record<string, unknown>;
};

// ──────────────────────────────────────────────────────────────────────
// Ambient trace context (AsyncLocalStorage)
// ──────────────────────────────────────────────────────────────────────
type TraceContext = {
  traceId: string;
  correlationId?: string;
  actorUserId?: string;
  companyId?: string;
  source?: string;
};

const traceStorage = new AsyncLocalStorage<TraceContext>();

export function getCurrentTrace(): TraceContext | undefined {
  return traceStorage.getStore();
}

export function newTraceId(): string {
  return randomUUID();
}

/** Run `fn` inside an ambient trace context. */
export async function withTrace<T>(ctx: Partial<TraceContext> & { traceId?: string }, fn: () => Promise<T>): Promise<T> {
  const traceId = ctx.traceId ?? newTraceId();
  return traceStorage.run({ ...ctx, traceId }, fn);
}

// ──────────────────────────────────────────────────────────────────────
// Emit
// ──────────────────────────────────────────────────────────────────────
const BATCH_MAX = 25;
const BATCH_FLUSH_MS = 1500;
const _queue: Array<Record<string, unknown>> = [];
let _flushTimer: NodeJS.Timeout | null = null;

function scheduleFlush() {
  if (_flushTimer) return;
  _flushTimer = setTimeout(flush, BATCH_FLUSH_MS).unref?.() as unknown as NodeJS.Timeout ?? setTimeout(flush, BATCH_FLUSH_MS);
}

async function flush() {
  _flushTimer = null;
  if (_queue.length === 0) return;
  const batch = _queue.splice(0, _queue.length);
  try {
    await supabase.from('creator_operational_events').insert(batch);
  } catch (err) {
    // Never throw — best-effort. Log at warn so SREs can see telemetry pipeline failures.
    logger.warn('creatorTelemetry.flush_failed', {
      surface: 'creatorOperationalTelemetry',
      error: (err as Error)?.message ?? String(err),
      batch_size: batch.length,
    });
  }
}

/** Best-effort: NEVER throws. Echoes to logger AND queues for DB persistence. */
export function emitCreatorEvent(input: CreatorEventInput): void {
  try {
    const ambient = getCurrentTrace();
    const severity = input.severity ?? 'info';
    const row = {
      event_type: input.event,
      severity,
      trace_id: input.traceId ?? ambient?.traceId ?? null,
      correlation_id: input.correlationId ?? ambient?.correlationId ?? null,
      company_id: input.companyId ?? ambient?.companyId ?? null,
      campaign_id: input.campaignId ?? null,
      daily_plan_id: input.dailyPlanId ?? null,
      scheduled_post_id: input.scheduledPostId ?? null,
      actor_user_id: input.actorUserId ?? ambient?.actorUserId ?? null,
      creator_format: input.creatorFormat ?? null,
      lifecycle_state: input.lifecycleState ?? null,
      execution_mode: input.executionMode ?? null,
      worker_id: input.workerId ?? null,
      queue_job_id: input.queueJobId ?? null,
      retry_count: input.retryCount ?? null,
      latency_ms: input.latencyMs ?? null,
      metadata: input.metadata ?? {},
    };

    // Echo to structured logger for log-aggregation pipelines that don't read
    // the DB. Severity drives the log level.
    const logMethod = severity === 'critical' ? 'error' : severity === 'warning' ? 'warn' : 'info';
    (logger as any)[logMethod]?.(`creatorEvent.${input.event}`, {
      surface: 'creatorOperationalTelemetry',
      ...row,
    });

    _queue.push(row);
    if (_queue.length >= BATCH_MAX) {
      void flush();
    } else {
      scheduleFlush();
    }
  } catch (err) {
    // Defensive — never propagate.
    try {
      logger.warn('creatorTelemetry.emit_failed', {
        surface: 'creatorOperationalTelemetry',
        error: (err as Error)?.message ?? String(err),
      });
    } catch { /* silence */ }
  }
}

/** Force-flush for tests + graceful shutdown. */
export async function flushCreatorTelemetry(): Promise<void> {
  if (_flushTimer) {
    clearTimeout(_flushTimer);
    _flushTimer = null;
  }
  await flush();
}

/** Reset internal state — TEST USE ONLY. */
export function __resetCreatorTelemetryForTests(): void {
  if (_flushTimer) clearTimeout(_flushTimer);
  _flushTimer = null;
  _queue.length = 0;
}

// ──────────────────────────────────────────────────────────────────────
// Convenience: time an async block, emit start + completion with latency.
// ──────────────────────────────────────────────────────────────────────
export async function withTimedEvent<T>(
  startEvent: CreatorEventType,
  completeEvent: CreatorEventType,
  base: Omit<CreatorEventInput, 'event' | 'latencyMs'>,
  fn: () => Promise<T>,
): Promise<T> {
  const startedAt = Date.now();
  emitCreatorEvent({ ...base, event: startEvent });
  try {
    const result = await fn();
    emitCreatorEvent({
      ...base,
      event: completeEvent,
      latencyMs: Date.now() - startedAt,
    });
    return result;
  } catch (err) {
    emitCreatorEvent({
      ...base,
      event: completeEvent,
      severity: 'warning',
      latencyMs: Date.now() - startedAt,
      metadata: { ...(base.metadata ?? {}), error: (err as Error)?.message ?? String(err), failed: true },
    });
    throw err;
  }
}
