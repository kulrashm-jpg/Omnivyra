import { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../../utils/supabaseClient';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { planId, campaignId } = req.query;

    if (!planId || !campaignId) {
      return res.status(400).json({ error: 'Plan ID and Campaign ID are required' });
    }

    // Get campaign details
    const { data: campaign, error: campaignError } = await supabase
      .from('campaigns')
      .select('*')
      .eq('id', campaignId)
      .single();

    if (campaignError) {
      console.error('Error fetching campaign:', campaignError);
      return res.status(500).json({ error: 'Failed to fetch campaign' });
    }

    // Get weekly content refinements
    const { data: refinements, error: refinementsError } = await supabase
      .from('weekly_content_refinements')
      .select('*')
      .eq('campaign_id', campaignId)
      .order('week_number', { ascending: true });

    if (refinementsError) {
      console.error('Error fetching refinements:', refinementsError);
    }

    // Get performance data
    const { data: performance, error: performanceError } = await supabase
      .from('campaign_performance')
      .select('*')
      .eq('campaign_id', campaignId)
      .order('week_number', { ascending: true });

    if (performanceError) {
      console.error('Error fetching performance:', performanceError);
    }

    // Build weeks data
    const weeks = Array.from({ length: 12 }, (_, i) => {
      const weekNumber = i + 1;
      const refinement = refinements?.find(r => r.week_number === weekNumber);
      const weekPerformance = performance?.filter(p => p.week_number === weekNumber);
      
      return {
        weekNumber,
        theme: refinement?.theme || campaign.weekly_themes?.[i]?.theme || `Week ${weekNumber} Theme`,
        focusArea: refinement?.focus_area || campaign.weekly_themes?.[i]?.focusArea || `Week ${weekNumber} Focus`,
        contentCount: refinement?.ai_suggestions?.length || 0,
        platforms: [...new Set(weekPerformance?.map(p => p.platform).filter(Boolean))],
        status: refinement?.refinement_status || 'draft',
        performance: weekPerformance?.[0] || null,
        aiSuggestions: refinement?.ai_suggestions || [],
        manualEdits: refinement?.manual_edits || {}
      };
    });

    // Build summary
    const summary = {
      id: campaign.id,
      name: campaign.name,
      description: campaign.description,
      startDate: campaign.start_date,
      endDate: campaign.end_date,
      objective: campaign.objective,
      audience: campaign.target_audience,
      contentFocus: campaign.content_focus,
      targetMetrics: campaign.target_metrics,
      campaignSummary: campaign.campaign_summary,
      aiGeneratedSummary: campaign.ai_generated_summary,
      weeklyThemes: campaign.weekly_themes,
      performanceTargets: campaign.performance_targets,
      status: campaign.status
    };

    // Build performance data
    const performanceData = {
      totalReach: performance?.reduce((sum, p) => sum + (p.total_reach || 0), 0) || 0,
      totalEngagement: performance?.reduce((sum, p) => sum + (p.total_engagement || 0), 0) || 0,
      totalConversions: performance?.reduce((sum, p) => sum + (p.total_conversions || 0), 0) || 0,
      weeklyPerformance: weeks.map(week => ({
        weekNumber: week.weekNumber,
        reach: week.performance?.total_reach || 0,
        engagement: week.performance?.total_engagement || 0,
        conversions: week.performance?.total_conversions || 0,
        targetReach: week.performance?.target_reach || 0,
        targetEngagement: week.performance?.target_engagement || 0,
        targetConversions: week.performance?.target_conversions || 0
      }))
    };

    res.status(200).json({ 
      weeks,
      summary,
      performance: performanceData
    });

  } catch (error) {
    console.error('Error in 12week-plans/[planId] API:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}
