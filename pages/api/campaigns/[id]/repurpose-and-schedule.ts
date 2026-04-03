
/**
 * POST /api/campaigns/[id]/repurpose-and-schedule
 *
 * Bulk repurpose and schedule: generate platform variants for all daily plans,
 * then insert into scheduled_posts. Reuses generateContentForDailyPlans and
 * scheduleStructuredPlan (no modifications to those services).
 *
 * Safety: prevents double scheduling, uses scheduler lock, validates campaign start_date.
 */

import { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../../../backend/db/supabaseClient';
import { requireCampaignAccess } from '../../../../backend/services/campaignAccessService';
import { evaluateScheduleEligibility } from '../../../../backend/services/campaignScheduleEligibilityService';
import { scheduleStructuredPlan, ScheduleEligibilityError } from '../../../../backend/services/structuredPlanScheduler';
import { acquireSchedulerLock, releaseSchedulerLock, SchedulerLockError } from '../../../../backend/services/SchedulerLockService';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const id = typeof req.query.id === 'string' ? req.query.id : Array.isArray(req.query.id) ? req.query.id[0] : '';
  const access = await requireCampaignAccess(req, res, id);
  if (!access) return;

  const campaignId = access.campaignId;

  let lockId: string | null = null;

  try {
    // Acquire scheduler lock to prevent concurrent runs
    try {
      lockId = await acquireSchedulerLock(campaignId);
    } catch (lockErr) {
      if (lockErr instanceof SchedulerLockError) {
        return res.status(409).json({
          success: false,
          error: 'Scheduling already in progress.',
        });
      }
      throw lockErr;
    }

    // FIX 3: Ensure campaign has start_date
    const { data: campaign, error: campaignError } = await supabase
      .from('campaigns')
      .select('start_date')
      .eq('id', campaignId)
      .single();

    if (campaignError || !campaign) {
      return res.status(404).json({ success: false, error: 'Campaign not found' });
    }
    if (!(campaign as { start_date?: string }).start_date) {
      return res.status(400).json({
        success: false,
        error: 'Campaign start date missing.',
      });
    }

    // Load all daily_content_plans for the campaign (include creator_asset for safety check)
    const { data: dailyPlans, error: plansError } = await supabase
      .from('daily_content_plans')
      .select('id, campaign_id, week_number, day_of_week, date, platform, content_type, title, topic, scheduled_time, content, creator_asset, content_status')
      .eq('campaign_id', campaignId)
      .order('week_number', { ascending: true })
      .order('day_of_week', { ascending: true });

    if (plansError) {
      console.error('[repurpose-and-schedule] Error loading daily plans:', plansError);
      return res.status(500).json({ success: false, error: 'Failed to load daily plans' });
    }

    const plans = dailyPlans ?? [];
    if (plans.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'No daily plans found for this campaign. Generate daily plans first.',
      });
    }

    const eligibility = evaluateScheduleEligibility(plans as Array<{
      id?: string | null;
      title?: string | null;
      platform?: string | null;
      content_type?: string | null;
      execution_mode?: string | null;
      creator_asset?: unknown;
    }>);
    if (!eligibility.eligible) {
      return res.status(409).json({
        success: false,
        error: 'Campaign has creator-dependent activities waiting for media links.',
        details: eligibility,
      });
    }

    // Build minimal plan.weeks for scheduleStructuredPlan
    const weekNumbers = [...new Set(plans.map((p) => Number(p.week_number) || 1))].filter((n) => n > 0).sort((a, b) => a - b);
    const weeks = weekNumbers.length > 0
      ? weekNumbers.map((wn) => ({ week: wn, week_number: wn }))
      : [{ week: 1, week_number: 1 }];

    const plan = { weeks };

    const result = await scheduleStructuredPlan(plan, campaignId, {
      generateContent: true,
      skipExisting: true,
    });

    // FIX 4: Return enhanced schedule summary
    const platformsScheduled = [...new Set(plans.map((p) => String(p.platform || '').trim().toLowerCase()).filter(Boolean))].sort();

    return res.status(200).json({
      success: true,
      scheduledPostsCreated: result.scheduled_count,
      alreadyScheduled: result.already_scheduled_count ?? 0,
      skippedCreatorActivities: eligibility.blockingCount,
      weeksScheduled: weekNumbers.length,
      platformsScheduled,
      skipped_platforms: result.skipped_platforms ?? [],
      fullyAiExecutable: eligibility.fullyAiExecutable,
    });
  } catch (err) {
    if (err instanceof ScheduleEligibilityError) {
      return res.status(409).json({
        success: false,
        error: err.message,
        details: err.details,
      });
    }
    console.error('[repurpose-and-schedule] Error:', err);
    const message = err instanceof Error ? err.message : 'Failed to repurpose and schedule';
    return res.status(500).json({
      success: false,
      error: message,
    });
  } finally {
    if (lockId) {
      await releaseSchedulerLock(campaignId, lockId).catch((e) =>
        console.warn('[repurpose-and-schedule] Failed to release lock:', e)
      );
    }
  }
}
