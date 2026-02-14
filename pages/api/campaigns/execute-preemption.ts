/**
 * POST /api/campaigns/execute-preemption
 * Controlled execution of PREEMPT_LOWER_PRIORITY_CAMPAIGN.
 * If target is protected or CRITICAL: returns APPROVAL_REQUIRED with requestId.
 * Otherwise: executes immediately, re-runs constraint evaluation.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../../backend/db/supabaseClient';
import {
  executeCampaignPreemption,
  PreemptionValidationError,
  type ApprovalRequiredResult,
  type ExecutePreemptionResult,
} from '../../../backend/services/CampaignPreemptionService';
import { runPrePlanning } from '../../../backend/services/CampaignPrePlanningService';
import { enforceCompanyAccess } from '../../../backend/services/userContextService';

function isApprovalRequired(
  r: ApprovalRequiredResult | ExecutePreemptionResult
): r is ApprovalRequiredResult {
  return 'status' in r && r.status === 'APPROVAL_REQUIRED';
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { initiatorCampaignId, preemptedCampaignId, companyId, reason } = req.body || {};

    if (!initiatorCampaignId || !preemptedCampaignId || !companyId) {
      return res.status(400).json({
        error: 'initiatorCampaignId, preemptedCampaignId, and companyId are required',
      });
    }

    const access = await enforceCompanyAccess({
      req,
      res,
      companyId,
      campaignId: initiatorCampaignId,
      requireCampaignId: true,
    });
    if (!access) return;

    const result = await executeCampaignPreemption({
      initiatorCampaignId,
      preemptedCampaignId,
      reason,
    });

    if (isApprovalRequired(result)) {
      return res.status(200).json({
        status: 'APPROVAL_REQUIRED',
        requestId: result.requestId,
      });
    }

    const { data: initiator } = await supabase
      .from('campaigns')
      .select('id, duration_weeks')
      .eq('id', initiatorCampaignId)
      .maybeSingle();

    if (!initiator) {
      return res.status(404).json({ error: 'Initiator campaign not found' });
    }

    const requested_weeks = initiator.duration_weeks ?? 12;
    if (!Number.isInteger(requested_weeks) || requested_weeks < 1 || requested_weeks > 52) {
      return res.status(400).json({ error: 'Initiator campaign has invalid duration_weeks' });
    }

    const evaluation = await runPrePlanning({
      companyId,
      campaignId: initiatorCampaignId,
      requested_weeks,
    });

    return res.status(200).json({
      success: true,
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
    console.error('[execute-preemption]', err);
    return res.status(500).json({
      error: err instanceof Error ? err.message : 'Internal server error',
    });
  }
}
