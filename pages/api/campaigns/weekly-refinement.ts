import { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../../backend/db/supabaseClient';
import { getSupabaseUserFromRequest } from '../../../backend/services/supabaseAuthService';
import { refineUserFacingResponse } from '@/backend/utils/refineUserFacingResponse';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const { user, error: authError } = await getSupabaseUserFromRequest(req);
  if (authError || !user) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { method, query } = req;
  const { campaignId, weekNumber, action } = query;

  try {
    switch (method) {
      case 'GET':
        if (action === 'weekly-refinement') {
          return await getWeeklyRefinement(campaignId as string, weekNumber as string, res);
        } else if (action === 'refinement-status') {
          return await getRefinementStatus(campaignId as string, res);
        } else if (action === 'daily-plans') {
          return await getDailyPlans(campaignId as string, weekNumber as string, res);
        }
        break;

      case 'POST':
        if (action === 'enhance-with-ai') {
          return await enhanceWithAI(req.body, res);
        } else if (action === 'manual-edit') {
          return await manualEdit(req.body, res);
        } else if (action === 'finalize-week') {
          return await finalizeWeek(req.body, res);
        } else if (action === 'populate-daily') {
          return await populateDailyPlans(req.body, res);
        }
        break;

      case 'PUT':
        if (action === 'update-refinement') {
          return await updateRefinement(req.body, res);
        }
        break;

      default:
        res.setHeader('Allow', ['GET', 'POST', 'PUT']);
        res.status(405).end(`Method ${method} Not Allowed`);
    }
  } catch (error) {
    console.error('Weekly refinement API error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

// Get weekly refinement details
async function getWeeklyRefinement(campaignId: string, weekNumber: string, res: NextApiResponse) {
  try {
    // Get refinement record
    const { data: refinement, error: refinementError } = await supabase
      .from('weekly_content_refinements')
      .select('*')
      .eq('campaign_id', campaignId)
      .eq('week_number', weekNumber)
      .single();

    // Get weekly content
    const { data: weeklyContent, error: contentError } = await supabase
      .from('content_plans')
      .select('*')
      .eq('campaign_id', campaignId)
      .eq('week_number', weekNumber)
      .order('day_of_week');

    if (contentError) throw contentError;

    const data = {
      refinement: refinement || null,
      weeklyContent,
      totalItems: weeklyContent.length,
      canEnhance: !refinement?.ai_enhancement_applied,
      canFinalize: refinement?.manual_edits_applied || refinement?.ai_enhancement_applied,
      canPopulateDaily: refinement?.finalized && !refinement?.daily_plan_populated
    };
    const refined = await refineUserFacingResponse(data);
    res.status(200).json(refined);

  } catch (error) {
    console.error('Error getting weekly refinement:', error);
    res.status(500).json({ error: 'Failed to get weekly refinement' });
  }
}

// Get refinement status for all weeks
async function getRefinementStatus(campaignId: string, res: NextApiResponse) {
  try {
    const { data: statusData, error } = await supabase
      .from('weekly_refinement_status')
      .select('*')
      .eq('campaign_id', campaignId)
      .order('week_number');

    if (error) throw error;

    const data = {
      weeks: statusData,
      summary: {
        totalWeeks: statusData.length,
        aiEnhanced: statusData.filter(w => w.ai_enhancement_applied).length,
        manuallyEdited: statusData.filter(w => w.manual_edits_applied).length,
        finalized: statusData.filter(w => w.finalized).length,
        dailyPopulated: statusData.filter(w => w.daily_plan_populated).length
      }
    };
    const refined = await refineUserFacingResponse(data);
    res.status(200).json(refined);

  } catch (error) {
    console.error('Error getting refinement status:', error);
    res.status(500).json({ error: 'Failed to get refinement status' });
  }
}

// Get daily plans for a week
async function getDailyPlans(campaignId: string, weekNumber: string, res: NextApiResponse) {
  try {
    const { data: dailyPlans, error } = await supabase
      .from('daily_content_plans')
      .select('*')
      .eq('campaign_id', campaignId)
      .eq('week_number', weekNumber)
      .order('date, scheduled_time');

    if (error) throw error;

    // Group by day
    const dailyPlansByDay = dailyPlans.reduce((acc: any, plan: any) => {
      const day = plan.day_of_week;
      if (!acc[day]) {
        acc[day] = [];
      }
      acc[day].push(plan);
      return acc;
    }, {});

    const data = {
      dailyPlans,
      dailyPlansByDay,
      totalPlans: dailyPlans.length,
      weekNumber: parseInt(weekNumber)
    };
    const refined = await refineUserFacingResponse(data);
    res.status(200).json(refined);

  } catch (error) {
    console.error('Error getting daily plans:', error);
    res.status(500).json({ error: 'Failed to get daily plans' });
  }
}

// Enhance weekly content with AI
async function enhanceWithAI(body: any, res: NextApiResponse) {
  try {
    const { campaignId, weekNumber, enhancementPrompt, userId } = body;

    // Call AI enhancement API
    const aiResponse = await fetch('/api/ai/generate-content', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        campaignId,
        weekNumber,
        enhancementPrompt: enhancementPrompt || 'Enhance this weekly content with better engagement, clearer messaging, and platform-specific optimizations',
        type: 'weekly_enhancement'
      })
    });

    if (!aiResponse.ok) {
      throw new Error('AI enhancement failed');
    }

    const aiData = await aiResponse.json();

    // Use database function to apply AI enhancement
    const { data: result, error } = await supabase
      .rpc('enhance_weekly_content_with_ai', {
        campaign_uuid: campaignId,
        week_num: weekNumber,
        enhancement_prompt: enhancementPrompt
      });

    if (error) throw error;

    // Update content_plans with AI suggestions
    if (aiData.enhancedContent) {
      for (const enhancedItem of aiData.enhancedContent) {
        await supabase
          .from('content_plans')
          .update({
            content: enhancedItem.content,
            topic: enhancedItem.topic,
            hashtags: enhancedItem.hashtags,
            ai_suggestions: enhancedItem.ai_suggestions,
            updated_at: new Date().toISOString()
          })
          .eq('id', enhancedItem.id);
      }
    }

    res.status(200).json({
      success: true,
      result,
      aiData,
      message: 'Weekly content enhanced with AI suggestions'
    });

  } catch (error) {
    console.error('Error enhancing with AI:', error);
    res.status(500).json({ error: 'Failed to enhance with AI' });
  }
}

// Manual edit weekly content
async function manualEdit(body: any, res: NextApiResponse) {
  try {
    const { campaignId, weekNumber, editedContent, editNotes, userId } = body;

    // Update content_plans with manual edits
    for (const item of editedContent) {
      const { error } = await supabase
        .from('content_plans')
        .update({
          content: item.content,
          topic: item.topic,
          hashtags: item.hashtags,
          manual_edits: {
            edited_at: new Date().toISOString(),
            edited_by: userId,
            edit_notes: item.editNotes || editNotes,
            changes: item.changes || [],
          },
          updated_at: new Date().toISOString()
        })
        .eq('id', item.id);

      if (error) throw error;
    }

    console.warn('DEPRECATED: weekly_content_refinements write path triggered (weekly-refinement upsert)');
    const { error: refinementError } = await supabase
      .from('weekly_content_refinements')
      .upsert({
        campaign_id: campaignId,
        week_number: weekNumber,
        manually_edited_content: editedContent,
        refinement_status: 'manually-edited',
        manual_edits_applied: true,
        manual_edit_notes: editNotes,
        edited_by: userId,
        updated_at: new Date().toISOString()
      }, {
        onConflict: 'campaign_id,week_number'
      });

    if (refinementError) throw refinementError;

    res.status(200).json({
      success: true,
      message: 'Weekly content manually edited successfully'
    });

  } catch (error) {
    console.error('Error with manual edit:', error);
    res.status(500).json({ error: 'Failed to apply manual edits' });
  }
}

// Finalize weekly content
async function finalizeWeek(body: any, res: NextApiResponse) {
  try {
    const { campaignId, weekNumber, finalizationNotes, userId } = body;

    // Use database function to finalize
    const { data: result, error } = await supabase
      .rpc('finalize_weekly_content', {
        campaign_uuid: campaignId,
        week_num: weekNumber,
        finalization_notes: finalizationNotes,
        finalized_by_uuid: userId
      });

    if (error) throw error;

    res.status(200).json({
      success: true,
      result,
      message: 'Weekly content finalized successfully'
    });

  } catch (error) {
    console.error('Error finalizing week:', error);
    res.status(500).json({ error: 'Failed to finalize weekly content' });
  }
}

// Populate daily plans from finalized weekly content
async function populateDailyPlans(body: any, res: NextApiResponse) {
  try {
    const { campaignId, weekNumber } = body;

    // Use database function to populate daily plans
    const { data: insertedCount, error } = await supabase
      .rpc('populate_daily_plans_from_weekly', {
        campaign_uuid: campaignId,
        week_num: weekNumber
      });

    if (error) throw error;

    res.status(200).json({
      success: true,
      insertedCount,
      message: `Generated ${insertedCount} daily content plans from weekly content`
    });

  } catch (error) {
    console.error('Error populating daily plans:', error);
    res.status(500).json({ error: 'Failed to populate daily plans' });
  }
}

// Update refinement
async function updateRefinement(body: any, res: NextApiResponse) {
  try {
    const { refinementId, updates } = body;
    console.warn('DEPRECATED: weekly_content_refinements write path triggered (weekly-refinement update)');
    const { error } = await supabase
      .from('weekly_content_refinements')
      .update({
        ...updates,
        updated_at: new Date().toISOString()
      })
      .eq('id', refinementId);

    if (error) throw error;

    res.status(200).json({
      success: true,
      message: 'Refinement updated successfully'
    });

  } catch (error) {
    console.error('Error updating refinement:', error);
    res.status(500).json({ error: 'Failed to update refinement' });
  }
}
