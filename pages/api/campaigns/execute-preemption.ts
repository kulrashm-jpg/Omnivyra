
/**
 * POST /api/campaigns/execute-preemption
 * Controlled execution of PREEMPT_LOWER_PRIORITY_CAMPAIGN.
 * If target is protected or CRITICAL: returns APPROVAL_REQUIRED with requestId.
 * Otherwise: executes immediately, re-runs constraint evaluation.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../../backend/db/supabaseClient';
import { isGovernanceLocked } from '../../../backend/services/GovernanceLockdownService';
import {
  executeCampaignPreemption,
  PreemptionValidationError,
  type ApprovalRequiredResult,
  type ExecutePreemptionResult,
} from '../../../backend/services/CampaignPreemptionService';
import { assertCampaignNotFinalized, CampaignFinalizedError } from '../../../backend/services/CampaignFinalizationGuard';
import { InvalidExecutionTransitionError, normalizeExecutionState } from '../../../backend/governance/ExecutionStateMachine';
import { runPrePlanning } from '../../../backend/services/CampaignPrePlanningService';
import { recordGovernanceEvent } from '../../../backend/services/GovernanceEventService';
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

  if (await isGovernanceLocked()) {
    return res.status(423).json({
      code: 'GOVERNANCE_LOCKED',
      message: 'Governance lockdown active. Mutations disabled.',
    });
  }

  try {
    const { initiatorCampaignId, preemptedCampaignId, companyId, reason, justification } = req.body || {};

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

    const justificationTrimmed = typeof justification === 'string' ? justification.trim() : '';
    if (!justificationTrimmed || justificationTrimmed.length < 15) {
      return res.status(400).json({
        success: false,
        error: 'Preemption justification is required (minimum 15 characters).',
        rejected: true,
      });
    }

    const { data: initiatorCampaign, error: initErr } = await supabase
      .from('campaigns')
      .select('id, execution_status')
      .eq('id', initiatorCampaignId)
      .maybeSingle();

    if (initErr || !initiatorCampaign) {
      return res.status(404).json({ error: 'Initiator campaign not found' });
    }

    const initiatorExecutionStatus = normalizeExecutionState((initiatorCampaign as any).execution_status);
    try {
      assertCampaignNotFinalized(initiatorExecutionStatus);
    } catch (err: unknown) {
      if (err instanceof CampaignFinalizedError) {
        await recordGovernanceEvent({
          companyId,
          campaignId: initiatorCampaignId,
          eventType: 'CAMPAIGN_MUTATION_BLOCKED_FINALIZED',
          eventStatus: 'BLOCKED',
          metadata: { campaignId: initiatorCampaignId, execution_status: initiatorExecutionStatus },
        });
        return res.status(409).json({
          code: 'CAMPAIGN_FINALIZED',
          message: 'Campaign is finalized and cannot be modified',
        });
      }
      throw err;
    }

    const result = await executeCampaignPreemption({
      initiatorCampaignId,
      preemptedCampaignId,
      reason,
      justification: justificationTrimmed,
      companyId,
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
        justification: result.justification,
      },
      initiatorEvaluation: evaluation,
    });
  } catch (err: unknown) {
    if (err instanceof InvalidExecutionTransitionError) {
      return res.status(409).json({
        code: 'INVALID_EXECUTION_TRANSITION',
        message: 'Illegal execution state transition',
      });
    }
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
