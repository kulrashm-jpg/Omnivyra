/**
 * Strategic Recommendation Sequencing.
 * Converts flat ranked recommendations into a strategic execution ladder.
 * Read-only orchestration. No ranking, scoring, or filtering changes.
 */

import type { CompanyStrategyDNA } from './companyStrategyDNAService';

export type ExecutionStage = 'awareness' | 'education' | 'authority' | 'conversion';

export type SequencedRecommendation = Record<string, unknown> & {
  topic: string;
  execution_stage: ExecutionStage;
};

export type StageMeta = {
  objective: string;
  psychological_goal: string;
  momentum_level: string;
};

export type StrategySequence = {
  ladder: Array<{
    stage: ExecutionStage;
    objective: string;
    psychological_goal: string;
    momentum_level: string;
    recommendations: SequencedRecommendation[];
  }>;
  recommended_flow: string;
};

const STAGE_META: Record<
  ExecutionStage,
  { objective: string; psychological_goal: string; momentum_level: string }
> = {
  awareness: {
    objective: 'Problem awareness',
    psychological_goal: 'Attention',
    momentum_level: 'low',
  },
  education: {
    objective: 'Understanding & clarity',
    psychological_goal: 'Comprehension',
    momentum_level: 'medium',
  },
  authority: {
    objective: 'Trust & credibility',
    psychological_goal: 'Belief',
    momentum_level: 'high',
  },
  conversion: {
    objective: 'Action & decision',
    psychological_goal: 'Commitment',
    momentum_level: 'peak',
  },
};

const DEFAULT_FLOW_ORDER: ExecutionStage[] = [
  'awareness',
  'education',
  'authority',
  'conversion',
];

const FLOW_ORDER_BY_MODE: Record<string, ExecutionStage[]> = {
  problem_transformation: ['awareness', 'education', 'authority', 'conversion'],
  authority_positioning: ['awareness', 'authority', 'education', 'conversion'],
  commercial_growth: ['awareness', 'education', 'conversion'],
  audience_engagement: ['awareness', 'education', 'authority'],
  educational_default: ['awareness', 'education'],
};

const FLOW_DESCRIPTIONS: Record<string, string> = {
  problem_transformation:
    'Start with awareness to expose the core problem, move into education for clarity, establish authority through differentiated insights, and finish with conversion-oriented recommendations.',
  authority_positioning:
    'Start with awareness to expose the problem, establish authority for trust and credibility, educate for comprehension, then move to conversion for action.',
  commercial_growth:
    'Start with awareness to expose the problem, move into education for clarity, then finish with conversion-oriented recommendations for action and commitment.',
  audience_engagement:
    'Start with awareness and education to build attention and comprehension; authority is optional for establishing belief.',
  educational_default:
    'Start with awareness for problem exposure and education for understanding and clarity.',
};

function classifyExecutionStage(
  rec: Record<string, unknown>,
  strategyDNA: CompanyStrategyDNA | null | undefined
): ExecutionStage {
  const intelligence = rec.intelligence as
    | { campaign_angle?: string; problem_being_solved?: string; authority_reason?: string | null }
    | undefined;
  const polishFlags = rec.polish_flags as
    | { diamond_candidate?: boolean; authority_elevated?: boolean }
    | undefined;

  const campaignAngle = String(intelligence?.campaign_angle ?? '').toLowerCase();
  const problemBeingSolved = intelligence?.problem_being_solved;
  const hasProblemBeingSolved =
    typeof problemBeingSolved === 'string' && problemBeingSolved.trim().length > 0;

  const hasConversion =
    campaignAngle.includes('conversion') ||
    strategyDNA?.growth_motion === 'conversion_acceleration';

  const authorityReason = intelligence?.authority_reason;
  const hasAuthorityReason =
    typeof authorityReason === 'string' && authorityReason.trim().length > 0;
  const hasAuthority =
    hasAuthorityReason || polishFlags?.authority_elevated || polishFlags?.diamond_candidate;

  const mode = strategyDNA?.mode ?? 'educational_default';

  switch (mode) {
    case 'commercial_growth':
      if (hasAuthorityReason) return 'authority';
      if (hasConversion) return 'conversion';
      if (hasAuthority) return 'authority';
      if (hasProblemBeingSolved) return 'education';
      return 'awareness';

    case 'authority_positioning':
      if (hasAuthority) return 'authority';
      if (hasConversion) return 'conversion';
      if (hasProblemBeingSolved) return 'education';
      return 'awareness';

    case 'problem_transformation':
      if (hasConversion) return 'conversion';
      if (hasProblemBeingSolved) return 'education';
      if (hasAuthority) return 'authority';
      return 'awareness';

    case 'audience_engagement':
      if (hasAuthority) return 'authority';
      if (hasProblemBeingSolved) return 'education';
      return 'awareness';

    case 'educational_default':
    default:
      if (hasConversion) return 'conversion';
      if (hasAuthority) return 'authority';
      if (hasProblemBeingSolved) return 'education';
      return 'awareness';
  }
}

/**
 * Sequences recommendations into a strategic execution ladder.
 * Does not modify ranking or scoring.
 */
export function sequenceRecommendations(
  recommendations: Array<Record<string, unknown> & { topic: string }>,
  strategyDNA: CompanyStrategyDNA | null | undefined
): StrategySequence {
  if (!recommendations || recommendations.length === 0) {
    return {
      ladder: [],
      recommended_flow: 'No recommendations to sequence.',
    };
  }

  const flowOrder =
    strategyDNA?.mode && FLOW_ORDER_BY_MODE[strategyDNA.mode]
      ? FLOW_ORDER_BY_MODE[strategyDNA.mode]
      : DEFAULT_FLOW_ORDER;

  const recommended_flow =
    strategyDNA?.mode && FLOW_DESCRIPTIONS[strategyDNA.mode]
      ? FLOW_DESCRIPTIONS[strategyDNA.mode]
      : 'Begin by building awareness, then educate, establish authority, and transition into conversion.';

  const withStage = recommendations.map((rec) => {
    const stage = classifyExecutionStage(rec, strategyDNA);
    return { ...rec, execution_stage: stage } as SequencedRecommendation;
  });

  const byStage = flowOrder.reduce(
    (acc, stage) => {
      acc[stage] = withStage.filter((r) => r.execution_stage === stage);
      return acc;
    },
    {} as Record<ExecutionStage, SequencedRecommendation[]>
  );

  const ladder = flowOrder
    .filter((stage) => byStage[stage].length > 0)
    .map((stage) => {
      const meta = STAGE_META[stage];
      return {
        stage,
        objective: meta.objective,
        psychological_goal: meta.psychological_goal,
        momentum_level: meta.momentum_level,
        recommendations: byStage[stage],
      };
    });

  return {
    ladder,
    recommended_flow,
  };
}
