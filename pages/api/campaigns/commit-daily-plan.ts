import { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../../utils/supabaseClient';
import { syncCampaignVersionStage } from '../../../backend/db/campaignVersionStore';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { campaignId, weekNumber, day, activities, commitType } = req.body;

    if (!campaignId || !weekNumber || !day || !activities) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // Calculate the date for this day
    const weekStartDate = new Date();
    weekStartDate.setDate(weekStartDate.getDate() + (weekNumber - 1) * 7);
    const dayIndex = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'].indexOf(day);
    const activityDate = new Date(weekStartDate);
    activityDate.setDate(weekStartDate.getDate() + dayIndex);

    // Get weekly_refinement_id for FK link
    const { data: refinement } = await supabase
      .from('weekly_content_refinements')
      .select('id')
      .eq('campaign_id', campaignId)
      .eq('week_number', weekNumber)
      .maybeSingle();

    // Delete existing daily plans for this day
    await supabase
      .from('daily_content_plans')
      .delete()
      .eq('campaign_id', campaignId)
      .eq('week_number', weekNumber)
      .eq('day_of_week', day);

    // Insert new daily plans for each activity (with weekly_refinement_id or source_refinement_id for FK link)
    const refinementId = refinement?.id ?? null;
    const dailyPlans = activities.map((activity: any) => ({
      campaign_id: campaignId,
      week_number: weekNumber,
      day_of_week: day,
      date: activityDate.toISOString().split('T')[0],
      platform: activity.platform || 'linkedin',
      content_type: activity.contentType || 'post',
      title: activity.title || `${day} Content`,
      content: activity.description || activity.content || '',
      topic: activity.topic,
      intro_objective: activity.introObjective,
      objective: activity.objective,
      summary: activity.summary || activity.description,
      key_points: Array.isArray(activity.keyPoints) ? activity.keyPoints : (activity.keyPoints ? [activity.keyPoints] : null),
      cta: activity.cta,
      brand_voice: activity.brandVoice,
      theme_linkage: activity.themeLinkage,
      format_notes: activity.formatNotes,
      hashtags: activity.hashtags || [],
      mentions: activity.mentions || [],
      media_urls: activity.mediaUrls || [],
      media_types: activity.mediaTypes || [],
      required_resources: activity.requiredResources || [],
      scheduled_time: activity.time ? `${activity.time}:00` : null,
      timezone: 'UTC',
      posting_strategy: activity.postingStrategy || 'organic',
      status: 'planned',
      priority: activity.priority || 'medium',
      ai_generated: activity.aiSuggested || false,
      expected_engagement: activity.expectedEngagement || 0,
      target_audience: activity.targetAudience || '',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      ...(refinementId && { source_refinement_id: refinementId }),
    }));

    const { data: insertedPlans, error: insertError } = await supabase
      .from('daily_content_plans')
      .insert(dailyPlans)
      .select();

    if (insertError) {
      console.error('Error inserting daily plans:', insertError);
      return res.status(500).json({ error: 'Failed to commit daily plan' });
    }

    // Update weekly refinement to mark daily plan as populated
    await supabase
      .from('weekly_content_refinements')
      .update({
        daily_plan_populated: true,
        updated_at: new Date().toISOString()
      })
      .eq('campaign_id', campaignId)
      .eq('week_number', weekNumber);

    // Advance campaign to daily_plan stage
    await supabase
      .from('campaigns')
      .update({
        current_stage: 'daily_plan',
        updated_at: new Date().toISOString()
      })
      .eq('id', campaignId);
    void syncCampaignVersionStage(campaignId, 'daily_plan').catch(() => {});

    res.status(200).json({
      success: true,
      message: `${day} plan committed successfully`,
      data: {
        day,
        weekNumber,
        activitiesCount: activities.length,
        committedAt: new Date().toISOString()
      }
    });

  } catch (error) {
    console.error('Error in commit-daily-plan API:', error);
    res.status(500).json({ 
      error: 'Internal server error', 
      details: error instanceof Error ? error.message : String(error)
    });
  }
}





