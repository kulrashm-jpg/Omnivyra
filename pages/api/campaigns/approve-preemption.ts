
/**
 * POST /api/campaigns/approve-preemption
 * Approves a pending preemption request and executes the preemption.
 * Request must have status PENDING.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../../backend/db/supabaseClient';
import { isGovernanceLocked } from '../../../backend/services/GovernanceLockdownService';
import {
  executePreemptionFromRequest,
  PreemptionValidationError,
} from '../../../backend/services/CampaignPreemptionService';
import { assertCampaignNotFinalized, CampaignFinalizedError } from '../../../backend/services/CampaignFinalizationGuard';
import { InvalidExecutionTransitionError, normalizeExecutionState } from '../../../backend/governance/ExecutionStateMachine';
import { runPrePlanning } from '../../../backend/services/CampaignPrePlanningService';
import { recordGovernanceEvent } from '../../../backend/services/GovernanceEventService';
import { enforceCompanyAccess } from '../../../backend/services/userContextService';

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
    const { requestId, companyId, justification } = req.body || {};

    if (!requestId || !companyId) {
      return res.status(400).json({
        error: 'requestId and companyId are required',
      });
    }

    const justificationTrimmed = typeof justification === 'string' ? justification.trim() : '';
    if (!justificationTrimmed || justificationTrimmed.length < 15) {
      return res.status(400).json({
        success: false,
        error: 'Preemption justification is required (minimum 15 characters).',
        rejected: true,
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

    const { data: initiatorCampaign, error: initErr } = await supabase
      .from('campaigns')
      .select('id, execution_status')
      .eq('id', request.initiator_campaign_id)
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
          campaignId: request.initiator_campaign_id,
          eventType: 'CAMPAIGN_MUTATION_BLOCKED_FINALIZED',
          eventStatus: 'BLOCKED',
          metadata: { campaignId: request.initiator_campaign_id, execution_status: initiatorExecutionStatus },
        });
        return res.status(409).json({
          code: 'CAMPAIGN_FINALIZED',
          message: 'Campaign is finalized and cannot be modified',
        });
      }
      throw err;
    }

    const access = await enforceCompanyAccess({
      req,
      res,
      companyId,
      campaignId: request.initiator_campaign_id,
      requireCampaignId: true,
    });
    if (!access) return;

    const result = await executePreemptionFromRequest(requestId, justificationTrimmed, companyId);

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
    console.error('[approve-preemption]', err);
    return res.status(500).json({
      error: err instanceof Error ? err.message : 'Internal server error',
    });
  }
}
