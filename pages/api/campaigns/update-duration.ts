import { createApiRoute as __createApiRoute } from '../../../lib/platform/routeFactory';
import { CampaignStatusFields, resolveCampaignStage } from '../../../lib/campaign/campaignStage';
import { campaignLifecycleSelect, isCampaignFinalized } from '../../../lib/campaign/executionStatusCompat';

/**
 * POST /api/campaigns/update-duration
 * User requests duration change. Runs constraint evaluation.
 * If APPROVED: update duration, invalidate blueprint, lock.
 * If NEGOTIATE/REJECTED: return constraint feedback. No auto-regenerate.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../../backend/db/supabaseClient';
import { isGovernanceLocked } from '../../../backend/services/GovernanceLockdownService';
import { runPrePlanning } from '../../../backend/services/CampaignPrePlanningService';
import { assertBlueprintMutable, BlueprintImmutableError, BlueprintExecutionFreezeError } from '../../../backend/services/campaignBlueprintService';
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
    const { campaignId, companyId, requested_weeks, start_date, override_lock } = req.body || {};

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
      // R5: execution_status removed — absent in production, and naming it
      // 42703-failed the whole read. duration_locked is untouched: it exists,
      // and its semantics below are deliberately unchanged.
      .select(campaignLifecycleSelect('duration_locked', 'duration_weeks'))
      .eq('id', campaignId)
      .maybeSingle();

    if (campError || !campaign) {
      return res.status(404).json({ error: 'Campaign not found' });
    }

    // R5: centralized (dynamic) select widens the row type; assert once here.
    const campaignRow = campaign as unknown as CampaignStatusFields & { duration_locked?: boolean; duration_weeks?: number };
    if (campaignRow.duration_locked && !override_lock) {
      return res.status(403).json({
        error: 'DURATION_LOCKED',
        message: 'Duration is locked. Pass override_lock: true to force change.',
      });
    }

    // R5: canonical stage replaces the absent column's execution state. Same
    // protection, same 409 vocabulary, same governance event — the metadata
    // now reports the stage that was actually consulted instead of a value
    // invented for a column production does not have.
    if (isCampaignFinalized(campaignRow)) {
      await recordGovernanceEvent({
        companyId,
        campaignId,
        eventType: 'CAMPAIGN_MUTATION_BLOCKED_FINALIZED',
        eventStatus: 'BLOCKED',
        metadata: { campaignId, campaign_stage: resolveCampaignStage(campaignRow).stage },
      });
      return res.status(409).json({
        code: 'CAMPAIGN_FINALIZED',
        message: 'Campaign is finalized and cannot be modified',
      });
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
        // R5: report the canonical stage rather than an absent column's
        // invented 'ACTIVE' default. Diagnostics only — nothing branches here.
        const execStatus = resolveCampaignStage(campaignRow).stage;
        const bpStatus = campaignRow.blueprint_status ?? 'ACTIVE';
        await recordGovernanceEvent({
          companyId,
          campaignId,
          eventType: 'BLUEPRINT_MUTATION_BLOCKED',
          eventStatus: 'BLOCKED',
          metadata: { campaignId, campaign_stage: execStatus, blueprint_status: bpStatus },
        });
        return res.status(409).json({
          code: 'BLUEPRINT_IMMUTABLE',
          message: 'Blueprint cannot be modified while campaign is in execution.',
        });
      }
      throw err;
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
    const updatePayload: Record<string, unknown> = {
      duration_weeks: weeks,
      blueprint_status: 'INVALIDATED',
      duration_locked: true,
      updated_at: new Date().toISOString(),
    };
    if (start_date && typeof start_date === 'string') {
      const parsed = new Date(start_date);
      if (!isNaN(parsed.getTime())) {
        updatePayload.start_date = parsed.toISOString().split('T')[0];
        updatePayload.end_date = null; // Recalculated when blueprint regenerates
      }
    }
    const { error: updateError } = await supabase
      .from('campaigns')
      .update(updatePayload)
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

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/campaigns/update-duration' });
