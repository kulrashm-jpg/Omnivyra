import { supabase } from '../db/supabaseClient';

export type PerformanceMetricsInput = {
  campaign_id: string;
  recommendation_id?: string | null;
  platform: string;
  post_id: string;
  impressions?: number;
  likes?: number;
  shares?: number;
  comments?: number;
  clicks?: number;
  engagement_rate?: number;
  collected_at?: string;
  source: 'platform_api' | 'manual';
};

export type AggregatedPerformance = {
  campaign_id: string;
  impressions: number;
  likes: number;
  shares: number;
  comments: number;
  clicks: number;
  engagement_rate: number;
  expected_reach?: number | null;
  accuracy_score: number;
  recommendation_confidence?: number | null;
  last_collected_at?: string | null;
};

const clamp = (value: number, min = 0, max = 1) => Math.min(Math.max(value, min), max);

export const computeAccuracyScore = (expected: number, actual: number): number => {
  if (expected <= 0 || actual <= 0) return 0.5;
  const diff = Math.abs(actual - expected) / expected;
  return Number(clamp(1 - diff, 0, 1).toFixed(3));
};

const normalizeMetrics = (input: PerformanceMetricsInput) => {
  const impressions = input.impressions ?? 0;
  const likes = input.likes ?? 0;
  const shares = input.shares ?? 0;
  const comments = input.comments ?? 0;
  const clicks = input.clicks ?? 0;
  const engagementRate =
    input.engagement_rate ??
    (impressions > 0 ? (likes + shares + comments + clicks) / impressions : 0);

  return {
    impressions,
    likes,
    shares,
    comments,
    clicks,
    engagement_rate: Number(engagementRate.toFixed(4)),
  };
};

export const recordPerformance = async (input: PerformanceMetricsInput): Promise<boolean> => {
  try {
    const normalized = normalizeMetrics(input);
    const { error } = await supabase
      .from('performance_feedback')
      .insert({
        campaign_id: input.campaign_id,
        recommendation_id: input.recommendation_id ?? null,
        platform: input.platform,
        post_id: input.post_id,
        impressions: normalized.impressions,
        likes: normalized.likes,
        shares: normalized.shares,
        comments: normalized.comments,
        clicks: normalized.clicks,
        engagement_rate: normalized.engagement_rate,
        collected_at: input.collected_at ?? new Date().toISOString(),
        source: input.source,
      });

    if (error) {
      console.warn('Failed to record performance feedback', error.message);
      return false;
    }
    return true;
  } catch (error) {
    console.warn('Performance feedback record failed');
    return false;
  }
};

export const aggregateCampaignPerformance = async (
  campaignId: string
): Promise<AggregatedPerformance | null> => {
  try {
    const { data: rows, error } = await supabase
      .from('performance_feedback')
      .select('*')
      .eq('campaign_id', campaignId);

    if (error) {
      console.warn('Failed to load performance feedback', error.message);
      return null;
    }

    const totals = (rows || []).reduce(
      (acc: AggregatedPerformance, row: any) => {
        acc.impressions += row.impressions ?? 0;
        acc.likes += row.likes ?? 0;
        acc.shares += row.shares ?? 0;
        acc.comments += row.comments ?? 0;
        acc.clicks += row.clicks ?? 0;
        const collectedAt = row.collected_at ? new Date(row.collected_at).toISOString() : null;
        if (collectedAt && (!acc.last_collected_at || collectedAt > acc.last_collected_at)) {
          acc.last_collected_at = collectedAt;
        }
        return acc;
      },
      {
        campaign_id: campaignId,
        impressions: 0,
        likes: 0,
        shares: 0,
        comments: 0,
        clicks: 0,
        engagement_rate: 0,
        expected_reach: null,
        accuracy_score: 0.5,
        recommendation_confidence: null,
        last_collected_at: null,
      }
    );

    totals.engagement_rate =
      totals.impressions > 0
        ? Number(((totals.likes + totals.shares + totals.comments + totals.clicks) / totals.impressions).toFixed(4))
        : 0;

    const { data: recs } = await supabase
      .from('recommendation_snapshots')
      .select('success_projection, confidence')
      .eq('campaign_id', campaignId);

    const expectedReach = recs?.[0]?.success_projection?.expected_reach ?? null;
    const confidence = recs?.[0]?.confidence ?? null;

    totals.expected_reach = expectedReach;
    totals.recommendation_confidence = confidence;
    totals.accuracy_score =
      expectedReach && totals.impressions
        ? computeAccuracyScore(expectedReach, totals.impressions)
        : 0.5;

    return totals;
  } catch (error) {
    console.warn('Failed to aggregate performance feedback');
    return null;
  }
};

export const compareWithPrediction = async (
  recommendationId: string,
  metrics: { impressions: number }
): Promise<number> => {
  const { data: rec, error } = await supabase
    .from('recommendation_snapshots')
    .select('success_projection')
    .eq('id', recommendationId)
    .single();
  if (error || !rec) return 0.5;
  const expected = rec.success_projection?.expected_reach ?? 0;
  return computeAccuracyScore(expected, metrics.impressions);
};

export const getHistoricalAccuracyScore = async (input: {
  trend_topic: string;
  company_id?: string | null;
}): Promise<number> => {
  try {
    const { trend_topic, company_id } = input;
    let query = supabase
      .from('recommendation_snapshots')
      .select('campaign_id, success_projection')
      .ilike('trend_topic', `%${trend_topic}%`);
    if (company_id) {
      query = query.eq('company_id', company_id);
    }
    const { data: recommendations, error } = await query;
    if (error || !recommendations || recommendations.length === 0) return 0.5;

    const campaignIds = recommendations
      .map((rec: any) => rec.campaign_id)
      .filter(Boolean);
    if (campaignIds.length === 0) return 0.5;

    const { data: feedbackRows } = await supabase
      .from('performance_feedback')
      .select('campaign_id, impressions')
      .in('campaign_id', campaignIds);

    const impressionsByCampaign = (feedbackRows || []).reduce(
      (acc: Record<string, number>, row: any) => {
        acc[row.campaign_id] = (acc[row.campaign_id] || 0) + (row.impressions ?? 0);
        return acc;
      },
      {}
    );

    const scores = recommendations.map((rec: any) => {
      const expected = rec.success_projection?.expected_reach ?? 0;
      const actual = impressionsByCampaign[rec.campaign_id] ?? 0;
      return computeAccuracyScore(expected, actual);
    });

    const average = scores.reduce((sum: number, value: number) => sum + value, 0) / scores.length;
    return Number(clamp(average, 0, 1).toFixed(3));
  } catch (error) {
    return 0.5;
  }
};
