/**
 * Credit Approval Service — C-4 closure
 *
 * Implements the approval workflow for super-admin financial actions.
 *
 *   request → pending → (signature N-of-M) → approved → execute → audited
 *                          ↓
 *                       rejected (if any signer rejects)
 *
 * Threshold lookup is delegated to the DB function required_approvals_for_action().
 * Multi-actor sign-off is enforced by the DB function sign_credit_action_approval()
 * with these guards:
 *   - Proposer cannot self-approve (segregation of duties)
 *   - Any reject → status='rejected'
 *   - Approve count >= required → status='approved'
 *   - Once executed_at is set, the row is frozen
 *   - Pending rows expire 7 days after proposed_at
 */

import { randomUUID } from 'crypto';
import { supabase } from '../../db/supabaseClient';
import { logger } from '../logger';
import { emitAnomaly, emitFinancialAudit } from './billingAuditEmitter';
import { incrCounter } from './billingMetrics';
import { getBillingCorrelation } from './billingCorrelationService';

export type ApprovalActionType = 'admin_grant' | 'admin_adjust' | 'admin_refund' | 'admin_rate_change';

export interface ApprovalPayload {
  // common
  organizationId: string;
  amountCredits?: number;        // signed for adjust; unsigned for grant
  reason:         string;
  reasonType?:    string;

  // grant-specific
  category?:      'free' | 'paid' | 'incentive';
  expiryDays?:    number;

  // refund-specific
  originalPurchaseId?: string;

  // rate-change specific
  newCreditRateUsd?:   number;

  // free-form
  metadata?:      Record<string, unknown>;
}

export interface ProposeApprovalArgs {
  actionType:      ApprovalActionType;
  payload:         ApprovalPayload;
  proposedBy:      string;
  clientRequestId?: string;
  /** Override threshold lookup. Use sparingly — primarily for tests. */
  requiredApprovalsOverride?: number;
}

export type ProposeApprovalResult =
  | {
      ok:                  true;
      approvalId:          string;
      requiredApprovals:   number;
      status:              'pending' | 'approved';
      autoApproved:        boolean;
    }
  | {
      ok:      false;
      code:    'INVALID_PAYLOAD' | 'INSERT_FAILED' | 'INVALID_AMOUNT';
      message: string;
    };

export async function proposeApproval(args: ProposeApprovalArgs): Promise<ProposeApprovalResult> {
  // ── Validate ────────────────────────────────────────────────────────────────
  if (!args.payload?.organizationId) {
    return { ok: false, code: 'INVALID_PAYLOAD', message: 'organizationId required' };
  }
  if (!args.payload.reason?.trim()) {
    return { ok: false, code: 'INVALID_PAYLOAD', message: 'reason required' };
  }
  const absoluteAmount = Math.abs(args.payload.amountCredits ?? 0);
  if (args.actionType === 'admin_grant' && (!Number.isInteger(args.payload.amountCredits) || (args.payload.amountCredits ?? 0) <= 0)) {
    return { ok: false, code: 'INVALID_AMOUNT', message: 'grant credits must be positive integer' };
  }
  if (args.actionType === 'admin_adjust' && !Number.isInteger(args.payload.amountCredits)) {
    return { ok: false, code: 'INVALID_AMOUNT', message: 'adjust credits must be a signed integer' };
  }

  // ── Threshold lookup ─────────────────────────────────────────────────────────
  let required = args.requiredApprovalsOverride;
  if (!required) {
    const { data, error } = await supabase.rpc('required_approvals_for_action', {
      p_action_type: args.actionType,
      p_amount:      absoluteAmount,
    });
    if (error) {
      logger.warn('approval_threshold_lookup_failed', { actionType: args.actionType, message: error.message });
      required = 2; // conservative fallback
    } else {
      required = Number(data ?? 1);
    }
  }

  const id = randomUUID();
  const { data: row, error } = await supabase
    .from('credit_action_approvals')
    .upsert({
      id,
      action_type:        args.actionType,
      organization_id:    args.payload.organizationId,
      proposed_by:        args.proposedBy,
      payload:            args.payload as unknown as Record<string, unknown>,
      status:             required <= 1 ? 'approved' : 'pending',
      required_approvals: required,
      approvals_received: required <= 1 ? 1 : 0,
      approval_threshold_met_at: required <= 1 ? new Date().toISOString() : null,
      client_request_id:  args.clientRequestId ?? null,
      metadata:           args.payload.metadata ?? {},
    }, { onConflict: 'client_request_id', ignoreDuplicates: false })
    .select('id, status, required_approvals')
    .single();

  if (error) {
    logger.error('approval_insert_failed', { actionType: args.actionType, message: error.message });
    return { ok: false, code: 'INSERT_FAILED', message: error.message };
  }

  incrCounter('approval_proposals_total');

  return {
    ok:                true,
    approvalId:        (row as { id: string }).id,
    requiredApprovals: required,
    status:            required <= 1 ? 'approved' : 'pending',
    autoApproved:      required <= 1,
  };
}

export interface SignApprovalArgs {
  approvalId: string;
  approverId: string;
  decision:   'approve' | 'reject';
  comment?:   string;
}

export type SignApprovalResult =
  | {
      ok:               true;
      status:           'pending' | 'approved' | 'rejected';
      approvals:        number;
      requiredApprovals: number;
      approveCount:     number;
      rejectCount:      number;
    }
  | {
      ok:      false;
      code:    'NOT_FOUND' | 'NOT_ACTIONABLE' | 'EXPIRED' | 'SELF_SIGN_BLOCKED' | 'ALREADY_EXECUTED' | 'SIGN_FAILED';
      message: string;
    };

export async function signApproval(args: SignApprovalArgs): Promise<SignApprovalResult> {
  const { data, error } = await supabase.rpc('sign_credit_action_approval', {
    p_approval_id: args.approvalId,
    p_approver_id: args.approverId,
    p_decision:    args.decision,
    p_comment:     args.comment ?? null,
  });

  if (error) {
    const msg = String((error as { message?: string }).message ?? '');
    if (msg.includes('APPROVAL_NOT_FOUND'))         return { ok: false, code: 'NOT_FOUND',        message: msg };
    if (msg.includes('APPROVAL_NOT_ACTIONABLE'))    return { ok: false, code: 'NOT_ACTIONABLE',   message: msg };
    if (msg.includes('APPROVAL_EXPIRED'))           return { ok: false, code: 'EXPIRED',          message: msg };
    if (msg.includes('APPROVAL_SELF_NOT_ALLOWED')) {
      incrCounter('approval_self_signature_blocks');
      emitAnomaly({
        kind: 'approval_self_signature_attempt',
        severity: 'warn',
        message: `self-sign blocked: approval=${args.approvalId} actor=${args.approverId}`,
      });
      return { ok: false, code: 'SELF_SIGN_BLOCKED', message: msg };
    }
    if (msg.includes('APPROVAL_ALREADY_EXECUTED'))  return { ok: false, code: 'ALREADY_EXECUTED', message: msg };
    return { ok: false, code: 'SIGN_FAILED', message: msg };
  }

  const row = data as {
    id:                 string;
    status:             'pending' | 'approved' | 'rejected';
    approvals_received: number;
    required_approvals: number;
    approve_count:      number;
    reject_count:       number;
  };

  incrCounter('approval_signatures_total');
  if (row.status === 'rejected') {
    incrCounter('approval_rejections_total');
  }

  return {
    ok:                true,
    status:            row.status,
    approvals:         row.approvals_received,
    requiredApprovals: row.required_approvals,
    approveCount:      row.approve_count,
    rejectCount:       row.reject_count,
  };
}

/**
 * Mark an approval row as executed and emit the financial audit event.
 * MUST be called from inside the same transaction as the underlying ledger
 * write, OR with the ledger's idempotency key already in hand. The DB-level
 * `guard_approval_post_execute` trigger prevents double-execution.
 */
export async function markApprovalExecuted(args: {
  approvalId:           string;
  executedIdempotencyKey: string;
  actorUserId:          string;
}): Promise<{ ok: true } | { ok: false; code: 'NOT_FOUND' | 'ALREADY_EXECUTED' | 'NOT_APPROVED'; message: string }> {
  // 1. Lock + fetch
  const { data: current, error: fetchErr } = await supabase
    .from('credit_action_approvals')
    .select('id, status, executed_at, payload, action_type, organization_id')
    .eq('id', args.approvalId)
    .maybeSingle();

  if (fetchErr || !current) {
    return { ok: false, code: 'NOT_FOUND', message: fetchErr?.message ?? 'approval row not found' };
  }
  const row = current as { id: string; status: string; executed_at: string | null; payload: ApprovalPayload; action_type: ApprovalActionType; organization_id: string };
  if (row.executed_at) {
    return { ok: false, code: 'ALREADY_EXECUTED', message: 'approval already executed' };
  }
  if (row.status !== 'approved') {
    return { ok: false, code: 'NOT_APPROVED', message: `status=${row.status}` };
  }

  const { error: updErr } = await supabase
    .from('credit_action_approvals')
    .update({
      executed_at:              new Date().toISOString(),
      executed_idempotency_key: args.executedIdempotencyKey,
      status:                   'executed',
    })
    .eq('id', args.approvalId);

  if (updErr) {
    return { ok: false, code: 'NOT_FOUND', message: updErr.message };
  }

  incrCounter('approval_executions_total');

  // 2. Emit financial audit row
  const correlation = getBillingCorrelation({ module: `approval:${row.action_type}` });
  await emitFinancialAudit({
    actorUserId:          args.actorUserId,
    actionType:           row.action_type,
    organizationId:       row.organization_id,
    amountCredits:        row.payload.amountCredits,
    reasonType:           row.payload.reasonType,
    reason:               row.payload.reason,
    approvalId:           row.id,
    ledgerIdempotencyKey: args.executedIdempotencyKey,
    correlationId:        correlation.correlationId,
    metadata:             row.payload.metadata ?? {},
  });

  return { ok: true };
}

/**
 * Convenience read for an approval inspection UI.
 */
export async function getApprovalDetails(approvalId: string): Promise<{
  approval: Record<string, unknown> | null;
  signatures: Array<Record<string, unknown>>;
}> {
  const [approvalRes, sigRes] = await Promise.all([
    supabase.from('credit_action_approvals').select('*').eq('id', approvalId).maybeSingle(),
    supabase.from('credit_action_approval_signatures').select('*').eq('approval_id', approvalId).order('signed_at', { ascending: true }),
  ]);
  return {
    approval:   (approvalRes.data as Record<string, unknown> | null) ?? null,
    signatures: (sigRes.data as Array<Record<string, unknown>>) ?? [],
  };
}

/**
 * Reaper for expired pending approvals — called from a daily cron.
 */
export async function expirePendingApprovals(): Promise<{ expired: number }> {
  const { data, error } = await supabase
    .from('credit_action_approvals')
    .update({ status: 'expired' })
    .lt('expires_at', new Date().toISOString())
    .eq('status', 'pending')
    .select('id');
  if (error) {
    logger.error('approval_expiry_failed', { message: error.message });
    return { expired: 0 };
  }
  const count = (data?.length ?? 0);
  if (count > 0) incrCounter('approval_expirations_total', count);
  return { expired: count };
}
