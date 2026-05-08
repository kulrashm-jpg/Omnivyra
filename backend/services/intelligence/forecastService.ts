// Forecast service.
//
// Real linear projection over historical snapshots. No fabricated certainty:
// when the history is too short or too volatile, the service returns an
// `unavailable` forecast with the explicit reason.
//
// Method:
//   - Linear least-squares regression on (days_since_first_snapshot, score) pairs
//   - Confidence band = ±2σ of residuals
//   - Spike filter: drop snapshots whose score is > 2σ from the trendline (outliers)
//   - Volatility detection: if residual stdev / range > 0.45, refuse to project
//   - Insufficient-history: <3 measured snapshots → unavailable

import type {
  CanonicalScore,
  ConfidenceBand,
  EvidenceTrace,
} from '../canonicalReport/canonicalReportTypes';
import type { ReportSnapshotRecord } from './historicalPersistence';

export type ForecastResult = {
  state: 'measured' | 'unavailable';
  horizon_days: number;
  projected_score: CanonicalScore | null;
  // ±2σ band on the projected_score.value
  confidence_band: { lower: number; upper: number } | null;
  // Detected trajectory shape for the historical window.
  trajectory:
    | 'sustained_growth'
    | 'sustained_decay'
    | 'stagnation'
    | 'volatile'
    | 'temporary_spike'
    | 'insufficient_history';
  history_count: number;
  reason_unavailable: string | null;
};

const MIN_HISTORY = 3;
const VOLATILITY_THRESHOLD = 0.45; // residual_stdev / range
const SPIKE_SIGMA = 2.0;

function meanOf(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

function stdevOf(values: number[]): number {
  if (values.length < 2) return 0;
  const mean = meanOf(values);
  const variance = values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

function linearRegression(xs: number[], ys: number[]): { slope: number; intercept: number } | null {
  const n = xs.length;
  if (n < 2) return null;
  const xMean = meanOf(xs);
  const yMean = meanOf(ys);
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    num += (xs[i] - xMean) * (ys[i] - yMean);
    den += (xs[i] - xMean) ** 2;
  }
  if (den === 0) return null;
  const slope = num / den;
  const intercept = yMean - slope * xMean;
  return { slope, intercept };
}

function dayOffsetFromBase(observedAt: string, baseMs: number): number {
  return (new Date(observedAt).getTime() - baseMs) / (1000 * 60 * 60 * 24);
}

function snapshotsSortedAsc(snapshots: ReportSnapshotRecord[]): ReportSnapshotRecord[] {
  return [...snapshots].sort((a, b) => (a.observed_at < b.observed_at ? -1 : a.observed_at > b.observed_at ? 1 : 0));
}

function aggregateEvidence(snapshots: ReportSnapshotRecord[]): EvidenceTrace {
  const sources = new Set<EvidenceTrace['sources'][number]>();
  let count = 0;
  let lastObservedAt: string | null = null;
  const observations: EvidenceTrace['observations'] = [];
  for (const snap of snapshots) {
    count += 1;
    sources.add('trajectory_history');
    lastObservedAt = snap.observed_at;
    observations.push({
      signal: `snapshot:${snap.observed_at}:${snap.authority_score.value ?? '—'}`,
      source: 'trajectory_history',
      observed_at: snap.observed_at,
    });
  }
  return {
    count,
    sources: [...sources],
    freshness: { last_observed_at: lastObservedAt, age_hours: null },
    observations,
  };
}

function bandFromHistoryCount(count: number, residualStdev: number, range: number): ConfidenceBand {
  if (count >= 8 && residualStdev / Math.max(1, range) < 0.18) return 'high';
  if (count >= 5 && residualStdev / Math.max(1, range) < 0.3) return 'medium';
  return 'low';
}

function bandLabelFromValue(value: number): CanonicalScore['band'] {
  if (value >= 75) return 'leading';
  if (value >= 50) return 'operational';
  if (value >= 25) return 'developing';
  return 'foundational';
}

export function buildForecast(params: {
  snapshots: ReportSnapshotRecord[];
  horizonDays: number;
  scoreSelector?: (s: ReportSnapshotRecord) => number | null;
}): ForecastResult {
  const horizon = params.horizonDays;
  const selector = params.scoreSelector ?? ((s: ReportSnapshotRecord) => s.authority_score.value);

  const sorted = snapshotsSortedAsc(params.snapshots);
  const measured = sorted.filter((s) => selector(s) != null);

  if (measured.length < MIN_HISTORY) {
    return {
      state: 'unavailable',
      horizon_days: horizon,
      projected_score: null,
      confidence_band: null,
      trajectory: 'insufficient_history',
      history_count: measured.length,
      reason_unavailable: `Need at least ${MIN_HISTORY} measured snapshots; have ${measured.length}.`,
    };
  }

  const baseMs = new Date(measured[0].observed_at).getTime();
  const xs = measured.map((s) => dayOffsetFromBase(s.observed_at, baseMs));
  const ys = measured.map((s) => selector(s) as number);

  // First pass regression (raw).
  const initial = linearRegression(xs, ys);
  if (!initial) {
    return {
      state: 'unavailable',
      horizon_days: horizon,
      projected_score: null,
      confidence_band: null,
      trajectory: 'insufficient_history',
      history_count: measured.length,
      reason_unavailable: 'All history points share the same observed_at — cannot regress.',
    };
  }

  const initialResiduals = ys.map((y, i) => y - (initial.slope * xs[i] + initial.intercept));
  const residualStdev = stdevOf(initialResiduals);

  // Spike filter: drop points outside ±SPIKE_SIGMA × stdev from trendline.
  const filteredXs: number[] = [];
  const filteredYs: number[] = [];
  let spikesFiltered = 0;
  for (let i = 0; i < ys.length; i++) {
    if (residualStdev === 0 || Math.abs(initialResiduals[i]) <= SPIKE_SIGMA * residualStdev) {
      filteredXs.push(xs[i]);
      filteredYs.push(ys[i]);
    } else {
      spikesFiltered += 1;
    }
  }

  // Re-regress on filtered data.
  const filtered = linearRegression(filteredXs, filteredYs) ?? initial;
  const filteredResiduals = filteredYs.map(
    (y, i) => y - (filtered.slope * filteredXs[i] + filtered.intercept),
  );
  const filteredStdev = stdevOf(filteredResiduals);
  const range = Math.max(...filteredYs) - Math.min(...filteredYs);
  const volatility = filteredStdev / Math.max(1, range);

  // Volatility refusal — explicit, not synthesized.
  if (volatility > VOLATILITY_THRESHOLD && spikesFiltered === 0) {
    return {
      state: 'unavailable',
      horizon_days: horizon,
      projected_score: null,
      confidence_band: null,
      trajectory: 'volatile',
      history_count: measured.length,
      reason_unavailable: `History is too volatile to project (residual_stdev/range = ${volatility.toFixed(2)}; threshold ${VOLATILITY_THRESHOLD}).`,
    };
  }

  // Project at horizon.
  const lastX = filteredXs[filteredXs.length - 1];
  const projectedX = lastX + horizon;
  const projectedRaw = filtered.slope * projectedX + filtered.intercept;
  const projected = Math.round(Math.max(0, Math.min(100, projectedRaw)));

  const lower = Math.round(Math.max(0, Math.min(100, projectedRaw - 2 * filteredStdev)));
  const upper = Math.round(Math.max(0, Math.min(100, projectedRaw + 2 * filteredStdev)));

  // Trajectory classification.
  const slopePerWeek = filtered.slope * 7;
  let trajectory: ForecastResult['trajectory'];
  if (spikesFiltered > 0 && Math.abs(filtered.slope) < 0.05) {
    trajectory = 'temporary_spike';
  } else if (slopePerWeek >= 0.8) {
    trajectory = 'sustained_growth';
  } else if (slopePerWeek <= -0.8) {
    trajectory = 'sustained_decay';
  } else {
    trajectory = 'stagnation';
  }

  const confidence = bandFromHistoryCount(measured.length, filteredStdev, range);
  const evidence = aggregateEvidence(measured);

  return {
    state: 'measured',
    horizon_days: horizon,
    projected_score: {
      value: projected,
      state: 'measured',
      confidence,
      band: bandLabelFromValue(projected),
      evidence,
      benchmark: { value: null, label: null },
    },
    confidence_band: { lower, upper },
    trajectory,
    history_count: measured.length,
    reason_unavailable: null,
  };
}
