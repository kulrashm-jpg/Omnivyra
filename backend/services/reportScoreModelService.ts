import type { PersistedDecisionObject } from './decisionObjectService';
import { classifyDecisionType } from './decisionTypeRegistry';
import type { ResolvedReportInput } from './reportInputResolver';
import type { CompetitorIntelligenceResult } from './reportCompetitorIntelligenceService';

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
  value: number;
  explanation: string;
};

export type ReportScoreModel = {
  available: true;
  value: number;
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
  const normalized = values.map((value) => Math.max(1, value));
  const logSum = normalized.reduce((sum, value) => sum + Math.log(value), 0);
  return Math.exp(logSum / normalized.length);
}

function levelLabel(score: number): string {
  if (score >= 75) return 'Strong market position';
  if (score >= 60) return 'Competitive but uneven';
  if (score >= 45) return 'Developing baseline';
  return 'Foundational work required';
}

function nextLevel(currentScore: number): string | null {
  if (currentScore < 45) return 'Developing baseline';
  if (currentScore < 60) return 'Competitive but uneven';
  if (currentScore < 75) return 'Strong market position';
  return null;
}

function byCategory(decisions: PersistedDecisionObject[], category: string): PersistedDecisionObject[] {
  return decisions.filter((decision) => classifyDecisionType(decision.issue_type) === category);
}

function byIssueMatch(decisions: PersistedDecisionObject[], pattern: RegExp): PersistedDecisionObject[] {
  return decisions.filter((decision) => pattern.test(`${decision.issue_type} ${decision.title} ${decision.description}`.toLowerCase()));
}

function dimensionValue(params: {
  baseline: number;
  decisions: PersistedDecisionObject[];
  multiplier?: number;
  floor?: number;
  ceiling?: number;
}): number {
  const penalty = average(params.decisions.map((decision) => severity(decision))) * (params.multiplier ?? 0.6);
  return Math.round(clamp(params.baseline - penalty, params.floor ?? 18, params.ceiling ?? 92));
}

function dimensionLabel(key: ScoreDimensionKey): string {
  return key.replace(/_/g, ' ');
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
    {
      key: 'content_quality',
      label: 'Content Quality',
      value: dimensionValue({ baseline: 74, decisions: contentDecisions, multiplier: 0.62 }),
      explanation: 'Measures how well pages answer buyer questions with depth and clarity.',
    },
    {
      key: 'frequency',
      label: 'Publishing Frequency',
      value: Math.round(clamp(42 + socialCount * 8 - average(contentDecisions.map(severity)) * 0.24, 20, 84)),
      explanation: 'Reflects whether the brand appears active enough to sustain momentum.',
    },
    {
      key: 'reach',
      label: 'Reach',
      value: dimensionValue({ baseline: 72, decisions: reachDecisions, multiplier: 0.68 }),
      explanation: 'Captures discoverability across search and distribution channels.',
    },
    {
      key: 'engagement',
      label: 'Engagement',
      value: dimensionValue({ baseline: 68, decisions: [...conversionDecisions, ...trustDecisions], multiplier: 0.5 }),
      explanation: 'Shows whether the message is resonating enough to hold buyer attention.',
    },
    {
      key: 'authority',
      label: 'Authority',
      value: dimensionValue({ baseline: 70, decisions: authorityDecisions, multiplier: 0.7 }),
      explanation: 'Indicates how credible and established the brand appears in-market.',
    },
    {
      key: 'conversion',
      label: 'Conversion',
      value: dimensionValue({ baseline: 73, decisions: conversionDecisions, multiplier: 0.75 }),
      explanation: 'Measures how cleanly interest turns into action on high-intent pages.',
    },
    {
      key: 'coverage',
      label: 'Coverage',
      value: Math.round(clamp(70 - average(contentDecisions.map(severity)) * 0.58 - competitorGapCount * 3, 18, 90)),
      explanation: 'Represents how well the business covers demand across topics and buyer stages.',
    },
    {
      key: 'platforms',
      label: 'Platforms',
      value: Math.round(clamp(38 + socialCount * 14 - average(platformDecisions.map(severity)) * 0.35, 20, 86)),
      explanation: 'Tracks whether the business is present on enough credible channels to support growth.',
    },
    {
      key: 'aeo',
      label: 'AEO Readiness',
      value: Math.round(clamp(64 - average(aeoDecisions.map(severity)) * 0.7 - competitorGapCount * 2, 18, 88)),
      explanation: 'Reflects how reusable the site is in answer engines and zero-click discovery.',
    },
  ];

  const values = dimensions.map((dimension) => dimension.value);
  const finalScore = Math.round(clamp(geometricMean(values), 18, 92));
  const weakestDimensions = [...dimensions]
    .sort((left, right) => left.value - right.value)
    .slice(0, 3)
    .map((dimension) => ({
      key: dimension.key,
      label: dimension.label,
      value: dimension.value,
    }));

  const limitingFactors = weakestDimensions.map((dimension) =>
    `${dimension.label} is limiting the score because it is currently at ${dimension.value}/100, which drags down stronger areas in the geometric mean.`,
  );

  const projectedScoreImprovements = weakestDimensions.map((dimension) => {
    const projectedValue = Math.min(100, Math.max(dimension.value + 12, 55));
    const projectedDimensions = dimensions.map((item) =>
      item.key === dimension.key ? projectedValue : item.value,
    );
    return {
      dimension: dimension.key,
      current_value: dimension.value,
      projected_value: projectedValue,
      projected_total_score: Math.round(geometricMean(projectedDimensions)),
    };
  });

  return {
    available: true,
    value: finalScore,
    label: levelLabel(finalScore),
    dimensions,
    weakest_dimensions: weakestDimensions,
    limiting_factors: limitingFactors,
    growth_path: {
      current_level: levelLabel(finalScore),
      next_level: nextLevel(finalScore),
      focus: weakestDimensions.map((dimension) =>
        `Improve ${dimensionLabel(dimension.key)} to remove the main drag on total score.`,
      ),
      projected_score_improvements: projectedScoreImprovements,
    },
  };
}
