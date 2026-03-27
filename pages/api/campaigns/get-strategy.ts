import { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../../backend/db/supabaseClient';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { campaignId } = req.query;

    if (!campaignId) {
      return res.status(400).json({ error: 'Campaign ID is required' });
    }

    // Planning-only: return strategy metadata without execution/automation details.
    // Community-AI playbooks execute separately and are not surfaced here.
    // Get campaign strategy
    const { data: strategy, error: strategyError } = await supabase
      .from('campaign_strategies')
      .select('*')
      .eq('campaign_id', campaignId)
      .single();

    if (strategyError && strategyError.code !== 'PGRST116') {
      console.error('Error fetching campaign strategy:', strategyError);
      return res.status(500).json({ error: 'Failed to fetch campaign strategy' });
    }

    // Get content pillars
    const { data: pillars, error: pillarsError } = await supabase
      .from('content_pillars')
      .select('*')
      .eq('campaign_id', campaignId);

    if (pillarsError) {
      console.error('Error fetching content pillars:', pillarsError);
    }

    // Get platform strategies
    const { data: platformStrategies, error: platformError } = await supabase
      .from('platform_strategies')
      .select('*')
      .eq('campaign_id', campaignId);

    if (platformError) {
      console.error('Error fetching platform strategies:', platformError);
    }

    // Format response
    const response = {
      objective: strategy?.objective || '',
      targetAudience: strategy?.target_audience || '',
      keyPlatforms: strategy?.key_platforms || [],
      campaignPhases: strategy?.campaign_phases || {},
      contentPillars: pillars?.map(pillar => ({
        id: pillar.id,
        name: pillar.pillar_name,
        description: pillar.description,
        percentage: pillar.percentage_allocation,
        contentTypes: pillar.content_types,
        platforms: pillar.platform_preferences,
        hashtagCategories: pillar.hashtag_categories,
        visualStyle: pillar.visual_style
      })) || [],
      contentFrequency: platformStrategies?.reduce((acc, ps) => {
        acc[ps.platform] = ps.content_frequency;
        return acc;
      }, {}) || {},
      visualIdentity: strategy?.visual_identity || {
        colors: [],
        fonts: [],
        templates: []
      },
      voiceTone: strategy?.voice_tone || '',
      overallGoals: strategy?.overall_goals || {
        totalImpressions: 0,
        totalEngagements: 0,
        followerGrowth: 0,
        ugcSubmissions: 0,
        playlistAdds: 0,
        websiteTraffic: 0
      },
      weeklyKpis: strategy?.weekly_kpis || {
        impressions: 0,
        engagements: 0,
        followerGrowth: 0,
        ugcSubmissions: 0
      },
      hashtagStrategy: strategy?.hashtag_strategy || {
        branded: [],
        industry: [],
        trending: []
      }
    };

    res.status(200).json(response);

  } catch (error) {
    console.error('Error in get-strategy API:', error);
    res.status(500).json({
      error: 'Internal server error',
      details: error instanceof Error ? error.message : String(error)
    });
  }
}



