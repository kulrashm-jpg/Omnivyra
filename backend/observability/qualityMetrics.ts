/**
 * WRITER-EXEC-005 Wave 4 — Quality & collaboration observability.
 *
 * Thin, FAIL-SAFE wrappers over the existing HARDEN-001 metrics framework
 * (see ./metrics.ts). Like ./originalityMetrics.ts, we deliberately reuse the
 * framework's raw counter / histogram primitives (`recordRawCounter` /
 * `recordRawHistogram`) rather than introducing a new registry: those helpers
 * already
 *   - honour the global `OBSERVABILITY_ENABLED` master switch,
 *   - apply the bounded-cardinality + reservoir caps of the shared registry,
 *   - and never throw.
 *
 * Every function adds a second try/catch belt-and-suspenders so a bug here can
 * NEVER surface into the editing / approval / quality path. Emitting a metric is
 * always best-effort: on any failure we swallow and move on.
 *
 * Metric names follow the framework's `<domain>.<subject>[.<unit>]` convention.
 */
import { recordRawCounter, recordRawHistogram, type Labels } from './metrics';

/** Single source of truth for quality/collaboration metric names. */
export const QUALITY_METRICS = {
  /** histogram — overall deterministic quality score, 0..100. */
  scoreDistribution: 'quality.score_distribution',
  /** counter — a section-level recommendation was accepted. */
  recommendationAccepted: 'quality.recommendation_accepted',
  /** counter — a section-level recommendation was rejected. */
  recommendationRejected: 'quality.recommendation_rejected',
  /** counter — a locked section blocked/deflected an automated rewrite. */
  lockedSectionUsage: 'quality.locked_section_usage',
  /** histogram — time from ready-for-review to approval decision, ms. */
  approvalLatencyMs: 'quality.approval_latency_ms',
  /** histogram — edit distance between AI output and the human-accepted text. */
  editDistance: 'quality.edit_distance',
  /** counter — regeneration requests issued for a piece of content. */
  regenerationFrequency: 'quality.regeneration_frequency',
} as const;

/** Coerce label values to bounded, safe strings. */
function safeLabels(contentType?: string, extra?: Record<string, string | undefined>): Labels {
  const labels: Labels = {};
  if (contentType) labels.content_type = String(contentType).slice(0, 32);
  if (extra) {
    for (const [k, v] of Object.entries(extra)) {
      if (v !== undefined && v !== null && v !== '') labels[k] = String(v).slice(0, 32);
    }
  }
  return labels;
}

/** Observe an overall quality score (0..100) into the distribution histogram. */
export function recordQualityScore(contentType: string, score: number): void {
  try {
    if (!Number.isFinite(score)) return;
    recordRawHistogram(QUALITY_METRICS.scoreDistribution, score, safeLabels(contentType));
  } catch { /* fail-safe */ }
}

/** Count an accepted recommendation, optionally tagged by category. */
export function recordRecommendationAccepted(contentType: string, category?: string): void {
  try {
    recordRawCounter(QUALITY_METRICS.recommendationAccepted, 1, safeLabels(contentType, { category }));
  } catch { /* fail-safe */ }
}

/** Count a rejected recommendation, optionally tagged by category. */
export function recordRecommendationRejected(contentType: string, category?: string): void {
  try {
    recordRawCounter(QUALITY_METRICS.recommendationRejected, 1, safeLabels(contentType, { category }));
  } catch { /* fail-safe */ }
}

/**
 * Count usage of a locked section — i.e. a lock that prevented an automated
 * rewrite from applying. Optionally tagged by the section/block type.
 */
export function recordLockedSectionUsage(contentType: string, section?: string): void {
  try {
    recordRawCounter(QUALITY_METRICS.lockedSectionUsage, 1, safeLabels(contentType, { section }));
  } catch { /* fail-safe */ }
}

/** Observe approval latency (ms) into the histogram. Negative/NaN dropped. */
export function recordApprovalLatency(ms: number, contentType?: string): void {
  try {
    if (!Number.isFinite(ms) || ms < 0) return;
    recordRawHistogram(QUALITY_METRICS.approvalLatencyMs, ms, safeLabels(contentType));
  } catch { /* fail-safe */ }
}

/** Observe an edit distance (AI output → accepted text) into the histogram. */
export function recordEditDistance(distance: number, contentType?: string): void {
  try {
    if (!Number.isFinite(distance) || distance < 0) return;
    recordRawHistogram(QUALITY_METRICS.editDistance, distance, safeLabels(contentType));
  } catch { /* fail-safe */ }
}

/** Count regeneration requests for a piece of content (default 1). */
export function recordRegenerationFrequency(contentType: string, count = 1): void {
  try {
    if (!Number.isFinite(count) || count <= 0) return;
    recordRawCounter(QUALITY_METRICS.regenerationFrequency, count, safeLabels(contentType));
  } catch { /* fail-safe */ }
}
