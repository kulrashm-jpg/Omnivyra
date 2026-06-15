/**
 * Carousel Phase B — Commit B1 (SHADOW measurement).
 *
 * Bounded in-memory ring buffer for carousel quality + completeness telemetry,
 * mirroring variantPerformanceTelemetry. Pure record-only — no behavior change,
 * no I/O, no Redis (dashboard reads the in-memory summary). Oldest sample drops
 * at the cap.
 *
 * Caps: 200 samples (rolling). Memory footprint: a few KB.
 */

export type CarouselQualitySample = {
  archetype: string;
  generation_attempts: number;
  retry_count: number;
  fallback_used: boolean;
  failed: boolean;
  overall_score: number;
  dimension_scores: Record<string, number | null>;
  occurredAt: string;
  /* ── Commit B2 (enforcement) — additive, optional ── */
  quality_mode?: 'shadow' | 'warn' | 'strict';
  quality_retry_count?: number;
  quality_rejected?: boolean;
  quality_failing_dimensions?: string[];
};

const MAX_SAMPLES = 200;
const buffer: CarouselQualitySample[] = [];

/** Record a single carousel generation's quality + completeness sample. */
export function recordCarouselQualitySample(sample: Omit<CarouselQualitySample, 'occurredAt'>): void {
  buffer.push({ ...sample, occurredAt: new Date().toISOString() });
  if (buffer.length > MAX_SAMPLES) {
    buffer.splice(0, buffer.length - MAX_SAMPLES);
  }
}

/** Raw samples (diagnostics / tests). */
export function getCarouselQualitySamples(): ReadonlyArray<CarouselQualitySample> {
  return buffer.slice();
}

/** Test/ops helper — clear the buffer. */
export function resetCarouselQualityTelemetry(): void {
  buffer.length = 0;
}

export type CarouselQualitySummary = {
  sample_count: number;
  avg_overall_score: number | null;
  avg_dimension_scores: Record<string, number>;
  generation_attempts: number;
  retry_count: number;
  fallback_count: number;
  failure_count: number;
  archetype_distribution: Record<string, number>;
  /* ── Commit B2 (enforcement) ── */
  quality_retry_count: number;
  quality_rejection_count: number;
  quality_failure_dimensions: Record<string, number>;
  mode_distribution: Record<string, number>;
};

/** Dashboard-compatible aggregate over the current ring buffer. */
export function getCarouselQualitySummary(): CarouselQualitySummary {
  const n = buffer.length;
  if (n === 0) {
    return {
      sample_count: 0,
      avg_overall_score: null,
      avg_dimension_scores: {},
      generation_attempts: 0,
      retry_count: 0,
      fallback_count: 0,
      failure_count: 0,
      archetype_distribution: {},
      quality_retry_count: 0,
      quality_rejection_count: 0,
      quality_failure_dimensions: {},
      mode_distribution: {},
    };
  }

  let attempts = 0;
  let retries = 0;
  let fallbacks = 0;
  let failures = 0;
  let overallSum = 0;
  let qualityRetries = 0;
  let qualityRejections = 0;
  const dimSums = new Map<string, { sum: number; count: number }>();
  const archetypes = new Map<string, number>();
  const qualityFailureDims = new Map<string, number>();
  const modes = new Map<string, number>();

  for (const s of buffer) {
    attempts += s.generation_attempts;
    retries += s.retry_count;
    if (s.fallback_used) fallbacks += 1;
    if (s.failed) failures += 1;
    overallSum += s.overall_score;
    archetypes.set(s.archetype, (archetypes.get(s.archetype) ?? 0) + 1);
    for (const [dim, value] of Object.entries(s.dimension_scores)) {
      if (typeof value !== 'number') continue;
      const agg = dimSums.get(dim) ?? { sum: 0, count: 0 };
      agg.sum += value;
      agg.count += 1;
      dimSums.set(dim, agg);
    }
    qualityRetries += s.quality_retry_count ?? 0;
    if (s.quality_rejected) qualityRejections += 1;
    if (s.quality_mode) modes.set(s.quality_mode, (modes.get(s.quality_mode) ?? 0) + 1);
    for (const dim of s.quality_failing_dimensions ?? []) {
      qualityFailureDims.set(dim, (qualityFailureDims.get(dim) ?? 0) + 1);
    }
  }

  const avgDims: Record<string, number> = {};
  for (const [dim, agg] of dimSums) avgDims[dim] = Math.round(agg.sum / agg.count);

  return {
    sample_count: n,
    avg_overall_score: Math.round(overallSum / n),
    avg_dimension_scores: avgDims,
    generation_attempts: attempts,
    retry_count: retries,
    fallback_count: fallbacks,
    failure_count: failures,
    archetype_distribution: Object.fromEntries(archetypes),
    quality_retry_count: qualityRetries,
    quality_rejection_count: qualityRejections,
    quality_failure_dimensions: Object.fromEntries(qualityFailureDims),
    mode_distribution: Object.fromEntries(modes),
  };
}
