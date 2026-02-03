import { getProfile } from './companyProfileService';
import { fetchTrendsFromApis } from './externalApiService';
import { getActivePolicy, RecommendationPolicyWeights } from './recommendationPolicyService';
import { generateRecommendations } from './recommendationEngine';

export const simulateRecommendations = async (input: {
  companyId?: string;
  campaignId?: string;
  draftPolicyWeights: RecommendationPolicyWeights;
}) => {
  const { companyId, campaignId, draftPolicyWeights } = input;

  const profile = await getProfile(companyId, { autoRefine: false });
  const geoHint = profile?.geography_list?.[0] ?? profile?.geography ?? undefined;
  const categoryHint = profile?.industry_list?.[0] ?? profile?.category ?? undefined;
  const trendSignals = await fetchTrendsFromApis(companyId, geoHint, categoryHint, { recordHealth: false });
  const activePolicy = await getActivePolicy();

  const baseline = await generateRecommendations(
    {
      companyProfile: profile,
      trendSignals,
    },
    {
      policyOverride: activePolicy || undefined,
      disableAudit: true,
    }
  );

  const draft = await generateRecommendations(
    {
      companyProfile: profile,
      trendSignals,
    },
    {
      policyWeightsOverride: draftPolicyWeights,
      disableAudit: true,
    }
  );

  return {
    simulated_recommendations: draft,
    baseline_recommendations: baseline,
    compared_with: activePolicy?.id ?? null,
    campaign_id: campaignId ?? null,
  };
};
