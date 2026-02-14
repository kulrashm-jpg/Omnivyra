/**
 * POST /api/campaigns/regenerate-blueprint
 * Regenerates blueprint after duration change.
 * Requires blueprint_status === INVALIDATED.
 * Calls orchestrator with campaigns.duration_weeks, saves blueprint, sets ACTIVE.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../../backend/db/supabaseClient';
import { runCampaignAiPlan } from '../../../backend/services/campaignAiOrchestrator';
import { saveCampaignBlueprintFromLegacy } from '../../../backend/db/campaignPlanStore';
import { fromStructuredPlan } from '../../../backend/services/campaignBlueprintAdapter';
import { enforceCompanyAccess } from '../../../backend/services/userContextService';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { campaignId, companyId } = req.body || {};

    if (!campaignId || !companyId) {
      return res.status(400).json({
        error: 'campaignId and companyId are required',
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
      .select('id, blueprint_status, duration_weeks')
      .eq('id', campaignId)
      .maybeSingle();

    if (campError || !campaign) {
      return res.status(404).json({ error: 'Campaign not found' });
    }

    if (campaign.blueprint_status !== 'INVALIDATED') {
      return res.status(400).json({
        error: 'INVALID_STATE',
        message: 'Blueprint can only be regenerated when status is INVALIDATED.',
        current_status: campaign.blueprint_status,
      });
    }

    const durationWeeks = campaign.duration_weeks ?? 12;

    const result = await runCampaignAiPlan({
      campaignId,
      mode: 'generate_plan',
      message: `Regenerate campaign plan for ${durationWeeks} weeks.`,
      durationWeeks,
    });

    if (!result.plan?.weeks || result.plan.weeks.length === 0) {
      return res.status(500).json({
        error: 'ORCHESTRATOR_NO_PLAN',
        message: 'Orchestrator did not return a valid plan.',
      });
    }

    const blueprint = fromStructuredPlan({
      weeks: result.plan.weeks,
      campaign_id: campaignId,
    });

    await saveCampaignBlueprintFromLegacy({
      campaignId,
      blueprint,
      source: 'regenerate-blueprint',
    });

    const { error: updateError } = await supabase
      .from('campaigns')
      .update({
        blueprint_status: 'ACTIVE',
        updated_at: new Date().toISOString(),
      })
      .eq('id', campaignId);

    if (updateError) {
      return res.status(500).json({
        error: 'Failed to set blueprint status to ACTIVE',
        details: updateError.message,
      });
    }

    return res.status(200).json({
      success: true,
      blueprint_status: 'ACTIVE',
      duration_weeks: blueprint.duration_weeks,
      message: 'Blueprint regenerated successfully.',
    });
  } catch (err: any) {
    console.error('[regenerate-blueprint]', err);
    return res.status(500).json({
      error: err?.message || 'Internal server error',
    });
  }
}

export default handler;
