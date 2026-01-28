import { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../../utils/supabaseClient';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { campaignId, strategy } = req.body;

    if (!campaignId || !strategy) {
      return res.status(400).json({ error: 'Campaign ID and strategy are required' });
    }

    // Save campaign strategy
    const { data: strategyData, error: strategyError } = await supabase
      .from('campaign_strategies')
      .upsert({
        campaign_id: campaignId,
        objective: strategy.objective,
        target_audience: strategy.targetAudience,
        key_platforms: strategy.keyPlatforms,
        campaign_phases: strategy.campaignPhases,
        content_pillars: strategy.contentPillars,
        content_frequency: strategy.contentFrequency,
        visual_identity: strategy.visualIdentity,
        voice_tone: strategy.voiceTone,
        overall_goals: strategy.overallGoals,
        weekly_kpis: strategy.weeklyKpis,
        hashtag_strategy: strategy.hashtagStrategy,
        updated_at: new Date().toISOString()
      })
      .select()
      .single();

    if (strategyError) {
      console.error('Error saving campaign strategy:', strategyError);
      return res.status(500).json({ error: 'Failed to save campaign strategy' });
    }

    // Save content pillars
    if (strategy.contentPillars && strategy.contentPillars.length > 0) {
      const pillarsData = strategy.contentPillars.map((pillar: any) => ({
        campaign_id: campaignId,
        pillar_name: pillar.name,
        description: pillar.description,
        percentage_allocation: pillar.percentage,
        content_types: pillar.contentTypes,
        platform_preferences: pillar.platforms,
        hashtag_categories: pillar.hashtagCategories,
        visual_style: pillar.visualStyle
      }));

      const { error: pillarsError } = await supabase
        .from('content_pillars')
        .upsert(pillarsData);

      if (pillarsError) {
        console.error('Error saving content pillars:', pillarsError);
      }
    }

    // Save platform strategies
    if (strategy.contentFrequency) {
      const platformStrategies = Object.entries(strategy.contentFrequency).map(([platform, frequency]: [string, any]) => ({
        campaign_id: campaignId,
        platform,
        content_frequency: frequency,
        optimal_posting_times: {}, // Will be populated later
        content_types: [], // Will be populated later
        character_limits: {}, // Will be populated later
        target_metrics: {
          impressions: 0,
          engagements: 0,
          followers: 0
        }
      }));

      const { error: platformError } = await supabase
        .from('platform_strategies')
        .upsert(platformStrategies);

      if (platformError) {
        console.error('Error saving platform strategies:', platformError);
      }
    }

    res.status(200).json({
      success: true,
      message: 'Campaign strategy saved successfully',
      data: strategyData
    });

  } catch (error) {
    console.error('Error in save-strategy API:', error);
    res.status(500).json({
      error: 'Internal server error',
      details: error instanceof Error ? error.message : String(error)
    });
  }
}



