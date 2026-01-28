import { supabase } from '../db/supabaseClient';
import { runCampaignAiPlan } from './campaignAiOrchestrator';
import { getProfile } from './companyProfileService';

type RecommendationSnapshot = {
  id: string;
  company_id: string;
  snapshot_hash?: string | null;
  trend_topic: string;
  category?: string | null;
  audience?: any;
  geo?: any;
  platforms?: any;
  promotion_mode?: string | null;
};

const stringifyContext = (snapshot: RecommendationSnapshot, profile: any) => {
  return JSON.stringify(
    {
      trend_topic: snapshot.trend_topic,
      category: snapshot.category,
      audience: snapshot.audience,
      geo: snapshot.geo,
      platforms: snapshot.platforms,
      promotion_mode: snapshot.promotion_mode,
      company_profile: {
        name: profile?.name,
        industry: profile?.industry,
        category: profile?.category,
        target_audience: profile?.target_audience,
        geography: profile?.geography,
        brand_voice: profile?.brand_voice,
        goals: profile?.goals,
        content_themes: profile?.content_themes,
      },
    },
    null,
    2
  );
};

export async function buildCampaignFromRecommendation(input: {
  recommendationId: string;
  durationWeeks?: number;
}): Promise<{ campaign_id: string; plan: any; recommendation_used: RecommendationSnapshot }> {
  const { recommendationId, durationWeeks } = input;

  const { data: recommendation, error: recError } = await supabase
    .from('recommendation_snapshots')
    .select('*')
    .eq('id', recommendationId)
    .single();

  if (recError || !recommendation) {
    throw new Error('Recommendation not found');
  }

  const profile = await getProfile(recommendation.company_id, { autoRefine: true });

  const { data: campaign, error: campaignError } = await supabase
    .from('campaigns')
    .insert({
      name: `Trend: ${recommendation.trend_topic}`,
      description: `Auto-generated from recommendation ${recommendation.id}`,
      status: 'draft',
      current_stage: 'planning',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .select('*')
    .single();

  if (campaignError || !campaign) {
    throw new Error('Failed to create campaign');
  }

  const message =
    'Create a campaign based on this recommendation.\n' +
    stringifyContext(recommendation as RecommendationSnapshot, profile);

  const planResult = await runCampaignAiPlan({
    campaignId: campaign.id,
    mode: 'generate_plan',
    message,
    durationWeeks: durationWeeks ?? 12,
  });

  const { error: linkError } = await supabase
    .from('recommendation_snapshots')
    .update({ campaign_id: campaign.id })
    .eq('id', recommendation.id);

  if (linkError) {
    console.warn('Failed to link recommendation to campaign', linkError.message);
  }

  return {
    campaign_id: campaign.id,
    plan: planResult.plan,
    recommendation_used: recommendation,
  };
}
