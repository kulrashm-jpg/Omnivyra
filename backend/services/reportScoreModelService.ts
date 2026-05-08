import type { PersistedDecisionObject } from './decisionObjectService';
import { classifyDecisionType } from './decisionTypeRegistry';
import type { ResolvedReportInput } from './reportInputResolver';
import type { CompetitorIntelligenceResult } from './reportCompetitorIntelligenceService';
import type { ConfidenceBand, ScoreState } from './snapshotReport/canonicalScoreState';
import { bandFromEvidence } from './snapshotReport/canonicalScoreState';

export type ScoreDimensionKey =
  | 'content_quality'
  | 'frequency'
  | 'reach'
  | 'engagement'
  | 'authority'
  | 'conversion'
  | 'coverage'
  | 'platforms'
  | 'aeo';

export type ScoreDimension = {
  key: ScoreDimensionKey;
  label: string;
  value: number | null;
  state: ScoreState;
  confidence: ConfidenceBand;
  evidence_count: number;
  evidence_sources: string[];
  explanation: string;
};

export type ReportScoreModel = {
  available: true;
  value: number | null;
  state: ScoreState;
  confidence: ConfidenceBand;
  label: string;
  dimensions: ScoreDimension[];
  weakest_dimensions: Array<{ key: ScoreDimensionKey; label: string; value: number }>;
  limiting_factors: string[];
  growth_path: {
    current_level: string;
    next_level: string | null;
    focus: string[];
    projected_score_improvements: Array<{
      dimension: ScoreDimensionKey;
      current_value: number;
      projected_value: number;
      projected_total_score: number;
    }>;
  };
};

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function average(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function severity(decision: PersistedDecisionObject): number {
  const impact = Math.max(
    Number(decision.impact_traffic ?? 0),
    Number(decision.impact_conversion ?? 0),
    Number(decision.impact_revenue ?? 0),
  );
  const confidence = Number(decision.confidence_score ?? 0) * 100;
  return clamp((impact * 0.65) + (confidence * 0.35), 0, 100);
}

function geometricMean(values: number[]): number {
  if (values.length === 0) return 0;
  const normalized = values.map((value) => Math.max(1, value));
  const logSum = normalized.reduce((sum, value) => sum + Math.log(value), 0);
  return Math.exp(logSum / normalized.length);
}

function levelLabel(score: number | null): string {
  if (score == null) return 'Insufficient signal';
  if (score >= 75) return 'Strong market position';
  if (score >= 60) return 'Competitive but uneven';
  if (score >= 45) return 'Developing baseline';
  if (score >= 25) return 'Foundational work required';
  return 'Critical structural gap';
}

function nextLevel(currentScore: number | null): string | null {
  if (currentScore == null) return 'Developing baseline';
  if (currentScore < 25) return 'Foundational work required';
  if (currentScore < 45) return 'Developing baseline';
  if (currentScore < 60) return 'Competitive but uneven';
  if (currentScore < 75) return 'Strong market position';
  return null;
}

function byCategory(decisions: PersistedDecisionObject[], category: string): PersistedDecisionObject[] {
  return decisions.filter((decision) => classifyDecisionType(decision.issue_type) === category);
}

function byIssueMatch(decisions: PersistedDecisionObject[], pattern: RegExp): PersistedDecisionObject[] {
  return decisions.filter((decision) =>
    pattern.test(`${decision.issue_type} ${decision.title} ${decision.description}`.toLowerCase()),
  );
}

function dimensionLabel(key: ScoreDimensionKey): string {
  return key.replace(/_/g, ' ');
}

function uniqSources(...lists: Array<string[] | undefined | null>): string[] {
  const out = new Set<string>();
  for (const list of lists) {
    if (!list) continue;
    for (const item of list) if (item) out.add(item);
  }
  return [...out];
}

type DimensionInput = {
  key: ScoreDimensionKey;
  label: string;
  explanation: string;
  decisions: PersistedDecisionObject[];
  supportingSignal?: number | null;
  supportingSources?: string[];
  hasStrongSource?: boolean;
};

function dimensionFromDecisions(input: DimensionInput): ScoreDimension {
  const decisionCount = input.decisions.length;
  const evidenceCount = decisionCount + (input.supportingSignal != null && input.supportingSignal > 0 ? 1 : 0);

  if (decisionCount === 0 && (input.supportingSignal == null || input.supportingSignal === 0)) {
    return {
      key: input.key,
      label: input.label,
      value: null,
      state: 'insufficient_signal',
      confidence: 'low',
      evidence_count: 0,
      evidence_sources: [],
      explanation: input.explanation,
    };
  }

  if (decisionCount > 0) {
    const meanSeverity = average(input.decisions.map((decision) => severity(decision)));
    const value = Math.round(clamp(100 - meanSeverity, 0, 100));
    const sources = uniqSources(['decisions'], input.supportingSources);
    return {
      key: input.key,
      label: input.label,
      value,
      state: 'measured',
      confidence: bandFromEvidence(decisionCount, input.hasStrongSource ?? true),
      evidence_count: decisionCount,
      evidence_sources: sources,
      explanation: input.explanation,
    };
  }

  // No decisions but we have a supporting signal — inferred score.
  const inferredValue = Math.round(clamp((input.supportingSignal ?? 0) * 100, 0, 100));
  return {
    key: input.key,
    label: input.label,
    value: inferredValue,
    state: 'inferred',
    confidence: bandFromEvidence(evidenceCount, false),
    evidence_count: evidenceCount,
    evidence_sources: uniqSources(input.supportingSources),
    explanation: input.explanation,
  };
}

export function buildReportScoreModel(params: {
  decisions: PersistedDecisionObject[];
  resolvedInput?: ResolvedReportInput | null;
  competitorIntelligence?: CompetitorIntelligenceResult | null;
}): ReportScoreModel {
  const decisions = params.decisions;

  const contentDecisions = [
    ...byCategory(decisions, 'content_strategy'),
    ...byIssueMatch(decisions, /(seo_gap|ranking_gap|topic_gap|coverage|content gap|weak_content_depth)/),
  ];
  const authorityDecisions = [
    ...byCategory(decisions, 'authority'),
    ...byIssueMatch(decisions, /(authority|backlink)/),
  ];
  const trustDecisions = [
    ...byCategory(decisions, 'trust'),
    ...byIssueMatch(decisions, /(trust|credibility|proof|testimonial|review)/),
  ];
  const conversionDecisions = [
    ...byCategory(decisions, 'execution'),
    ...byIssueMatch(decisions, /(conversion|cta|dropoff|funnel|journey|lead|pricing|contact|demo)/),
  ];
  const reachDecisions = [
    ...byCategory(decisions, 'performance'),
    ...byCategory(decisions, 'distribution'),
    ...byIssueMatch(decisions, /(search|seo|visibility|ranking|impression)/),
  ];
  const aeoDecisions = byIssueMatch(decisions, /(aeo|faq|answer engine|direct answer|summary block)/);
  const platformDecisions = byIssueMatch(decisions, /(platform|channel|distribution|social)/);
  const competitorGapCount = params.competitorIntelligence?.generated_gaps?.length ?? 0;
  const socialCount = params.resolvedInput?.resolved.socialLinks.length ?? 0;

  const dimensions: ScoreDimension[] = [
    dimensionFromDecisions({
      key: 'content_quality',
      label: 'Content Quality',
      explanation: 'Measures how well pages answer buyer questions with depth and clarity.',
      decisions: contentDecisions,
    }),
    dimensionFromDecisions({
      key: 'frequency',
      label: 'Publishing Frequency',
      explanation: 'Reflects whether the brand appears active enough to sustain momentum.',
      decisions: contentDecisions.length > 0 ? contentDecisions : [],
      supportingSignal: socialCount > 0 ? Math.min(socialCount / 6, 1) : null,
      supportingSources: socialCount > 0 ? ['social_links'] : [],
    }),
    dimensionFromDecisions({
      key: 'reach',
      label: 'Reach',
      explanation: 'Captures discoverability across search and distribution channels.',
      decisions: reachDecisions,
    }),
    dimensionFromDecisions({
      key: 'engagement',
      label: 'Engagement',
      explanation: 'Shows whether the message is resonating enough to hold buyer attention.',
      decisions: [...conversionDecisions, ...trustDecisions],
    }),
    dimensionFromDecisions({
      key: 'authority',
      label: 'Authority',
      explanation: 'Indicates how credible and established the brand appears in-market.',
      decisions: authorityDecisions,
    }),
    dimensionFromDecisions({
      key: 'conversion',
      label: 'Conversion',
      explanation: 'Measures how cleanly interest turns into action on high-intent pages.',
      decisions: conversionDecisions,
    }),
    dimensionFromDecisions({
      key: 'coverage',
      label: 'Coverage',
      explanation: 'Represents how well the business covers demand across topics and buyer stages.',
      decisions: contentDecisions,
      supportingSignal: competitorGapCount > 0 ? Math.max(0, 1 - competitorGapCount * 0.12) : null,
      supportingSources: competitorGapCount > 0 ? ['competitor_intelligence'] : [],
    }),
    dimensionFromDecisions({
      key: 'platforms',
      label: 'Platforms',
      explanation: 'Tracks whether the business is present on enough credible channels to support growth.',
      decisions: platformDecisions,
      supportingSignal: socialCount > 0 ? Math.min(socialCount / 6, 1) : null,
      supportingSources: socialCount > 0 ? ['social_links'] : [],
      hasStrongSource: false,
    }),
    dimensionFromDecisions({
      key: 'aeo',
      label: 'AEO Readiness',
      explanation: 'Reflects how reusable the site is in answer engines and zero-click discovery.',
      decisions: aeoDecisions,
    }),
  ];

  const measuredValues = dimensions
    .filter((dimension) => dimension.value != null && dimension.state !== 'insufficient_signal')
    .map((dimension) => dimension.value as number);

  const value = measuredValues.length === 0 ? null : Math.round(clamp(geometricMean(measuredValues), 0, 100));
  const overallState: ScoreState = measuredValues.length === 0
    ? 'insufficient_signal'
    : measuredValues.length < dimensions.length / 2
      ? 'inferred'
      : 'measured';
  const overallConfidence: ConfidenceBand = measuredValues.length >= 6
    ? 'high'
    : measuredValues.length >= 3
      ? 'medium'
      : 'low';

  const weakestMeasuredDimensions = dimensions
    .filter((dimension) => dimension.value != null)
    .sort((left, right) => (left.value as number) - (right.value as number))
    .slice(0, 3)
    .map((dimension) => ({
      key: dimension.key,
      label: dimension.label,
      value: dimension.value as number,
    }));

  const limitingFactors = weakestMeasuredDimensions.map((dimension) =>
    `${dimension.label} is at ${dimension.value}/100 — currently the strongest drag on total score.`,
  );

  const projectedScoreImprovements = weakestMeasuredDimensions.map((dimension) => {
    const projectedValue = Math.min(100, Math.max(dimension.value + 15, 50));
    const projectedDimensions = dimensions
      .map((item) => (item.key === dimension.key ? projectedValue : item.value))
      .filter((entry): entry is number => entry != null);
    return {
      dimension: dimension.key,
      current_value: dimension.value,
      projected_value: projectedValue,
      projected_total_score: projectedDimensions.length === 0 ? 0 : Math.round(geometricMean(projectedDimensions)),
    };
  });

  return {
    available: true,
    value,
    state: overallState,
    confidence: overallConfidence,
    label: levelLabel(value),
    dimensions,
    weakest_dimensions: weakestMeasuredDimensions,
    limiting_factors: limitingFactors,
    growth_path: {
      current_level: levelLabel(value),
      next_level: nextLevel(value),
      focus: weakestMeasuredDimensions.map((dimension) =>
        `Improve ${dimensionLabel(dimension.key)} to remove the largest drag on total score.`,
      ),
      projected_score_improvements: projectedScoreImprovements,
    },
  };
}
