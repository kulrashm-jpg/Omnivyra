import { supabase } from '../db/supabaseClient';

type AnalyticsFilters = {
  fromDate?: string;
  toDate?: string;
  campaignId?: string;
  companyId?: string;
};

type AnalyticsResult = {
  totals: {
    recommendations_count: number;
    campaigns_created: number;
    avg_confidence: number;
    avg_accuracy: number;
  };
  by_platform: Array<{ platform: string; count: number; avg_confidence: number; avg_accuracy: number }>;
  by_trend_source: Array<{ source: string; count: number; avg_score: number }>;
  by_policy: Array<{ policy_id: string; name: string; usage_count: number; avg_confidence: number }>;
  timeline: Array<{ date: string; count: number; avg_confidence: number }>;
};

const average = (values: number[]) =>
  values.length === 0 ? 0 : Number((values.reduce((sum, val) => sum + val, 0) / values.length).toFixed(2));

const normalizeDate = (value?: string) => (value ? new Date(value).toISOString() : null);

export const getRecommendationAnalytics = async (
  filters: AnalyticsFilters = {}
): Promise<AnalyticsResult> => {
  const fromDate = normalizeDate(filters.fromDate);
  const toDate = normalizeDate(filters.toDate);

  let snapshotsQuery = supabase.from('recommendation_snapshots').select('*');
  let auditsQuery = supabase.from('recommendation_audit_logs').select('*');
  let feedbackQuery = supabase.from('performance_feedback').select('*');
  let policiesQuery = supabase.from('recommendation_policies').select('*');

  if (filters.campaignId) {
    snapshotsQuery = snapshotsQuery.eq('campaign_id', filters.campaignId);
    auditsQuery = auditsQuery.eq('campaign_id', filters.campaignId);
    feedbackQuery = feedbackQuery.eq('campaign_id', filters.campaignId);
  }

  if (filters.companyId) {
    snapshotsQuery = snapshotsQuery.eq('company_id', filters.companyId);
    auditsQuery = auditsQuery.eq('company_id', filters.companyId);
  }

  if (fromDate) {
    snapshotsQuery = snapshotsQuery.gte('created_at', fromDate);
    auditsQuery = auditsQuery.gte('created_at', fromDate);
    feedbackQuery = feedbackQuery.gte('collected_at', fromDate);
  }

  if (toDate) {
    snapshotsQuery = snapshotsQuery.lte('created_at', toDate);
    auditsQuery = auditsQuery.lte('created_at', toDate);
    feedbackQuery = feedbackQuery.lte('collected_at', toDate);
  }

  const [
    { data: snapshots = [], error: snapshotError },
    { data: audits = [], error: auditError },
    { data: feedback = [], error: feedbackError },
    { data: policies = [], error: policyError },
  ] = await Promise.all([
    snapshotsQuery,
    auditsQuery,
    feedbackQuery,
    policiesQuery,
  ]);

  if (snapshotError || auditError || feedbackError || policyError) {
    throw new Error('Failed to load analytics data');
  }

  const campaignsCreated = snapshots.filter((rec: any) => !!rec.campaign_id).length;
  const avgConfidence = average(
    snapshots.map((rec: any) => Number(rec.confidence ?? 0))
  );

  const accuracyByCampaign: Record<string, number> = {};
  feedback.forEach((row: any) => {
    if (!row.campaign_id) return;
    accuracyByCampaign[row.campaign_id] =
      (accuracyByCampaign[row.campaign_id] || 0) + Number(row.engagement_rate ?? 0);
  });
  const avgAccuracy = average(Object.values(accuracyByCampaign));

  const platformCounts: Record<string, { count: number; confidences: number[]; accuracies: number[] }> = {};
  snapshots.forEach((rec: any) => {
    const platforms = Array.isArray(rec.platforms) ? rec.platforms : [];
    platforms.forEach((platform: any) => {
      const name = typeof platform === 'string' ? platform : platform.platform;
      if (!name) return;
      if (!platformCounts[name]) {
        platformCounts[name] = { count: 0, confidences: [], accuracies: [] };
      }
      platformCounts[name].count += 1;
      platformCounts[name].confidences.push(Number(rec.confidence ?? 0));
      if (rec.campaign_id && accuracyByCampaign[rec.campaign_id] !== undefined) {
        platformCounts[name].accuracies.push(accuracyByCampaign[rec.campaign_id]);
      }
    });
  });

  const by_platform = Object.entries(platformCounts).map(([platform, data]) => ({
    platform,
    count: data.count,
    avg_confidence: average(data.confidences),
    avg_accuracy: average(data.accuracies),
  }));

  const trendCounts: Record<string, { count: number; scores: number[] }> = {};
  audits.forEach((audit: any) => {
    const sources = Array.isArray(audit.trend_sources_used) ? audit.trend_sources_used : [];
    sources.forEach((sourceEntry: any) => {
      const source = sourceEntry?.source || 'unknown';
      if (!trendCounts[source]) {
        trendCounts[source] = { count: 0, scores: [] };
      }
      trendCounts[source].count += 1;
      trendCounts[source].scores.push(Number(audit.final_score ?? 0));
    });
  });

  const by_trend_source = Object.entries(trendCounts).map(([source, data]) => ({
    source,
    count: data.count,
    avg_score: average(data.scores),
  }));

  const policyNameMap: Record<string, string> = {};
  policies.forEach((policy: any) => {
    policyNameMap[policy.id] = policy.name;
  });

  const policyCounts: Record<string, { count: number; confidences: number[] }> = {};
  audits.forEach((audit: any) => {
    const policyId = audit.policy_id || 'unknown';
    if (!policyCounts[policyId]) {
      policyCounts[policyId] = { count: 0, confidences: [] };
    }
    policyCounts[policyId].count += 1;
    policyCounts[policyId].confidences.push(Number(audit.confidence ?? 0));
  });

  const by_policy = Object.entries(policyCounts).map(([policyId, data]) => ({
    policy_id: policyId,
    name: policyNameMap[policyId] || 'Unknown',
    usage_count: data.count,
    avg_confidence: average(data.confidences),
  }));

  const timelineMap: Record<string, number[]> = {};
  snapshots.forEach((rec: any) => {
    const date = rec.created_at ? new Date(rec.created_at).toISOString().slice(0, 10) : 'unknown';
    if (!timelineMap[date]) timelineMap[date] = [];
    timelineMap[date].push(Number(rec.confidence ?? 0));
  });

  const timeline = Object.entries(timelineMap)
    .map(([date, confidences]) => ({
      date,
      count: confidences.length,
      avg_confidence: average(confidences),
    }))
    .sort((a, b) => a.date.localeCompare(b.date));

  return {
    totals: {
      recommendations_count: snapshots.length,
      campaigns_created: campaignsCreated,
      avg_confidence: avgConfidence,
      avg_accuracy: avgAccuracy,
    },
    by_platform,
    by_trend_source,
    by_policy,
    timeline,
  };
};
