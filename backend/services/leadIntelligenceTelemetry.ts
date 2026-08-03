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
      logger.warn('intel_generation_failed', {
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
  logger.debug('intel_generation_completed', {
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
  if (input.fromEngine !== input.toEngine) {
    counter(INTEL_METRICS.generation.versionUpgrade, { from: input.fromEngine, to: input.toEngine });
  }
  if (input.fromSchema !== input.toSchema) {
    counter(INTEL_METRICS.generation.schemaUpgrade, { from: input.fromSchema, to: input.toSchema });
  }
  const { emit, suppressed } = shouldLog(`upgrade:${input.fromEngine}->${input.toEngine}`, Date.now());
  if (emit) {
    logger.info('intel_record_upgraded', {
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
    logger.warn('intel_snapshot_read_failed', {
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
    logger.error('intel_persistence_failed', {
      op,
      company_id: companyId ?? null,
      detail,
      impact: op === 'upsert' ? 'generated intelligence was NOT saved' : 'read degraded to never_generated',
      suppressed_since_last: suppressed,
    });
  }
}

// ── Activation ──────────────────────────────────────────────────────────────

export function recordActivationDecision(outcome: ActivationOutcome, reason: string): void {
  counter(INTEL_METRICS.activation.decision, { outcome, reason });
  if (outcome === 'failed_open') {
    const { emit, suppressed } = shouldLog(`activation_failed_open:${reason}`, Date.now());
    if (emit) {
      logger.warn('intel_activation_failed_open', { reason, suppressed_since_last: suppressed });
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
    logger.warn('intel_read_failed', {
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
  logger.error('intel_tenant_mismatch_blocked', {
    requested_company_id: requestedCompanyId,
    record_company_id: recordCompanyId,
    lead_id: leadId,
    impact: 'record withheld and served as never_generated',
  });
}
