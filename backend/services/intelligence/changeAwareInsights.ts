// Delta-aware executive insight upgrades.
//
// Phase 5 wraps Phase 4's Executive Insight Engine with change-awareness:
// when a prior snapshot exists, narratives can call out improvements,
// regressions, stagnation, and compounding wins. The base ExecutiveInsightSet
// is preserved when there is no prior — no fabricated change is introduced.

import type {
  CanonicalNarrative,
  ConfidenceBand,
  EvidenceTrace,
  PillarKey,
  SystemMaturityClass,
} from '../canonicalReport/canonicalReportTypes';
import type { ExecutiveInsightSet } from './executiveInsightEngine';
import type { ChangeIntelligence } from './deltaIntelligence';

const PILLAR_LABEL: Record<PillarKey, string> = {
  foundation: 'Foundation',
  authority: 'Authority',
  discoverability: 'Discoverability',
  trust: 'Trust',
  momentum: 'Momentum',
};

function combineEvidence(...traces: EvidenceTrace[]): EvidenceTrace {
  const sources = new Set<EvidenceTrace['sources'][number]>();
  let count = 0;
  let lastObservedAt: string | null = null;
  const observations: EvidenceTrace['observations'] = [];
  for (const trace of traces) {
    count += trace.count;
    for (const s of trace.sources) sources.add(s);
    for (const o of trace.observations) observations.push(o);
    if (trace.freshness.last_observed_at) lastObservedAt = trace.freshness.last_observed_at;
  }
  return {
    count,
    sources: [...sources] as EvidenceTrace['sources'],
    freshness: { last_observed_at: lastObservedAt, age_hours: null },
    observations,
  };
}

export function applyChangeAwareness(params: {
  base: ExecutiveInsightSet;
  delta: ChangeIntelligence;
  maturity: SystemMaturityClass;
}): ExecutiveInsightSet {
  if (params.delta.state !== 'measured') {
    // No prior snapshot — return base unchanged. Honest.
    return params.base;
  }

  const { base, delta, maturity } = params;

  const headlinePrefix = buildHeadlinePrefix(delta);
  const headlineThesis: CanonicalNarrative = {
    text: `${headlinePrefix}${base.headline_thesis.text}`,
    confidence: weakerOf(base.headline_thesis.confidence, lowIfInsufficient(delta)),
    evidence: combineEvidence(base.headline_thesis.evidence, delta.evidence),
    maturity,
  };

  const momentumInterpretation = buildMomentumNarrative(delta, maturity);
  const authorityRisk = applyRiskOverlay(base.authority_risk, delta, maturity);
  const strategicOpportunity = applyOpportunityOverlay(base.strategic_opportunity, delta, maturity);

  return {
    headline_thesis: headlineThesis,
    primary_constraint: base.primary_constraint, // unchanged — constraint identity comes from current state
    next_unlock: base.next_unlock,
    strategic_opportunity: strategicOpportunity,
    authority_risk: authorityRisk,
    momentum_interpretation: momentumInterpretation,
  };
}

function buildHeadlinePrefix(delta: ChangeIntelligence): string {
  if (!delta.authority.significant) return '';
  if (delta.authority.delta == null) return '';
  if (delta.authority.delta > 0) {
    return `Authority improved ${delta.authority.delta} pts since the last snapshot. `;
  }
  return `Authority regressed ${Math.abs(delta.authority.delta)} pts since the last snapshot. `;
}

function buildMomentumNarrative(
  delta: ChangeIntelligence,
  maturity: SystemMaturityClass,
): CanonicalNarrative {
  // Compose the line from authority + AI visibility direction signals.
  const auth = delta.authority;
  const ai = delta.ai_visibility;

  let text: string;
  if (auth.direction === 'improved' && ai.direction === 'improved') {
    text = `Authority is compounding across both channels — Authority Index ${auth.delta! >= 0 ? '+' : ''}${auth.delta} pts, AI surface ${ai.delta! >= 0 ? '+' : ''}${ai.delta} pts. Sustain the actions driving this; switching pillars now resets the curve.`;
  } else if (auth.direction === 'regressed' && ai.direction === 'regressed') {
    text = `Authority is decaying — Authority Index ${auth.delta} pts, AI surface ${ai.delta} pts since the last snapshot. Identify the regression source before adding new bets.`;
  } else if (auth.direction === 'stagnated' && ai.direction === 'stagnated') {
    text = `Authority is stagnating — both Authority Index and AI surface presence held flat since the last snapshot. A flat curve is the most expensive position; pick one pillar to break it.`;
  } else if (auth.direction === 'first_observation' || ai.direction === 'first_observation') {
    text = `Insufficient history to classify momentum — comparison baseline is incomplete.`;
  } else {
    // Mixed direction.
    text = `Authority and AI surface are diverging — Authority ${auth.delta! >= 0 ? '+' : ''}${auth.delta} pts, AI surface ${ai.delta! >= 0 ? '+' : ''}${ai.delta} pts. Investigate whether the divergence is structural or a measurement artefact.`;
  }
  return {
    text,
    confidence: 'medium',
    evidence: delta.evidence,
    maturity,
  };
}

function applyRiskOverlay(
  base: CanonicalNarrative,
  delta: ChangeIntelligence,
  maturity: SystemMaturityClass,
): CanonicalNarrative {
  // If a measured pillar regressed significantly, that becomes the surfaced risk.
  const regressedPillar = delta.pillars.find((p) => p.delta.direction === 'regressed' && p.delta.significant);
  if (!regressedPillar) return base;
  return {
    text: `Active regression: ${PILLAR_LABEL[regressedPillar.pillar]} fell ${Math.abs(regressedPillar.delta.delta!)} pts since the last snapshot. ${base.text}`,
    confidence: 'medium',
    evidence: combineEvidence(base.evidence, delta.evidence),
    maturity,
  };
}

function applyOpportunityOverlay(
  base: CanonicalNarrative,
  delta: ChangeIntelligence,
  maturity: SystemMaturityClass,
): CanonicalNarrative {
  // Compounding pillar: keep going. We append a one-liner.
  const compoundingPillar = delta.pillars.find((p) => p.delta.direction === 'improved' && p.delta.significant);
  if (!compoundingPillar) return base;
  return {
    text: `${base.text} ${PILLAR_LABEL[compoundingPillar.pillar]} is currently compounding (+${compoundingPillar.delta.delta} pts) — the leverage on this opportunity is rising, not falling.`,
    confidence: base.confidence,
    evidence: combineEvidence(base.evidence, delta.evidence),
    maturity,
  };
}

function weakerOf(a: ConfidenceBand, b: ConfidenceBand): ConfidenceBand {
  const order = { high: 2, medium: 1, low: 0 };
  return order[a] <= order[b] ? a : b;
}

function lowIfInsufficient(delta: ChangeIntelligence): ConfidenceBand {
  return delta.state === 'measured' ? 'medium' : 'low';
}
