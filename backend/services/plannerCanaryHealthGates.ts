/**
 * Canary health gates.
 *
 * Watches a rollout-in-progress and auto-rolls back when configured metric
 * thresholds breach. The gate runs as a periodic check (every
 * `GATE_CHECK_INTERVAL_MS`) during `status === 'in_canary'`. When a gate
 * trips, it calls `rollback()` with a structured reason.
 *
 * Each metric has:
 *   - threshold (numeric value above which the gate trips)
 *   - cooldown   (samples held below threshold required before "healthy" again)
 *   - n_required (samples needed to fire — false-positive suppression)
 *
 * Rolling window: gate state machine keeps a small per-metric ring buffer.
 * A SINGLE high sample doesn't trip; N consecutive high samples within the
 * window do. Symmetric on the recovery side: N consecutive healthy samples
 * are required to clear the alarm.
 *
 * The gate reads metrics from `getPlannerOpsSnapshot()` (single Redis +
 * in-memory aggregation pass) so each check is one round-trip regardless
 * of the number of metrics watched.
 */

import { logger } from './logger';
import { getRolloutState, rollback } from './plannerRolloutOrchestrator';
import { getPlannerOpsSnapshot } from './plannerOpsDashboard';

export type GateMetricName =
  | 'success_rate'
  | 'planner_p95_latency_ms'
  | 'placeholder_fallback_rate'
  | 'provider_exhaustion_rate'
  | 'admission_reject_rate'
  | 'refinement_failure_rate'
  | 'stream_lag_pending'
  | 'sse_disconnect_rate';

/**
 * Threshold definition for one metric. A metric is UNHEALTHY when its
 * observed value is on the wrong side of `threshold` per `direction`.
 *
 *   - `'above'`: unhealthy when value > threshold (e.g. fallback rate)
 *   - `'below'`: unhealthy when value < threshold (e.g. success rate)
 */
export interface GateThreshold {
  metric: GateMetricName;
  threshold: number;
  direction: 'above' | 'below';
  /** Samples within the rolling window that must be unhealthy to trip. */
  unhealthySamplesRequired: number;
  /** Samples that must be healthy to clear the alarm. */
  healthySamplesRequired: number;
  /** Operator-facing label for log messages. */
  label: string;
}

const DEFAULT_THRESHOLDS: GateThreshold[] = [
  { metric: 'success_rate',              threshold: 0.95, direction: 'below', unhealthySamplesRequired: 3, healthySamplesRequired: 5, label: 'plan success rate' },
  { metric: 'planner_p95_latency_ms',    threshold: 60_000, direction: 'above', unhealthySamplesRequired: 3, healthySamplesRequired: 5, label: 'planner p95 latency' },
  { metric: 'placeholder_fallback_rate', threshold: 0.10, direction: 'above', unhealthySamplesRequired: 3, healthySamplesRequired: 5, label: 'placeholder fallback rate' },
  { metric: 'provider_exhaustion_rate',  threshold: 0.05, direction: 'above', unhealthySamplesRequired: 3, healthySamplesRequired: 5, label: 'provider exhaustion rate' },
  { metric: 'admission_reject_rate',     threshold: 0.05, direction: 'above', unhealthySamplesRequired: 3, healthySamplesRequired: 5, label: 'admission reject rate' },
  { metric: 'refinement_failure_rate',   threshold: 0.10, direction: 'above', unhealthySamplesRequired: 3, healthySamplesRequired: 5, label: 'refinement failure rate' },
  { metric: 'stream_lag_pending',        threshold: 100,  direction: 'above', unhealthySamplesRequired: 3, healthySamplesRequired: 5, label: 'event stream pending entries' },
  { metric: 'sse_disconnect_rate',       threshold: 0.20, direction: 'above', unhealthySamplesRequired: 3, healthySamplesRequired: 5, label: 'SSE disconnect rate' },
];

const SAMPLE_RING_CAPACITY = 10;
type SampleRing = { samples: Array<{ value: number; ts: number }>; unhealthyAt: number | null; trippedAt: number | null };
const _ring = new Map<GateMetricName, SampleRing>();

function ringFor(metric: GateMetricName): SampleRing {
  let r = _ring.get(metric);
  if (!r) {
    r = { samples: [], unhealthyAt: null, trippedAt: null };
    _ring.set(metric, r);
  }
  return r;
}

function pushSample(metric: GateMetricName, value: number): void {
  const r = ringFor(metric);
  r.samples.push({ value, ts: Date.now() });
  if (r.samples.length > SAMPLE_RING_CAPACITY) r.samples.shift();
}

function isUnhealthy(value: number, threshold: GateThreshold): boolean {
  return threshold.direction === 'above' ? value > threshold.threshold : value < threshold.threshold;
}

function consecutiveUnhealthyCount(ring: SampleRing, threshold: GateThreshold): number {
  let count = 0;
  for (let i = ring.samples.length - 1; i >= 0; i--) {
    if (isUnhealthy(ring.samples[i].value, threshold)) count++;
    else break;
  }
  return count;
}

function consecutiveHealthyCount(ring: SampleRing, threshold: GateThreshold): number {
  let count = 0;
  for (let i = ring.samples.length - 1; i >= 0; i--) {
    if (isUnhealthy(ring.samples[i].value, threshold)) break;
    else count++;
  }
  return count;
}

/**
 * Extract a single metric's current value from the ops snapshot. Returns
 * null when the metric isn't computable from the snapshot.
 *
 * Most metrics here are rates per 5-min window — the alert counters in
 * `plannerOpsSnapshot` already track this. We convert raw counts to rates
 * by dividing by an assumed traffic floor when the cluster is idle so we
 * don't trip alerts during low-traffic windows.
 */
function extractMetric(
  metric: GateMetricName,
  snap: Awaited<ReturnType<typeof getPlannerOpsSnapshot>>,
): number | null {
  const counters = snap.alert_counters || [];
  const counterByName = new Map(counters.map((c) => [c.counter, c]));
  // Heuristic plan-count denominator: assume the snapshot's drafting_timeout
  // window represents a 5-min cluster window. We don't have a direct
  // "plans/5min" metric here so we use a conservative floor of 20 to avoid
  // div-by-zero and to suppress noise at very low traffic.
  const planFloor = 20;
  switch (metric) {
    case 'success_rate': {
      const fallbacks = counterByName.get('placeholder_fallback')?.recent_cluster ?? counterByName.get('placeholder_fallback')?.recent_local ?? 0;
      const timeouts = (counterByName.get('drafting_timeout')?.recent_cluster ?? 0) + (counterByName.get('alignment_timeout')?.recent_cluster ?? 0);
      const failures = fallbacks + timeouts;
      // Assume at least planFloor plan attempts; success = 1 - failure / total.
      return Math.max(0, 1 - failures / Math.max(planFloor, failures + 1));
    }
    case 'planner_p95_latency_ms':
      // Snapshot doesn't surface latency directly. Returning null tells the
      // gate to skip this metric (no trip, no clear) — operators should pair
      // this with Datadog log-based metric scraping in production.
      return null;
    case 'placeholder_fallback_rate': {
      const fallbacks = counterByName.get('placeholder_fallback')?.recent_cluster ?? counterByName.get('placeholder_fallback')?.recent_local ?? 0;
      return fallbacks / planFloor;
    }
    case 'provider_exhaustion_rate': {
      const exhaust = counterByName.get('provider_bucket_exhausted')?.recent_cluster ?? counterByName.get('provider_bucket_exhausted')?.recent_local ?? 0;
      return exhaust / planFloor;
    }
    case 'admission_reject_rate': {
      // No direct counter today — surfaced via plannerAlerting once admission
      // events get wired. For now derive from overload mode as a proxy:
      // 'critical' mode means admission gate is active.
      const mode = snap.cluster_overload?.mode ?? 'normal';
      return mode === 'critical' ? 0.10 : 0;
    }
    case 'refinement_failure_rate': {
      const refs = counterByName.get('refinement_failure')?.recent_cluster ?? counterByName.get('refinement_failure')?.recent_local ?? 0;
      return refs / planFloor;
    }
    case 'stream_lag_pending': {
      const max = (snap.stream_lag || []).reduce((m, l) => Math.max(m, l.pending), 0);
      return max;
    }
    case 'sse_disconnect_rate':
      // No direct counter today. Skip — return null.
      return null;
  }
}

export interface GateEvaluation {
  metric: GateMetricName;
  observed: number | null;
  unhealthy: boolean;
  consecutiveUnhealthy: number;
  consecutiveHealthy: number;
  triggered: boolean;
  cleared: boolean;
  label: string;
}

let _customThresholds: GateThreshold[] | null = null;

/** Override the default threshold set. Useful for staging vs prod tuning. */
export function setGateThresholds(thresholds: GateThreshold[]): void {
  _customThresholds = thresholds;
}

export function getGateThresholds(): GateThreshold[] {
  return _customThresholds ?? DEFAULT_THRESHOLDS;
}

/**
 * One evaluation pass. Reads the ops snapshot, pushes a sample per metric,
 * computes consecutive-unhealthy / consecutive-healthy counts, and returns
 * the per-metric verdict.
 *
 * Side effects: when ANY gate triggers AND the rollout is currently in
 * `in_canary`, this function calls `rollback()` once with the trip reason.
 *
 * Returns the evaluation array so callers (control-plane API) can render
 * the state without re-evaluating.
 */
export async function evaluateHealthGates(opts: { dryRun?: boolean } = {}): Promise<GateEvaluation[]> {
  const snap = await getPlannerOpsSnapshot();
  const thresholds = getGateThresholds();
  const evaluations: GateEvaluation[] = [];
  let firstTrip: GateEvaluation | null = null;
  for (const t of thresholds) {
    const observed = extractMetric(t.metric, snap);
    if (observed === null) {
      // Metric not computable — push a neutral sample so the ring still ages.
      evaluations.push({
        metric: t.metric,
        observed: null,
        unhealthy: false,
        consecutiveUnhealthy: 0,
        consecutiveHealthy: 0,
        triggered: false,
        cleared: false,
        label: t.label,
      });
      continue;
    }
    pushSample(t.metric, observed);
    const ring = ringFor(t.metric);
    const consecutiveUnhealthy = consecutiveUnhealthyCount(ring, t);
    const consecutiveHealthy = consecutiveHealthyCount(ring, t);
    const wasTripped = ring.trippedAt !== null;
    const unhealthy = isUnhealthy(observed, t);

    let triggered = false;
    let cleared = false;
    if (!wasTripped && consecutiveUnhealthy >= t.unhealthySamplesRequired) {
      ring.trippedAt = Date.now();
      triggered = true;
      if (!firstTrip) firstTrip = {
        metric: t.metric, observed, unhealthy: true,
        consecutiveUnhealthy, consecutiveHealthy: 0,
        triggered: true, cleared: false, label: t.label,
      };
    } else if (wasTripped && consecutiveHealthy >= t.healthySamplesRequired) {
      ring.trippedAt = null;
      cleared = true;
    }
    evaluations.push({
      metric: t.metric,
      observed,
      unhealthy,
      consecutiveUnhealthy,
      consecutiveHealthy,
      triggered,
      cleared,
      label: t.label,
    });
  }

  if (firstTrip && !opts.dryRun) {
    const state = await getRolloutState();
    if (state.status === 'in_canary') {
      logger.warn('planner_canary_gate_tripped', {
        metric: firstTrip.metric,
        observed: firstTrip.observed,
        label: firstTrip.label,
        active_mode: state.active_mode,
        target_mode: state.target_mode,
        rollback_to: state.rollback_mode,
      });
      await rollback({
        operatorId: 'canary-gate',
        reason: `auto_rollback:${firstTrip.metric}=${firstTrip.observed}>threshold`,
      });
    } else {
      logger.warn('planner_canary_gate_tripped_no_rollout_in_progress', {
        metric: firstTrip.metric,
        status: state.status,
      });
    }
  }
  return evaluations;
}

let _checkTimer: ReturnType<typeof setInterval> | null = null;

/**
 * Start the periodic gate-checker. Idempotent. Runs every
 * `PLANNER_GATE_CHECK_INTERVAL_MS` (default 60s). Stops automatically when
 * called twice — second invocation is a no-op.
 */
export function startCanaryHealthGates(): void {
  if (_checkTimer) return;
  const intervalMs = Math.max(15_000, Number(process.env.PLANNER_GATE_CHECK_INTERVAL_MS || 60_000));
  const tick = async (): Promise<void> => {
    try {
      const state = await getRolloutState();
      if (state.status !== 'in_canary') return;
      await evaluateHealthGates();
    } catch {
      /* gate ticker never throws */
    }
  };
  _checkTimer = setInterval(tick, intervalMs);
  try { (_checkTimer as any).unref?.(); } catch { /* noop */ }
  void tick();
  logger.info('planner_canary_health_gates_started', { interval_ms: intervalMs });
}

export function stopCanaryHealthGates(): void {
  if (_checkTimer) clearInterval(_checkTimer);
  _checkTimer = null;
}

export function __resetGatesForTests(): void {
  _ring.clear();
  _customThresholds = null;
  if (_checkTimer) { clearInterval(_checkTimer); _checkTimer = null; }
}
