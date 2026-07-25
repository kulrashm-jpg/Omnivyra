/**
 * RELEASE-READINESS-001 — Strategic Recommendation Intelligence observability.
 *
 * Thin, FAIL-SAFE wrappers over the existing HARDEN-001 metrics framework
 * (see ./metrics.ts). Like ./originalityMetrics.ts, this deliberately reuses the
 * framework's raw counter / histogram primitives (`recordRawCounter` /
 * `recordRawHistogram`) rather than introducing a parallel registry: those helpers
 * already
 *   - honour the global `OBSERVABILITY_ENABLED` master switch,
 *   - apply the bounded-cardinality + reservoir caps of the shared registry,
 *   - and never throw.
 *
 * Every function here adds a second try/catch belt-and-suspenders so a bug in this
 * module — or a throwing sink — can NEVER surface into the recommendation
 * generation path. Emitting a metric is always best-effort: on any failure we
 * swallow and move on. Nothing here alters a return value, and the enrichment
 * output is byte-identical whether or not observability is enabled.
 *
 * ── PRIVACY CONTRACT (load-bearing — do not relax) ───────────────────────────
 * The six strategic narrative fields (`problem_being_solved`, `gap_being_filled`,
 * `why_now`, `authority_reason`, `expected_transformation`, `campaign_angle`)
 * carry COMPANY-SPECIFIC STRATEGIC CONTENT. This module therefore emits:
 *   - counts, durations, a fixed `path` enum and a fixed `reason` enum — and
 *     NOTHING else.
 * It must NEVER emit: a narrative field value, profile text, a topic string, a
 * company id / name / domain, or any other tenant-identifying value. Every label
 * below is a compile-time literal union, so there is no code path by which caller
 * data can reach the registry.
 *
 * Metric names follow the framework's `<domain>.<subject>[.<unit>]` convention.
 */
import { recordRawCounter, recordRawHistogram, type Labels } from './metrics';

/** Single source of truth for strategic-intelligence metric names. */
export const STRATEGIC_INTELLIGENCE_METRICS = {
  /** counter — enrichment was entered (flag ON). */
  invoked: 'recommendation.strategic_intelligence.invoked',
  /** counter — enrichment returned rows and they were adopted. */
  succeeded: 'recommendation.strategic_intelligence.succeeded',
  /** counter — enrichment did not run, or ran and produced nothing to adopt. */
  skipped: 'recommendation.strategic_intelligence.skipped',
  /** counter — the producer's fail-safe fallback fired. */
  failed: 'recommendation.strategic_intelligence.failed',
  /** histogram — wall time of one enrichment call, ms. */
  durationMs: 'recommendation.strategic_intelligence.duration_ms',
} as const;

/** Which engine seam emitted the sample. Fixed enum — never caller-supplied. */
export type StrategicIntelligencePath = 'primary' | 'fallback';

/** Why enrichment produced no adopted output. Fixed enum — never caller-supplied. */
export type StrategicIntelligenceSkipReason =
  /** `STRATEGIC_RECOMMENDATION_INTELLIGENCE_ENABLED` is not `'true'`. */
  | 'flag_disabled'
  /** Flag ON, producer ran, but returned zero rows (nothing to adopt). */
  | 'empty_result';

/** Why enrichment degraded. Fixed enum — never caller-supplied. */
export type StrategicIntelligenceFailureReason =
  /** The producer's `catch` fired and the generic fallback narrative was returned. */
  | 'producer_fallback';

/**
 * Build the label set. Only literal-union values ever reach this function, and
 * each is re-coerced + length-capped so an `as any` at a call site still cannot
 * smuggle tenant data into the registry.
 */
function safeLabels(
  path?: StrategicIntelligencePath,
  reason?: string,
): Labels {
  const labels: Labels = {};
  if (path) labels.path = String(path).slice(0, 16);
  if (reason) labels.reason = String(reason).slice(0, 32);
  return labels;
}

/** Record that enrichment was entered at `path` (flag ON). */
export function recordStrategicIntelligenceInvoked(path: StrategicIntelligencePath): void {
  try {
    recordRawCounter(STRATEGIC_INTELLIGENCE_METRICS.invoked, 1, safeLabels(path));
  } catch { /* fail-safe */ }
}

/** Record a successful enrichment at `path`, plus its wall time in ms. */
export function recordStrategicIntelligenceSucceeded(
  path: StrategicIntelligencePath,
  durationMs?: number,
): void {
  try {
    recordRawCounter(STRATEGIC_INTELLIGENCE_METRICS.succeeded, 1, safeLabels(path));
    if (typeof durationMs === 'number' && Number.isFinite(durationMs) && durationMs >= 0) {
      recordRawHistogram(STRATEGIC_INTELLIGENCE_METRICS.durationMs, durationMs, safeLabels(path));
    }
  } catch { /* fail-safe */ }
}

/** Record that enrichment produced no adopted output, with a fixed reason. */
export function recordStrategicIntelligenceSkipped(
  reason: StrategicIntelligenceSkipReason,
  path?: StrategicIntelligencePath,
): void {
  try {
    recordRawCounter(STRATEGIC_INTELLIGENCE_METRICS.skipped, 1, safeLabels(path, reason));
  } catch { /* fail-safe */ }
}

/** Record that the producer's fail-safe fallback fired. */
export function recordStrategicIntelligenceFailed(
  reason: StrategicIntelligenceFailureReason,
  path?: StrategicIntelligencePath,
): void {
  try {
    recordRawCounter(STRATEGIC_INTELLIGENCE_METRICS.failed, 1, safeLabels(path, reason));
  } catch { /* fail-safe */ }
}
