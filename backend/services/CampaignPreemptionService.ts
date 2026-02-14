/**
 * Controlled Preemption Execution Service.
 * Safely executes PREEMPT_LOWER_PRIORITY_CAMPAIGN when explicitly requested.
 * Stage 9B: Protected campaigns and CRITICAL targets require approval flow.
 */

import { supabase } from '../db/supabaseClient';
const PRIORITY_ORDER: Record<string, number> = { LOW: 0, NORMAL: 1, HIGH: 2, CRITICAL: 3 };

export interface ExecutePreemptionParams {
  initiatorCampaignId: string;
  preemptedCampaignId: string;
  reason?: string;
}

export interface ExecutePreemptionResult {
  success: boolean;
  preemptedCampaignId: string;
  preemptedExecutionStatus: string;
  preemptedBlueprintStatus: string;
  logId: string;
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
  preemptedCampaignId: string
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
  const { initiatorCampaignId, preemptedCampaignId, reason } = params;
  const fromApproved = !!options?.fromApprovedRequest;

  const { data: campaigns, error: fetchError } = await supabase
    .from('campaigns')
    .select('id, priority_level, execution_status, blueprint_status')
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

  if (!fromApproved && initiatorRank <= preemptedRank) {
    throw new PreemptionValidationError(
      'Initiator priority must be higher than preempted campaign.'
    );
  }

  const preemptedStatus = String(preempted.execution_status || 'ACTIVE').toUpperCase();
  if (preemptedStatus === 'PREEMPTED') {
    throw new PreemptionValidationError('Campaign is already preempted. Cannot preempt again.');
  }

  const { error: updateError } = await supabase
    .from('campaigns')
    .update({
      execution_status: 'PREEMPTED',
      blueprint_status: 'INVALIDATED',
      updated_at: new Date().toISOString(),
    })
    .eq('id', preemptedCampaignId);

  if (updateError) {
    throw new PreemptionValidationError(`Failed to update preempted campaign: ${updateError.message}`);
  }

  const { data: logRow, error: logError } = await supabase
    .from('campaign_preemption_log')
    .insert({
      initiator_campaign_id: initiatorCampaignId,
      preempted_campaign_id: preemptedCampaignId,
      reason: reason ?? null,
    })
    .select('id')
    .single();

  if (logError || !logRow) {
    console.error('campaign_preemption_log insert failed:', logError);
  }

  return {
    success: true,
    preemptedCampaignId,
    preemptedExecutionStatus: 'PREEMPTED',
    preemptedBlueprintStatus: 'INVALIDATED',
    logId: logRow?.id ?? '',
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
    throw new PreemptionValidationError(
      'Initiator priority must be higher than preempted campaign.'
    );
  }

  const preemptedStatus = String(preempted.execution_status || 'ACTIVE').toUpperCase();
  if (preemptedStatus === 'PREEMPTED') {
    throw new PreemptionValidationError('Campaign is already preempted. Cannot preempt again.');
  }

  if (initiatorRank === preemptedRank && !requiresApproval(preempted)) {
    throw new PreemptionValidationError(
      'Equal priority cannot preempt unless target is protected or CRITICAL (approval required).'
    );
  }

  if (requiresApproval(preempted)) {
    return createApprovalRequest(initiatorCampaignId, preemptedCampaignId);
  }

  return performPreemption(params);
}

/**
 * Execute preemption from an approved request.
 * Used by approve-preemption endpoint.
 */
export async function executePreemptionFromRequest(requestId: string): Promise<ExecutePreemptionResult> {
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
