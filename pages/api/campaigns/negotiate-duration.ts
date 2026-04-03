
/**
 * POST /api/campaigns/negotiate-duration
 * Stage 12: AI Negotiation Loop — conversational duration refinement.
 * Re-evaluates proposed duration. Does NOT update campaign. Duration change requires /update-duration.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../../backend/db/supabaseClient';
import { isGovernanceLocked } from '../../../backend/services/GovernanceLockdownService';
import { runDurationNegotiation } from '../../../backend/services/CampaignNegotiationService';
import { assertBlueprintMutable, BlueprintImmutableError, BlueprintExecutionFreezeError } from '../../../backend/services/campaignBlueprintService';
import { assertCampaignNotFinalized, CampaignFinalizedError } from '../../../backend/services/CampaignFinalizationGuard';
import { normalizeExecutionState } from '../../../backend/governance/ExecutionStateMachine';
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
    const { campaignId, companyId, message } = req.body || {};

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
      .select('id, duration_weeks, execution_status, blueprint_status')
      .eq('id', campaignId)
      .maybeSingle();

    if (campError || !campaign) {
      return res.status(404).json({ error: 'Campaign not found' });
    }

    const executionStatus = normalizeExecutionState((campaign as any).execution_status);
    try {
      assertCampaignNotFinalized(executionStatus);
    } catch (err: any) {
      if (err instanceof CampaignFinalizedError) {
        await recordGovernanceEvent({
          companyId,
          campaignId,
          eventType: 'CAMPAIGN_MUTATION_BLOCKED_FINALIZED',
          eventStatus: 'BLOCKED',
          metadata: { campaignId, execution_status: executionStatus },
        });
        return res.status(409).json({
          code: 'CAMPAIGN_FINALIZED',
          message: 'Campaign is finalized and cannot be modified',
        });
      }
      throw err;
    }

    try {
      await assertBlueprintMutable(campaignId);
    } catch (err: any) {
      if (err instanceof BlueprintExecutionFreezeError) {
        await recordGovernanceEvent({
          companyId,
          campaignId,
          eventType: 'BLUEPRINT_FREEZE_BLOCKED',
          eventStatus: 'BLOCKED',
          metadata: {
            campaignId,
            hoursUntilExecution: err.hoursUntilExecution,
            freezeWindowHours: err.freezeWindowHours,
          },
        });
        return res.status(409).json({
          code: 'EXECUTION_WINDOW_FROZEN',
          message: 'Blueprint modifications are locked within 24 hours of execution.',
        });
      }
      if (err instanceof BlueprintImmutableError) {
        await recordGovernanceEvent({
          companyId,
          campaignId,
          eventType: 'BLUEPRINT_MUTATION_BLOCKED',
          eventStatus: 'BLOCKED',
          metadata: {
            campaignId,
            execution_status: (campaign as any).execution_status ?? 'ACTIVE',
            blueprint_status: (campaign as any).blueprint_status ?? 'ACTIVE',
          },
        });
        return res.status(409).json({
          code: 'BLUEPRINT_IMMUTABLE',
          message: 'Blueprint cannot be modified while campaign is in execution.',
        });
      }
      throw err;
    }

    if ((campaign as any).duration_weeks == null) {
      return res.status(412).json({
        code: 'PRE_PLANNING_REQUIRED',
        message: 'Campaign duration not initialized. Run pre-planning first.',
      });
    }

    const result = await runDurationNegotiation({
      campaignId,
      companyId,
      userMessage: message ?? '',
    });

    const { evaluation } = result;
    const requested_weeks =
      evaluation.requested_weeks ??
      (evaluation.max_weeks_allowed ?? evaluation.min_weeks_required ?? 12);

    await recordGovernanceEvent({
      companyId,
      campaignId,
      eventType: 'DURATION_NEGOTIATED',
      eventStatus: evaluation.status,
      metadata: {
        requested_weeks,
        max_weeks_allowed: evaluation.max_weeks_allowed,
        min_weeks_required: evaluation.min_weeks_required,
        negotiation_message: (message ?? '').slice(0, 500),
        trade_off_options: evaluation.tradeOffOptions ?? [],
      },
    });

    return res.status(200).json({
      status: evaluation.status,
      evaluation: {
        requested_weeks,
        max_weeks_allowed: evaluation.max_weeks_allowed,
        min_weeks_required: evaluation.min_weeks_required,
        limiting_constraints: evaluation.limiting_constraints ?? [],
        blocking_constraints: evaluation.blocking_constraints ?? [],
      },
      explanation: result.explanation,
      trade_off_options: evaluation.tradeOffOptions ?? [],
    });
  } catch (err: any) {
    console.error('[negotiate-duration]', err);
    return res.status(500).json({
      error: err?.message || 'Internal server error',
    });
  }
}
