/**
 * Creator Observability Service
 *
 * Aggregates the telemetry stream into windowed operational metrics and
 * applies lightweight anomaly heuristics. The admin operations dashboard
 * + alerting service both consume from this layer — so metric definitions
 * live in ONE place, not duplicated across UI + alerting.
 *
 * Windows:  1h, 24h, 7d, 30d.
 * Metrics:
 *   - upload success rate
 *   - resumable recovery rate
 *   - queue contention rate
 *   - publish validation failure rate
 *   - orphan cleanup rate
 *   - upload retry frequency
 *   - schedule unlock latency
 *   - mixed-mode execution latency
 *   - render latency
 *   - attachment readiness conversion rate
 *
 * Anomaly detection:
 *   - Compare 1h window vs 7d baseline. If a failure-class metric exceeds
 *     baseline by Z * stdev (or absolute floor), flag as anomalous.
 *   - Operational health score: weighted aggregate where each metric
 *     contributes a clamped 0-100 score; final score is the weighted mean.
 */

import { supabase } from '../db/supabaseClient';
import { CREATOR_EVENTS } from './creatorOperationalTelemetryService';
import { logger } from './logger';

export type ObservabilityWindow = '1h' | '24h' | '7d' | '30d';

const WINDOW_MS: Record<ObservabilityWindow, number> = {
  '1h': 60 * 60 * 1000,
  '24h': 24 * 60 * 60 * 1000,
  '7d': 7 * 24 * 60 * 60 * 1000,
  '30d': 30 * 24 * 60 * 60 * 1000,
};

const MAX_AGG_ROWS = 25_000;

export type EventCounts = Record<string, number>;

export type MetricSnapshot = {
  window: ObservabilityWindow;
  generated_at: string;
  total_events: number;
  counts_by_event: EventCounts;
  latencies_ms: Record<string, { p50: number; p95: number; p99: number; max: number; samples: number }>;
  rates: {
    upload_success: number;        // 0-1
    upload_failure: number;
    resumable_recovery: number;
    queue_contention: number;
    publish_validation_failure: number;
    orphan_cleanup_rate: number;
    upload_retry_per_hour: number;
    attachment_readiness_conversion: number; // (ready_for_schedule events / upload_started events)
    /** CONDITION attempts in the window = applied + degraded. A COUNT, not a ratio. */
    condition_attempts: number;
    /** Canonical CONDITION applications that succeeded. A COUNT. */
    condition_applied: number;
    /** Canonical CONDITION attempts that fell back. A COUNT. */
    condition_degraded: number;
    /** degraded / attempts, 0-1. 0 when no attempt was made. */
    condition_degradation: number;
  };
  health_score: number;            // 0-100, higher = healthier
  anomalies: AnomalyFinding[];
};

export type AnomalyFinding = {
  kind:
    | 'upload_failure_spike'
    | 'orphan_deletion_spike'
    | 'queue_contention_spike'
    | 'publish_failure_spike'
    | 'lifecycle_deadlock_pattern';
  severity: 'info' | 'warning' | 'critical';
  observed: number;
  baseline: number;
  ratio: number;
  message: string;
};

type RawEvent = {
  event_type: string;
  latency_ms: number | null;
  severity: string | null;
  metadata?: Record<string, unknown> | null;
  created_at?: string;
};

/**
 * Aggregate the operational event stream for a given window.
 * Companies can be scoped via `companyId` so the admin dashboard renders
 * per-tenant slices without leaking cross-company data.
 */
export async function aggregateCreatorMetrics(input: {
  window: ObservabilityWindow;
  companyId?: string | null;
}): Promise<MetricSnapshot> {
  const since = new Date(Date.now() - WINDOW_MS[input.window]).toISOString();
  const rows = await readEvents({ since, companyId: input.companyId ?? null });

  const counts: EventCounts = {};
  const latencyBuckets: Record<string, number[]> = {};
  for (const r of rows) {
    counts[r.event_type] = (counts[r.event_type] ?? 0) + 1;
    if (typeof r.latency_ms === 'number' && Number.isFinite(r.latency_ms)) {
      (latencyBuckets[r.event_type] ??= []).push(r.latency_ms);
    }
  }

  const latencies_ms: Record<string, { p50: number; p95: number; p99: number; max: number; samples: number }> = {};
  for (const [event, samples] of Object.entries(latencyBuckets)) {
    if (samples.length === 0) continue;
    samples.sort((a, b) => a - b);
    latencies_ms[event] = {
      p50: percentile(samples, 0.5),
      p95: percentile(samples, 0.95),
      p99: percentile(samples, 0.99),
      max: samples[samples.length - 1],
      samples: samples.length,
    };
  }

  const rates = computeRates(counts, WINDOW_MS[input.window]);
  const anomalies = await detectAnomalies({ window: input.window, companyId: input.companyId ?? null, currentCounts: counts });
  const health_score = scoreHealth(rates, anomalies);

  return {
    window: input.window,
    generated_at: new Date().toISOString(),
    total_events: rows.length,
    counts_by_event: counts,
    latencies_ms,
    rates,
    health_score,
    anomalies,
  };
}

function computeRates(counts: EventCounts, windowMs: number): MetricSnapshot['rates'] {
  const uploadStart = counts[CREATOR_EVENTS.UPLOAD_STARTED] ?? 0;
  const uploadComplete = counts[CREATOR_EVENTS.UPLOAD_COMPLETED] ?? 0;
  const uploadFail = counts[CREATOR_EVENTS.UPLOAD_FAILED] ?? 0;
  const uploadValFail = counts[CREATOR_EVENTS.UPLOAD_VALIDATION_FAILED] ?? 0;
  const uploadResumed = counts[CREATOR_EVENTS.UPLOAD_RESUMED] ?? 0;
  const resumeDetected = counts[CREATOR_EVENTS.RESUMABLE_SESSION_DETECTED] ?? 0;
  const queueAcquired = counts[CREATOR_EVENTS.QUEUE_LOCK_ACQUIRED] ?? 0;
  const queueContention = counts[CREATOR_EVENTS.QUEUE_LOCK_CONTENTION] ?? 0;
  const publishPass = counts[CREATOR_EVENTS.PUBLISH_VALIDATION_PASSED] ?? 0;
  const publishFail = counts[CREATOR_EVENTS.PUBLISH_VALIDATION_FAILED] ?? 0;
  const orphan = counts[CREATOR_EVENTS.ORPHAN_DELETED] ?? 0;
  const readyForSchedule = counts[CREATOR_EVENTS.ATTACHMENT_READY_FOR_SCHEDULE] ?? 0;
  /*
   * CONDITION attempts come from the event stream and NOTHING else.
   *
   * `provider_model` cannot serve as the denominator (the showcase edit path
   * stamps the same `…:edit`), and `creator_assets` cannot either, because
   * lifecycle deletion removes assets while the events correctly survive. The
   * two events are the only pair that always sum to the attempts made.
   */
  const conditionApplied = counts[CREATOR_EVENTS.CONDITION_REFERENCE_APPLIED] ?? 0;
  const conditionDegraded = counts[CREATOR_EVENTS.CONDITION_REFERENCE_DEGRADED] ?? 0;
  const conditionAttempts = conditionApplied + conditionDegraded;

  // When a metric has no signal (denominator = 0) treat it as neutral/best-case
  // rather than 0 — an empty window should not score as "incident".
  const neutralRatio = (num: number, denom: number, bestCase: number) =>
    denom <= 0 ? bestCase : safeRatio(num, denom);

  const upload_success = neutralRatio(uploadComplete, uploadStart, 1);
  const upload_failure = neutralRatio(uploadFail + uploadValFail, uploadStart, 0);
  const resumable_recovery = neutralRatio(uploadResumed, resumeDetected, 1);
  const queue_contention = neutralRatio(queueContention, queueAcquired + queueContention, 0);
  const publish_validation_failure = neutralRatio(publishFail, publishPass + publishFail, 0);
  const orphan_cleanup_rate = orphan / (windowMs / 3_600_000); // per hour
  const upload_retry_per_hour = (uploadResumed) / (windowMs / 3_600_000);
  const attachment_readiness_conversion = neutralRatio(readyForSchedule, uploadStart, 1);
  // Zero attempts is not zero-percent-degraded and not an incident — it is no
  // signal. `neutralRatio` returns the best case (0 degraded) rather than
  // dividing by zero, matching every other rate here.
  const condition_degradation = neutralRatio(conditionDegraded, conditionAttempts, 0);

  return {
    upload_success,
    upload_failure,
    resumable_recovery,
    queue_contention,
    publish_validation_failure,
    orphan_cleanup_rate,
    upload_retry_per_hour,
    attachment_readiness_conversion,
    condition_attempts: conditionAttempts,
    condition_applied: conditionApplied,
    condition_degraded: conditionDegraded,
    condition_degradation,
  };
}

function safeRatio(num: number, denom: number): number {
  if (!Number.isFinite(num) || !Number.isFinite(denom) || denom <= 0) return 0;
  return Math.max(0, Math.min(1, num / denom));
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.floor(p * (sorted.length - 1))));
  return sorted[idx];
}

async function readEvents(input: { since: string; companyId: string | null }): Promise<RawEvent[]> {
  try {
    let q = supabase
      .from('creator_operational_events')
      .select('event_type, latency_ms, severity, metadata, created_at')
      .gte('created_at', input.since)
      .order('created_at', { ascending: false })
      .limit(MAX_AGG_ROWS);
    if (input.companyId) q = q.eq('company_id', input.companyId);
    const { data, error } = await q;
    if (error) {
      logger.warn('creatorObservability.read_failed', {
        surface: 'creatorObservability',
        error: error.message,
      });
      return [];
    }
    return (Array.isArray(data) ? data : []) as RawEvent[];
  } catch (err) {
    logger.warn('creatorObservability.read_threw', {
      surface: 'creatorObservability',
      error: (err as Error)?.message ?? String(err),
    });
    return [];
  }
}

// ──────────────────────────────────────────────────────────────────────
// Anomaly detection
// ──────────────────────────────────────────────────────────────────────

const ANOMALY_RATIO_THRESHOLD = 3.0; // current rate ≥ 3x baseline
const ANOMALY_ABSOLUTE_FLOOR: Record<string, number> = {
  upload_failure_spike: 5,
  orphan_deletion_spike: 25,
  queue_contention_spike: 10,
  publish_failure_spike: 3,
};

export async function detectAnomalies(input: {
  window: ObservabilityWindow;
  companyId: string | null;
  currentCounts: EventCounts;
}): Promise<AnomalyFinding[]> {
  const findings: AnomalyFinding[] = [];
  // Pull a baseline window (7d) once for cross-comparison.
  const baselineRows = await readEvents({
    since: new Date(Date.now() - WINDOW_MS['7d']).toISOString(),
    companyId: input.companyId,
  });
  const baselineCounts: EventCounts = {};
  for (const r of baselineRows) {
    baselineCounts[r.event_type] = (baselineCounts[r.event_type] ?? 0) + 1;
  }

  const currentWindowHours = WINDOW_MS[input.window] / 3_600_000;
  const baselineWindowHours = WINDOW_MS['7d'] / 3_600_000;

  // Helper to compute an hourly rate from a count, scaled to one hour.
  const rate = (n: number, hours: number) => (hours > 0 ? n / hours : 0);

  const checks: Array<{
    kind: AnomalyFinding['kind'];
    severity: AnomalyFinding['severity'];
    eventTypes: string[];
    floorKey: string;
    label: string;
  }> = [
    {
      kind: 'upload_failure_spike',
      severity: 'warning',
      eventTypes: [CREATOR_EVENTS.UPLOAD_FAILED, CREATOR_EVENTS.UPLOAD_VALIDATION_FAILED, CREATOR_EVENTS.UPLOAD_MIME_SPOOF],
      floorKey: 'upload_failure_spike',
      label: 'Upload failure rate exceeds baseline.',
    },
    {
      kind: 'orphan_deletion_spike',
      severity: 'info',
      eventTypes: [CREATOR_EVENTS.ORPHAN_DELETED],
      floorKey: 'orphan_deletion_spike',
      label: 'Orphan deletions sharply higher than baseline — investigate upload churn or stalled sessions.',
    },
    {
      kind: 'queue_contention_spike',
      severity: 'warning',
      eventTypes: [CREATOR_EVENTS.QUEUE_LOCK_CONTENTION],
      floorKey: 'queue_contention_spike',
      label: 'Queue lock contention spiking — concurrent reschedules or worker pile-up.',
    },
    {
      kind: 'publish_failure_spike',
      severity: 'critical',
      eventTypes: [CREATOR_EVENTS.PUBLISH_VALIDATION_FAILED, CREATOR_EVENTS.ATTACHMENT_PUBLISH_FAILURE],
      floorKey: 'publish_failure_spike',
      label: 'Publish failure rate above tolerance — risk of customer-facing publish gaps.',
    },
  ];

  for (const c of checks) {
    let observed = 0;
    let baseline = 0;
    for (const t of c.eventTypes) {
      observed += input.currentCounts[t] ?? 0;
      baseline += baselineCounts[t] ?? 0;
    }
    const observedRate = rate(observed, currentWindowHours);
    const baselineRate = rate(baseline, baselineWindowHours);
    const ratio = baselineRate > 0 ? observedRate / baselineRate : (observed > 0 ? Infinity : 0);
    const floor = ANOMALY_ABSOLUTE_FLOOR[c.floorKey] ?? 0;

    const exceedsFloor = observed >= floor;
    const exceedsBaseline = baselineRate > 0 && ratio >= ANOMALY_RATIO_THRESHOLD;
    const cleanSpike = baselineRate === 0 && observed >= floor;

    if ((exceedsFloor && exceedsBaseline) || cleanSpike) {
      findings.push({
        kind: c.kind,
        severity: c.severity,
        observed,
        baseline,
        ratio: Number.isFinite(ratio) ? Number(ratio.toFixed(2)) : -1,
        message: c.label,
      });
    }
  }

  // Lifecycle deadlock heuristic: many awaiting_media_upload rows with no
  // corresponding upload_started events implies frontends initiated upload
  // intent but never made it to the server.
  const ready = input.currentCounts[CREATOR_EVENTS.ATTACHMENT_READY_FOR_SCHEDULE] ?? 0;
  const failed = input.currentCounts[CREATOR_EVENTS.UPLOAD_FAILED] ?? 0;
  const started = input.currentCounts[CREATOR_EVENTS.UPLOAD_STARTED] ?? 0;
  if (started > 20 && ready === 0 && failed === 0) {
    findings.push({
      kind: 'lifecycle_deadlock_pattern',
      severity: 'warning',
      observed: started,
      baseline: ready + failed,
      ratio: -1,
      message: 'Uploads are starting but nothing reaches ready_for_schedule or upload_failed — possible deadlock.',
    });
  }

  return findings;
}

// ──────────────────────────────────────────────────────────────────────
// Operational health score
// ──────────────────────────────────────────────────────────────────────

const HEALTH_WEIGHTS = {
  upload_success: 0.25,
  publish_validation_failure: 0.25, // inverted
  queue_contention: 0.15,           // inverted
  attachment_readiness_conversion: 0.15,
  resumable_recovery: 0.10,
  anomaly_penalty: 0.10,
} as const;

function scoreHealth(
  rates: MetricSnapshot['rates'],
  anomalies: AnomalyFinding[],
): number {
  const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
  // Each component is normalized to a 0-100 score where higher is healthier.
  const uploadComp = clamp01(rates.upload_success) * 100;
  const publishComp = (1 - clamp01(rates.publish_validation_failure)) * 100;
  const queueComp = (1 - clamp01(rates.queue_contention)) * 100;
  const readyComp = clamp01(rates.attachment_readiness_conversion) * 100;
  const resumeComp = clamp01(rates.resumable_recovery) * 100;
  // Anomaly penalty: critical = 30, warning = 15, info = 5, capped 100.
  const penalty = Math.min(100, anomalies.reduce((s, a) => s + (a.severity === 'critical' ? 30 : a.severity === 'warning' ? 15 : 5), 0));
  const anomalyComp = 100 - penalty;

  const score =
    uploadComp * HEALTH_WEIGHTS.upload_success +
    publishComp * HEALTH_WEIGHTS.publish_validation_failure +
    queueComp * HEALTH_WEIGHTS.queue_contention +
    readyComp * HEALTH_WEIGHTS.attachment_readiness_conversion +
    resumeComp * HEALTH_WEIGHTS.resumable_recovery +
    anomalyComp * HEALTH_WEIGHTS.anomaly_penalty;

  // Hard ceilings driven by anomaly severity — an active critical anomaly
  // can NEVER sit at a healthy score; a warning anomaly caps the score
  // in the "degraded" band. This makes the score reflect operational
  // reality even when the per-metric components are quiet.
  const hasCritical = anomalies.some((a) => a.severity === 'critical');
  const hasWarning = anomalies.some((a) => a.severity === 'warning');
  let final = Math.round(score);
  if (hasCritical) final = Math.min(final, 40);
  else if (hasWarning) final = Math.min(final, 70);
  return final;
}

/**
 * Workflow degradation classifier — wraps a snapshot into a human-facing
 * status the admin dashboard can render as a colored badge.
 */
export function classifyWorkflowStatus(snapshot: MetricSnapshot): 'healthy' | 'degraded' | 'incident' {
  if (snapshot.anomalies.some((a) => a.severity === 'critical')) return 'incident';
  if (snapshot.health_score < 60) return 'incident';
  if (snapshot.health_score < 80 || snapshot.anomalies.some((a) => a.severity === 'warning')) return 'degraded';
  return 'healthy';
}
