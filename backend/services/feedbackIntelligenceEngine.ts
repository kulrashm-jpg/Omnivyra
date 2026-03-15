/**
 * Feedback Intelligence Engine
 * Analyzes engagement signals and generates actionable insights.
 * Does not modify intelligence pipeline.
 */

import { supabase } from '../db/supabaseClient';

type SignalRow = {
  id: string;
  post_id: string;
  platform: string;
  engagement_type: string;
  engagement_count: number;
};

type PostRow = {
  id: string;
  company_id: string | null;
  platform: string | null;
};

/**
 * Load engagement signals from the last 7 days.
 */
async function loadRecentSignals(): Promise<SignalRow[]> {
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await supabase
    .from('engagement_signals')
    .select('id, post_id, platform, engagement_type, engagement_count')
    .gte('captured_at', since);

  if (error) throw new Error(`Failed to load engagement_signals: ${error.message}`);
  return (data ?? []) as SignalRow[];
}

/**
 * Load post -> company mapping.
 */
async function loadPostCompanies(postIds: string[]): Promise<Map<string, string>> {
  if (postIds.length === 0) return new Map();
  const { data, error } = await supabase
    .from('community_posts')
    .select('id, company_id')
    .in('id', postIds);

  if (error) return new Map();
  const map = new Map<string, string>();
  for (const r of (data ?? []) as PostRow[]) {
    if (r.company_id) map.set(r.id, r.company_id);
  }
  return map;
}

/**
 * Generate insight from aggregated engagement data.
 */
function generateInsight(
  type: string,
  summary: string,
  impactScore: number
): { insight_type: string; insight_summary: string; impact_score: number } {
  return {
    insight_type: type,
    insight_summary: summary,
    impact_score: Math.min(1, Math.max(0, impactScore)),
  };
}

export type GenerateFeedbackInsightsResult = {
  signals_analyzed: number;
  insights_created: number;
  insights_skipped: number;
};

/**
 * Generate feedback intelligence from engagement signals.
 */
export async function generateFeedbackInsights(): Promise<GenerateFeedbackInsightsResult> {
  const signals = await loadRecentSignals();
  const postIds = [...new Set(signals.map((s) => s.post_id))];
  const postToCompany = await loadPostCompanies(postIds);

  const byCompany = new Map<string, SignalRow[]>();
  for (const s of signals) {
    const companyId = postToCompany.get(s.post_id);
    if (!companyId) continue;
    const arr = byCompany.get(companyId) ?? [];
    arr.push(s);
    byCompany.set(companyId, arr);
  }

  let insightsCreated = 0;
  let insightsSkipped = 0;

  for (const [companyId, companySignals] of byCompany) {
    const byPlatform = new Map<string, number>();
    const byType = new Map<string, number>();

    for (const s of companySignals) {
      byPlatform.set(s.platform, (byPlatform.get(s.platform) ?? 0) + s.engagement_count);
      byType.set(s.engagement_type, (byType.get(s.engagement_type) ?? 0) + s.engagement_count);
    }

    const totalEng = [...byType.values()].reduce((a, b) => a + b, 0);
    if (totalEng === 0) continue;

    const platforms = [...byPlatform.entries()].sort((a, b) => b[1] - a[1]);
    if (platforms.length >= 2) {
      const [top, second] = platforms;
      const ratio = top[1] / (second[1] || 1);
      const insight = generateInsight(
        'platform_performance',
        `${top[0]} engagement ${ratio.toFixed(1)}x higher than ${second[0]} for SaaS themes`,
        Math.min(0.9, 0.5 + ratio * 0.1)
      );
      const { error } = await supabase.from('feedback_intelligence').insert({
        signal_id: companySignals[0]?.id ?? null,
        company_id: companyId,
        insight_type: insight.insight_type,
        insight_summary: insight.insight_summary,
        impact_score: insight.impact_score,
      });
      if (!error) insightsCreated++;
      else if (error.code !== '23503') throw new Error(`feedback_intelligence insert failed: ${error.message}`);
      else insightsSkipped++;
    }

    const comments = byType.get('comments') ?? 0;
    const likes = byType.get('likes') ?? 0;
    if (likes > 0) {
      const commentRate = comments / likes;
      const insight = generateInsight(
        'content_performance',
        commentRate > 0.1
          ? 'Thought leadership posts drive higher discussion rate'
          : 'Educational frameworks produce highest engagement',
        Math.min(0.9, 0.5 + commentRate)
      );
      const { error } = await supabase.from('feedback_intelligence').insert({
        signal_id: companySignals[0]?.id ?? null,
        company_id: companyId,
        insight_type: insight.insight_type,
        insight_summary: insight.insight_summary,
        impact_score: insight.impact_score,
      });
      if (!error) insightsCreated++;
      else if (error.code !== '23503') throw new Error(`feedback_intelligence insert failed: ${error.message}`);
      else insightsSkipped++;
    }
  }

  return {
    signals_analyzed: signals.length,
    insights_created: insightsCreated,
    insights_skipped: insightsSkipped,
  };
}
