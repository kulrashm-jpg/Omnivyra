/**
 * POST /api/campaigns/approve-preemption
 * Approves a pending preemption request and executes the preemption.
 * Request must have status PENDING.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../../backend/db/supabaseClient';
import {
  executePreemptionFromRequest,
  PreemptionValidationError,
} from '../../../backend/services/CampaignPreemptionService';
import { runPrePlanning } from '../../../backend/services/CampaignPrePlanningService';
import { enforceCompanyAccess } from '../../../backend/services/userContextService';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { requestId, companyId } = req.body || {};

    if (!requestId || !companyId) {
      return res.status(400).json({
        error: 'requestId and companyId are required',
      });
    }

    const { data: request, error: fetchError } = await supabase
      .from('campaign_preemption_requests')
      .select('id, initiator_campaign_id, status')
      .eq('id', requestId)
      .maybeSingle();

    if (fetchError || !request) {
      return res.status(404).json({ error: 'Preemption request not found' });
    }

    const access = await enforceCompanyAccess({
      req,
      res,
      companyId,
      campaignId: request.initiator_campaign_id,
      requireCampaignId: true,
    });
    if (!access) return;

    const result = await executePreemptionFromRequest(requestId);

    const { data: initiator } = await supabase
      .from('campaigns')
      .select('id, duration_weeks')
      .eq('id', request.initiator_campaign_id)
      .maybeSingle();

    const requested_weeks = initiator?.duration_weeks ?? 12;
    let evaluation;
    if (Number.isInteger(requested_weeks) && requested_weeks >= 1 && requested_weeks <= 52) {
      evaluation = await runPrePlanning({
        companyId,
        campaignId: request.initiator_campaign_id,
        requested_weeks,
      });
    }

    return res.status(200).json({
      status: 'EXECUTED',
      preemptedCampaignId: result.preemptedCampaignId,
      preemption: {
        preemptedCampaignId: result.preemptedCampaignId,
        preemptedExecutionStatus: result.preemptedExecutionStatus,
        preemptedBlueprintStatus: result.preemptedBlueprintStatus,
        logId: result.logId,
      },
      initiatorEvaluation: evaluation,
    });
  } catch (err: unknown) {
    if (err instanceof PreemptionValidationError) {
      return res.status(400).json({
        success: false,
        error: err.message,
        rejected: true,
      });
    }
    console.error('[approve-preemption]', err);
    return res.status(500).json({
      error: err instanceof Error ? err.message : 'Internal server error',
    });
  }
}
