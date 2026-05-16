/**
 * Approval Cancellation Service — Phase D
 *
 * The proposer (and only the proposer) can cancel a pending approval. Once
 * an approval is executed, it is frozen (DB-enforced). Cancellation is
 * implemented as a DB function so the row transitions atomically and the
 * history remains immutable.
 */

import { supabase } from '../../db/supabaseClient';
import { logger } from '../logger';
import { incrCounter } from './billingMetrics';
import { recordAdminFinancialOperation } from './enterpriseBillingOrchestrator';

export interface CancelApprovalArgs {
  approvalId:  string;
  actorUserId: string;
  reason:      string;
}

export type CancelApprovalResult =
  | { ok: true; status: 'cancelled' }
  | { ok: false; code: 'NOT_FOUND' | 'ALREADY_EXECUTED' | 'NOT_PENDING' | 'NOT_ALLOWED' | 'FAILED'; message: string };

export async function cancelApproval(args: CancelApprovalArgs): Promise<CancelApprovalResult> {
  if (!args.reason?.trim()) {
    return { ok: false, code: 'FAILED', message: 'reason required' };
  }

  const { data, error } = await supabase.rpc('cancel_credit_action_approval', {
    p_approval_id: args.approvalId,
    p_actor:       args.actorUserId,
    p_reason:      args.reason,
  });
  if (error) {
    const msg = String((error as { message?: string }).message ?? '');
    if (msg.includes('APPROVAL_NOT_FOUND'))         return { ok: false, code: 'NOT_FOUND',         message: msg };
    if (msg.includes('APPROVAL_ALREADY_EXECUTED'))  return { ok: false, code: 'ALREADY_EXECUTED',  message: msg };
    if (msg.includes('APPROVAL_NOT_PENDING'))       return { ok: false, code: 'NOT_PENDING',       message: msg };
    if (msg.includes('APPROVAL_CANCEL_NOT_ALLOWED')) return { ok: false, code: 'NOT_ALLOWED',      message: msg };
    logger.error('approval_cancel_failed', { approvalId: args.approvalId, message: msg });
    return { ok: false, code: 'FAILED', message: msg };
  }

  incrCounter('approval_rejections_total');  // closest existing counter; cancellations rolled into rejection bucket

  // Pull org context for the audit trail
  const { data: row } = await supabase
    .from('credit_action_approvals')
    .select('organization_id, action_type, payload')
    .eq('id', args.approvalId)
    .maybeSingle();
  if (row) {
    const r = row as { organization_id: string; action_type: 'admin_grant' | 'admin_adjust' | 'admin_refund' | 'admin_rate_change'; payload: { amountCredits?: number } };
    await recordAdminFinancialOperation({
      module:         'http:admin_approval_cancel',
      actorUserId:    args.actorUserId,
      organizationId: r.organization_id,
      action:         r.action_type,
      amountCredits:  r.payload?.amountCredits,
      reason:         args.reason,
      approvalId:     args.approvalId,
      metadata:       { cancelled: true },
    });
  }

  return { ok: true, status: 'cancelled' };
}
