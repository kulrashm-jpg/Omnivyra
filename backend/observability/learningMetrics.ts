/**
 * WRITER-EXEC-006 Wave 5 — Learning observability (item 8).
 *
 * Thin, FAIL-SAFE wrappers over the existing HARDEN-001 metrics framework
 * (see ./metrics.ts), mirroring ./originalityMetrics.ts exactly. We deliberately
 * reuse the framework's raw counter / histogram primitives
 * (`recordRawCounter` / `recordRawHistogram`) rather than introducing a new
 * registry: those helpers already
 *   - honour the global `OBSERVABILITY_ENABLED` master switch,
 *   - apply the bounded-cardinality + reservoir caps of the shared registry,
 *   - and never throw.
 *
 * Every function here adds a second try/catch belt-and-suspenders so a bug in this
 * module can NEVER surface into the Writer learning / generation path. Emitting a
 * metric is always best-effort: on any failure we swallow and move on.
 *
 * Metric names follow the framework's `<domain>.<subject>[.<unit>]` convention.
 */
import { recordRawCounter, recordRawHistogram, type Labels } from './metrics';

/** Single source of truth for learning metric names. */
export const LEARNING_METRICS = {
  /** counter — a learning rollup / intelligence write happened. */
  updates: 'learning.updates',
  /** histogram — measured prediction accuracy, 0..1 (higher = better calibrated). */
  predictionAccuracy: 'learning.prediction_accuracy',
  /** histogram — observed effectiveness of a surfaced recommendation, 0..1. */
  recommendationEffectiveness: 'learning.recommendation_effectiveness',
  /** histogram — time to retrieve learning memory / intelligence, ms. */
  retrievalLatencyMs: 'learning.retrieval_latency_ms',
  /** histogram — time to ingest a performance signal / derive intelligence, ms. */
  ingestionLatencyMs: 'learning.ingestion_latency_ms',
  /** histogram — model/rollup freshness marker (e.g. model_version at read time). */
  modelFreshness: 'learning.model_freshness',
  /** histogram — how many platforms the learning intelligence currently covers. */
  platformIntelligenceCoverage: 'learning.platform_intelligence_coverage',
} as const;

/** Coerce any label values to bounded, safe strings. */
function safeLabels(a?: Record<string, string | undefined>): Labels {
  const labels: Labels = {};
  if (a) {
    for (const [k, v] of Object.entries(a)) {
      if (v == null) continue;
      labels[k] = String(v).slice(0, 32);
    }
  }
  return labels;
}

/** Record that a learning rollup / intelligence write occurred. */
export function recordLearningUpdate(kind?: string, count = 1): void {
  try {
    if (!Number.isFinite(count) || count <= 0) return;
    recordRawCounter(LEARNING_METRICS.updates, count, safeLabels({ kind }));
  } catch { /* fail-safe */ }
}

/** Observe measured prediction accuracy (0..1). */
export function recordLearningPredictionAccuracy(value: number, platform?: string): void {
  try {
    if (!Number.isFinite(value) || value < 0 || value > 1) return;
    recordRawHistogram(LEARNING_METRICS.predictionAccuracy, value, safeLabels({ platform }));
  } catch { /* fail-safe */ }
}

/** Observe the observed effectiveness of a surfaced recommendation (0..1). */
export function recordLearningRecommendationEffectiveness(value: number, dimension?: string): void {
  try {
    if (!Number.isFinite(value) || value < 0 || value > 1) return;
    recordRawHistogram(LEARNING_METRICS.recommendationEffectiveness, value, safeLabels({ dimension }));
  } catch { /* fail-safe */ }
}

/** Observe learning retrieval latency (ms) into the histogram. */
export function recordLearningRetrievalLatency(ms: number, kind?: string): void {
  try {
    if (!Number.isFinite(ms) || ms < 0) return;
    recordRawHistogram(LEARNING_METRICS.retrievalLatencyMs, ms, safeLabels({ kind }));
  } catch { /* fail-safe */ }
}

/** Observe learning ingestion latency (ms) into the histogram. */
export function recordLearningIngestionLatency(ms: number, source?: string): void {
  try {
    if (!Number.isFinite(ms) || ms < 0) return;
    recordRawHistogram(LEARNING_METRICS.ingestionLatencyMs, ms, safeLabels({ source }));
  } catch { /* fail-safe */ }
}

/**
 * Observe a model-freshness marker. Pass the rollup's `model_version` (or an age
 * in ms) at read/derive time so dashboards can chart staleness.
 */
export function recordLearningModelFreshness(value: number, kind?: string): void {
  try {
    if (!Number.isFinite(value) || value < 0) return;
    recordRawHistogram(LEARNING_METRICS.modelFreshness, value, safeLabels({ kind }));
  } catch { /* fail-safe */ }
}

/** Observe how many platforms the learning intelligence currently covers. */
export function recordLearningPlatformIntelligenceCoverage(platformCount: number): void {
  try {
    if (!Number.isFinite(platformCount) || platformCount < 0) return;
    recordRawHistogram(LEARNING_METRICS.platformIntelligenceCoverage, platformCount);
  } catch { /* fail-safe */ }
}

/**
 * Convenience roll-up: emit the full learning metric set for one learning cycle.
 * All fields optional-safe; any individual emit failing never affects the rest.
 */
export interface LearningMetricSample {
  /** Learning writes performed this cycle (rollup + intelligence upserts). */
  updates?: number;
  /** Measured prediction accuracy, 0..1. */
  predictionAccuracy?: number;
  /** Observed recommendation effectiveness, 0..1. */
  recommendationEffectiveness?: number;
  /** Retrieval latency, ms. */
  retrievalLatencyMs?: number;
  /** Ingestion latency, ms. */
  ingestionLatencyMs?: number;
  /** Model/rollup freshness marker (e.g. model_version). */
  modelFreshness?: number;
  /** Platforms covered by learning intelligence. */
  platformCoverage?: number;
  /** Optional label context. */
  platform?: string;
  dimension?: string;
}

export function recordLearningSample(sample: LearningMetricSample): void {
  try {
    if (typeof sample.updates === 'number') recordLearningUpdate(sample.dimension, sample.updates);
    if (typeof sample.predictionAccuracy === 'number') {
      recordLearningPredictionAccuracy(sample.predictionAccuracy, sample.platform);
    }
    if (typeof sample.recommendationEffectiveness === 'number') {
      recordLearningRecommendationEffectiveness(sample.recommendationEffectiveness, sample.dimension);
    }
    if (typeof sample.retrievalLatencyMs === 'number') {
      recordLearningRetrievalLatency(sample.retrievalLatencyMs);
    }
    if (typeof sample.ingestionLatencyMs === 'number') {
      recordLearningIngestionLatency(sample.ingestionLatencyMs);
    }
    if (typeof sample.modelFreshness === 'number') {
      recordLearningModelFreshness(sample.modelFreshness);
    }
    if (typeof sample.platformCoverage === 'number') {
      recordLearningPlatformIntelligenceCoverage(sample.platformCoverage);
    }
  } catch { /* fail-safe */ }
}
