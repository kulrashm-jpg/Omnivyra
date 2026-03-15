/**
 * Campaign Outcome Learning Engine
 * Analyzes campaign results and stores learnings into marketing memory.
 */

import { saveMarketingMemory } from './marketingMemoryService';
import type { MemoryType } from './marketingMemoryService';

export interface CampaignOutcomeLearningInput {
  company_id: string;
  campaign_id: string;
  performance_metrics: {
    impressions?: number;
    engagement_rate?: number;
    conversion_rate?: number;
    content_formats?: string[];
    narratives_used?: string[];
    audience_segments?: string[];
    format_engagement?: Record<string, number>;
    narrative_engagement?: Record<string, number>;
  };
}

export type CampaignOutcomeLearningResult = {
  memory_entries_created: number;
  errors: string[];
};

/**
 * Learn from campaign outcome and persist to marketing memory.
 */
export async function learnFromCampaignOutcome(
  input: CampaignOutcomeLearningInput
): Promise<CampaignOutcomeLearningResult> {
  const errors: string[] = [];
  let memoryEntriesCreated = 0;
  const { company_id, campaign_id, performance_metrics } = input;
  const metrics = performance_metrics ?? {};

  try {
    const formatEngagement = metrics.format_engagement ?? {};
    const contentFormats = metrics.content_formats ?? Object.keys(formatEngagement);
    if (contentFormats.length > 0) {
      const formatScores = Object.entries(formatEngagement).sort((a, b) => b[1] - a[1]);
      if (formatScores.length > 0) {
        const [topFormat, avgEng] = formatScores[0];
        const id = await saveMarketingMemory({
          company_id,
          memory_type: 'content_performance',
          memory_key: 'high_performing_content_format',
          memory_value: { format: topFormat, avg_engagement: avgEng },
          confidence: 0.85,
          source: `campaign:${campaign_id}`,
        });
        if (id) memoryEntriesCreated++;
      }
    }

    const narrativeEngagement = metrics.narrative_engagement ?? {};
    const narrativesUsed = metrics.narratives_used ?? Object.keys(narrativeEngagement);
    if (narrativesUsed.length > 0) {
      const narrativeScores = Object.entries(narrativeEngagement)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5);
      for (const [narrative, score] of narrativeScores) {
        const id = await saveMarketingMemory({
          company_id,
          memory_type: 'narrative_performance',
          memory_key: `narrative_effectiveness:${narrative}`,
          memory_value: { narrative, engagement_score: score },
          confidence: 0.8,
          source: `campaign:${campaign_id}`,
        });
        if (id) memoryEntriesCreated++;
      }
    }

    const engagementRate = metrics.engagement_rate ?? 0;
    const conversionRate = metrics.conversion_rate ?? 0;
    if (engagementRate > 0 || conversionRate > 0) {
      const id = await saveMarketingMemory({
        company_id,
        memory_type: 'campaign_outcome',
        memory_key: `campaign_outcome:${campaign_id}`,
        memory_value: {
          impressions: metrics.impressions ?? 0,
          engagement_rate: engagementRate,
          conversion_rate: conversionRate,
          content_formats: metrics.content_formats ?? [],
          narratives_used: metrics.narratives_used ?? [],
          audience_segments: metrics.audience_segments ?? [],
        },
        confidence: 0.75,
        source: `campaign:${campaign_id}`,
      });
      if (id) memoryEntriesCreated++;
    }

    if (metrics.audience_segments?.length) {
      const id = await saveMarketingMemory({
        company_id,
        memory_type: 'audience_pattern',
        memory_key: 'engaged_audience_segments',
        memory_value: {
          segments: metrics.audience_segments,
          engagement_rate: engagementRate,
        },
        confidence: 0.7,
        source: `campaign:${campaign_id}`,
      });
      if (id) memoryEntriesCreated++;
    }
  } catch (err) {
    errors.push(err instanceof Error ? err.message : String(err));
  }

  return { memory_entries_created: memoryEntriesCreated, errors };
}