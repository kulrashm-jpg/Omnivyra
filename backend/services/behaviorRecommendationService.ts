import type { BehaviorInsight, BehaviorInsightSeverity } from './behaviorInsightService';
import type { BehaviorInsightReportData } from './behaviorInsightService';
import type { BehaviorRecommendationLearningProfile } from './behaviorActionTrackingService';

export type BehaviorRecommendationType =
  | 'ux_fix'
  | 'messaging_fix'
  | 'conversion_optimization'
  | 'traffic_alignment'
  | 'content_optimization'
  | 'cta_optimization';

export type BehaviorRecommendationPriority = 'high' | 'medium' | 'low';
export type BehaviorRecommendationEffortLevel = 'low' | 'medium' | 'high';

export interface BehaviorRecommendation {
  type: BehaviorRecommendationType;
  priority: BehaviorRecommendationPriority;
  message: string;
  reasoning: string;
  linked_insight: BehaviorInsight['type'];
  impact_estimate: string;
  effort_level: BehaviorRecommendationEffortLevel;
  context?: Record<string, string | number | null>;
}

export interface BehaviorRecommendationReportData extends BehaviorInsightReportData {
  session_metrics?: {
    total_sessions: number;
    avg_events_per_session: number;
    conversion_rate: number;
  };
}

function mapSeverityToPriority(severity: BehaviorInsightSeverity): BehaviorRecommendationPriority {
  if (severity === 'high') return 'high';
  if (severity === 'medium') return 'medium';
  return 'low';
}

function priorityRank(priority: BehaviorRecommendationPriority): number {
  if (priority === 'high') return 3;
  if (priority === 'medium') return 2;
  return 1;
}

function recommendationImpactScore(recommendation: BehaviorRecommendation): number {
  const contextWeight = Math.max(
    Number(recommendation.context?.entry_sessions ?? 0),
    Number(recommendation.context?.sessions ?? 0),
    Number(recommendation.context?.visits ?? 0),
    Number(recommendation.context?.users ?? 0),
  );
  const learningWeight = Number(recommendation.context?.learning_priority_adjustment ?? 0);

  return priorityRank(recommendation.priority) * 100000 + (learningWeight * 1000) + contextWeight;
}

function recommendationPriorityAdjustment(
  recommendationType: BehaviorRecommendationType,
  learningProfile?: BehaviorRecommendationLearningProfile,
): number {
  return learningProfile?.[recommendationType]?.priority_adjustment ?? 0;
}

function impactEstimateForType(type: BehaviorRecommendationType): string {
  if (type === 'conversion_optimization') return '+10–30% conversion improvement potential';
  if (type === 'ux_fix' || type === 'messaging_fix') return '+15–25% funnel retention improvement';
  if (type === 'traffic_alignment') return '+10–20% lead quality improvement';
  return '+5–15% engagement → conversion lift';
}

function effortLevelForType(type: BehaviorRecommendationType): BehaviorRecommendationEffortLevel {
  if (type === 'cta_optimization' || type === 'messaging_fix') return 'low';
  if (type === 'content_optimization' || type === 'traffic_alignment') return 'medium';
  if (type === 'ux_fix') return 'medium';
  return 'high';
}

function buildDropOffRecommendation(insight: BehaviorInsight): BehaviorRecommendation {
  const pageUrl = String(insight.context?.page_url ?? 'this page');
  const dropRate = Number(insight.context?.drop_off_rate ?? insight.metric ?? 0);
  return {
    type: 'ux_fix',
    priority: mapSeverityToPriority(insight.severity),
    message: `Tighten the first-screen promise and CTA path on ${pageUrl}`,
    reasoning: dropRate > 0
      ? `${Math.round(dropRate * 100)}% drop-off indicates users are leaving before the page earns a next action.`
      : 'High drop-off indicates users are leaving before the page earns a next action.',
    linked_insight: 'drop_off',
    impact_estimate: impactEstimateForType('ux_fix'),
    effort_level: effortLevelForType('ux_fix'),
    context: {
      ...(insight.context ?? {}),
      baseline_metric: insight.metric,
    },
  };
}

function buildFunnelRecommendation(insight: BehaviorInsight): BehaviorRecommendation {
  const toStep = String(insight.context?.to_step ?? '');
  const isEngagementGap = toStep === 'engagement';

  if (isEngagementGap) {
    return {
      type: 'messaging_fix',
      priority: mapSeverityToPriority(insight.severity),
      message: 'Rewrite landing-page messaging around the visitor intent that arrived',
      reasoning: 'A large drop before engagement suggests visitors do not see an immediate match between traffic intent and page value.',
      linked_insight: 'funnel',
      impact_estimate: impactEstimateForType('messaging_fix'),
      effort_level: effortLevelForType('messaging_fix'),
      context: {
        ...(insight.context ?? {}),
        baseline_metric: insight.metric,
      },
    };
  }

  return {
    type: 'conversion_optimization',
    priority: mapSeverityToPriority(insight.severity),
    message: 'Reduce late-stage conversion friction after users engage',
    reasoning: 'Users are engaging but not converting, which points to friction or weak conversion prompts later in the journey.',
    linked_insight: 'funnel',
    impact_estimate: impactEstimateForType('conversion_optimization'),
    effort_level: effortLevelForType('conversion_optimization'),
    context: {
      ...(insight.context ?? {}),
      baseline_metric: insight.metric,
    },
  };
}

function buildTrafficRecommendation(insight: BehaviorInsight): BehaviorRecommendation {
  const source = String(insight.context?.traffic_source ?? 'this traffic source');
  const medium = String(insight.context?.source_medium ?? '');
  const sourceLabel = medium && medium !== 'unknown' ? `${source} / ${medium}` : source;

  return {
    type: 'traffic_alignment',
    priority: mapSeverityToPriority(insight.severity),
    message: `Re-align ${sourceLabel} traffic with a landing promise that matches its intent`,
    reasoning: 'This source is delivering sessions without proportional conversions, which suggests targeting mismatch or landing page misalignment.',
    linked_insight: 'traffic_quality',
    impact_estimate: impactEstimateForType('traffic_alignment'),
    effort_level: effortLevelForType('traffic_alignment'),
    context: {
      ...(insight.context ?? {}),
      baseline_metric: insight.metric,
    },
  };
}

function buildPagePerformanceRecommendation(insight: BehaviorInsight): BehaviorRecommendation {
  const pageUrl = String(insight.context?.page_url ?? 'this page');
  const conversions = Number(insight.context?.conversions ?? 0);

  if (conversions === 0 && insight.message.toLowerCase().includes('fails to convert')) {
    return {
      type: 'cta_optimization',
      priority: mapSeverityToPriority(insight.severity),
      message: `Add a clearer primary CTA and proof cue on ${pageUrl}`,
      reasoning: 'Users are engaging with the page, but there is no conversion response, which points to weak or unclear next-step prompts.',
      linked_insight: 'page_performance',
      impact_estimate: impactEstimateForType('cta_optimization'),
      effort_level: effortLevelForType('cta_optimization'),
      context: {
        ...(insight.context ?? {}),
        baseline_metric: insight.metric,
      },
    };
  }

  return {
    type: 'content_optimization',
    priority: mapSeverityToPriority(insight.severity),
    message: `Rework ${pageUrl} around the strongest reader problem, proof, and next step`,
    reasoning: 'The page is getting visits but not enough interaction, which suggests the content or first impression is not pulling users deeper.',
    linked_insight: 'page_performance',
    impact_estimate: impactEstimateForType('content_optimization'),
    effort_level: effortLevelForType('content_optimization'),
    context: {
      ...(insight.context ?? {}),
      baseline_metric: insight.metric,
    },
  };
}

export function generateBehaviorRecommendations(
  insights: BehaviorInsight[],
  _reportData: BehaviorRecommendationReportData,
  learningProfile?: BehaviorRecommendationLearningProfile,
): BehaviorRecommendation[] {
  const recommendations = insights.map((insight) => {
    if (insight.type === 'drop_off') {
      return buildDropOffRecommendation(insight);
    }

    if (insight.type === 'funnel') {
      return buildFunnelRecommendation(insight);
    }

    if (insight.type === 'traffic_quality') {
      return buildTrafficRecommendation(insight);
    }

    return buildPagePerformanceRecommendation(insight);
  }).map((recommendation) => ({
    ...recommendation,
    context: {
      ...(recommendation.context ?? {}),
      learning_priority_adjustment: recommendationPriorityAdjustment(recommendation.type, learningProfile),
    },
  }));

  return recommendations.sort((a, b) => recommendationImpactScore(b) - recommendationImpactScore(a));
}
