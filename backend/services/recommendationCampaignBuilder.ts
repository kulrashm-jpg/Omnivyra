import { supabase } from '../db/supabaseClient';
import { runCampaignAiPlan } from './campaignAiOrchestrator';
import { getProfile } from './companyProfileService';
import { getCampaignPlanningInputs } from './campaignPlanningInputsService';

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
  const context = {
    trend_topic: snapshot.trend_topic,
    category: snapshot.category ?? null,
    audience: snapshot.audience ?? null,
    geo: snapshot.geo ?? null,
    platforms: snapshot.platforms ?? null,
    promotion_mode: snapshot.promotion_mode ?? null,
    confidence: (snapshot as any)?.confidence ?? null,
    success_projection: (snapshot as any)?.success_projection ?? null,
    final_score: (snapshot as any)?.final_score ?? null,
    scores: (snapshot as any)?.scores ?? null,
    explanation: (snapshot as any)?.explanation ?? null,
    effort_score: (snapshot as any)?.effort_score ?? null,
    snapshot_hash: (snapshot as any)?.snapshot_hash ?? null,
    refresh_source: (snapshot as any)?.refresh_source ?? null,
    refreshed_at: (snapshot as any)?.refreshed_at ?? null,
    company_profile: {
      name: profile?.name ?? null,
      industry: profile?.industry ?? null,
      category: profile?.category ?? null,
      target_audience: profile?.target_audience ?? null,
      geography: profile?.geography ?? null,
      brand_voice: profile?.brand_voice ?? null,
      goals: profile?.goals ?? null,
      content_themes: profile?.content_themes ?? null,
    },
  };
  console.debug('Recommendation enrichment context attached');
  return JSON.stringify(context, null, 2);
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
    'Generate a 12-week content mix proposal based on this recommendation.\n' +
    'Use the provided context to propose: platforms, content types (video/blog/post/etc.), weekly frequency, and reuse opportunities across platforms.\n' +
    'Base the proposal on: confidence, final_score, company_profile, and platforms.\n' +
    'After proposing, ask for confirmation one field at a time. For each field, provide two suggested options and accept user-provided alternatives.\n' +
    stringifyContext(recommendation as RecommendationSnapshot, profile);

  const planningInputs = await getCampaignPlanningInputs(campaign.id);
  const deterministicPlanningContext = planningInputs
    ? {
        available_content: planningInputs.available_content,
        content_capacity: planningInputs.weekly_capacity,
        exclusive_campaigns: planningInputs.exclusive_campaigns,
        platforms: planningInputs.selected_platforms,
        platform_content_requests: planningInputs.platform_content_requests,
      }
    : {};
  const existingCollectedPlanningContext: Record<string, unknown> | undefined = undefined;
  const finalCollectedPlanningContext = {
    ...(existingCollectedPlanningContext ?? {}),
    ...deterministicPlanningContext,
  };

  console.log('[PLAN INPUT SOURCE]', JSON.stringify(finalCollectedPlanningContext, null, 2));

  const planResult = await runCampaignAiPlan({
    campaignId: campaign.id,
    mode: 'generate_plan',
    message,
    durationWeeks: durationWeeks ?? 12,
    collectedPlanningContext: finalCollectedPlanningContext,
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
