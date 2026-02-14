/**
 * POST /api/campaigns/update-duration
 * User requests duration change. Runs constraint evaluation.
 * If APPROVED: update duration, invalidate blueprint, lock.
 * If NEGOTIATE/REJECTED: return constraint feedback. No auto-regenerate.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../../backend/db/supabaseClient';
import { runPrePlanning } from '../../../backend/services/CampaignPrePlanningService';
import { enforceCompanyAccess } from '../../../backend/services/userContextService';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { campaignId, companyId, requested_weeks, override_lock } = req.body || {};

    if (!campaignId || !companyId || requested_weeks == null) {
      return res.status(400).json({
        error: 'campaignId, companyId, and requested_weeks are required',
      });
    }

    const weeks = Number(requested_weeks);
    if (!Number.isInteger(weeks) || weeks < 1 || weeks > 52) {
      return res.status(400).json({
        error: 'requested_weeks must be an integer between 1 and 52',
      });
    }

    const access = await enforceCompanyAccess({
      req,
      res,
      companyId,
      campaignId,
      requireCampaignId: true,
    });
    if (!access) return;

    const { data: campaign, error: campError } = await supabase
      .from('campaigns')
      .select('id, duration_locked, duration_weeks, blueprint_status')
      .eq('id', campaignId)
      .maybeSingle();

    if (campError || !campaign) {
      return res.status(404).json({ error: 'Campaign not found' });
    }

    if (campaign.duration_locked && !override_lock) {
      return res.status(403).json({
        error: 'DURATION_LOCKED',
        message: 'Duration is locked. Pass override_lock: true to force change.',
      });
    }

    const evaluation = await runPrePlanning({
      companyId,
      campaignId,
      requested_weeks: weeks,
    });

    if (evaluation.status === 'REJECTED') {
      const message =
        evaluation.max_weeks_allowed !== undefined && evaluation.max_weeks_allowed <= 0
          ? 'Campaign cannot proceed under current constraints.'
          : 'Duration change blocked by constraints.';
      return res.status(400).json({
        status: 'REJECTED',
        max_weeks_allowed: evaluation.max_weeks_allowed,
        blocking_constraints: evaluation.blocking_constraints,
        limiting_constraints: evaluation.limiting_constraints,
        trade_off_options: evaluation.tradeOffOptions ?? [],
        message,
      });
    }

    if (evaluation.status === 'NEGOTIATE') {
      const msg = evaluation.min_weeks_required
        ? `Minimum required: ${evaluation.min_weeks_required} weeks`
        : `Maximum viable duration: ${evaluation.max_weeks_allowed} weeks`;
      return res.status(200).json({
        status: 'NEGOTIATE',
        requested_weeks: weeks,
        max_weeks_allowed: evaluation.max_weeks_allowed,
        min_weeks_required: evaluation.min_weeks_required,
        limiting_constraints: evaluation.limiting_constraints,
        trade_off_options: evaluation.tradeOffOptions ?? [],
        message: msg,
      });
    }

    // APPROVED
    const { error: updateError } = await supabase
      .from('campaigns')
      .update({
        duration_weeks: weeks,
        blueprint_status: 'INVALIDATED',
        duration_locked: true,
        updated_at: new Date().toISOString(),
      })
      .eq('id', campaignId);

    if (updateError) {
      return res.status(500).json({
        error: 'Failed to update campaign duration',
        details: updateError.message,
      });
    }

    return res.status(200).json({
      status: 'REGENERATION_REQUIRED',
      duration_weeks: weeks,
      message: 'Duration updated. Blueprint invalidated. Regeneration required before execution.',
    });
  } catch (err: any) {
    console.error('[update-duration]', err);
    return res.status(500).json({
      error: err?.message || 'Internal server error',
    });
  }
}

export default handler;
