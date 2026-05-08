// Explainability engine.
//
// Phase 6 mandates that every score / recommendation / benchmark / forecast /
// maturity classification is accompanied by a structured Explanation object.
// The UI renders these as "Why this score?" / "Why this recommendation?" etc.
//
// The Explanation is NOT free-form prose — it's a typed payload the UI can
// render predictably. Free-form text is one field of the structure (the
// `headline`), but the contributing factors and limitations are arrays so
// they survive translation, PDF export, and machine consumption.

import type {
  CanonicalAction,
  CanonicalNarrative,
  CanonicalPillarScore,
  CanonicalReport,
  CanonicalScore,
  ConfidenceBand,
  EvidenceTrace,
  PillarKey,
} from '../canonicalReport/canonicalReportTypes';
import { PILLAR_META } from '../canonicalReport/canonicalReportTypes';
import type { ChangeIntelligence } from './deltaIntelligence';
import type { ForecastResult } from './forecastService';

export type ExplanationFactor = {
  /** Kind of factor — drives the icon/colour in the popover. */
  kind: 'evidence' | 'method' | 'limitation' | 'confidence' | 'override' | 'comparison';
  label: string;
  detail: string;
  /** When known, a numeric weight 0-1 indicating how much this factor moved the result. */
  weight: number | null;
};

export type Explanation = {
  /** One-line answer to "Why this <thing>?" */
  headline: string;
  /** "How was this computed?" — typed steps the UI can render as a sequence. */
  method_summary: string;
  /** Ordered list of contributing factors, strongest first. */
  factors: ExplanationFactor[];
  /** Honest limitations — surfaces "Why is confidence low?" content. */
  limitations: string[];
  /** Confidence band that the explanation itself carries. */
  confidence: ConfidenceBand;
  /** Pointers back to the underlying evidence rows. */
  evidence: EvidenceTrace;
};

// ── Score explanation ─────────────────────────────────────────────────────────

export function explainCanonicalScore(params: {
  score: CanonicalScore;
  label: string;
  context: string; // e.g., "pillar:foundation" or "dimension:ai_surface_presence"
}): Explanation {
  const factors: ExplanationFactor[] = [];
  const limitations: string[] = [];

  const value = params.score.value;
  if (value == null) {
    factors.push({
      kind: 'evidence',
      label: 'No measured evidence',
      detail: `No observation has been recorded for ${params.context} yet.`,
      weight: null,
    });
    limitations.push('Score cannot be computed until at least one observation lands in this scope.');
    return {
      headline: `${params.label} cannot be measured — no evidence is available yet.`,
      method_summary:
        'When a score has no contributing evidence, the engine renders it as Insufficient signal rather than synthesizing a value.',
      factors,
      limitations,
      confidence: 'low',
      evidence: params.score.evidence,
    };
  }

  // Method summary describes how the underlying score was computed.
  factors.push({
    kind: 'method',
    label: 'Composition',
    detail: `${params.label} is a 0-100 ${
      params.context.startsWith('pillar')
        ? 'mean of its measured dimensions'
        : 'composite of its underlying signals'
    }.`,
    weight: null,
  });

  const obsCount = params.score.evidence.count;
  factors.push({
    kind: 'evidence',
    label: `${obsCount} observation${obsCount === 1 ? '' : 's'}`,
    detail: `Across ${params.score.evidence.sources.length} source${params.score.evidence.sources.length === 1 ? '' : 's'}: ${params.score.evidence.sources.join(', ')}.`,
    weight: Math.min(1, obsCount / 10),
  });

  factors.push({
    kind: 'confidence',
    label: `${params.score.confidence} confidence`,
    detail:
      params.score.confidence === 'high'
        ? 'Multiple independent sources agree at sufficient density.'
        : params.score.confidence === 'medium'
          ? 'Either evidence count is moderate or sources are partial.'
          : 'Few observations or weak sources — read the value as directional, not authoritative.',
    weight: null,
  });

  if (params.score.benchmark.value != null && params.score.benchmark.label) {
    factors.push({
      kind: 'comparison',
      label: 'Benchmark anchor',
      detail: `Compared against ${params.score.benchmark.label} (${params.score.benchmark.value}/100).`,
      weight: null,
    });
  }

  if (params.score.confidence === 'low') {
    limitations.push('Confidence is low — the score may shift materially as more evidence lands.');
  }
  if (params.score.evidence.freshness.age_hours != null && params.score.evidence.freshness.age_hours > 168) {
    limitations.push(
      `Evidence freshness lag is ${params.score.evidence.freshness.age_hours}h — re-run a scan for current data.`,
    );
  }
  if (params.score.evidence.sources.length === 1 && params.score.evidence.sources[0] === 'heuristic') {
    limitations.push('Only heuristic sources contributed — connecting a real provider would tighten this score.');
  }

  return {
    headline: `${params.label} is ${value}/100 (${params.score.band}) with ${params.score.confidence} confidence.`,
    method_summary:
      'The engine aggregates measured evidence into a 0-100 score, applies a maturity band, and weights confidence by evidence density × source diversity.',
    factors,
    limitations,
    confidence: params.score.confidence,
    evidence: params.score.evidence,
  };
}

// ── Recommendation explanation ────────────────────────────────────────────────

export function explainRecommendation(action: CanonicalAction): Explanation {
  const factors: ExplanationFactor[] = [
    {
      kind: 'method',
      label: 'Leverage formula',
      detail: 'leverage = severity-weight × confidence × (1 / dependency-depth) + maturity bonuses.',
      weight: null,
    },
    {
      kind: 'evidence',
      label: `Pillar: ${PILLAR_META[action.pillar].label}`,
      detail: PILLAR_META[action.pillar].purpose,
      weight: null,
    },
    {
      kind: 'comparison',
      label: `Severity ${action.severity}`,
      detail: `Severity weights: critical=100, moderate=70, low=40. Confidence multiplier ${action.confidence}.`,
      weight:
        action.severity === 'critical' ? 1.0 : action.severity === 'moderate' ? 0.7 : 0.4,
    },
  ];

  if (action.dependencies.length > 0) {
    factors.push({
      kind: 'limitation',
      label: 'Dependencies',
      detail: `Depends on ${action.dependencies.length} other action${action.dependencies.length === 1 ? '' : 's'} — those must clear first to unlock the full leverage.`,
      weight: null,
    });
  }

  const limitations: string[] = [];
  if (action.confidence === 'low') {
    limitations.push('Confidence on the underlying evidence is low — re-rank after the next snapshot to confirm leverage.');
  }
  if (action.evidence.count === 0) {
    limitations.push('No direct evidence rows yet — the recommendation is inferred from the pillar context only.');
  }

  return {
    headline: `${action.title} — leverage ${action.leverage_score}, ${action.expected_impact} impact at ${action.effort} effort.`,
    method_summary: `Recommendations are ranked by leverage score; the top action ${
      action.maturity_implication === 'shifts_tier'
        ? 'is expected to shift the maturity tier'
        : `${action.maturity_implication.replace(/_/g, ' ')}s the ${PILLAR_META[action.pillar].label} pillar`
    }.`,
    factors,
    limitations,
    confidence: action.confidence,
    evidence: action.evidence,
  };
}

// ── Maturity-stage explanation ────────────────────────────────────────────────

export function explainMaturityStage(maturity_stage: CanonicalReport['maturity_stage']): Explanation {
  const factors: ExplanationFactor[] = [
    {
      kind: 'method',
      label: 'Stage placement',
      detail: 'Stages span 0-24 (Foundational), 25-39 (Emerging), 40-54 (Developing), 55-69 (Operational), 70-84 (Advanced), 85+ (Leading).',
      weight: null,
    },
    {
      kind: 'evidence',
      label: 'Why this stage',
      detail: maturity_stage.why_this_stage,
      weight: null,
    },
    {
      kind: 'limitation',
      label: 'Blocker',
      detail: maturity_stage.blocker.explanation,
      weight: null,
    },
  ];
  return {
    headline: `Stage: ${maturity_stage.label}.${maturity_stage.next_stage ? ` Next: ${maturity_stage.next_stage}.` : ''}`,
    method_summary:
      'Maturity is derived from the Authority Index (the 0-100 overall score). Stage thresholds are fixed and benchmark-relative interpretations are surfaced separately.',
    factors,
    limitations: [],
    confidence: maturity_stage.confidence,
    evidence: maturity_stage.evidence,
  };
}

// ── Forecast explanation ──────────────────────────────────────────────────────

export function explainForecast(forecast: ForecastResult): Explanation {
  if (forecast.state !== 'measured' || !forecast.projected_score) {
    return {
      headline: forecast.reason_unavailable ?? 'Forecast cannot be computed yet.',
      method_summary:
        'Forecasts use linear least-squares regression on historical snapshots, with spike filtering and volatility refusal — when the history is too short or too volatile, the engine returns Unavailable rather than synthesize a projection.',
      factors: [
        {
          kind: 'limitation',
          label: 'Insufficient history',
          detail: `Have ${forecast.history_count} snapshot${forecast.history_count === 1 ? '' : 's'}; need at least 3.`,
          weight: null,
        },
      ],
      limitations: [forecast.reason_unavailable ?? 'No projection available.'],
      confidence: 'low',
      evidence: forecast.projected_score?.evidence ?? {
        count: 0,
        sources: [],
        freshness: { last_observed_at: null, age_hours: null },
        observations: [],
      },
    };
  }
  const value = forecast.projected_score.value ?? 0;
  return {
    headline: `Projected ${value}/100 at the ${forecast.horizon_days}-day horizon (band ${forecast.confidence_band?.lower}-${forecast.confidence_band?.upper}).`,
    method_summary:
      'Linear regression across historical snapshots with ±2σ confidence band. Outliers > 2σ are dropped; high-volatility windows refuse to project.',
    factors: [
      {
        kind: 'method',
        label: `Trajectory: ${forecast.trajectory.replace(/_/g, ' ')}`,
        detail: `Classified from regression slope and residual variance over ${forecast.history_count} snapshot${forecast.history_count === 1 ? '' : 's'}.`,
        weight: null,
      },
      {
        kind: 'evidence',
        label: `${forecast.history_count} historical snapshots`,
        detail: 'Each snapshot is an immutable row in `report_score_history` with timestamp + score + maturity.',
        weight: Math.min(1, forecast.history_count / 12),
      },
    ],
    limitations: forecast.history_count < 6 ? ['History is short — projection widens as more snapshots land.'] : [],
    confidence: forecast.projected_score.confidence,
    evidence: forecast.projected_score.evidence,
  };
}

// ── Benchmark position explanation ────────────────────────────────────────────

export function explainBenchmarkPosition(
  benchmark: CanonicalReport['benchmark'],
): Explanation {
  if (benchmark.state !== 'measured' || !benchmark.overlay) {
    return {
      headline: benchmark.overlay?.reason_unavailable ?? 'No benchmark dataset is loaded.',
      method_summary:
        'Benchmarks are loaded from a curated peer dataset. Insufficient peer coverage forces Unavailable rather than fabricated comparison.',
      factors: [],
      limitations: [benchmark.overlay?.reason_unavailable ?? 'Benchmark unavailable.'],
      confidence: 'low',
      evidence: benchmark.rationale.evidence,
    };
  }
  return {
    headline: `${benchmark.overlay.percentile != null ? benchmark.overlay.percentile + 'th percentile' : 'Position uncomputed'} against ${benchmark.overlay.peer_count} peers in ${benchmark.overlay.vertical}.`,
    method_summary:
      'Percentile is computed from the peer-set score distribution. Median + top-quartile baselines come from the same dataset.',
    factors: [
      {
        kind: 'comparison',
        label: `${benchmark.overlay.peer_count} peers`,
        detail: `Vertical: ${benchmark.overlay.vertical} · Size band: ${benchmark.overlay.size_band}.`,
        weight: null,
      },
      {
        kind: 'evidence',
        label: 'Dataset freshness',
        detail: 'Benchmark dataset carries its own observed_at timestamp.',
        weight: null,
      },
    ],
    limitations: (benchmark.overlay.peer_count ?? 0) < 25 ? ['Peer count is small — percentile precision is limited.'] : [],
    confidence: benchmark.rationale.confidence,
    evidence: benchmark.rationale.evidence,
  };
}

// ── Change intelligence explanation ───────────────────────────────────────────

export function explainChange(change: ChangeIntelligence): Explanation {
  if (change.state !== 'measured') {
    return {
      headline: 'No change history yet — comparison activates on the second snapshot.',
      method_summary: 'Delta intelligence loads the most recent prior snapshot from the historical store and compares it to the current run.',
      factors: [],
      limitations: [change.reason_unavailable ?? 'Insufficient history.'],
      confidence: 'low',
      evidence: change.evidence,
    };
  }
  return {
    headline: `Compared against snapshot from ${new Date(change.comparison_baseline_at!).toLocaleDateString()}: ${change.notable_changes.length} notable change${change.notable_changes.length === 1 ? '' : 's'}.`,
    method_summary:
      'Delta = current - prior. Significance threshold is ±5 points. Pillar-level deltas are surfaced separately.',
    factors: change.notable_changes.map((text) => ({
      kind: 'comparison' as const,
      label: 'Observed change',
      detail: text,
      weight: null,
    })),
    limitations:
      change.notable_changes.length === 0
        ? ['No significant changes since the last snapshot — the brand has held its position.']
        : [],
    confidence: 'medium',
    evidence: change.evidence,
  };
}

// ── Pillar explanation ────────────────────────────────────────────────────────

export function explainPillar(pillar: CanonicalPillarScore): Explanation {
  const explanation = explainCanonicalScore({
    score: pillar.score,
    label: pillar.label,
    context: `pillar:${pillar.pillar}`,
  });
  if (pillar.primary_signal) {
    explanation.factors.unshift({
      kind: 'evidence',
      label: 'Primary signal',
      detail: pillar.primary_signal,
      weight: 1,
    });
  }
  return explanation;
}

// ── Wrapper that summarizes a full report's explanations into an index ────────
//
// Shape consumed by `<ExplainabilityCatalogue>` UI: every score/recommendation/
// stage on the page maps to its Explanation by id.

export type ExplanationIndex = {
  authority_overall: Explanation;
  pillars: Array<{ pillar: PillarKey; explanation: Explanation }>;
  dimensions: Array<{ key: string; explanation: Explanation }>;
  recommendations: Array<{ id: string; explanation: Explanation }>;
  maturity_stage: Explanation;
  forecast: Explanation;
  benchmark: Explanation;
  change: Explanation;
};

export function buildExplanationIndex(report: CanonicalReport): ExplanationIndex {
  return {
    authority_overall: explainCanonicalScore({
      score: report.authority_overview.overall_score,
      label: 'Authority Index',
      context: 'overall',
    }),
    pillars: report.pillars.map((p) => ({ pillar: p.pillar, explanation: explainPillar(p) })),
    dimensions: report.discoverability_authority_radar.axes.map((axis) => ({
      key: axis.key,
      explanation: explainCanonicalScore({
        score: axis.score,
        label: axis.label,
        context: `dimension:${axis.key}`,
      }),
    })),
    recommendations: report.action_playbook.actions.map((action) => ({
      id: action.id,
      explanation: explainRecommendation(action),
    })),
    maturity_stage: explainMaturityStage(report.maturity_stage),
    forecast: explainForecast({
      state: report.forecast.state,
      horizon_days: report.forecast.horizon_days,
      projected_score: report.forecast.projected_score,
      confidence_band: report.forecast.confidence_band,
      trajectory: report.forecast.trajectory,
      history_count: report.forecast.history_count,
      reason_unavailable: report.forecast.reason_unavailable,
    }),
    benchmark: explainBenchmarkPosition(report.benchmark),
    change: explainChange({
      state: report.change_intelligence.state,
      observed_at: report.change_intelligence.observed_at,
      comparison_baseline_at: report.change_intelligence.comparison_baseline_at,
      authority: report.change_intelligence.authority_delta,
      ai_visibility: report.change_intelligence.ai_visibility_delta,
      benchmark_percentile: {
        current: null,
        previous: null,
        delta: null,
        direction: 'first_observation',
        significant: false,
      },
      pillars: report.change_intelligence.pillar_deltas,
      notable_changes: report.change_intelligence.notable_changes,
      evidence: report.evidence_trace.overall,
      reason_unavailable: report.change_intelligence.reason_unavailable,
    }),
  };
}
