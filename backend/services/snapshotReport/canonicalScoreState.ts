export type ScoreState = 'measured' | 'inferred' | 'insufficient_signal' | 'unavailable';

export type ConfidenceBand = 'high' | 'medium' | 'low';

export type EvidenceSourceTag = string;

export type ScoreEnvelope = {
  value: number | null;
  state: ScoreState;
  confidence: ConfidenceBand;
  evidence_count: number;
  evidence_sources: EvidenceSourceTag[];
  freshness: { last_observed_at: string | null; age_hours: number | null };
};

export type SystemMaturityClass =
  | 'structurally_weak'
  | 'early_stage'
  | 'building_baseline'
  | 'operational'
  | 'leading';

const HIGH_EVIDENCE_THRESHOLD = 4;
const MEDIUM_EVIDENCE_THRESHOLD = 2;

export function bandFromEvidence(evidenceCount: number, hasStrongSource: boolean): ConfidenceBand {
  if (evidenceCount >= HIGH_EVIDENCE_THRESHOLD && hasStrongSource) return 'high';
  if (evidenceCount >= MEDIUM_EVIDENCE_THRESHOLD) return 'medium';
  return 'low';
}

export function emptyEnvelope(state: ScoreState = 'insufficient_signal'): ScoreEnvelope {
  return {
    value: null,
    state,
    confidence: 'low',
    evidence_count: 0,
    evidence_sources: [],
    freshness: { last_observed_at: null, age_hours: null },
  };
}

export function measuredEnvelope(params: {
  value: number;
  evidence_count: number;
  evidence_sources: EvidenceSourceTag[];
  hasStrongSource?: boolean;
  last_observed_at?: string | null;
  age_hours?: number | null;
}): ScoreEnvelope {
  return {
    value: params.value,
    state: 'measured',
    confidence: bandFromEvidence(params.evidence_count, params.hasStrongSource ?? true),
    evidence_count: params.evidence_count,
    evidence_sources: params.evidence_sources,
    freshness: {
      last_observed_at: params.last_observed_at ?? null,
      age_hours: params.age_hours ?? null,
    },
  };
}

export function inferredEnvelope(params: {
  value: number;
  evidence_count: number;
  evidence_sources: EvidenceSourceTag[];
  last_observed_at?: string | null;
  age_hours?: number | null;
}): ScoreEnvelope {
  return {
    value: params.value,
    state: 'inferred',
    confidence: bandFromEvidence(params.evidence_count, false),
    evidence_count: params.evidence_count,
    evidence_sources: params.evidence_sources,
    freshness: {
      last_observed_at: params.last_observed_at ?? null,
      age_hours: params.age_hours ?? null,
    },
  };
}

export function unavailableEnvelope(reason?: string): ScoreEnvelope {
  return {
    value: null,
    state: 'unavailable',
    confidence: 'low',
    evidence_count: 0,
    evidence_sources: reason ? [reason] : [],
    freshness: { last_observed_at: null, age_hours: null },
  };
}

export function classifySystemMaturity(params: {
  foundationEnvelopes: ScoreEnvelope[];
  authorityEnvelopes: ScoreEnvelope[];
}): SystemMaturityClass {
  const measuredFoundation = params.foundationEnvelopes.filter((env) => env.state === 'measured');
  const measuredAuthority = params.authorityEnvelopes.filter((env) => env.state === 'measured');

  if (measuredFoundation.length === 0 && measuredAuthority.length === 0) return 'structurally_weak';

  const foundationAvg = measuredFoundation.length > 0
    ? measuredFoundation.reduce((sum, env) => sum + (env.value ?? 0), 0) / measuredFoundation.length
    : null;
  const authorityAvg = measuredAuthority.length > 0
    ? measuredAuthority.reduce((sum, env) => sum + (env.value ?? 0), 0) / measuredAuthority.length
    : null;

  const strongFoundation = foundationAvg != null && foundationAvg >= 65;
  const weakAuthority = authorityAvg == null || authorityAvg < 40;
  const strongAuthority = authorityAvg != null && authorityAvg >= 60;

  if (strongFoundation && weakAuthority) return 'early_stage';
  if (!strongFoundation && weakAuthority) return 'structurally_weak';
  if (strongFoundation && strongAuthority) return 'leading';
  if (strongFoundation || strongAuthority) return 'operational';
  return 'building_baseline';
}

export function maturityNarrativeAdjective(maturity: SystemMaturityClass): string {
  if (maturity === 'leading') return 'leading';
  if (maturity === 'operational') return 'operational';
  if (maturity === 'building_baseline') return 'building a baseline';
  if (maturity === 'early_stage') return 'early-stage';
  return 'structurally weak';
}

export function describeScoreState(state: ScoreState): string {
  if (state === 'measured') return 'Measured';
  if (state === 'inferred') return 'Inferred';
  if (state === 'insufficient_signal') return 'Insufficient signal';
  return 'Unavailable';
}
