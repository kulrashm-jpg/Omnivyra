/**
 * Controlled Preemption Execution Service.
 * Safely executes PREEMPT_LOWER_PRIORITY_CAMPAIGN when explicitly requested.
 * Stage 9B: Protected campaigns and CRITICAL targets require approval flow.
 * Stage 9C-B: Preemption cooldown window (7 days) to prevent thrashing.
 */

import { supabase } from '../db/supabaseClient';
import { recordGovernanceEvent } from './GovernanceEventService';
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
  /** Optional: for governance event persistence. When provided, events are recorded. */
  companyId?: string;
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
async function createApprovalRequest(
  initiatorCampaignId: string,
  preemptedCampaignId: string,
  companyId?: string
): Promise<ApprovalRequiredResult> {
  const { data: requestRow, error } = await supabase
    .from('campaign_preemption_requests')
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

  const { data: campaigns, error: fetchError } = await supabase
    .from('campaigns')
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
  const { error: updateError } = await supabase
    .from('campaigns')
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

  const { data: logRow, error: logError } = await supabase
    .from('campaign_preemption_log')
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

  const { data: campaigns, error: fetchError } = await supabase
    .from('campaigns')
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
 * Execute preemption from an approved request.
 * Used by approve-preemption endpoint.
 * @param requestId - Pending request ID
 * @param justification - Required approval justification (min 15 chars)
 * @param companyId - Optional, for governance event persistence
 */
export async function executePreemptionFromRequest(
  requestId: string,
  justification: string,
  companyId?: string
): Promise<ExecutePreemptionResult> {
  const { data: request, error: fetchError } = await supabase
    .from('campaign_preemption_requests')
    .select('id, initiator_campaign_id, target_campaign_id, status')
    .eq('id', requestId)
    .maybeSingle();

  if (fetchError || !request) {
    throw new PreemptionValidationError('Preemption request not found.');
  }

  if (String(request.status).toUpperCase() !== 'PENDING') {
    throw new PreemptionValidationError(`Request is not pending. Current status: ${request.status}`);
  }

  const result = await performPreemption(
    {
      initiatorCampaignId: request.initiator_campaign_id,
      preemptedCampaignId: request.target_campaign_id,
      justification,
      companyId,
    },
    { fromApprovedRequest: true }
  );

  const { error: updateError } = await supabase
    .from('campaign_preemption_requests')
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
export async function rejectPreemptionRequest(requestId: string): Promise<void> {
  const { data: request, error: fetchError } = await supabase
    .from('campaign_preemption_requests')
    .select('id, status')
    .eq('id', requestId)
    .maybeSingle();

  if (fetchError || !request) {
    throw new PreemptionValidationError('Preemption request not found.');
  }

  if (String(request.status).toUpperCase() !== 'PENDING') {
    throw new PreemptionValidationError(`Request is not pending. Current status: ${request.status}`);
  }

  const { error: updateError } = await supabase
    .from('campaign_preemption_requests')
    .update({
      status: 'REJECTED',
      rejected_at: new Date().toISOString(),
    })
    .eq('id', requestId);

  if (updateError) {
    throw new PreemptionValidationError(`Failed to reject request: ${updateError.message}`);
  }
}
