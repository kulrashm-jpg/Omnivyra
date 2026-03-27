/**
 * Save AI-generated daily plans for a week.
 * Uses execution engine saveWeekPlans (delete-then-insert).
 * Used by ComprehensivePlanningInterface when generating daily plans from weekly plan.
 */
import { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../../backend/db/supabaseClient';
import { saveWeekPlans } from '../../../backend/services/executionPlannerService';

const DAYS_ORDER = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

function dayNameToIndex(dayName: string): number {
  const i = DAYS_ORDER.indexOf(dayName);
  return i >= 0 ? i + 1 : 1;
}

function computeDayDate(params: { campaignStart: string; weekNumber: number; dayOfWeek: string }): string {
  const start = new Date(params.campaignStart.replace(/T.*/, 'T00:00:00'));
  const dayIndex = dayNameToIndex(params.dayOfWeek);
  const offsetDays = (params.weekNumber - 1) * 7 + (dayIndex - 1);
  start.setDate(start.getDate() + offsetDays);
  return start.toISOString().slice(0, 10);
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { campaignId, weekNumber, plans, campaignStartDate } = req.body as {
      campaignId?: string;
      weekNumber?: number;
      plans?: Array<{
        dayOfWeek: string;
        platform: string;
        contentType: string;
        title: string;
        content: string;
        description?: string;
        hashtags?: string[];
        optimalPostingTime?: string;
        targetMetrics?: Record<string, number>;
      }>;
      campaignStartDate?: string;
    };

    if (!campaignId || !Number.isFinite(weekNumber) || weekNumber < 1 || !Array.isArray(plans) || plans.length === 0) {
      return res.status(400).json({
        error: 'campaignId, weekNumber, and non-empty plans array are required',
      });
    }

    const { data: campaign } = await supabase
      .from('campaigns')
      .select('id, start_date')
      .eq('id', campaignId)
      .maybeSingle();

    let startDate =
      campaignStartDate && /^\d{4}-\d{2}-\d{2}/.test(String(campaignStartDate).trim())
        ? String(campaignStartDate).trim().split('T')[0]
        : (campaign as { start_date?: string } | null)?.start_date?.split?.('T')?.[0];
    if (!startDate) {
      const fallback = new Date();
      fallback.setDate(fallback.getDate() - (weekNumber - 1) * 7);
      startDate = fallback.toISOString().slice(0, 10);
      if (process.env.NODE_ENV !== 'test') {
        console.log('[DAILY_PLAN_TRACE] DB_WRITE: No campaign start_date, using fallback', startDate);
      }
    }
    const rows = plans
      .filter((p) => p?.dayOfWeek && DAYS_ORDER.includes(p.dayOfWeek))
      .map((plan) => {
        const date = computeDayDate({
          campaignStart: startDate,
          weekNumber,
          dayOfWeek: plan.dayOfWeek,
        });
        const contentObj = {
          topicTitle: plan.title,
          dailyObjective: plan.content,
          writingIntent: plan.description ?? plan.content,
          platform: (plan.platform || 'linkedin').toLowerCase(),
          contentType: (plan.contentType || 'post').toLowerCase(),
          desiredAction: '',
          whatProblemAreWeAddressing: plan.description ?? '',
          whatShouldReaderLearn: plan.content ?? '',
        };
        return {
          campaign_id: campaignId,
          week_number: weekNumber,
          day_of_week: plan.dayOfWeek,
          date,
          platform: (plan.platform || 'linkedin').toLowerCase(),
          content_type: (plan.contentType || 'post').toLowerCase(),
          title: plan.title || `${plan.dayOfWeek} content`,
          content: JSON.stringify(contentObj),
          hashtags: Array.isArray(plan.hashtags) ? plan.hashtags : [],
          scheduled_time: plan.optimalPostingTime || '09:00',
          status: 'planned',
          priority: 'medium',
          ai_generated: true,
          target_audience: '',
        };
      });

    if (rows.length === 0) {
      return res.status(200).json({
        success: true,
        message: 'No valid plans to save',
        rowsInserted: 0,
      });
    }

    const { rowsInserted } = await saveWeekPlans(campaignId, weekNumber, rows as any, 'AI');
    return res.status(200).json({
      success: true,
      message: `Saved ${rowsInserted} daily plan(s) for week ${weekNumber}`,
      rowsInserted,
    });
  } catch (error) {
    console.error('Error in save-ai-daily-plans API:', error);
    return res.status(500).json({
      error: 'Internal server error',
      details: error instanceof Error ? error.message : String(error),
    });
  }
}
