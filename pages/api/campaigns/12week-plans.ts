import { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../../backend/db/supabaseClient';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { campaignId } = req.query;

    if (!campaignId) {
      return res.status(400).json({ error: 'Campaign ID required' });
    }

    // Get weekly refinements from existing table structure
    const { data: weeklyRefinements, error } = await supabase
      .from('weekly_content_refinements')
      .select('*, daily_content_plans(count)')
      .eq('campaign_id', campaignId)
      .order('week_number');

    if (error) {
      console.log('No weekly refinements found:', error?.message);
      
      // Fallback to campaigns.weekly_themes if weekly refinements table doesn't exist
      const { data: campaign } = await supabase
        .from('campaigns')
        .select('weekly_themes, ai_generated_summary')
        .eq('id', campaignId)
        .single();

      const weeklyThemes = campaign?.weekly_themes || [];
      
      const formattedPlans = weeklyThemes.map((theme: any, index: number) => ({
        id: `week-${index + 1}`,
        week: index + 1,
        theme: theme?.theme || `Week ${index + 1} Theme`,
        contentFocus: theme?.contentFocus || '',
        targetAudience: theme?.targetAudience || '',
        keyMessaging: theme?.keyMessaging || '',
        contentTypes: theme?.contentTypes || [],
        platformStrategy: theme?.platformStrategy || '',
        callToAction: theme?.callToAction || '',
        successMetrics: theme?.successMetrics || {},
        createdAt: theme?.createdAt || new Date().toISOString(),
        status: theme?.status || 'pending',
        dailyPlansCount: theme?.dailyStructure?.length || 0
      }));

      return res.status(200).json({ 
        success: true, 
        plans: formattedPlans,
        count: formattedPlans.length 
      });
    }

    // Format plans from weekly refinements
    const formattedPlans = weeklyRefinements.map((refinement: any) => ({
      id: refinement.id,
      week: refinement.week_number,
      theme: refinement.theme,
      contentFocus: refinement.focus_area,
      targetAudience: refinement.target_audience,
      keyMessaging: refinement.key_messaging,
      contentTypes: refinement.finalized_content || [],
      platformStrategy: refinement.platform_strategy,
      callToAction: refinement.call_to_action,
      successMetrics: refinement.success_metrics,
      createdAt: refinement.created_at,
      status: refinement.refinement_status,
      dailyPlansCount: refinement.daily_content_plans?.[0]?.count || 0,
      aiGenerated: refinement.ai_enhancement_applied,
      finalized: refinement.finalized,
      dailyPopulated: refinement.daily_plan_populated
    }));

    return res.status(200).json({ 
      success: true, 
      plans: formattedPlans,
      count: formattedPlans.length 
    });

  } catch (error) {
    console.error('Error in 12week-plans API:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}