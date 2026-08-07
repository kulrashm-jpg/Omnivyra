/**
 * HARDEN-INT-002 — the single telemetry surface for the Intelligence platform.
 *
 * Production Runtime Validation found the INT modules carried ZERO metrics and
 * ZERO logs: a stack that fails open everywhere was also completely silent, so
 * a total outage (e.g. the persistence table missing) looked identical to
 * "no intelligence generated yet". This module closes that gap by plugging
 * into the EXISTING HARDEN-001 registry — no new infrastructure, no new
 * transport. New names flow into the observability snapshot and the Prometheus
 * exporter automatically because both enumerate the registry generically.
 *
 * Rules this module enforces so instrumentation stays production-safe:
 *  - FAIL-SAFE: every recorder is wrapped; telemetry never breaks a request.
 *  - BOUNDED CARDINALITY: labels are drawn from small closed sets only. Ids
 *    (company/lead) are NEVER labels — they go in log payloads, not metrics.
 *  - NO SENSITIVE DATA: logs carry ids, counts, durations and versions only.
 *    Never email, name, page URL, message body or any envelope content.
 *  - NOT NOISY: recurring failure logs are throttled per (event, key) to one
 *    line per window; the counter still increments on every occurrence, so the
 *    metric stays exact while the log stays readable.
 */

import { recordRawCounter, recordRawHistogram } from '../observability/metrics';
import { logger } from './logger';

/** Metric names — `<domain>.<subject>.<unit>`, matching HARDEN-001 convention. */
export const INTEL_METRICS = {
  generation: {
    count: 'intel.generation.count',
    duration: 'intel.generation.duration_ms',
    failures: 'intel.generation.failures',
    skipped: 'intel.generation.skipped',
    versionUpgrade: 'intel.generation.version_upgrade',
    schemaUpgrade: 'intel.generation.schema_upgrade',
  },
  snapshot: {
    rows: 'intel.snapshot.rows',
    failures: 'intel.snapshot.failures',
  },
  // WS-2 M1 (3): the capture-side session write, which is the ROOT of every
  // downstream journey signal. A lost session row is invisible in every metric
  // above it — generation still succeeds, it just silently has no sessions.
  session: {
    persistence: 'intel.session.persistence',
    failures: 'intel.session.persistence_failures',
  },
  // WS-2 M2: the visitor-dimension and event-coverage layer. `visitorContext`
  // answers "is enrichment actually working?" — a parser that silently stops
  // resolving devices, or an edge that stops sending geo headers, degrades to
  // null everywhere downstream and is otherwise invisible.
  visitor: {
    context: 'intel.visitor.context',
  },
  event: {
    ingested: 'intel.event.ingested',
  },
  // WS-2 M3: the evolution layer. These answer "is the platform seeing leads
  // MOVE?" — a stack where every lead reads `stable`/`unaware` forever is
  // either mis-deriving or starved of multi-session data, and neither shows up
  // in any generation or persistence metric.
  evolution: {
    intentTrend: 'intel.evolution.intent_trend',
    funnelStage: 'intel.evolution.funnel_stage',
    funnelTransition: 'intel.evolution.funnel_transition',
    journeyState: 'intel.evolution.journey_state',
    checkpoints: 'intel.evolution.checkpoints',
    timelineEntries: 'intel.evolution.timeline_entries',
  },
  persistence: {
    failures: 'intel.persistence.failures',
  },
  envelope: {
    bytes: 'intel.envelope.bytes',
  },
  activation: {
    decision: 'intel.activation.decision',
    fanout: 'intel.activation.fanout',
  },
  read: {
    count: 'intel.read.count',
    duration: 'intel.read.duration_ms',
    failures: 'intel.read.failures',
    bulkIds: 'intel.read.bulk_ids',
    tenantMismatch: 'intel.read.tenant_mismatch',
  },
} as const;

export type GenerationOutcome = 'generated' | 'skipped_unchanged' | 'failed';
export type GenerationStage = 'snapshot' | 'engine' | 'planning' | 'persistence' | 'not_found';
export type SnapshotCollection = 'lead' | 'tracking_events' | 'visitor_sessions' | 'campaign_touchpoints';
export type ActivationOutcome = 'ran' | 'cooldown' | 'disabled' | 'failed_open';
export type ReadSurface = 'detail' | 'bulk' | 'list';

/**
 * STABILIZE-INT-002 (D12): the module header promises "every recorder is
 * wrapped", but the logger calls were bare. `logger.write` does JSON.stringify
 * and reads AsyncLocalStorage — a throw there propagated out of the recorder
 * and into the orchestrator's instrumentation chain. Every emit now goes
 * through this guard, so telemetry can never break or mask a caller.
 */
const safeLog = (
  level: 'debug' | 'info' | 'warn' | 'error',
  event: string,
  payload: Record<string, unknown>,
): void => {
  try {
    logger[level](event, payload);
  } catch {
    /* logging must never break the caller */
  }
};

const counter = (name: string, labels?: Record<string, string | number | boolean>): void => {
  try {
    recordRawCounter(name, 1, labels);
  } catch {
    /* telemetry must never break the caller */
  }
};

const histogram = (name: string, value: number, labels?: Record<string, string | number | boolean>): void => {
  try {
    if (Number.isFinite(value)) recordRawHistogram(name, value, labels);
  } catch {
    /* telemetry must never break the caller */
  }
};

// ── Log throttling ──────────────────────────────────────────────────────────
// A failing dependency (missing table, dead session query) fires on EVERY
// generation. Without throttling that is thousands of identical lines an hour.
// One line per (event, key) per window, with an occurrences count so the log
// still conveys volume. Bounded like the activation cooldown map.
const LOG_WINDOW_MS = 60_000;
const MAX_THROTTLE_KEYS = 2000;
const lastLogged = new Map<string, { at: number; suppressed: number }>();

function shouldLog(key: string, nowMs: number): { emit: boolean; suppressed: number } {
  const prev = lastLogged.get(key);
  if (prev && nowMs - prev.at < LOG_WINDOW_MS) {
    prev.suppressed += 1;
    return { emit: false, suppressed: prev.suppressed };
  }
  if (lastLogged.size > MAX_THROTTLE_KEYS) lastLogged.clear();
  const suppressed = prev?.suppressed ?? 0;
  lastLogged.set(key, { at: nowMs, suppressed: 0 });
  return { emit: true, suppressed };
}

/** Test-only: reset throttle state so suites are order-independent. */
export function __resetTelemetryThrottleForTests(): void {
  lastLogged.clear();
}

// ── Generation ──────────────────────────────────────────────────────────────

export function recordGenerationOutcome(input: {
  outcome: GenerationOutcome;
  reason: string;
  durationMs: number;
  companyId: string;
  leadId: string;
  stage?: GenerationStage;
  error?: string | null;
  envelopeBytes?: number;
  inputCounts?: { events: number; sessions: number; touchpoints: number };
  persisted?: boolean;
}): void {
  const { outcome, reason, durationMs, companyId, leadId } = input;
  counter(INTEL_METRICS.generation.count, { outcome, reason });
  histogram(INTEL_METRICS.generation.duration, durationMs, { outcome });

  if (outcome === 'skipped_unchanged') counter(INTEL_METRICS.generation.skipped, { reason });

  if (typeof input.envelopeBytes === 'number') {
    histogram(INTEL_METRICS.envelope.bytes, input.envelopeBytes);
  }
  if (input.inputCounts) {
    histogram(INTEL_METRICS.snapshot.rows, input.inputCounts.events, { collection: 'tracking_events' });
    histogram(INTEL_METRICS.snapshot.rows, input.inputCounts.sessions, { collection: 'visitor_sessions' });
    histogram(INTEL_METRICS.snapshot.rows, input.inputCounts.touchpoints, { collection: 'campaign_touchpoints' });
  }

  if (outcome === 'failed') {
    const stage = input.stage ?? 'engine';
    counter(INTEL_METRICS.generation.failures, { stage });
    const { emit, suppressed } = shouldLog(`gen_fail:${stage}`, Date.now());
    if (emit) {
      safeLog('warn', 'intel_generation_failed', {
        stage,
        reason,
        company_id: companyId,
        lead_id: leadId,
        duration_ms: Math.round(durationMs),
        error: input.error ?? null,
        suppressed_since_last: suppressed,
      });
    }
    return;
  }

  // Success is debug-level: silent in production (LOG_LEVEL defaults to info)
  // but available for targeted investigation without a redeploy.
  safeLog('debug', 'intel_generation_completed', {
    outcome,
    reason,
    company_id: companyId,
    lead_id: leadId,
    duration_ms: Math.round(durationMs),
    persisted: input.persisted ?? null,
  });
}

/** A persisted record was regenerated because the engine/schema version moved. */
export function recordVersionUpgrade(input: {
  fromEngine: string;
  toEngine: string;
  fromSchema: number;
  toSchema: number;
  companyId: string;
  leadId: string;
}): void {
  const engineMoved = input.fromEngine !== input.toEngine;
  const schemaMoved = input.fromSchema !== input.toSchema;
  if (engineMoved) {
    counter(INTEL_METRICS.generation.versionUpgrade, { from: input.fromEngine, to: input.toEngine });
  }
  if (schemaMoved) {
    counter(INTEL_METRICS.generation.schemaUpgrade, { from: input.fromSchema, to: input.toSchema });
  }
  // STABILIZE-INT-002 (D11): the counters were already gated on an actual
  // version move, but the log was not — so every steady-state regeneration
  // emitted "record upgraded from lie-2.0.0 to lie-2.0.0", a misleading
  // signal precisely during incident triage. Log only a real upgrade.
  if (!engineMoved && !schemaMoved) return;
  const { emit, suppressed } = shouldLog(`upgrade:${input.fromEngine}->${input.toEngine}`, Date.now());
  if (emit) {
    safeLog('info', 'intel_record_upgraded', {
      from_engine: input.fromEngine,
      to_engine: input.toEngine,
      from_schema: input.fromSchema,
      to_schema: input.toSchema,
      company_id: input.companyId,
      lead_id: input.leadId,
      suppressed_since_last: suppressed,
    });
  }
}

// ── Snapshot + persistence fail-open paths ──────────────────────────────────

/**
 * A snapshot collection read failed and fell open to []. Previously silent —
 * this is exactly how the visitor_sessions ordering defect stayed invisible.
 */
export function recordSnapshotReadFailure(collection: SnapshotCollection, companyId: string, detail?: string): void {
  counter(INTEL_METRICS.snapshot.failures, { collection });
  const { emit, suppressed } = shouldLog(`snapshot_fail:${collection}`, Date.now());
  if (emit) {
    safeLog('warn', 'intel_snapshot_read_failed', {
      collection,
      company_id: companyId,
      detail: detail ?? null,
      impact: 'collection degraded to empty; intelligence generated with partial inputs',
      suppressed_since_last: suppressed,
    });
  }
}

/**
 * A persistence operation failed. This is THE signal for "migration not
 * applied" — error level, because generated intelligence is being discarded.
 */
export function recordPersistenceFailure(op: 'upsert' | 'get' | 'getMany' | 'mark_rebuild', detail: string, companyId?: string): void {
  counter(INTEL_METRICS.persistence.failures, { op });
  const { emit, suppressed } = shouldLog(`persist_fail:${op}`, Date.now());
  if (emit) {
    safeLog('error', 'intel_persistence_failed', {
      op,
      company_id: companyId ?? null,
      detail,
      impact: op === 'upsert' ? 'generated intelligence was NOT saved' : 'read degraded to never_generated',
      suppressed_since_last: suppressed,
    });
  }
}

/**
 * WS-2 M1 (3) / M1A (1): the outcome of persisting a visitor session.
 *
 * Two outcomes are RECOVERIES, not failures — the session id was still
 * resolved, so the visit keeps its journey. They are counted (so the rate is
 * visible) but never logged as failures and never counted as failures:
 *   • `recovered_conflict` — a concurrent request won the insert; we adopted it.
 *   • `insert_retried`     — a transient error was retried.
 *
 * Everything else means either the visit was never linked to a session (it
 * will contribute no journey, behaviour or intent signal at all) or its stored
 * journey snapshot is stale.
 */
export type SessionPersistOutcome =
  | 'recovered_conflict'
  | 'insert_retried'
  | 'conflict_unrecovered'
  | 'insert_failed'
  | 'missing_id'
  | 'read_failed'
  | 'refresh_failed';

/**
 * Closed, bounded set — a database failure family, not a raw error code.
 * Raw codes/messages go in the log payload; only the family is a metric label.
 */
export type DbErrorClass = 'conflict' | 'permission' | 'missing_table' | 'transient' | 'timeout' | 'unknown';

const SESSION_IMPACT: Record<SessionPersistOutcome, string> = {
  recovered_conflict: 'none — concurrent insert adopted',
  insert_retried: 'none — transient error retried',
  conflict_unrecovered: 'session not linked; the visit contributes no journey or behaviour signal',
  insert_failed: 'session not linked; the visit contributes no journey or behaviour signal',
  missing_id: 'session not linked; the visit contributes no journey or behaviour signal',
  read_failed: 'existing-session lookup degraded; insert path will create or adopt the row',
  refresh_failed: 'session kept its id but its journey snapshot was not refreshed',
};

const SESSION_RECOVERIES: ReadonlySet<SessionPersistOutcome> = new Set<SessionPersistOutcome>([
  'recovered_conflict',
  'insert_retried',
]);

export function recordSessionPersistence(input: {
  outcome: SessionPersistOutcome;
  errorClass?: DbErrorClass;
  detail?: string;
  companyId?: string;
}): void {
  const { outcome, errorClass } = input;
  counter(INTEL_METRICS.session.persistence, { outcome, error_class: errorClass ?? 'none' });
  if (SESSION_RECOVERIES.has(outcome)) return;

  counter(INTEL_METRICS.session.failures, { outcome, error_class: errorClass ?? 'none' });
  const { emit, suppressed } = shouldLog(`session_persist:${outcome}:${errorClass ?? 'none'}`, Date.now());
  if (emit) {
    safeLog('warn', 'intel_session_persist_failed', {
      outcome,
      error_class: errorClass ?? null,
      company_id: input.companyId ?? null,
      detail: input.detail ?? null,
      impact: SESSION_IMPACT[outcome],
      suppressed_since_last: suppressed,
    });
  }
}

// ── WS-2 M2: visitor dimensions + event coverage ────────────────────────────

/** Closed set — the event families the intelligence pipeline understands. */
export type EventFamily = 'page_view' | 'download' | 'video' | 'search' | 'conversion' | 'other';

/**
 * Device/geo enrichment outcome for ONE request (not one event — the tracker
 * batches, and the context is parsed once per request).
 *
 * Both labels are booleans, so this is exactly 4 series regardless of traffic.
 * A sustained `device=false` share means the parser has stopped recognising a
 * real browser; a sustained `geo=false` means the edge is not forwarding its
 * geography headers. Neither breaks anything — both silently flatten the new
 * intelligence — which is precisely why they are counted.
 */
export function recordVisitorContext(input: { device: boolean; geo: boolean }): void {
  counter(INTEL_METRICS.visitor.context, { device: input.device, geo: input.geo });
}

/**
 * One tracking event accepted or rejected at ingestion, by family. Bounded:
 * 6 families × 2 outcomes. The event NAME is never a label — trackers can send
 * arbitrary names, which would be an unbounded cardinality source.
 */
export function recordEventIngestion(family: EventFamily, outcome: 'accepted' | 'rejected'): void {
  counter(INTEL_METRICS.event.ingested, { family, outcome });
  if (outcome === 'rejected') {
    const { emit, suppressed } = shouldLog(`event_rejected:${family}`, Date.now());
    if (emit) {
      safeLog('warn', 'intel_event_ingest_rejected', {
        family,
        impact: 'event not stored; it cannot contribute to behaviour, intent or timeline',
        suppressed_since_last: suppressed,
      });
    }
  }
}

/**
 * WS-2 M3 — one generated envelope's evolution shape.
 *
 * Called by the ORCHESTRATOR, never by an engine: the engines are pure and
 * must stay that way, so instrumentation lives at the seam that already
 * records generation outcomes.
 *
 * Cardinality is closed by construction: 6 trends × 6 stages × 6 journey
 * states as separate counters (not a cross-product label set), plus a
 * transition counter keyed on direction only. Lead and company ids never
 * appear — they are not labels here for the same reason they are not labels
 * anywhere else in this module.
 */
export function recordEvolution(input: {
  intentTrend: string;
  funnelStage: string;
  journeyState: string;
  advancements: number;
  regressions: number;
  checkpoints: number;
  timelineEntries: number;
}): void {
  counter(INTEL_METRICS.evolution.intentTrend, { trend: input.intentTrend });
  counter(INTEL_METRICS.evolution.funnelStage, { stage: input.funnelStage });
  counter(INTEL_METRICS.evolution.journeyState, { state: input.journeyState });
  if (input.advancements > 0) {
    recordRawCounterSafe(INTEL_METRICS.evolution.funnelTransition, input.advancements, { direction: 'advance' });
  }
  if (input.regressions > 0) {
    recordRawCounterSafe(INTEL_METRICS.evolution.funnelTransition, input.regressions, { direction: 'regress' });
  }
  histogram(INTEL_METRICS.evolution.checkpoints, input.checkpoints);
  histogram(INTEL_METRICS.evolution.timelineEntries, input.timelineEntries);
}

/** Counter increment by N, wrapped like every other recorder in this module. */
function recordRawCounterSafe(name: string, by: number, labels: Record<string, string | number | boolean>): void {
  try {
    recordRawCounter(name, by, labels);
  } catch {
    /* telemetry must never break the caller */
  }
}

// ── Activation ──────────────────────────────────────────────────────────────

export function recordActivationDecision(outcome: ActivationOutcome, reason: string): void {
  counter(INTEL_METRICS.activation.decision, { outcome, reason });
  if (outcome === 'failed_open') {
    const { emit, suppressed } = shouldLog(`activation_failed_open:${reason}`, Date.now());
    if (emit) {
      safeLog('warn', 'intel_activation_failed_open', { reason, suppressed_since_last: suppressed });
    }
  }
}

export function recordActivationFanout(kind: 'session_leads' | 'request_sessions', count: number): void {
  histogram(INTEL_METRICS.activation.fanout, count, { kind });
}

// ── Read surfaces ───────────────────────────────────────────────────────────

export function recordRead(input: { surface: ReadSurface; durationMs: number; freshness?: string; count?: number }): void {
  counter(INTEL_METRICS.read.count, { surface: input.surface, freshness: input.freshness ?? 'n/a' });
  histogram(INTEL_METRICS.read.duration, input.durationMs, { surface: input.surface });
  if (typeof input.count === 'number') histogram(INTEL_METRICS.read.bulkIds, input.count, { surface: input.surface });
}

export function recordReadFailure(surface: ReadSurface, detail?: string): void {
  counter(INTEL_METRICS.read.failures, { surface });
  const { emit, suppressed } = shouldLog(`read_fail:${surface}`, Date.now());
  if (emit) {
    safeLog('warn', 'intel_read_failed', {
      surface,
      detail: detail ?? null,
      impact: 'response degraded to never_generated',
      suppressed_since_last: suppressed,
    });
  }
}

/**
 * The read mapper rejected a record whose tenant did not match the request.
 * Always logged (never throttled away entirely) — this is a security signal,
 * not a routine failure.
 */
export function recordTenantMismatch(requestedCompanyId: string, recordCompanyId: string, leadId: string): void {
  counter(INTEL_METRICS.read.tenantMismatch);
  safeLog('error', 'intel_tenant_mismatch_blocked', {
    requested_company_id: requestedCompanyId,
    record_company_id: recordCompanyId,
    lead_id: leadId,
    impact: 'record withheld and served as never_generated',
  });
}
