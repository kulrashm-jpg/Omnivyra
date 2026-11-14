import { ownedDbTable } from '../db/writeOwner';
import { ownerOfChildRow, systemTenantContext, tenantChildTable, tenantTable, TenantSeamError } from '../db/tenantTable';
/**
 * Controlled Preemption Execution Service.
 * Safely executes PREEMPT_LOWER_PRIORITY_CAMPAIGN when explicitly requested.
 * Stage 9B: Protected campaigns and CRITICAL targets require approval flow.
 * Stage 9C-B: Preemption cooldown window (7 days) to prevent thrashing.
 */

import { supabase } from '../db/supabaseClient';
import { recordGovernanceEvent } from './GovernanceEventService';
import { checkCampaignOwnership } from './campaignOwnershipService';
import {

  assertValidExecutionTransition,
  normalizeExecutionState,
  InvalidExecutionTransitionError,
} from '../governance/ExecutionStateMachine';

const PRIORITY_ORDER: Record<string, number> = { LOW: 0, NORMAL: 1, HIGH: 2, CRITICAL: 3 };

/** Default cooldown window in days. Campaign cannot be preempted again within this period. */
const COOLDOWN_DAYS = 7;
const COOLDOWN_MS = COOLDOWN_DAYS * 24 * 60 * 60 * 1000;

export interface ExecutePreemptionParams {
  initiatorCampaignId: string;
  preemptedCampaignId: string;
  reason?: string;
  /** Required: non-empty justification (min 15 chars). Stage 9C-A. */
  justification: string;
  /**
   * REQUIRED (cross-tenant fix): the company the caller was authorized for. BOTH campaigns must be canonically
   * owned by it, or nothing is read further, written or recorded. Also the company of the governance events.
   */
  companyId: string;
}

export interface ExecutePreemptionResult {
  success: boolean;
  preemptedCampaignId: string;
  preemptedExecutionStatus: string;
  preemptedBlueprintStatus: string;
  logId: string;
  justification: string;
}

export interface ApprovalRequiredResult {
  status: 'APPROVAL_REQUIRED';
  requestId: string;
}

export type PreemptionAttemptResult = ExecutePreemptionResult | ApprovalRequiredResult;

/**
 * A campaign of the preemption is not owned by the caller's company ('not_owned': another company's, or none),
 * or ownership could not be read ('unverified'). Routes answer 404 / 503.
 */
export class PreemptionOwnershipError extends Error {
  constructor(readonly kind: 'not_owned' | 'unverified', message: string) {
    super(message);
    this.name = 'PreemptionOwnershipError';
  }
}

/**
 * CROSS-TENANT FIX (6f, 2026-11-13): a preemption WRITES the preempted campaign (PREEMPTED + blueprint
 * INVALIDATED) and records governance events for both. Before, only the initiator was bound to the caller's company
 * (by the route), so any member could preempt ANOTHER company's campaign. Both campaigns must now be canonically
 * owned (checkCampaignOwnership === 'owned') by `companyId`; 'not_found' is refused too (there is nothing to
 * preempt).
 */
async function assertBothOwnedBy(companyId: string, initiatorCampaignId: string, preemptedCampaignId: string): Promise<void> {
  // INTENTIONAL (05): a missing / blank company is refused HERE, with its own reason, before any ownership read -
  // never left to checkCampaignOwnership's behaviour for an empty string. Trimmed once, and the trimmed value is used.
  const company = typeof companyId === 'string' ? companyId.trim() : '';
  if (company === '') {
    throw new PreemptionOwnershipError('not_owned', 'companyId is required for a preemption.');
  }
  for (const campaignId of [initiatorCampaignId, preemptedCampaignId]) {
    const ownership = await checkCampaignOwnership(String(campaignId ?? ''), company);
    if (ownership === 'lookup_error') throw new PreemptionOwnershipError('unverified', 'Campaign ownership could not be verified.');
    if (ownership !== 'owned') throw new PreemptionOwnershipError('not_owned', 'Campaign not found.');
  }
}

export class PreemptionValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PreemptionValidationError';
  }
}

/**
 * Check if target requires approval before preemption.
 * Returns true if target is protected OR target priority is CRITICAL.
 */
function requiresApproval(target: { is_protected?: boolean; priority_level?: string }): boolean {
  const protected_ = !!target.is_protected;
  const isCritical = String(target.priority_level || '').toUpperCase() === 'CRITICAL';
  return protected_ || isCritical;
}

/**
 * Create a preemption request and return APPROVAL_REQUIRED.
 */
export async function createApprovalRequest(
  initiatorCampaignId: string,
  preemptedCampaignId: string,
  companyId: string
): Promise<ApprovalRequiredResult> {
  // A request row names a target another company could later "approve" into a preemption: never create one for a
  // campaign pair the caller's company does not own (also re-checked at approval - executePreemptionFromRequest).
  // Exported and TESTED directly (05): today its only caller, executeCampaignPreemption, has already checked both
  // campaigns, so without a direct test this guard would be a comment, not a control.
  await assertBothOwnedBy(companyId, initiatorCampaignId, preemptedCampaignId);
  const { data: requestRow, error } = await ownedDbTable('campaign_preemption_requests')
    .insert({
      initiator_campaign_id: initiatorCampaignId,
      target_campaign_id: preemptedCampaignId,
      status: 'PENDING',
    })
    .select('id')
    .single();

  if (error || !requestRow) {
    throw new PreemptionValidationError(`Failed to create preemption request: ${error?.message ?? 'unknown'}`);
  }

  if (companyId) {
    recordGovernanceEvent({
      companyId,
      campaignId: initiatorCampaignId,
      eventType: 'PREEMPTION_APPROVAL_REQUIRED',
      eventStatus: 'PENDING',
      metadata: { targetCampaignId: preemptedCampaignId },
    });
  }

  console.log('GOV_EVENT: PREEMPTION_APPROVAL_REQUIRED', JSON.stringify({
    initiatorCampaignId,
    preemptedCampaignId,
    requestId: requestRow.id,
  }));

  return { status: 'APPROVAL_REQUIRED', requestId: requestRow.id };
}

/**
 * Core preemption execution. No approval gate.
 * When fromApprovedRequest=true, same-rank (e.g. CRITICAL vs CRITICAL) is allowed.
 */
async function performPreemption(
  params: ExecutePreemptionParams,
  options?: { fromApprovedRequest?: boolean }
): Promise<ExecutePreemptionResult> {
  const { initiatorCampaignId, preemptedCampaignId, reason, justification } = params;
  const justified = String(justification ?? '').trim();
  if (!justified || justified.length < 15) {
    throw new PreemptionValidationError('Preemption justification is required (minimum 15 characters).');
  }
  const fromApproved = !!options?.fromApprovedRequest;

  // S2 tier 2: both callers ran assertBothOwnedBy(params.companyId, ...) first, so the read is scoped to that company.
  const { data: campaigns, error: fetchError } = await tenantTable('campaigns', systemTenantContext(params.companyId, 'campaign preemption: authorized company'))
    .select('id, priority_level, execution_status, blueprint_status, last_preempted_at')
    .in('id', [initiatorCampaignId, preemptedCampaignId]);

  if (fetchError || !campaigns || campaigns.length !== 2) {
    throw new PreemptionValidationError('One or both campaigns not found.');
  }

  const initiator = campaigns.find((c: any) => c.id === initiatorCampaignId);
  const preempted = campaigns.find((c: any) => c.id === preemptedCampaignId);

  if (!initiator || !preempted) {
    throw new PreemptionValidationError('One or both campaigns not found.');
  }

  const initiatorRank = PRIORITY_ORDER[String(initiator.priority_level || 'NORMAL').toUpperCase()] ?? 1;
  const preemptedRank = PRIORITY_ORDER[String(preempted.priority_level || 'NORMAL').toUpperCase()] ?? 1;

  /**
   * Stage 9C-B: Cooldown enforcement.
   * CRITICAL override: If initiator is CRITICAL and target is lower than CRITICAL,
   * allow preemption despite cooldown (executive override for urgent business needs).
   */
  const lastPreemptedAt = preempted.last_preempted_at
    ? new Date(preempted.last_preempted_at).getTime()
    : null;
  const canOverrideCooldown = initiatorRank === 3 && preemptedRank < 3; // CRITICAL vs lower
  if (
    lastPreemptedAt &&
    Date.now() - lastPreemptedAt < COOLDOWN_MS &&
    !canOverrideCooldown
  ) {
    if (params.companyId) {
      recordGovernanceEvent({
        companyId: params.companyId,
        campaignId: initiatorCampaignId,
        eventType: 'PREEMPTION_REJECTED',
        eventStatus: 'REJECTED',
        metadata: { reason: 'Preemption cooldown active.', targetCampaignId: preemptedCampaignId },
      });
    }
    console.log('GOV_EVENT: PREEMPTION_BLOCKED_COOLDOWN', JSON.stringify({
      initiatorCampaignId,
      preemptedCampaignId,
      lastPreemptedAt: preempted.last_preempted_at,
    }));
    throw new PreemptionValidationError(
      'Preemption cooldown active. Campaign cannot be preempted again within 7 days.'
    );
  }

  if (!fromApproved && initiatorRank <= preemptedRank) {
    if (params.companyId) {
      recordGovernanceEvent({
        companyId: params.companyId,
        campaignId: initiatorCampaignId,
        eventType: 'PREEMPTION_REJECTED',
        eventStatus: 'REJECTED',
        metadata: { reason: 'Initiator priority must be higher than preempted campaign.', targetCampaignId: preemptedCampaignId },
      });
    }
    throw new PreemptionValidationError(
      'Initiator priority must be higher than preempted campaign.'
    );
  }

  const preemptedStatus = String(preempted.execution_status || 'ACTIVE').toUpperCase();
  if (preemptedStatus === 'PREEMPTED') {
    if (params.companyId) {
      recordGovernanceEvent({
        companyId: params.companyId,
        campaignId: initiatorCampaignId,
        eventType: 'PREEMPTION_REJECTED',
        eventStatus: 'REJECTED',
        metadata: { reason: 'Campaign is already preempted.', targetCampaignId: preemptedCampaignId },
      });
    }
    throw new PreemptionValidationError('Campaign is already preempted. Cannot preempt again.');
  }

  const fromState = normalizeExecutionState(preempted.execution_status);
  assertValidExecutionTransition(fromState, 'PREEMPTED');

  const nowIso = new Date().toISOString();
  // S2 tenant seam: the company the caller was authorized for (params.companyId; both campaigns were verified
  // owned by it in assertBothOwnedBy before performPreemption runs). The update reaches only that company's row.
  const { error: updateError } = await tenantTable('campaigns', systemTenantContext(params.companyId, 'campaign preemption: authorized company'))
    .update({
      execution_status: 'PREEMPTED',
      blueprint_status: 'INVALIDATED',
      last_preempted_at: nowIso,
      updated_at: nowIso,
    })
    .eq('id', preemptedCampaignId);

  if (updateError) {
    throw new PreemptionValidationError(`Failed to update preempted campaign: ${updateError.message}`);
  }

  if (params.companyId) {
    recordGovernanceEvent({
      companyId: params.companyId,
      campaignId: preemptedCampaignId,
      eventType: 'EXECUTION_STATE_TRANSITION',
      eventStatus: 'TRANSITIONED',
      metadata: {
        campaignId: preemptedCampaignId,
        from: fromState,
        to: 'PREEMPTED',
      },
    });
    recordGovernanceEvent({
      companyId: params.companyId,
      campaignId: preemptedCampaignId,
      eventType: 'CAMPAIGN_ARCHIVED',
      eventStatus: 'ARCHIVED',
      metadata: {
        campaignId: preemptedCampaignId,
        archivedReason: 'PREEMPTED',
      },
    });
  }

  const { data: logRow, error: logError } = await ownedDbTable('campaign_preemption_log')
    .insert({
      initiator_campaign_id: initiatorCampaignId,
      preempted_campaign_id: preemptedCampaignId,
      reason: reason ?? null,
      justification: justified,
    })
    .select('id, justification')
    .single();

  if (logError || !logRow) {
    console.error('campaign_preemption_log insert failed:', logError);
  }

  if (params.companyId) {
    recordGovernanceEvent({
      companyId: params.companyId,
      campaignId: initiatorCampaignId,
      eventType: 'PREEMPTION_EXECUTED',
      eventStatus: 'EXECUTED',
      metadata: {
        targetCampaignId: preemptedCampaignId,
        initiatorPriority: String(initiator.priority_level || 'NORMAL'),
        targetPriority: String(preempted.priority_level || 'NORMAL'),
        justification: justified,
      },
      evaluationContext: {
        execution_status: String(initiator.execution_status || 'ACTIVE'),
        blueprint_status: String(initiator.blueprint_status || 'ACTIVE'),
      },
    });
  }

  console.log('GOV_EVENT: PREEMPTION_EXECUTED', JSON.stringify({
    initiatorCampaignId,
    preemptedCampaignId,
    logId: logRow?.id,
  }));

  return {
    success: true,
    preemptedCampaignId,
    preemptedExecutionStatus: 'PREEMPTED',
    preemptedBlueprintStatus: 'INVALIDATED',
    logId: logRow?.id ?? '',
    justification: justified,
  };
}

/**
 * Attempt preemption. If target is protected or CRITICAL, creates request and returns APPROVAL_REQUIRED.
 * Otherwise executes immediately.
 */
export async function executeCampaignPreemption(
  params: ExecutePreemptionParams
): Promise<PreemptionAttemptResult> {
  const { initiatorCampaignId, preemptedCampaignId } = params;
  // Before ANY read, write or governance event: both campaigns must belong to the caller's company.
  await assertBothOwnedBy(params.companyId, initiatorCampaignId, preemptedCampaignId);

  // S2 tier 2: scoped to the company assertBothOwnedBy just verified both campaigns against.
  const { data: campaigns, error: fetchError } = await tenantTable('campaigns', systemTenantContext(params.companyId, 'campaign preemption: authorized company'))
    .select('id, priority_level, execution_status, blueprint_status, is_protected')
    .in('id', [initiatorCampaignId, preemptedCampaignId]);

  if (fetchError || !campaigns || campaigns.length !== 2) {
    throw new PreemptionValidationError('One or both campaigns not found.');
  }

  const initiator = campaigns.find((c: any) => c.id === initiatorCampaignId);
  const preempted = campaigns.find((c: any) => c.id === preemptedCampaignId);

  if (!initiator || !preempted) {
    throw new PreemptionValidationError('One or both campaigns not found.');
  }

  const initiatorRank = PRIORITY_ORDER[String(initiator.priority_level || 'NORMAL').toUpperCase()] ?? 1;
  const preemptedRank = PRIORITY_ORDER[String(preempted.priority_level || 'NORMAL').toUpperCase()] ?? 1;

  if (initiatorRank < preemptedRank) {
    if (params.companyId) {
      recordGovernanceEvent({
        companyId: params.companyId,
        campaignId: initiatorCampaignId,
        eventType: 'PREEMPTION_REJECTED',
        eventStatus: 'REJECTED',
        metadata: { reason: 'Initiator priority must be higher than preempted campaign.', targetCampaignId: preemptedCampaignId },
      });
    }
    throw new PreemptionValidationError(
      'Initiator priority must be higher than preempted campaign.'
    );
  }

  const preemptedStatus = String(preempted.execution_status || 'ACTIVE').toUpperCase();
  if (preemptedStatus === 'PREEMPTED') {
    if (params.companyId) {
      recordGovernanceEvent({
        companyId: params.companyId,
        campaignId: initiatorCampaignId,
        eventType: 'PREEMPTION_REJECTED',
        eventStatus: 'REJECTED',
        metadata: { reason: 'Campaign is already preempted.', targetCampaignId: preemptedCampaignId },
      });
    }
    throw new PreemptionValidationError('Campaign is already preempted. Cannot preempt again.');
  }

  if (initiatorRank === preemptedRank && !requiresApproval(preempted)) {
    if (params.companyId) {
      recordGovernanceEvent({
        companyId: params.companyId,
        campaignId: initiatorCampaignId,
        eventType: 'PREEMPTION_REJECTED',
        eventStatus: 'REJECTED',
        metadata: { reason: 'Equal priority cannot preempt unless target is protected or CRITICAL.', targetCampaignId: preemptedCampaignId },
      });
    }
    throw new PreemptionValidationError(
      'Equal priority cannot preempt unless target is protected or CRITICAL (approval required).'
    );
  }

  if (requiresApproval(preempted)) {
    return createApprovalRequest(initiatorCampaignId, preemptedCampaignId, params.companyId);
  }

  return performPreemption(params);
}

/**
 * S2 tier 2: campaign_preemption_requests (child of campaigns via initiator_campaign_id) for ONE request, verified
 * under the caller-authorized company. A missing / company-less request, or one whose initiator is not in that
 * company, is "not found" (PreemptionValidationError). A FAILED read (owner link or parent) is not: the retryable
 * TenantSeamError is rethrown so the route answers a 5xx instead of a permanent 400 (6f review; reads contract).
 */
async function preemptionRequestsFor(requestId: string, companyId: string, reason: string) {
  const owner = await ownerOfChildRow('campaign_preemption_requests', String(requestId ?? ''), `${reason}: initiator campaign of the request`);
  if (!owner) throw new PreemptionValidationError('Preemption request not found.');
  try {
    return await tenantChildTable('campaign_preemption_requests', systemTenantContext(companyId, reason), owner.parentId);
  } catch (err) {
    if (err instanceof TenantSeamError && !err.retryable) {
      throw new PreemptionValidationError('Preemption request not found.');
    }
    throw err;
  }
}

/**
 * Execute preemption from an approved request.
 * Used by approve-preemption endpoint.
 * @param requestId - Pending request ID
 * @param justification - Required approval justification (min 15 chars)
 * @param companyId - Optional, for governance event persistence
 */
export async function executePreemptionFromRequest(
  requestId: string,
  justification: string,
  companyId: string
): Promise<ExecutePreemptionResult> {
  // S2 tier 2: the request row is read only through the seam, under the company approve-preemption authorized.
  const requestsTable = await preemptionRequestsFor(requestId, companyId, 'campaign preemption: authorized company');
  const { data: request, error: fetchError } = await requestsTable
    .select('id, initiator_campaign_id, target_campaign_id, status')
    .eq('id', requestId)
    .maybeSingle();

  if (fetchError || !request) {
    throw new PreemptionValidationError('Preemption request not found.');
  }

  if (String(request.status).toUpperCase() !== 'PENDING') {
    throw new PreemptionValidationError(`Request is not pending. Current status: ${request.status}`);
  }

  // A request row created BEFORE this fix may name a target OWNED BY ANOTHER COMPANY (target_campaign_id is NOT NULL
  // and references campaigns since 20260701000000 - the risk is a populated foreign target, never a missing one):
  // re-check both at approval.
  await assertBothOwnedBy(companyId, request.initiator_campaign_id, request.target_campaign_id);

  const result = await performPreemption(
    {
      initiatorCampaignId: request.initiator_campaign_id,
      preemptedCampaignId: request.target_campaign_id,
      justification,
      companyId,
    },
    { fromApprovedRequest: true }
  );

  // S2 tenant seam: campaign_preemption_requests is a child of campaigns via initiator_campaign_id; the table was
  // verified under the authorized company above (and assertBothOwnedBy re-checked both campaigns).
  const { error: updateError } = await requestsTable
    .update({
      status: 'EXECUTED',
      approved_at: new Date().toISOString(),
    })
    .eq('id', requestId);

  if (updateError) {
    console.error('Failed to update preemption request to EXECUTED:', updateError);
  }

  return result;
}

/**
 * Reject a pending preemption request.
 */
export async function rejectPreemptionRequest(requestId: string, companyId: string): Promise<void> {
  // S2 tenant seam: the company the route authorized for this request's initiator campaign
  // (reject-preemption.ts: enforceCompanyAccess with campaignId = initiator_campaign_id). A request whose initiator is
  // not in that company is refused like a missing one; the request row is read only through the seam.
  const requestsTable = await preemptionRequestsFor(requestId, companyId, 'campaign preemption reject: authorized company');
  const { data: request, error: fetchError } = await requestsTable
    .select('id, status, initiator_campaign_id')
    .eq('id', requestId)
    .maybeSingle();

  if (fetchError || !request) {
    throw new PreemptionValidationError('Preemption request not found.');
  }

  if (String(request.status).toUpperCase() !== 'PENDING') {
    throw new PreemptionValidationError(`Request is not pending. Current status: ${request.status}`);
  }

  const { error: updateError } = await requestsTable
    .update({
      status: 'REJECTED',
      rejected_at: new Date().toISOString(),
    })
    .eq('id', requestId);

  if (updateError) {
    throw new PreemptionValidationError(`Failed to reject request: ${updateError.message}`);
  }
}
