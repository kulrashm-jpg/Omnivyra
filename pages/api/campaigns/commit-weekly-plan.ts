import { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../../utils/supabaseClient';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
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
        finalized_by: '550e8400-e29b-41d4-a716-446655440000', // Default user
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

    // If committing, also generate daily plans for this week
    if (commitType === 'finalize') {
      try {
        // Generate daily content plans for each day of the week
        const daysOfWeek = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
        const platforms = ['linkedin', 'facebook', 'instagram', 'twitter', 'youtube'];
        const contentTypes = ['post', 'video', 'story', 'article', 'poll'];

        for (let dayIndex = 0; dayIndex < 7; dayIndex++) {
          const day = daysOfWeek[dayIndex];
          const date = new Date();
          date.setDate(date.getDate() + (weekNumber - 1) * 7 + dayIndex);

          // Create daily plans for different platforms
          for (const platform of platforms) {
            const contentType = contentTypes[dayIndex % contentTypes.length];
            
            const { error: dailyPlanError } = await supabase
              .from('daily_content_plans')
              .insert({
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
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString()
              });

            if (dailyPlanError) {
              console.log(`Error creating daily plan for ${day} ${platform}:`, dailyPlanError);
            }
          }
        }
      } catch (error) {
        console.log('Error generating daily plans:', error);
        // Don't fail the commit if daily plan generation fails
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





