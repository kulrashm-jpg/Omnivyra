// Comparison engine.
//
// Builds side-by-side comparison views from real history + benchmark data.
// Phase 5 already produces ChangeIntelligence; this engine exposes the same
// data shaped for the comparison UX:
//   - current vs prior snapshot
//   - current vs benchmark median
//   - maturity progression strip
//   - AI visibility evolution
//   - trust evolution
//
// "No misleading comparison semantics" rule:
//   - Any comparison axis whose underlying value is null gets `state: 'unavailable'`.
//   - Confidence-low scores are flagged so the UI can render the comparison muted.

import type {
  CanonicalReport,
  CanonicalScore,
  ConfidenceBand,
  PillarKey,
} from '../canonicalReport/canonicalReportTypes';
import { PILLAR_META } from '../canonicalReport/canonicalReportTypes';
import { getHistoricalStore } from './historicalPersistence';

export type ComparisonAxis = {
  key: string;
  label: string;
  current: number | null;
  baseline: number | null;
  delta: number | null;
  direction: 'improved' | 'regressed' | 'stagnated' | 'first_observation';
  significant: boolean;
  /** When confidence is low we mute the comparison visually. */
  reduced_confidence: boolean;
  state: 'measured' | 'unavailable';
  reason_unavailable: string | null;
};

export type ComparisonStrip = {
  /** `prior_snapshot` = vs most-recent prior; `benchmark_median` = vs vertical median. */
  baseline_kind: 'prior_snapshot' | 'benchmark_median';
  baseline_label: string;
  baseline_observed_at: string | null;
  axes: ComparisonAxis[];
};

export type MaturityProgressionStripEntry = {
  observed_at: string;
  stage: string;
  authority_score: number | null;
};

export type ComparisonView = {
  prior_snapshot_strip: ComparisonStrip;
  benchmark_strip: ComparisonStrip;
  maturity_progression: MaturityProgressionStripEntry[];
};

const SIGNIFICANT_THRESHOLD = 5;

function classify(delta: number | null): ComparisonAxis['direction'] {
  if (delta == null) return 'first_observation';
  if (delta > 1.5) return 'improved';
  if (delta < -1.5) return 'regressed';
  return 'stagnated';
}

function buildAxis(params: {
  key: string;
  label: string;
  currentScore: CanonicalScore | null;
  baselineValue: number | null;
}): ComparisonAxis {
  const current = params.currentScore?.value ?? null;
  const baseline = params.baselineValue;

  if (current == null && baseline == null) {
    return {
      key: params.key,
      label: params.label,
      current: null,
      baseline: null,
      delta: null,
      direction: 'first_observation',
      significant: false,
      reduced_confidence: true,
      state: 'unavailable',
      reason_unavailable: 'Neither current nor baseline value is measured.',
    };
  }
  if (current == null || baseline == null) {
    return {
      key: params.key,
      label: params.label,
      current,
      baseline,
      delta: null,
      direction: 'first_observation',
      significant: false,
      reduced_confidence: true,
      state: 'unavailable',
      reason_unavailable: current == null ? 'Current value is not measured.' : 'Baseline value is not available.',
    };
  }
  const delta = Math.round((current - baseline) * 10) / 10;
  return {
    key: params.key,
    label: params.label,
    current,
    baseline,
    delta,
    direction: classify(delta),
    significant: Math.abs(delta) >= SIGNIFICANT_THRESHOLD,
    reduced_confidence: (params.currentScore?.confidence ?? 'low') === 'low',
    state: 'measured',
    reason_unavailable: null,
  };
}

export async function buildComparisonView(params: {
  companyId: string;
  current: CanonicalReport;
}): Promise<ComparisonView> {
  const store = getHistoricalStore();
  const recent = await store.loadSnapshots({ company_id: params.companyId, limit: 2 });
  const observedAtNow = new Date().toISOString();
  const prior = recent.find((s) => s.observed_at < observedAtNow) ?? null;

  // ── Prior-snapshot strip ────────────────────────────────────────────────────
  const priorPillarRows = prior
    ? await store.loadPillarHistory({
        company_id: params.companyId,
        from: prior.observed_at,
        to: prior.observed_at,
        limit: 10,
      })
    : [];
  const priorPillarByKey = new Map<PillarKey, number | null>();
  for (const row of priorPillarRows) priorPillarByKey.set(row.pillar, row.score.value);

  const priorAxes: ComparisonAxis[] = [
    buildAxis({
      key: 'authority',
      label: 'Authority Index',
      currentScore: params.current.authority_overview.overall_score,
      baselineValue: prior?.authority_score.value ?? null,
    }),
    buildAxis({
      key: 'ai_visibility',
      label: 'AI Surface Presence',
      currentScore: params.current.ai_surface_presence.score,
      baselineValue: prior?.ai_visibility_score.value ?? null,
    }),
    ...params.current.pillars.map((p) =>
      buildAxis({
        key: `pillar:${p.pillar}`,
        label: PILLAR_META[p.pillar].label,
        currentScore: p.score,
        baselineValue: priorPillarByKey.get(p.pillar) ?? null,
      }),
    ),
  ];

  // ── Benchmark-median strip ─────────────────────────────────────────────────
  const benchmark = params.current.benchmark.overlay;
  const benchmarkAxes: ComparisonAxis[] = params.current.discoverability_authority_radar.axes.map((axis) => {
    const median = benchmark?.median?.[axis.key] ?? null;
    return buildAxis({
      key: `dim:${axis.key}`,
      label: axis.label,
      currentScore: axis.score,
      baselineValue: median,
    });
  });

  // ── Maturity progression strip ─────────────────────────────────────────────
  const allRecent = await store.loadSnapshots({ company_id: params.companyId, limit: 12 });
  const maturity_progression: MaturityProgressionStripEntry[] = allRecent
    .slice()
    .sort((a, b) => (a.observed_at < b.observed_at ? -1 : 1))
    .map((s) => ({
      observed_at: s.observed_at,
      stage: s.maturity_stage,
      authority_score: s.authority_score.value,
    }));

  return {
    prior_snapshot_strip: {
      baseline_kind: 'prior_snapshot',
      baseline_label: prior ? `Snapshot from ${new Date(prior.observed_at).toLocaleDateString()}` : 'No prior snapshot',
      baseline_observed_at: prior?.observed_at ?? null,
      axes: priorAxes,
    },
    benchmark_strip: {
      baseline_kind: 'benchmark_median',
      baseline_label: benchmark
        ? `${benchmark.vertical ?? 'Unknown vertical'} median (n=${benchmark.peer_count})`
        : 'Benchmark not loaded',
      baseline_observed_at: null,
      axes: benchmarkAxes,
    },
    maturity_progression,
  };
}
