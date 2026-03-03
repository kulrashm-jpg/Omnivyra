/**
 * Weekly Strategy Intelligence Service
 *
 * Aggregates strategic feedback, AI activity queue summary, and engagement metrics
 * into a single read-only payload for weekly planning context.
 * No mutations, no AI, no automation.
 */

import { getLatestStrategicFeedback } from './strategicFeedbackService';
import { getAiActivityQueue } from './aiActivityQueueService';
import { getLatestCampaignVersionByCampaignId } from '../db/campaignVersionStore';

export type WeeklyStrategyIntelligence = {
  engagement_summary: {
    total_comments: number;
    avg_comments_per_post: number;
    total_posts_published: number;
  };
  strategic_insights: string[];
  ai_pressure: {
    high_priority_actions: number;
    medium_priority_actions: number;
    low_priority_actions: number;
  };
  intelligence_level: 'LOW' | 'MEDIUM' | 'HIGH';
};

const NEGATIVE_INSIGHT_PHRASE = 'negative feedback detected';

/**
 * Deterministic intelligence level from metrics and insights.
 * HIGH: high_priority_actions >= 5 OR negative signals insight exists.
 * MEDIUM: total_comments > 0 OR medium_priority_actions >= 3.
 * LOW: otherwise.
 */
function computeIntelligenceLevel(
  total_comments: number,
  medium_priority_actions: number,
  high_priority_actions: number,
  strategic_insights: string[]
): 'LOW' | 'MEDIUM' | 'HIGH' {
  const hasNegativeInsight = strategic_insights.some((s) =>
    s.toLowerCase().includes(NEGATIVE_INSIGHT_PHRASE)
  );
  if (high_priority_actions >= 5 || hasNegativeInsight) return 'HIGH';
  if (total_comments > 0 || medium_priority_actions >= 3) return 'MEDIUM';
  return 'LOW';
}

/**
 * Get aggregated weekly strategy intelligence for a campaign.
 * Uses: latest strategic feedback, AI activity queue (filtered to campaign), deterministic level.
 */
export async function getWeeklyStrategyIntelligence(
  campaign_id: string
): Promise<WeeklyStrategyIntelligence> {
  const version = await getLatestCampaignVersionByCampaignId(campaign_id);
  const companyId = version?.company_id ? String(version.company_id) : null;

  const [feedback, queueResult] = await Promise.all([
    getLatestStrategicFeedback(campaign_id),
    companyId
      ? getAiActivityQueue({
          tenant_id: companyId,
          organization_id: companyId,
          status: 'pending',
        }).catch(() => ({ queue: [] }))
      : Promise.resolve({ queue: [] }),
  ]);

  const queue = queueResult.queue ?? [];
  const campaignQueue = queue.filter(
    (a: any) => a.related_scheduled_post?.campaign_id === campaign_id
  );

  let high_priority_actions = 0;
  let medium_priority_actions = 0;
  let low_priority_actions = 0;
  for (const a of campaignQueue) {
    const label = (a.priority_label ?? 'LOW').toString().toUpperCase();
    if (label === 'HIGH') high_priority_actions += 1;
    else if (label === 'MEDIUM') medium_priority_actions += 1;
    else low_priority_actions += 1;
  }

  const metrics = feedback?.metrics;
  const total_comments = metrics?.total_comments ?? 0;
  const avg_comments_per_post = metrics?.avg_comments_per_post ?? 0;
  const total_posts_published = metrics?.total_posts_published ?? 0;
  const strategic_insights = Array.isArray(feedback?.insights) ? feedback.insights : [];

  const intelligence_level = computeIntelligenceLevel(
    total_comments,
    medium_priority_actions,
    high_priority_actions,
    strategic_insights
  );

  return {
    engagement_summary: {
      total_comments,
      avg_comments_per_post,
      total_posts_published,
    },
    strategic_insights,
    ai_pressure: {
      high_priority_actions,
      medium_priority_actions,
      low_priority_actions,
    },
    intelligence_level,
  };
}
