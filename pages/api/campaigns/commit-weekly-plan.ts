import { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../../backend/db/supabaseClient';
import { getSupabaseUserFromRequest } from '../../../backend/services/supabaseAuthService';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { user, error: authError } = await getSupabaseUserFromRequest(req);
  if (authError || !user) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const { campaignId, weekNumber, weekData, commitType } = req.body;

    if (!campaignId || !weekNumber || !weekData) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // Update the weekly refinement status to 'finalized'
    const { data: updatedRefinement, error: updateError } = await supabase
      .from('weekly_content_refinements')
      .update({
        refinement_status: 'finalized',
        finalized: true,
        finalized_at: new Date().toISOString(),
        finalized_by: user.id,
        updated_at: new Date().toISOString()
      })
      .eq('campaign_id', campaignId)
      .eq('week_number', weekNumber)
      .select()
      .single();

    if (updateError) {
      console.error('Error updating weekly refinement:', updateError);
      return res.status(500).json({ error: 'Failed to commit weekly plan' });
    }

    // If committing, also generate daily plans for this week via execution engine
    if (commitType === 'finalize') {
      try {
        const daysOfWeek = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
        const platforms = ['linkedin', 'facebook', 'instagram', 'twitter', 'youtube'];
        const contentTypes = ['post', 'video', 'story', 'article', 'poll'];
        const rows: Array<Record<string, unknown>> = [];

        for (let dayIndex = 0; dayIndex < 7; dayIndex++) {
          const day = daysOfWeek[dayIndex];
          const date = new Date();
          date.setDate(date.getDate() + (weekNumber - 1) * 7 + dayIndex);

          for (const platform of platforms) {
            const contentType = contentTypes[dayIndex % contentTypes.length];
            rows.push({
              campaign_id: campaignId,
              week_number: weekNumber,
              day_of_week: day,
              date: date.toISOString().split('T')[0],
              platform: platform,
              content_type: contentType,
              title: `${weekData.theme} - ${day} ${platform} Content`,
              content: `Content for ${day} on ${platform} - ${weekData.focus_area}`,
              hashtags: [`#${platform}`, `#week${weekNumber}`, `#${weekData.theme?.toLowerCase().replace(/\s+/g, '')}`],
              status: 'planned',
              priority: 'medium',
              source_refinement_id: updatedRefinement.id,
              ai_generated: true,
            });
          }
        }

        if (rows.length > 0) {
          const { saveWeekPlans } = await import('../../../backend/services/executionPlannerService');
          await saveWeekPlans(campaignId, weekNumber, rows as any, 'blueprint');
        }
      } catch (error) {
        console.log('Error generating daily plans:', error);
      }
    }

    res.status(200).json({
      success: true,
      message: `Week ${weekNumber} plan committed successfully`,
      data: {
        weekNumber,
        status: 'finalized',
        updatedAt: new Date().toISOString()
      }
    });

  } catch (error) {
    console.error('Error in commit-weekly-plan API:', error);
    res.status(500).json({ 
      error: 'Internal server error', 
      details: error instanceof Error ? error.message : String(error)
    });
  }
}
