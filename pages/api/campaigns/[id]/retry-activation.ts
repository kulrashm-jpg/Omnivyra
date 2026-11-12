import { createApiRoute as __createApiRoute } from '../../../../lib/platform/routeFactory';
/**
 * POST /api/campaigns/[id]/retry-activation
 *
 * The user's "Retry status update" after schedule-structured-plan scheduled the posts but could not
 * activate the campaign (`activation.ok: false`). It runs ONLY the idempotent activation write
 * (activateScheduledCampaign). It NEVER schedules posts: a re-schedule would duplicate every post,
 * because scheduleStructuredPlan is not idempotent (e9, 2026-11-12).
 *
 * Refuses to activate what scheduling would not have:
 *   - caller must have access to the campaign (requireCampaignAccess);
 *   - not under governance lockdown (423), not finalized (409);
 *   - the campaign must already have scheduled posts (409 NOTHING_SCHEDULED): this is a retry of a
 *     completed schedule, not a way to activate an unscheduled campaign.
 * Every read is checked; a failed read or write is 503, retryable.
 */
import type { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../../../backend/db/supabaseClient';
import { requireCampaignAccess } from '../../../../backend/services/campaignAccessService';
import { isGovernanceLocked } from '../../../../backend/services/GovernanceLockdownService';
import { assertCampaignNotFinalized, CampaignFinalizedError } from '../../../../backend/services/CampaignFinalizationGuard';
import { normalizeExecutionState } from '../../../../backend/governance/ExecutionStateMachine';
import { activateScheduledCampaign } from '../../../../backend/services/campaignScheduleActivation';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  if (await isGovernanceLocked()) {
    return res.status(423).json({ code: 'GOVERNANCE_LOCKED', message: 'Governance lockdown active. Mutations disabled.' });
  }

  const { id } = req.query;
  if (!id || typeof id !== 'string') {
    return res.status(400).json({ error: 'Campaign ID is required' });
  }
  const access = await requireCampaignAccess(req, res, id);
  if (!access) return;

  const { data: campaign, error: campaignError } = await supabase
    .from('campaigns')
    .select('execution_status')
    .eq('id', id)
    .maybeSingle();
  if (campaignError) {
    return res.status(503).json({ code: 'CAMPAIGN_READ_FAILED', message: 'Could not read the campaign. Please try again.' });
  }
  if (!campaign) return res.status(404).json({ error: 'Campaign not found' });
  try {
    assertCampaignNotFinalized(normalizeExecutionState((campaign as any).execution_status));
  } catch (err) {
    if (err instanceof CampaignFinalizedError) {
      return res.status(409).json({ code: 'CAMPAIGN_FINALIZED', message: 'Campaign is finalized and cannot be modified' });
    }
    throw err;
  }

  const { count, error: postsError } = await supabase
    .from('scheduled_posts')
    .select('id', { count: 'exact', head: true })
    .eq('campaign_id', id);
  if (postsError || count === null || count === undefined) {
    return res.status(503).json({ code: 'SCHEDULED_POSTS_READ_FAILED', message: 'Could not check the campaign\'s scheduled posts. Please try again.' });
  }
  if (count === 0) {
    return res.status(409).json({ code: 'NOTHING_SCHEDULED', message: 'This campaign has no scheduled posts to activate. Schedule the plan first.' });
  }

  const activated = await activateScheduledCampaign(id);
  if (!activated.ok) {
    console.error('[retry-activation] activation failed again', { campaignId: id, message: activated.error?.message });
    return res.status(503).json({ code: 'CAMPAIGN_ACTIVATION_FAILED', message: 'The campaign status still could not be updated. Please try again shortly.' });
  }
  return res.status(200).json({ activation: { ok: true }, scheduled_posts: count });
}

export default __createApiRoute(handler, { route: '/api/campaigns/:id/retry-activation' });
