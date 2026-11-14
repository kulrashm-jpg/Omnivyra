import { createApiRoute as __createApiRoute } from '../../../lib/platform/routeFactory';

/**
 * POST /api/campaigns/approve-preemption
 * Approves a pending preemption request and executes the preemption.
 * Request must have status PENDING.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { isGovernanceLocked } from '../../../backend/services/GovernanceLockdownService';
import {
  executePreemptionFromRequest,
  PreemptionValidationError,
  PreemptionOwnershipError,
} from '../../../backend/services/CampaignPreemptionService';
import { assertCampaignNotFinalized, CampaignFinalizedError } from '../../../backend/services/CampaignFinalizationGuard';
import { InvalidExecutionTransitionError, normalizeExecutionState } from '../../../backend/governance/ExecutionStateMachine';
import { runPrePlanning } from '../../../backend/services/CampaignPrePlanningService';
import { recordGovernanceEvent } from '../../../backend/services/GovernanceEventService';
import { enforceCompanyAccess } from '../../../backend/services/userContextService';
import { tenantTable, tenantChildTable, tenantContextFor, ownerOfChildRow, TenantSeamError, type TenantContext } from '../../../backend/db/tenantTable';
import { seamDenial } from '../../../backend/db/seamDenial';

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

    // WSF-ORD-001 — authenticate and bind the caller to `companyId` BEFORE the
    // preemption request and the initiator campaign are looked up. Previously
    // the first guard call sat AFTER the finalization check, so an anonymous
    // caller holding a request id could (a) probe which request / campaign ids
    // exist through the two 404s and (b) drive recordGovernanceEvent into
    // inserting a governance event and upserting the governance projection
    // under a `companyId` of its own choosing.
    const companyAccess = await enforceCompanyAccess({ req, res, companyId });
    if (!companyAccess) return;

    // S2 derive-then-authorize (ownerOfChildRow, R10): campaign_preemption_requests is a child of its INITIATOR
    // campaign. ownerOfChildRow yields ONLY that campaign id and its company (null for a missing / unreadable /
    // company-less request: the same 404 as before). The initiator campaign is bound to the authorized companyId
    // right here, before the request row itself is read; a foreign request answers the binding's 404, exactly what
    // the (unchanged) initiator binding below answered before. The request is then read through the seam.
    const requestOwner = await ownerOfChildRow('campaign_preemption_requests', String(requestId), 'approve preemption: initiator campaign of the request');
    if (!requestOwner) {
      return res.status(404).json({ error: 'Preemption request not found' });
    }
    const requestOwnerAccess = await enforceCompanyAccess({ req, res, companyId, campaignId: requestOwner.parentId, requireCampaignId: true });
    if (!requestOwnerAccess) return;

    // S2 tenant seam: the tenant is the company enforceCompanyAccess authorized for this principal above.
    let tenant: TenantContext;
    let requestsTable: Awaited<ReturnType<typeof tenantChildTable>>;
    try {
      tenant = tenantContextFor({ userId: companyAccess.userId }, companyId);
      requestsTable = await tenantChildTable('campaign_preemption_requests', tenant, requestOwner.parentId);
    } catch (err) {
      if (err instanceof TenantSeamError) return seamDenial(res, err, 404, { error: 'Preemption request not found' });
      throw err;
    }

    const { data: request, error: fetchError } = await requestsTable
      .select('id, initiator_campaign_id, target_campaign_id, status')
      .eq('id', requestId)
      .maybeSingle();

    if (fetchError || !request) {
      return res.status(404).json({ error: 'Preemption request not found' });
    }

    const { data: initiatorCampaign, error: initErr } = await tenantTable('campaigns', tenant)
      .select('id, execution_status')
      .eq('id', request.initiator_campaign_id)
      .maybeSingle();

    if (initErr || !initiatorCampaign) {
      return res.status(404).json({ error: 'Initiator campaign not found' });
    }

    // The campaign binding (initiator campaign ⇢ companyId) also moves ABOVE
    // the finalization check: that check's BLOCKED branch is itself a
    // governance write, so it must not run for a caller who has not been
    // bound to the campaign. It stays below the request lookup because the
    // request row is what names the campaign to bind.
    const access = await enforceCompanyAccess({
      req,
      res,
      companyId,
      campaignId: request.initiator_campaign_id,
      requireCampaignId: true,
    });
    if (!access) return;
    // CROSS-TENANT FIX: the request's TARGET is the campaign the approval preempts - bind it to the same company
    // (a request row created before the fix may name a target OWNED BY ANOTHER COMPANY). The service re-checks both.
    // ORDER MATTERS: both bindings precede assertCampaignNotFinalized, whose BLOCKED branch is a governance write.
    // (The request and initiator reads above only find the campaigns to bind - S2: both now run through the seam under the
    // authorized company; no write happens before both bindings, and a foreign / unknown row answers a 404.)
    const targetAccess = await enforceCompanyAccess({
      req,
      res,
      companyId,
      campaignId: (request as { target_campaign_id?: string }).target_campaign_id,
      requireCampaignId: true,
    });
    if (!targetAccess) return;

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

    const result = await executePreemptionFromRequest(requestId, justificationTrimmed, companyId);

    const { data: initiator } = await tenantTable('campaigns', tenant)
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
    if (err instanceof PreemptionOwnershipError) {
      // A campaign of another company (or none) is "not found" - never an existence oracle.
      return err.kind === 'unverified'
        ? res.status(503).json({ error: 'Campaign ownership check is temporarily unavailable. Please try again.', code: 'CAMPAIGN_LOOKUP_ERROR', retryable: true })
        : res.status(404).json({ error: 'Campaign not found', code: 'CAMPAIGN_NOT_FOUND' });
    }
    if (err instanceof PreemptionValidationError) {
      return res.status(400).json({
        success: false,
        error: err.message,
        rejected: true,
      });
    }
    // S2 tier 2: a tenant-seam error (a request / campaign row that could not be READ, or a seam refusal) is never a
    // 500 carrying the seam's internal message: retryable -> 503 + Retry-After, otherwise the request's not-found.
    if (err instanceof TenantSeamError) return seamDenial(res, err, 404, { error: 'Preemption request not found' });
    console.error('[approve-preemption]', err);
    return res.status(500).json({
      error: err instanceof Error ? err.message : 'Internal server error',
    });
  }
}

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/campaigns/approve-preemption' });
