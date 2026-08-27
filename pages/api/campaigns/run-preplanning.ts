import { createApiRoute as __createApiRoute } from '../../../lib/platform/routeFactory';
import { CampaignStatusFields, resolveCampaignStage } from '../../../lib/campaign/campaignStage';
import { campaignLifecycleSelect, isCampaignFinalized } from '../../../lib/campaign/executionStatusCompat';

/**
 * POST /api/campaigns/run-preplanning
 * Stage 11: Pre-planning gate — run duration evaluation without committing.
 * Returns structured result + AI explanation. Emits PRE_PLANNING_EVALUATED event.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../../backend/db/supabaseClient';
import { isGovernanceLocked } from '../../../backend/services/GovernanceLockdownService';
import { runPrePlanning } from '../../../backend/services/CampaignPrePlanningService';
import { getUnifiedCampaignBlueprint, assertBlueprintMutable, BlueprintImmutableError, BlueprintExecutionFreezeError } from '../../../backend/services/campaignBlueprintService';
import { recordGovernanceEvent } from '../../../backend/services/GovernanceEventService';
import { generatePrePlanningExplanation } from '../../../backend/services/aiGateway';
import { enforceCompanyAccess } from '../../../backend/services/userContextService';
import { createHash } from 'crypto';
import { wirePhase2Route } from '../../../backend/services/billing/phase2RouteWiring';
import { PaymentRequiredError } from '../../../backend/services/billing/phase2EnforcementGate';

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
    const { campaignId, companyId, requested_weeks } = req.body || {};

    if (!campaignId || !companyId) {
      return res.status(400).json({
        error: 'campaignId and companyId are required',
      });
    }

    const weeks = requested_weeks != null ? Number(requested_weeks) : 12;
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
      // R5: execution_status is absent in production; naming it 42703-failed
      // the whole read, so this route answered 404 for every campaign.
      // Pre-planning never branched on the value.
      .select(campaignLifecycleSelect('duration_weeks'))
      .eq('id', campaignId)
      .maybeSingle();

    if (campError || !campaign) {
      return res.status(404).json({ error: 'Campaign not found' });
    }

    // DB first: if duration already set (e.g. after restart), return it — never contradict
    // R5: the centralized select list is a dynamic string, so supabase-js
    // widens the row type; re-assert the shape once, here.
    const campaignRow = campaign as unknown as CampaignStatusFields & { duration_weeks?: number };
    const dbWeeks = typeof campaignRow.duration_weeks === 'number' &&
      campaignRow.duration_weeks >= 1 &&
      campaignRow.duration_weeks <= 52
      ? campaignRow.duration_weeks
      : null;
    if (dbWeeks != null) {
      return res.status(200).json({
        status: 'APPROVED',
        requested_weeks: dbWeeks,
        recommended_duration: dbWeeks,
        max_weeks_allowed: dbWeeks,
        min_weeks_required: dbWeeks,
        limiting_constraints: [],
        blocking_constraints: [],
        trade_off_options: [],
        explanation_summary: `Campaign duration is already set to ${dbWeeks} weeks.`,
      });
    }

    // R5: canonical stage replaces the absent column's execution state. The
    // old form normalized a missing value to 'DRAFT', which is never terminal
    // — so the guard could not fire even when the read succeeded.
    const campaignStage = resolveCampaignStage(campaignRow).stage;
    if (isCampaignFinalized(campaignRow)) {
      await recordGovernanceEvent({
        companyId,
        campaignId,
        eventType: 'CAMPAIGN_MUTATION_BLOCKED_FINALIZED',
        eventStatus: 'BLOCKED',
        metadata: { campaignId, campaign_stage: campaignStage },
      });
      return res.status(409).json({
        code: 'CAMPAIGN_FINALIZED',
        message: 'Campaign is finalized and cannot be modified',
      });
    }

    const blueprint = await getUnifiedCampaignBlueprint(campaignId);
    if (blueprint && blueprint.weeks?.length > 0) {
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
            // R5: execution_status intentionally OMITTED — production has no
            // such column, so reporting any value would be an invention. The
            // canonical stage is carried in metadata above instead.
            evaluationContext: {},
          });
          return res.status(409).json({
            code: 'EXECUTION_WINDOW_FROZEN',
            message: 'Blueprint modifications are locked within 24 hours of execution.',
          });
        }
        if (err instanceof BlueprintImmutableError) {
          const { data: camp } = await supabase
            .from('campaigns')
            .select(campaignLifecycleSelect())
            .eq('id', campaignId)
            .maybeSingle();
          await recordGovernanceEvent({
            companyId,
            campaignId,
            eventType: 'BLUEPRINT_MUTATION_BLOCKED',
            eventStatus: 'BLOCKED',
            metadata: {
              campaignId,
              // R5: canonical stage instead of an absent column's invented
              // 'ACTIVE' default. Diagnostics only — nothing branches on it.
              campaign_stage: resolveCampaignStage(camp as unknown as CampaignStatusFields).stage,
              blueprint_status: (camp as any)?.blueprint_status ?? 'ACTIVE',
            },
          });
          return res.status(409).json({
            code: 'BLUEPRINT_IMMUTABLE',
            message: 'Blueprint cannot be modified while campaign is in execution.',
          });
        }
        throw err;
      }
    }

    const evaluation = await runPrePlanning({
      companyId,
      campaignId,
      requested_weeks: weeks,
    });

    const recommended_duration =
      evaluation.status === 'APPROVED'
        ? weeks
        : evaluation.status === 'NEGOTIATE' && evaluation.min_weeks_required != null
          ? evaluation.min_weeks_required
          : evaluation.max_weeks_allowed;

    const constraint_counts = {
      limiting: evaluation.limiting_constraints?.length ?? 0,
      blocking: evaluation.blocking_constraints?.length ?? 0,
    };

    await recordGovernanceEvent({
      companyId,
      campaignId,
      eventType: 'PRE_PLANNING_EVALUATED',
      eventStatus: evaluation.status,
      metadata: {
        requested_weeks: weeks,
        max_weeks_allowed: evaluation.max_weeks_allowed,
        min_weeks_required: evaluation.min_weeks_required,
        constraint_counts,
        trade_off_options: evaluation.tradeOffOptions ?? [],
      },
    });

    const explanation_summary = await wirePhase2Route({
      surface:        'campaigns.run-preplanning',
      organizationId: companyId,
      action:         'campaign_preplanning',
      referenceType:  'campaign_preplanning',
      referenceId:    createHash('sha256')
        .update([companyId, String(campaignId), String(weeks), String(evaluation.status)].join('|'))
        .digest('hex').slice(0, 40),
      run: () => generatePrePlanningExplanation(companyId, {
      status: evaluation.status,
      requested_weeks: weeks,
      max_weeks_allowed: evaluation.max_weeks_allowed,
      min_weeks_required: evaluation.min_weeks_required,
      limiting_constraints: evaluation.limiting_constraints ?? [],
      blocking_constraints: evaluation.blocking_constraints ?? [],
      tradeOffOptions: evaluation.tradeOffOptions,
      }),
    });

    return res.status(200).json({
      status: evaluation.status,
      requested_weeks: weeks,
      recommended_duration,
      max_weeks_allowed: evaluation.max_weeks_allowed,
      min_weeks_required: evaluation.min_weeks_required,
      recommended_posts_per_week: null,
      limiting_constraints: evaluation.limiting_constraints ?? [],
      blocking_constraints: evaluation.blocking_constraints ?? [],
      trade_off_options: evaluation.tradeOffOptions ?? [],
      explanation_summary,
    });
  } catch (err: any) {
    if (err instanceof PaymentRequiredError) {
      return res.status(402).json({ error: err.message, code: err.code });
    }
    console.error('[run-preplanning]', err);
    return res.status(500).json({
      error: err?.message || 'Internal server error',
    });
  }
}

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/campaigns/run-preplanning' });
