import { NextApiRequest, NextApiResponse } from 'next';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const { method, query } = req;
  const { campaignId, weekNumber, action } = query;

  try {
    switch (method) {
      case 'GET':
        if (action === 'weekly-alignments') {
          return await getWeeklyAlignments(campaignId as string, res);
        } else if (action === 'plan-overview') {
          return await get12WeekPlanOverview(campaignId as string, res);
        } else if (action === 'week-details') {
          return await getWeekDetails(campaignId as string, weekNumber as string, res);
        }
        break;

      case 'POST':
        if (action === 'align-week') {
          return await alignWeek(req.body, res);
        } else if (action === 'populate-from-ai') {
          return await populateFromAIPlan(req.body, res);
        }
        break;

      case 'PUT':
        if (action === 'update-alignment') {
          return await updateAlignmentStatus(req.body, res);
        }
        break;

      default:
        res.setHeader('Allow', ['GET', 'POST', 'PUT']);
        res.status(405).end(`Method ${method} Not Allowed`);
    }
  } catch (error) {
    console.error('Weekly alignment API error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

// Get weekly alignments for a campaign
async function getWeeklyAlignments(campaignId: string, res: NextApiResponse) {
  try {
    const { data: contentPlans, error } = await supabase
      .from('content_plans')
      .select(`
        week_number,
        theme,
        focus_area,
        alignment_status,
        alignment_notes,
        platform,
        content_type,
        status,
        created_at
      `)
      .eq('campaign_id', campaignId)
      .not('week_number', 'is', null)
      .order('week_number', { ascending: true });

    if (error) throw error;

    // Group by week
    const weeklyData = contentPlans.reduce((acc: any, plan: any) => {
      const weekNum = plan.week_number;
      if (!acc[weekNum]) {
        acc[weekNum] = {
          weekNumber: weekNum,
          theme: plan.theme,
          focusArea: plan.focus_area,
          alignmentStatus: plan.alignment_status,
          alignmentNotes: plan.alignment_notes,
          contentItems: [],
          platforms: new Set(),
          contentTypes: new Set(),
          stats: {
            planned: 0,
            created: 0,
            scheduled: 0,
            published: 0
          }
        };
      }

      acc[weekNum].contentItems.push(plan);
      acc[weekNum].platforms.add(plan.platform);
      acc[weekNum].contentTypes.add(plan.content_type);
      
      // Update stats
      switch (plan.status) {
        case 'planned': acc[weekNum].stats.planned++; break;
        case 'created': acc[weekNum].stats.created++; break;
        case 'scheduled': acc[weekNum].stats.scheduled++; break;
        case 'published': acc[weekNum].stats.published++; break;
      }

      return acc;
    }, {});

    // Convert sets to arrays and format response
    const formattedWeeks = Object.values(weeklyData).map((week: any) => ({
      ...week,
      platforms: Array.from(week.platforms),
      contentTypes: Array.from(week.contentTypes),
      totalContent: week.contentItems.length
    }));

    const currentWeek = formattedWeeks.find((week: any) => 
      week.alignmentStatus === 'pending' || week.alignmentStatus === 'in-review'
    );

    const upcomingWeeks = formattedWeeks.filter((week: any) => 
      week.alignmentStatus === 'pending' && week !== currentWeek
    );

    res.status(200).json({
      currentWeek,
      upcomingWeeks: upcomingWeeks.slice(0, 3), // Next 3 weeks
      allWeeks: formattedWeeks
    });

  } catch (error) {
    console.error('Error getting weekly alignments:', error);
    res.status(500).json({ error: 'Failed to get weekly alignments' });
  }
}

// Get 12-week plan overview
async function get12WeekPlanOverview(campaignId: string, res: NextApiResponse) {
  try {
    // Get campaign details
    const { data: campaign, error: campaignError } = await supabase
      .from('campaigns')
      .select('*')
      .eq('id', campaignId)
      .single();

    if (campaignError) throw campaignError;

    // Get AI thread for plan data
    const { data: aiThread, error: threadError } = await supabase
      .from('ai_threads')
      .select('plan_review_data, weekly_themes, review_status')
      .eq('campaign_id', campaignId)
      .single();

    // Get weekly content summary using the view
    const { data: weeklySummary, error: summaryError } = await supabase
      .from('weekly_alignment_summary')
      .select('*')
      .eq('campaign_id', campaignId)
      .order('week_number');

    if (summaryError) throw summaryError;

    res.status(200).json({
      campaign,
      planData: aiThread || {},
      weeklyOverview: weeklySummary,
      reviewStatus: aiThread?.review_status || 'pending'
    });

  } catch (error) {
    console.error('Error getting plan overview:', error);
    res.status(500).json({ error: 'Failed to get plan overview' });
  }
}

// Get specific week details
async function getWeekDetails(campaignId: string, weekNumber: string, res: NextApiResponse) {
  try {
    const { data: weekContent, error } = await supabase
      .from('content_plans')
      .select(`
        *,
        users!content_plans_reviewed_by_fkey(name)
      `)
      .eq('campaign_id', campaignId)
      .eq('week_number', weekNumber)
      .order('date', { ascending: true });

    if (error) throw error;

    // Get performance data for the week
    const { data: performance, error: perfError } = await supabase
      .from('campaign_performance')
      .select('*')
      .eq('campaign_id', campaignId)
      .eq('week_number', weekNumber)
      .single();

    res.status(200).json({
      weekNumber: parseInt(weekNumber),
      content: weekContent,
      performance: performance || {},
      totalItems: weekContent.length
    });

  } catch (error) {
    console.error('Error getting week details:', error);
    res.status(500).json({ error: 'Failed to get week details' });
  }
}

// Align a week (mark as aligned or needs adjustment)
async function alignWeek(body: any, res: NextApiResponse) {
  try {
    const { campaignId, weekNumber, status, notes, reviewerId } = body;

    // Update content plans alignment status
    const { error: updateError } = await supabase
      .from('content_plans')
      .update({
        alignment_status: status,
        alignment_notes: notes,
        reviewed_by: reviewerId,
        reviewed_at: status === 'aligned' ? new Date().toISOString() : null,
        updated_at: new Date().toISOString()
      })
      .eq('campaign_id', campaignId)
      .eq('week_number', weekNumber);

    if (updateError) throw updateError;

    res.status(200).json({ 
      success: true, 
      message: `Week ${weekNumber} alignment status updated to ${status}` 
    });

  } catch (error) {
    console.error('Error aligning week:', error);
    res.status(500).json({ error: 'Failed to align week' });
  }
}

// Populate weekly content from AI plan
async function populateFromAIPlan(body: any, res: NextApiResponse) {
  try {
    const { campaignId, aiPlanData } = body;

    // Use the database function to populate content
    const { data: insertedCount, error } = await supabase
      .rpc('populate_weekly_content_from_ai_plan', {
        campaign_uuid: campaignId,
        ai_plan_data: aiPlanData
      });

    if (error) throw error;

    res.status(200).json({ 
      success: true, 
      insertedCount,
      message: `Populated ${insertedCount} content items from AI plan` 
    });

  } catch (error) {
    console.error('Error populating from AI plan:', error);
    res.status(500).json({ error: 'Failed to populate from AI plan' });
  }
}

// Update alignment status
async function updateAlignmentStatus(body: any, res: NextApiResponse) {
  try {
    const { campaignId, weekNumber, status, notes, reviewerId } = body;

    // Use the database function
    const { error } = await supabase
      .rpc('update_weekly_alignment', {
        campaign_uuid: campaignId,
        week_num: weekNumber,
        new_status: status,
        notes: notes,
        reviewer_uuid: reviewerId
      });

    if (error) throw error;

    res.status(200).json({ 
      success: true, 
      message: `Week ${weekNumber} alignment updated` 
    });

  } catch (error) {
    console.error('Error updating alignment:', error);
    res.status(500).json({ error: 'Failed to update alignment' });
  }
}