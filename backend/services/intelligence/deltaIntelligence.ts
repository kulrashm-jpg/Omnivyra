// Delta / change intelligence.
//
// Compares the current canonical report against the most recent stored
// snapshot. Detects:
//   - authority gains / losses
//   - per-pillar movements
//   - AI visibility direction changes
//   - benchmark percentile movement
//   - structured-data regressions
//   - trust deterioration
//
// "No fabrication" rule: when there is no prior snapshot, every delta is
// `null` and the result carries `state: 'insufficient_history'`.
//
// COMPARABILITY rule (same family, stricter): a prior snapshot EXISTING is not
// the same as a prior snapshot being COMPARABLE. Before this guard the
// baseline was simply the most recent row for the same `company_id`, so a
// website change, a different scan profile or a different scoring engine was
// published as company movement. A pair that fails `compareComparability` now
// yields `state: 'not_comparable'` carrying the reason — never a number, and
// never silence.

import type {
  CanonicalReport,
  CanonicalScore,
  EvidenceTrace,
  PillarKey,
} from '../canonicalReport/canonicalReportTypes';
import type {
  PillarHistoryRecord,
  ReportSnapshotRecord,
} from './historicalPersistence';
import { getHistoricalStore } from './historicalPersistence';
import { selectComparableBaseline, type ComparabilityIdentity } from './comparabilityIdentity';

export type DeltaDirection = 'improved' | 'regressed' | 'stagnated' | 'first_observation';

export type ScalarDelta = {
  current: number | null;
  previous: number | null;
  delta: number | null;
  direction: DeltaDirection;
  significant: boolean; // |delta| >= 5 points
};

export type ChangeIntelligence = {
  /**
   * `not_comparable` is distinct from `insufficient_history` on purpose:
   * "we have not measured you twice yet" and "we have measured you twice but
   * not the same way" are different things to tell a reader, and only the
   * first is fixed by waiting.
   */
  state: 'measured' | 'insufficient_history' | 'not_comparable';
  observed_at: string;
  comparison_baseline_at: string | null;
  // Top-level deltas
  authority: ScalarDelta;
  ai_visibility: ScalarDelta;
  benchmark_percentile: ScalarDelta;
  // Per-pillar deltas
  pillars: Array<{
    pillar: PillarKey;
    delta: ScalarDelta;
  }>;
  // Concrete observed changes (human-readable list).
  notable_changes: string[];
  evidence: EvidenceTrace;
  reason_unavailable: string | null;
};

const SIGNIFICANT_THRESHOLD = 5;

function classifyDirection(delta: number | null): DeltaDirection {
  if (delta == null) return 'first_observation';
  if (delta > 1.5) return 'improved';
  if (delta < -1.5) return 'regressed';
  return 'stagnated';
}

function buildScalarDelta(current: number | null, previous: number | null): ScalarDelta {
  if (current == null && previous == null) {
    return { current, previous, delta: null, direction: 'first_observation', significant: false };
  }
  if (current == null || previous == null) {
    return { current, previous, delta: null, direction: 'first_observation', significant: false };
  }
  const delta = Math.round((current - previous) * 10) / 10;
  return {
    current,
    previous,
    delta,
    direction: classifyDirection(delta),
    significant: Math.abs(delta) >= SIGNIFICANT_THRESHOLD,
  };
}

function evidenceFromHistory(snapshot: ReportSnapshotRecord | null): EvidenceTrace {
  if (!snapshot) {
    return {
      count: 0,
      sources: [],
      freshness: { last_observed_at: null, age_hours: null },
      observations: [],
    };
  }
  return {
    count: 1,
    sources: ['trajectory_history'],
    freshness: { last_observed_at: snapshot.observed_at, age_hours: null },
    observations: [
      {
        signal: `prior_snapshot:${snapshot.observed_at}:authority=${snapshot.authority_score.value ?? '—'}`,
        source: 'trajectory_history',
        observed_at: snapshot.observed_at,
      },
    ],
  };
}

/**
 * The shape returned whenever NO delta may be published. Every scalar is built
 * against a `null` previous, so each one is explicitly `delta: null` rather
 * than `0` — absence is never a zero.
 */
function noDeltaResult(params: {
  state: 'insufficient_history' | 'not_comparable';
  current: CanonicalReport;
  observedAt: string;
  reason: string;
}): ChangeIntelligence {
  return {
    state: params.state,
    observed_at: params.observedAt,
    comparison_baseline_at: null,
    authority: buildScalarDelta(params.current.authority_overview.overall_score.value, null),
    ai_visibility: buildScalarDelta(params.current.ai_surface_presence.score.value, null),
    benchmark_percentile: buildScalarDelta(params.current.benchmark.overlay?.percentile ?? null, null),
    pillars: params.current.pillars.map((p) => ({
      pillar: p.pillar,
      delta: buildScalarDelta(p.score.value, null),
    })),
    notable_changes: [],
    evidence: evidenceFromHistory(null),
    reason_unavailable: params.reason,
  };
}

/**
 * How far back to look for a comparable baseline.
 *
 * The previous value was 2, which only ever saw the single most recent prior
 * row. That is now wrong: an incomparable run (one ad-hoc `deep` scan between
 * two `standard` ones) must not hide the comparable run behind it. 24 matches
 * the window the forecast and trajectory readers already use.
 */
const BASELINE_SEARCH_WINDOW = 24;

export async function buildChangeIntelligence(params: {
  companyId: string;
  current: CanonicalReport;
  /**
   * The comparability identity of THIS run, built by the caller from the same
   * facts it will hand `persistCanonicalSnapshot`. Explicitly `null`able and
   * explicitly required: the parameter cannot be forgotten, and a `null` fails
   * closed into `not_comparable` rather than silently comparing.
   */
  identity: ComparabilityIdentity | null;
}): Promise<ChangeIntelligence> {
  const store = getHistoricalStore();
  const observedAt = new Date().toISOString();

  const recentSnapshots = await store.loadSnapshots({
    company_id: params.companyId,
    limit: BASELINE_SEARCH_WINDOW,
  });
  // The baseline is a PRIOR snapshot, so the current run's own row (if some
  // caller already wrote it) is excluded before comparability is considered.
  const priorSnapshots = recentSnapshots.filter((s) => s.observed_at < observedAt);

  const selection = selectComparableBaseline({
    current: params.identity,
    priorSnapshots,
  });

  if (selection.state === 'no_history') {
    return noDeltaResult({
      state: 'insufficient_history',
      current: params.current,
      observedAt,
      reason: selection.reason,
    });
  }

  if (selection.state === 'not_comparable') {
    // Prior runs exist, but none measured the same subject with the same
    // instrument. Reporting `insufficient_history` here would be a lie by
    // omission ("keep waiting"), so this is its own state.
    return noDeltaResult({
      state: 'not_comparable',
      current: params.current,
      observedAt,
      reason: selection.reason,
    });
  }

  const baseline: ReportSnapshotRecord = selection.baseline;

  const priorPillars = await store.loadPillarHistory({
    company_id: params.companyId,
    from: baseline.observed_at,
    to: baseline.observed_at,
    limit: 12,
  });
  const priorPillarByKey = new Map<PillarKey, PillarHistoryRecord>();
  for (const row of priorPillars) priorPillarByKey.set(row.pillar, row);

  const authorityDelta = buildScalarDelta(
    params.current.authority_overview.overall_score.value,
    baseline.authority_score.value,
  );
  const aiVisibilityDelta = buildScalarDelta(
    params.current.ai_surface_presence.score.value,
    baseline.ai_visibility_score.value,
  );
  const benchmarkDelta = buildScalarDelta(
    params.current.benchmark.overlay?.percentile ?? null,
    null, // benchmark percentile history queried separately when available
  );

  const pillarDeltas = params.current.pillars.map((p) => {
    const prior = priorPillarByKey.get(p.pillar);
    return {
      pillar: p.pillar,
      delta: buildScalarDelta(p.score.value, prior?.score.value ?? null),
    };
  });

  const notable: string[] = [];
  if (authorityDelta.significant) {
    notable.push(
      authorityDelta.delta! > 0
        ? `Authority Index improved by ${authorityDelta.delta} points (${authorityDelta.previous} → ${authorityDelta.current}).`
        : `Authority Index regressed by ${Math.abs(authorityDelta.delta!)} points (${authorityDelta.previous} → ${authorityDelta.current}).`,
    );
  }
  if (aiVisibilityDelta.significant) {
    notable.push(
      aiVisibilityDelta.delta! > 0
        ? `AI surface presence rose ${aiVisibilityDelta.delta} points.`
        : `AI surface presence fell ${Math.abs(aiVisibilityDelta.delta!)} points.`,
    );
  }
  for (const entry of pillarDeltas) {
    if (entry.delta.significant) {
      notable.push(
        entry.delta.delta! > 0
          ? `${entry.pillar} pillar gained ${entry.delta.delta} points.`
          : `${entry.pillar} pillar regressed ${Math.abs(entry.delta.delta!)} points.`,
      );
    }
  }
  if (
    baseline.maturity_stage !== params.current.maturity_stage.stage &&
    baseline.maturity_stage !== 'insufficient_signal' &&
    params.current.maturity_stage.stage !== 'insufficient_signal'
  ) {
    notable.push(
      `Maturity stage transitioned: ${baseline.maturity_stage} → ${params.current.maturity_stage.stage}.`,
    );
  }

  return {
    state: 'measured',
    observed_at: observedAt,
    comparison_baseline_at: baseline.observed_at,
    authority: authorityDelta,
    ai_visibility: aiVisibilityDelta,
    benchmark_percentile: benchmarkDelta,
    pillars: pillarDeltas,
    notable_changes: notable,
    evidence: evidenceFromHistory(baseline),
    reason_unavailable: null,
  };
}
