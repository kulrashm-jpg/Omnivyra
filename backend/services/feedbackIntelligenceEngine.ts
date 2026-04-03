/**
 * Feedback Intelligence Engine
 * Converts engagement signals into auditable decision objects.
 */

import { assertBackgroundJobContext } from './intelligenceExecutionContext';
import { enforceDecisionGenerationThrottle } from './decisionGenerationControlService';
import {
  archiveDecisionScope,
  listDecisionObjects,
  replaceDecisionObjectsForSource,
  type PersistedDecisionObject,
} from './decisionObjectService';
import { loadNormalizedFeedbackSignals } from './normalizeFeedbackSignalsService';

type SignalRow = {
  id: string;
  post_id: string;
  platform: string;
  engagement_type: string;
  engagement_count: number;
};


type FeedbackDecisionDraft = {
  issue_type: string;
  title: string;
  description: string;
  evidence: Record<string, unknown>;
  impact_traffic: number;
  impact_conversion: number;
  impact_revenue: number;
  priority_score: number;
  effort_score: number;
  confidence_score: number;
  recommendation: string;
  action_type: string;
  action_payload: Record<string, unknown>;
};

function clampPercent(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function clampConfidence(value: number): number {
  return Math.max(0, Math.min(1, Number(value.toFixed(2))));
}

function buildPlatformPerformanceDecision(
  platform: string,
  competitorPlatform: string,
  ratio: number,
  totalEngagement: number,
  signalCount: number
): FeedbackDecisionDraft {
  const impactRevenue = clampPercent(Math.min(95, 35 + ratio * 18));
  const impactConversion = clampPercent(Math.min(90, 30 + ratio * 14));
  const impactTraffic = clampPercent(Math.min(85, 25 + ratio * 10));
  const confidence = clampConfidence(Math.min(0.92, 0.55 + ratio * 0.08));

  return {
    issue_type: 'platform_performance_gap',
    title: `${platform} is outperforming ${competitorPlatform}`,
    description: `${platform} engagement is ${ratio.toFixed(1)}x higher than ${competitorPlatform}, indicating a distribution and budget allocation opportunity.`,
    evidence: {
      winning_platform: platform,
      trailing_platform: competitorPlatform,
      engagement_ratio: Number(ratio.toFixed(2)),
      total_engagement: totalEngagement,
      signal_count: signalCount,
    },
    impact_traffic: impactTraffic,
    impact_conversion: impactConversion,
    impact_revenue: impactRevenue,
    priority_score: clampPercent((impactRevenue * confidence) + 8),
    effort_score: 28,
    confidence_score: confidence,
    recommendation: `Shift more distribution and campaign emphasis toward ${platform} while testing whether ${competitorPlatform} needs a different message or format.`,
    action_type: 'fix_distribution',
    action_payload: {
      target_platform: platform,
      deprioritized_platform: competitorPlatform,
      reason: 'engagement_outperformance',
    },
  };
}

function buildContentPerformanceDecision(
  commentRate: number,
  comments: number,
  likes: number
): FeedbackDecisionDraft {
  const discussionLed = commentRate > 0.1;
  const recommendation = discussionLed
    ? 'Turn recent thought-leadership patterns into repeatable content themes and repurpose the strongest discussion starters.'
    : 'Rework educational posts to create stronger prompts, clearer positioning, and more conversation-driven CTAs.';
  const confidence = clampConfidence(Math.min(0.9, 0.5 + commentRate * 1.8));
  const impactRevenue = clampPercent(Math.min(82, 22 + commentRate * 260));
  const impactConversion = clampPercent(Math.min(78, 20 + commentRate * 220));
  const impactTraffic = clampPercent(Math.min(74, 18 + commentRate * 180));

  return {
    issue_type: discussionLed ? 'content_discussion_strength' : 'content_gap',
    title: discussionLed ? 'Discussion-led content is outperforming' : 'Engagement is not converting into discussion',
    description: discussionLed
      ? 'Posts that trigger conversation are creating stronger audience intent signals than passive engagement alone.'
      : 'Likes are outpacing comments, which suggests the content is getting attention without generating enough active intent.',
    evidence: {
      comment_rate: Number(commentRate.toFixed(3)),
      comments,
      likes,
      dominant_pattern: discussionLed ? 'discussion_led' : 'passive_engagement',
    },
    impact_traffic: impactTraffic,
    impact_conversion: impactConversion,
    impact_revenue: impactRevenue,
    priority_score: clampPercent((impactConversion * confidence) + 12),
    effort_score: 22,
    confidence_score: confidence,
    recommendation,
    action_type: 'improve_content',
    action_payload: {
      optimization_focus: discussionLed ? 'scale_discussion_format' : 'increase_comment_rate',
      comments,
      likes,
    },
  };
}

function buildCompanyDecisionDrafts(signals: SignalRow[]): FeedbackDecisionDraft[] {
  const byPlatform = new Map<string, number>();
  const byType = new Map<string, number>();

  for (const signal of signals) {
    byPlatform.set(signal.platform, (byPlatform.get(signal.platform) ?? 0) + signal.engagement_count);
    byType.set(signal.engagement_type, (byType.get(signal.engagement_type) ?? 0) + signal.engagement_count);
  }

  const totalEngagement = [...byType.values()].reduce((sum, value) => sum + value, 0);
  if (totalEngagement === 0) return [];

  const drafts: FeedbackDecisionDraft[] = [];
  const platforms = [...byPlatform.entries()].sort((left, right) => right[1] - left[1]);

  if (platforms.length >= 2) {
    const [top, second] = platforms;
    const ratio = top[1] / Math.max(second[1], 1);
    drafts.push(buildPlatformPerformanceDecision(top[0], second[0], ratio, totalEngagement, signals.length));
  }

  const comments = byType.get('comments') ?? 0;
  const likes = byType.get('likes') ?? 0;
  if (likes > 0) {
    drafts.push(buildContentPerformanceDecision(comments / likes, comments, likes));
  }

  return drafts;
}

export type GenerateFeedbackInsightsResult = {
  signals_analyzed: number;
  decisions_created: number;
  decisions_archived: number;
  companies_processed: number;
};

export async function generateFeedbackInsights(): Promise<GenerateFeedbackInsightsResult> {
  assertBackgroundJobContext('feedbackIntelligenceEngine');

  const normalizedSignals = await loadNormalizedFeedbackSignals(7);
  const byCompany = new Map<string, SignalRow[]>();

  for (const signal of normalizedSignals) {
    const companySignals = byCompany.get(signal.company_id) ?? [];
    companySignals.push({
      id: signal.id,
      post_id: signal.post_id,
      platform: signal.platform,
      engagement_type: signal.engagement_type,
      engagement_count: signal.engagement_count,
    });
    byCompany.set(signal.company_id, companySignals);
  }

  let decisionsCreated = 0;
  let decisionsArchived = 0;

  for (const [companyId, companySignals] of byCompany.entries()) {
    await enforceDecisionGenerationThrottle(companyId, 'feedbackIntelligenceEngine');
    const drafts = buildCompanyDecisionDrafts(companySignals);

    if (drafts.length === 0) {
      await archiveDecisionScope({
        company_id: companyId,
        report_tier: 'growth',
        source_service: 'feedbackIntelligenceEngine',
        entity_type: 'global',
        entity_id: null,
        changed_by: 'system',
      });
      decisionsArchived += 1;
      continue;
    }

    const persisted = await replaceDecisionObjectsForSource(
      drafts.map((draft) => ({
        company_id: companyId,
        report_tier: 'growth',
        source_service: 'feedbackIntelligenceEngine',
        entity_type: 'global',
        entity_id: null,
        issue_type: draft.issue_type,
        title: draft.title,
        description: draft.description,
        evidence: draft.evidence,
        impact_traffic: draft.impact_traffic,
        impact_conversion: draft.impact_conversion,
        impact_revenue: draft.impact_revenue,
        priority_score: draft.priority_score,
        effort_score: draft.effort_score,
        confidence_score: draft.confidence_score,
        recommendation: draft.recommendation,
        action_type: draft.action_type,
        action_payload: draft.action_payload,
        status: 'open',
        last_changed_by: 'system',
      }))
    );

    decisionsCreated += persisted.length;
  }

  return {
    signals_analyzed: normalizedSignals.length,
    decisions_created: decisionsCreated,
    decisions_archived: decisionsArchived,
    companies_processed: byCompany.size,
  };
}

export async function getLatestFeedbackDecisions(companyId: string): Promise<PersistedDecisionObject[]> {
  return listDecisionObjects({
    viewName: 'growth_view',
    companyId,
    sourceService: 'feedbackIntelligenceEngine',
    status: ['open'],
    limit: 50,
  });
}
