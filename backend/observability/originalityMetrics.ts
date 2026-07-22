/**
 * WRITER-EXEC-003 Wave 2 — Originality observability.
 *
 * Thin, FAIL-SAFE wrappers over the existing HARDEN-001 metrics framework
 * (see ./metrics.ts). We deliberately reuse the framework's raw counter /
 * histogram primitives (`recordRawCounter` / `recordRawHistogram`) rather than
 * introducing a new registry: those helpers already
 *   - honour the global `OBSERVABILITY_ENABLED` master switch,
 *   - apply the bounded-cardinality + reservoir caps of the shared registry,
 *   - and never throw.
 *
 * Every function here adds a second try/catch belt-and-suspenders so a bug in
 * this module can NEVER surface into the Writer generation path. Emitting a
 * metric is always best-effort: on any failure we swallow and move on.
 *
 * Metric names follow the framework's `<domain>.<subject>[.<unit>]` convention.
 */
import { recordRawCounter, recordRawHistogram, type Labels } from './metrics';

/** Single source of truth for originality metric names. */
export const ORIGINALITY_METRICS = {
  /** counter — one per originality check, labelled by decision. */
  checks: 'originality.checks',
  /** counter — checks whose decision was a duplicate. */
  duplicates: 'originality.duplicates',
  /** counter — number of REgeneration attempts performed (0 when accepted first try). */
  regenerationAttempts: 'originality.regeneration_attempts',
  /** histogram — aggregate originality score, 0..1 (1 = fully original). */
  similarityScore: 'originality.similarity_score',
  /** histogram — time spent retrieving + comparing against Content Memory, ms. */
  retrievalLatencyMs: 'originality.retrieval_latency_ms',
  /** histogram — candidate-set cache hit ratio, 0..1 (only when applicable). */
  cacheEfficiency: 'originality.cache_efficiency',
} as const;

/** Coerce any label value to a bounded, safe string/number. */
function safeLabels(contentType?: string, decision?: string): Labels {
  const labels: Labels = {};
  if (contentType) labels.content_type = String(contentType).slice(0, 32);
  if (decision) labels.decision = String(decision).slice(0, 32);
  return labels;
}

/** Record that an originality check ran, tagged with its terminal decision. */
export function recordOriginalityCheckCount(contentType: string, decision: string): void {
  try {
    recordRawCounter(ORIGINALITY_METRICS.checks, 1, safeLabels(contentType, decision));
  } catch { /* fail-safe */ }
}

/** Record that a duplicate was detected. */
export function recordOriginalityDuplicate(contentType: string): void {
  try {
    recordRawCounter(ORIGINALITY_METRICS.duplicates, 1, safeLabels(contentType));
  } catch { /* fail-safe */ }
}

/** Record how many REgeneration attempts were performed for this generation. */
export function recordOriginalityRegenerationAttempts(contentType: string, attempts: number): void {
  try {
    if (!Number.isFinite(attempts) || attempts <= 0) return;
    recordRawCounter(ORIGINALITY_METRICS.regenerationAttempts, attempts, safeLabels(contentType));
  } catch { /* fail-safe */ }
}

/** Observe the aggregate originality score (0..1) into the histogram. */
export function recordOriginalitySimilarityScore(contentType: string, score: number): void {
  try {
    if (!Number.isFinite(score)) return;
    recordRawHistogram(ORIGINALITY_METRICS.similarityScore, score, safeLabels(contentType));
  } catch { /* fail-safe */ }
}

/** Observe retrieval/compare latency (ms) into the histogram. */
export function recordOriginalityRetrievalLatency(contentType: string, ms: number): void {
  try {
    if (!Number.isFinite(ms) || ms < 0) return;
    recordRawHistogram(ORIGINALITY_METRICS.retrievalLatencyMs, ms, safeLabels(contentType));
  } catch { /* fail-safe */ }
}

/** Observe the candidate-set cache hit ratio (0..1). Only call when applicable. */
export function recordOriginalityCacheEfficiency(contentType: string, hitRate: number): void {
  try {
    if (!Number.isFinite(hitRate) || hitRate < 0 || hitRate > 1) return;
    recordRawHistogram(ORIGINALITY_METRICS.cacheEfficiency, hitRate, safeLabels(contentType));
  } catch { /* fail-safe */ }
}

/**
 * Convenience roll-up: emit the full metric set for one originality decision.
 * All fields optional-safe; any individual emit failing never affects the rest.
 */
export interface OriginalityMetricSample {
  contentType: string;
  /** OriginalityResult.decision (accepted|duplicate|regenerated|bypassed|error). */
  decision: string;
  /** Aggregate originality score, 0..1. */
  score?: number;
  /** True when at least one nearest match crossed the duplicate threshold. */
  isDuplicate?: boolean;
  /** REgeneration attempts performed (0 = accepted on first generation). */
  regenerationCount?: number;
  /** Retrieval + comparison latency, ms. */
  retrievalLatencyMs?: number;
  /** Candidate-set cache hit ratio, 0..1 (only emitted when provided). */
  cacheHitRate?: number;
}

export function recordOriginalitySample(sample: OriginalityMetricSample): void {
  try {
    recordOriginalityCheckCount(sample.contentType, sample.decision);
    if (sample.isDuplicate) recordOriginalityDuplicate(sample.contentType);
    if (typeof sample.regenerationCount === 'number') {
      recordOriginalityRegenerationAttempts(sample.contentType, sample.regenerationCount);
    }
    if (typeof sample.score === 'number') {
      recordOriginalitySimilarityScore(sample.contentType, sample.score);
    }
    if (typeof sample.retrievalLatencyMs === 'number') {
      recordOriginalityRetrievalLatency(sample.contentType, sample.retrievalLatencyMs);
    }
    if (typeof sample.cacheHitRate === 'number') {
      recordOriginalityCacheEfficiency(sample.contentType, sample.cacheHitRate);
    }
  } catch { /* fail-safe */ }
}
