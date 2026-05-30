/**
 * Cost Observation Store (Cost Estimate Accuracy — Phase 5 + 6).
 *
 * Bounded in-memory ring buffer of (estimated USD, actual USD)
 * observations, keyed by (content_type × variant_mode). Used for:
 *
 *   - Post-run variance display: caller compares estimated vs actual
 *     for a specific run.
 *   - Learning calibration: rolling mean variance per
 *     (content_type × mode) so operators can see whether the cost
 *     profiles are drifting and tune them via env overrides.
 *
 * STRICT scope:
 *   - PURE bookkeeping. No mutations to billing. No automatic
 *     adjustment of cost profiles — calibration is OPERATOR
 *     ACKNOWLEDGED (the surface only reports variance; tuning is
 *     manual via the env overrides documented in costProfiles.ts).
 *   - Bounded: 200 observations × 6 (content_type × mode) buckets
 *     ≈ 1200 entries max → ~50 KB. Old observations evict FIFO.
 */

export type CostObservation = {
  occurredAt: string;
  companyId: string;
  /** 'image' | 'carousel' | 'infographic' | other content types. */
  content_type: string;
  /** Variant mode the run executed under. */
  variant_mode:
    | 'single_variant'
    | 'best_variant'
    | 'top_3_variants'
    | 'experiment'
    | 'no_variant';
  /** Number of assets the run actually generated. */
  asset_count: number;
  estimated_usd: number;
  actual_usd: number;
  /** (actual − estimated) ÷ estimated; null when estimated == 0. */
  variance_pct: number | null;
};

const MAX_OBSERVATIONS_PER_BUCKET = 200;

function bucketKey(contentType: string, variantMode: string): string {
  return `${String(contentType).trim().toLowerCase()}::${String(variantMode).trim().toLowerCase()}`;
}

const buckets = new Map<string, CostObservation[]>();

/**
 * Record a single (estimated, actual) observation. Best-effort —
 * any invalid input is silently dropped so the calling generation
 * path is never destabilized.
 */
export function recordCostObservation(input: {
  companyId: string;
  contentType: string;
  variantMode: CostObservation['variant_mode'];
  assetCount: number;
  estimatedUsd: number;
  actualUsd: number;
  occurredAt?: string;
}): CostObservation | null {
  try {
    if (!input || !input.companyId) return null;
    if (!Number.isFinite(input.estimatedUsd) || !Number.isFinite(input.actualUsd)) return null;
    if (input.estimatedUsd < 0 || input.actualUsd < 0) return null;
    const occurredAt = typeof input.occurredAt === 'string' && input.occurredAt
      ? input.occurredAt
      : new Date().toISOString();
    const variance = input.estimatedUsd > 0
      ? (input.actualUsd - input.estimatedUsd) / input.estimatedUsd
      : null;
    const obs: CostObservation = {
      occurredAt,
      companyId: input.companyId,
      content_type: String(input.contentType ?? 'unknown').toLowerCase(),
      variant_mode: input.variantMode,
      asset_count: Math.max(1, Math.floor(input.assetCount || 0)),
      estimated_usd: Number(input.estimatedUsd.toFixed(6)),
      actual_usd: Number(input.actualUsd.toFixed(6)),
      variance_pct: variance !== null ? Number(variance.toFixed(6)) : null,
    };
    const key = bucketKey(obs.content_type, obs.variant_mode);
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = [];
      buckets.set(key, bucket);
    }
    bucket.push(obs);
    if (bucket.length > MAX_OBSERVATIONS_PER_BUCKET) {
      bucket.splice(0, bucket.length - MAX_OBSERVATIONS_PER_BUCKET);
    }
    return obs;
  } catch {
    return null;
  }
}

/* ── Read-side helpers ─────────────────────────────────────────── */

export type CostAccuracyBucket = {
  content_type: string;
  variant_mode: CostObservation['variant_mode'];
  sample_count: number;
  /** Mean variance — positive means actual > estimated (under-estimate). */
  mean_variance_pct: number | null;
  median_variance_pct: number | null;
  /** Absolute mean variance — magnitude of error regardless of direction. */
  mean_abs_variance_pct: number | null;
  /** Total estimated + actual across the bucket. */
  total_estimated_usd: number;
  total_actual_usd: number;
  /** ISO of the most recent observation. */
  last_observed_at: string | null;
};

function median(sortedAsc: number[]): number | null {
  if (sortedAsc.length === 0) return null;
  const mid = Math.floor(sortedAsc.length / 2);
  return sortedAsc.length % 2 === 0
    ? (sortedAsc[mid - 1] + sortedAsc[mid]) / 2
    : sortedAsc[mid];
}

export type GetCostAccuracySummaryScope = {
  companyId?: string;
  /** Optional content-type filter. */
  contentType?: string;
  /** Optional variant-mode filter. */
  variantMode?: CostObservation['variant_mode'];
};

/**
 * Returns a per-bucket variance summary. When `scope.companyId` is
 * set, observations are filtered to that org; otherwise the summary
 * spans every org seen (used by super-admin diagnostics).
 */
export function getCostAccuracySummary(
  scope: GetCostAccuracySummaryScope = {},
): CostAccuracyBucket[] {
  const out: CostAccuracyBucket[] = [];
  for (const [key, bucket] of buckets.entries()) {
    const [contentType, variantMode] = key.split('::');
    if (scope.contentType && contentType !== String(scope.contentType).toLowerCase()) continue;
    if (scope.variantMode && variantMode !== scope.variantMode) continue;
    const filtered = scope.companyId
      ? bucket.filter((o) => o.companyId === scope.companyId)
      : bucket;
    if (filtered.length === 0) continue;
    const variances = filtered
      .map((o) => o.variance_pct)
      .filter((v): v is number => v !== null);
    const meanVariance = variances.length > 0
      ? variances.reduce((a, b) => a + b, 0) / variances.length
      : null;
    const absVariances = variances.map((v) => Math.abs(v));
    const meanAbsVariance = absVariances.length > 0
      ? absVariances.reduce((a, b) => a + b, 0) / absVariances.length
      : null;
    const sorted = [...variances].sort((a, b) => a - b);
    const medianVariance = median(sorted);
    const totalEstimated = filtered.reduce((sum, o) => sum + o.estimated_usd, 0);
    const totalActual = filtered.reduce((sum, o) => sum + o.actual_usd, 0);
    const lastObserved = filtered.reduce<string | null>(
      (max, o) => (max && o.occurredAt < max ? max : o.occurredAt),
      null,
    );
    out.push({
      content_type: contentType,
      variant_mode: variantMode as CostObservation['variant_mode'],
      sample_count: filtered.length,
      mean_variance_pct: meanVariance !== null ? Number(meanVariance.toFixed(6)) : null,
      median_variance_pct: medianVariance !== null ? Number(medianVariance.toFixed(6)) : null,
      mean_abs_variance_pct: meanAbsVariance !== null ? Number(meanAbsVariance.toFixed(6)) : null,
      total_estimated_usd: Number(totalEstimated.toFixed(4)),
      total_actual_usd: Number(totalActual.toFixed(4)),
      last_observed_at: lastObserved,
    });
  }
  // Sort by bucket key for deterministic ordering.
  out.sort((a, b) => {
    const ka = `${a.content_type}::${a.variant_mode}`;
    const kb = `${b.content_type}::${b.variant_mode}`;
    return ka.localeCompare(kb);
  });
  return out;
}

/** List recent observations across all buckets. Bounded by `limit`. */
export function listRecentObservations(input: {
  companyId?: string;
  limit?: number;
} = {}): CostObservation[] {
  const limit = Math.max(1, Math.min(500, input.limit ?? 50));
  const all: CostObservation[] = [];
  for (const bucket of buckets.values()) {
    for (const obs of bucket) {
      if (input.companyId && obs.companyId !== input.companyId) continue;
      all.push(obs);
    }
  }
  return all
    .sort((a, b) => Date.parse(b.occurredAt) - Date.parse(a.occurredAt))
    .slice(0, limit);
}

/** Diagnostics surface — used by health endpoints. */
export function costObservationStoreStats(): {
  bucketCount: number;
  totalObservations: number;
  maxObservationsPerBucket: number;
} {
  let total = 0;
  for (const b of buckets.values()) total += b.length;
  return {
    bucketCount: buckets.size,
    totalObservations: total,
    maxObservationsPerBucket: MAX_OBSERVATIONS_PER_BUCKET,
  };
}

/** Test surface — clears the buffer between tests. NOT used in
 *  production. */
export function clearCostObservations(): void {
  buckets.clear();
}

/**
 * Returns a calibration hint that the estimator can OPTIONALLY use to
 * shift the expected value toward the observed mean. The hint is a
 * multiplicative adjustment factor; 1.0 means "no adjustment".
 *
 * - Returns 1.0 when sample_count < `minSamples` (default 5) so the
 *   estimator does not chase noise.
 * - Returns 1 + mean_variance_pct so the expected value becomes
 *   `estimated × (1 + observed_mean_variance)`, i.e. the centroid of
 *   recent observations.
 * - Clamped to a reasonable range so a single outlier can't blow up
 *   the estimate.
 *
 * Operators can disable calibration adjustment entirely by setting
 * CREATOR_COST_CALIBRATION_DISABLED=true.
 */
export function calibrationAdjustmentFactor(scope: {
  contentType: string;
  variantMode: CostObservation['variant_mode'];
  companyId?: string;
  minSamples?: number;
}): number {
  if (String(process.env.CREATOR_COST_CALIBRATION_DISABLED ?? 'false').toLowerCase() === 'true') {
    return 1.0;
  }
  const minSamples = Math.max(1, scope.minSamples ?? 5);
  const summary = getCostAccuracySummary({
    companyId: scope.companyId,
    contentType: scope.contentType,
    variantMode: scope.variantMode,
  });
  const bucket = summary.find(
    (b) => b.content_type === String(scope.contentType).toLowerCase()
      && b.variant_mode === scope.variantMode,
  );
  if (!bucket || bucket.sample_count < minSamples || bucket.mean_variance_pct === null) {
    return 1.0;
  }
  const factor = 1 + bucket.mean_variance_pct;
  // Hard guardrail: clamp to [0.5, 2.0] so calibration can't 10× the
  // estimate from a single bad sample.
  return Math.max(0.5, Math.min(2.0, factor));
}
