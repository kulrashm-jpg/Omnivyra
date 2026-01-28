import { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../../../backend/db/supabaseClient';
import { runCampaignAiPlan } from '../../../../backend/services/campaignAiOrchestrator';

type RecommendationSnapshot = {
  id: string;
  company_id: string;
  trend_topic: string;
  category?: string | null;
  audience?: any;
  geo?: any;
  platforms?: any;
  promotion_mode?: string | null;
};

const buildRecommendationContext = (snapshot: RecommendationSnapshot) => {
  return JSON.stringify(
    {
      trend_topic: snapshot.trend_topic,
      category: snapshot.category,
      audience: snapshot.audience,
      geo: snapshot.geo,
      platforms: snapshot.platforms,
      promotion_mode: snapshot.promotion_mode,
    },
    null,
    2
  );
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { id } = req.query;
  if (!id || typeof id !== 'string') {
    return res.status(400).json({ error: 'Recommendation ID is required' });
  }

  try {
    const { durationWeeks } = req.body || {};

    const { data: recommendation, error: recError } = await supabase
      .from('recommendation_snapshots')
      .select('*')
      .eq('id', id)
      .single();

    if (recError || !recommendation) {
      return res.status(404).json({ error: 'Recommendation not found' });
    }

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
      return res.status(500).json({ error: 'Failed to create campaign' });
    }

    const message =
      'Generate campaign plan based on this recommendation.\n' +
      buildRecommendationContext(recommendation as RecommendationSnapshot);

    const planResult = await runCampaignAiPlan({
      campaignId: campaign.id,
      mode: 'generate_plan',
      message,
      durationWeeks: typeof durationWeeks === 'number' ? durationWeeks : undefined,
    });

    const { error: linkError } = await supabase
      .from('recommendation_snapshots')
      .update({ campaign_id: campaign.id })
      .eq('id', recommendation.id);

    if (linkError) {
      console.warn('Failed to link recommendation to campaign', linkError.message);
    }

    return res.status(200).json({
      campaign_id: campaign.id,
      snapshot_hash: planResult.snapshot_hash,
      omnivyre_decision: planResult.omnivyre_decision,
    });
  } catch (error: any) {
    console.error('Error creating campaign from recommendation:', error);
    return res.status(500).json({ error: 'Failed to create campaign from recommendation' });
  }
}
