import { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../../utils/supabaseClient';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { campaignId, action } = req.query;

    if (!campaignId) {
      return res.status(400).json({ error: 'Campaign ID required' });
    }

    switch (action) {
      case 'get-overview':
        // Get campaign data
        const { data: campaign, error: campaignError } = await supabase
          .from('campaigns')
          .select('id, name, description, status, created_at, weekly_themes')
          .eq('id', campaignId)
          .single();

        if (campaignError || !campaign) {
          return res.status(404).json({ 
            success: false, 
            error: 'Campaign not found' 
          });
        }

        // Get weekly refinements data (this is where committed plans are stored)
        const { data: weeklyRefinements, error: refinementsError } = await supabase
          .from('weekly_content_refinements')
          .select('*')
          .eq('campaign_id', campaignId)
          .order('week_number');

        console.log('Weekly refinements found:', weeklyRefinements?.length || 0);
        if (weeklyRefinements) {
          console.log('Sample refinement:', weeklyRefinements[0]);
        }

        // Get daily plans count per week  
        const { data: dailyPlans } = await supabase
          .from('daily_content_plans')
          .select('week_number')
          .eq('campaign_id', campaignId);

        const completedWeeks = weeklyRefinements?.length || 0;

        // Create week plans from weekly refinements data
        const weekPlans = weeklyRefinements?.map((refinement: any) => {
          console.log('Processing refinement for week:', refinement.week_number, refinement);
          
          return {
            id: refinement.id,
            week: refinement.week_number,
            status: refinement.refinement_status || 'ai-enhanced',
            theme: refinement.theme || `Week ${refinement.week_number}`,
            contentFocus: refinement.focus_area || refinement.ai_suggestions?.join(', ') || 'AI Generated Content',
            targetAudience: refinement.target_audience || 'General Audience',
            keyMessaging: refinement.key_messaging || 'AI-generated messaging',
            contentTypes: refinement.content_types || ['post', 'video', 'story'],
            platformStrategy: refinement.platform_strategy || 'Multi-platform',
            callToAction: refinement.call_to_action || 'Engage with content',
            successMetrics: {
              reach: refinement.expected_reach || 1000,
              engagement: refinement.expected_engagement || 50,
              conversions: refinement.expected_conversions || 10
            },
            createdAt: refinement.created_at,
            refinementData: refinement, // Include full refinement data for "go deeper"
            // Add AI-generated content details
            aiContent: refinement.ai_enhanced_content || refinement.original_content || refinement.ai_suggestions || [],
            dailyContent: refinement.daily_content_structure || {},
            platforms: refinement.platforms || ['linkedin', 'facebook', 'instagram', 'twitter', 'youtube'],
            // Add AI suggestions as content
            aiSuggestions: refinement.ai_suggestions || []
          };
        }) || [];

        // If no weekly refinements exist, create placeholder weeks
        if (weekPlans.length === 0) {
          const placeholderWeeks = Array.from({ length: 12 }, (_, index) => ({
            id: `week-${index + 1}`,
            week: index + 1,
            status: 'pending',
            theme: `Week ${index + 1}`,
            contentFocus: 'To be planned',
            targetAudience: 'General Audience',
            keyMessaging: 'Key messaging to be defined',
            contentTypes: ['post'],
            platformStrategy: 'Multi-platform',
            callToAction: 'Engage with content',
            successMetrics: {
              reach: 0,
              engagement: 0,
              conversions: 0
            },
            createdAt: new Date().toISOString(),
            refinementData: null,
            aiContent: null,
            dailyContent: null,
            platforms: [],
            aiSuggestions: []
          }));
          weekPlans.push(...placeholderWeeks);
        }

        return res.status(200).json({
          overview: {
            totalWeeks: 12,
            completedWeeks: completedWeeks,
            campaigns: [
              {
                id: campaign.id,
                name: campaign.name || 'Campaign ' + campaignId,
                userId: 'user-123',
                status: campaign.status || 'planning',
                progress: Math.round((completedWeeks / 12) * 100),
                createdAt: campaign.created_at || new Date().toISOString(),
                description: campaign.description
              }
            ],
            plans: weekPlans
          }
        });

      case 'get-weeks':
        // Get all weeks for the campaign
        const { data: weeks, error: weeksError } = await supabase
          .from('weekly_content_refinements')
      .select('*')
      .eq('campaign_id', campaignId)
          .order('week');

        if (weeksError) {
          return res.status(200).json({ weeks: [] });
        }

        return res.status(200).json({ weeks });

      default:
        return res.status(400).json({ error: 'Invalid action' });
    }

  } catch (error) {
    console.error('Error in hierarchical-navigation API:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}