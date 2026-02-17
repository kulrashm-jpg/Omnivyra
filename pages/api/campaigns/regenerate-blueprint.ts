/**
 * POST /api/campaigns/regenerate-blueprint
 * Regenerates blueprint after duration change.
 * Requires blueprint_status === INVALIDATED.
 * Calls orchestrator with campaigns.duration_weeks, saves blueprint, sets ACTIVE.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../../backend/db/supabaseClient';
import { isGovernanceLocked } from '../../../backend/services/GovernanceLockdownService';
import { runCampaignAiPlan } from '../../../backend/services/campaignAiOrchestrator';
import { saveCampaignBlueprintFromLegacy } from '../../../backend/db/campaignPlanStore';
import { fromStructuredPlan } from '../../../backend/services/campaignBlueprintAdapter';
import { assertBlueprintMutable, BlueprintImmutableError, BlueprintExecutionFreezeError } from '../../../backend/services/campaignBlueprintService';
import { assertCampaignNotFinalized, CampaignFinalizedError } from '../../../backend/services/CampaignFinalizationGuard';
import { normalizeExecutionState } from '../../../backend/governance/ExecutionStateMachine';
import { recordGovernanceEvent } from '../../../backend/services/GovernanceEventService';
import { enforceCompanyAccess } from '../../../backend/services/userContextService';

async function handler(req: NextApiRequest, res: NextApiResponse) {
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
      .select('id, blueprint_status, duration_weeks, execution_status')
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

    if (campaign.duration_weeks == null) {
      return res.status(412).json({
        code: 'PRE_PLANNING_REQUIRED',
        message: 'Campaign duration not initialized. Run pre-planning first.',
      });
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
