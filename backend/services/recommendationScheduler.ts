import { supabase } from '../db/supabaseClient';
import { fetchTrendsFromApis, getCompanyDefaultApiIds } from './externalApiService';
import { generateRecommendations } from './recommendationEngine';
import { getProfile } from './companyProfileService';

type RefreshSource = 'manual' | 'auto_weekly' | 'profile_update';

const persistRecommendations = async (companyId: string, recommendations: any[], source: RefreshSource) => {
  if (recommendations.length === 0) return;
  const records = recommendations.map((rec) => ({
    company_id: companyId,
    trend_topic: rec.trend,
    category: rec.category || null,
    audience: rec.audience,
    geo: rec.geo,
    platforms: rec.platforms,
    promotion_mode: rec.promotion_mode,
    effort_score: rec.effort_score,
    success_projection: {
      expected_reach: rec.expected_reach,
      expected_growth: rec.expected_growth,
    },
    final_score: rec.final_score,
    scores: rec.scores,
    confidence: rec.confidence,
    explanation: rec.explanation,
    refresh_source: source,
    refreshed_at: new Date().toISOString(),
    created_at: new Date().toISOString(),
  }));

  const { error } = await supabase.from('recommendation_snapshots').insert(records);
  if (error) {
    console.warn('Failed to persist recommendations', error.message);
  }
};

const getActiveCompanyIds = async (): Promise<string[]> => {
  const { data, error } = await supabase
    .from('company_profiles')
    .select('company_id');
  if (error) {
    console.warn('Failed to load company profiles', error.message);
    return [];
  }
  return (data || []).map((row: any) => row.company_id).filter(Boolean);
};

export async function runWeeklyRecommendationRefresh(): Promise<void> {
  const companyIds = await getActiveCompanyIds();
  if (companyIds.length === 0) return;

  for (const companyId of companyIds) {
    try {
      const profile = await getProfile(companyId, { autoRefine: false });
      const geoHint = profile?.geography_list?.[0] ?? profile?.geography ?? undefined;
      const categoryHint = profile?.industry_list?.[0] ?? profile?.category ?? undefined;
      const defaultApiIds = await getCompanyDefaultApiIds(companyId);
      const trends = await fetchTrendsFromApis(companyId, geoHint, categoryHint, {
        recordHealth: false,
        selectedApiIds: defaultApiIds,
        feature: 'recommendations',
      });
      const recommendations = await generateRecommendations({
        companyProfile: profile,
        trendSignals: trends,
      });
      await persistRecommendations(companyId, recommendations, 'auto_weekly');
      console.log('Weekly recommendation refresh', {
        company_id: companyId,
        count: recommendations.length,
      });
    } catch (error) {
      console.warn('Weekly recommendation refresh failed', { companyId });
    }
  }
}

export async function runCompanyProfileTriggeredRefresh(companyId: string): Promise<void> {
  if (!companyId) return;
  try {
    const profile = await getProfile(companyId, { autoRefine: false });
    const geoHint = profile?.geography_list?.[0] ?? profile?.geography ?? undefined;
    const categoryHint = profile?.industry_list?.[0] ?? profile?.category ?? undefined;
    const defaultApiIds = await getCompanyDefaultApiIds(companyId);
    const trends = await fetchTrendsFromApis(companyId, geoHint, categoryHint, {
      recordHealth: false,
      selectedApiIds: defaultApiIds,
      feature: 'recommendations',
    });
    const recommendations = await generateRecommendations({
      companyProfile: profile,
      trendSignals: trends,
    });
    await persistRecommendations(companyId, recommendations, 'profile_update');
    console.log('Profile-triggered recommendation refresh', {
      company_id: companyId,
      count: recommendations.length,
    });
  } catch (error) {
    console.warn('Profile-triggered recommendation refresh failed', { companyId });
  }
}
