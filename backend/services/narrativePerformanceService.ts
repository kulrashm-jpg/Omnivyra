/**
 * Narrative Performance Intelligence Engine
 * Tracks which storytelling approaches perform best.
 */

import { saveMarketingMemory } from './marketingMemoryService';

export interface ContentItem {
  content_type?: string;
  narrative_type?: string;
  engagement_score?: number;
  platform?: string;
}

export interface NarrativePerformanceInput {
  campaign_id: string;
  company_id: string;
  content_items: ContentItem[];
}

export type NarrativePerformanceResult = {
  narratives_ranked: number;
  memory_entries_created: number;
  top_narrative_patterns: Array<{ narrative: string; avg_engagement: number; count: number }>;
  errors: string[];
};

/**
 * Analyze narrative performance from content items and store in marketing memory.
 */
export async function analyzeNarrativePerformance(
  input: NarrativePerformanceInput
): Promise<NarrativePerformanceResult> {
  const errors: string[] = [];
  let memoryEntriesCreated = 0;
  const { campaign_id, company_id, content_items } = input;
  const items = content_items ?? [];
  let topNarratives: Array<{ narrative: string; avg_engagement: number; count: number }> = [];

  if (items.length === 0) {
    return { narratives_ranked: 0, memory_entries_created: 0, top_narrative_patterns: [], errors };
  }

  try {
    const narrativeScores = new Map<string, { total: number; count: number }>();
    const platformNarratives = new Map<string, Map<string, { total: number; count: number }>>();

    for (const item of items) {
      const narrative = (item.narrative_type ?? item.content_type ?? 'general').trim();
      const score = typeof item.engagement_score === 'number' ? item.engagement_score : 0;
      const platform = (item.platform ?? 'unknown').toLowerCase();

      const cur = narrativeScores.get(narrative) ?? { total: 0, count: 0 };
      cur.total += score;
      cur.count += 1;
      narrativeScores.set(narrative, cur);

      let platMap = platformNarratives.get(platform);
      if (!platMap) {
        platMap = new Map();
        platformNarratives.set(platform, platMap);
      }
      const platCur = platMap.get(narrative) ?? { total: 0, count: 0 };
      platCur.total += score;
      platCur.count += 1;
      platMap.set(narrative, platCur);
    }

    const topNarratives = [...narrativeScores.entries()]
      .map(([narrative, { total, count }]) => ({
        narrative,
        avg_engagement: count > 0 ? total / count : 0,
        count,
      }))
      .filter((n) => n.avg_engagement > 0)
      .sort((a, b) => b.avg_engagement - a.avg_engagement);

    for (const { narrative, avg_engagement } of topNarratives.slice(0, 5)) {
      const id = await saveMarketingMemory({
        company_id,
        memory_type: 'narrative_performance',
        memory_key: `narrative_effectiveness:${narrative}`,
        memory_value: {
          narrative,
          engagement_score: Math.round(avg_engagement * 100) / 100,
          campaign_id,
        },
        confidence: 0.8,
        source: `campaign:${campaign_id}`,
      });
      if (id) memoryEntriesCreated++;
    }

    for (const [platform, platMap] of platformNarratives) {
      const platformTop = [...platMap.entries()]
        .map(([narrative, { total, count }]) => ({
          narrative,
          avg_engagement: count > 0 ? total / count : 0,
        }))
        .filter((n) => n.avg_engagement > 0)
        .sort((a, b) => b.avg_engagement - a.avg_engagement)[0];
      if (platformTop) {
        const id = await saveMarketingMemory({
          company_id,
          memory_type: 'narrative_performance',
          memory_key: `platform_narrative:${platform}`,
          memory_value: {
            platform,
            narrative: platformTop.narrative,
            engagement_score: platformTop.avg_engagement,
            campaign_id,
          },
          confidence: 0.75,
          source: `campaign:${campaign_id}`,
        });
        if (id) memoryEntriesCreated++;
      }
    }
  } catch (err) {
    errors.push(err instanceof Error ? err.message : String(err));
  }

  return {
    narratives_ranked: topNarratives.length,
    memory_entries_created: memoryEntriesCreated,
    top_narrative_patterns: topNarratives.slice(0, 5).map((n) => ({
      narrative: n.narrative,
      avg_engagement: Math.round(n.avg_engagement * 100) / 100,
      count: n.count,
    })),
    errors,
  };
}