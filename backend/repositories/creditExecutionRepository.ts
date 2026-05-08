import { supabase } from '../db/supabaseClient';
import type { CategorySplit } from '../services/creditPriorityService';

export interface CreditReservationCommand {
  orgId: string;
  phase: 'hold' | 'confirm' | 'release' | 'grant' | 'expire' | 'expire_incentive';
  split: CategorySplit;
  idempotencyKey: string;
  referenceType: string;
  referenceId?: string;
  note: string;
  performedBy: string;
  parentId?: string;
  /**
   * Optional explicit category for the credit_transactions row. When omitted,
   * the value is derived from the split (single non-zero bucket → that
   * category; multi-bucket → the larger of paid/free, with paid winning ties
   * since the wallet prefers free first). Necessary because the underlying
   * RPC defaults to 'paid' when no value is passed — which silently
   * miscategorized every free / incentive grant before this fix.
   */
  category?: 'free' | 'paid' | 'incentive';
}

/**
 * Pick the right category text for the credit_transactions row when the
 * caller didn't pass one. The split is the source of truth — we just label
 * the row to match.
 */
function deriveCategory(split: CategorySplit): 'free' | 'paid' | 'incentive' {
  if (split.free > 0 && split.paid === 0 && split.incentive === 0) return 'free';
  if (split.incentive > 0 && split.paid === 0 && split.free === 0) return 'incentive';
  if (split.paid > 0 && split.free === 0 && split.incentive === 0) return 'paid';
  // Mixed (typical for HOLD/CONFIRM) — pick the largest bucket; ties go paid.
  if (split.paid >= split.free && split.paid >= split.incentive) return 'paid';
  if (split.free >= split.incentive) return 'free';
  return 'incentive';
}

export interface CreditTransactionLookup {
  id: string;
  execution_phase?: string;
}

export interface CreditPartialConfirmCommand {
  orgId: string;
  holdTxnId: string;
  actualSplit: CategorySplit;
  idempotencyKey: string;
  referenceType: string;
  referenceId?: string;
  note: string;
  performedBy: string;
}

export async function callCreditReservation(command: CreditReservationCommand): Promise<{
  error: Error | null;
  transactionId: string | null;
}> {
  const category = command.category ?? deriveCategory(command.split);
  const { error, data } = await supabase.rpc('apply_credit_reservation', {
    p_org_id: command.orgId,
    p_phase: command.phase,
    p_free_amount: command.split.free,
    p_incentive_amount: command.split.incentive,
    p_paid_amount: command.split.paid,
    p_idempotency_key: command.idempotencyKey,
    p_reference_type: command.referenceType,
    p_reference_id: command.referenceId ?? null,
    p_note: command.note,
    p_performed_by: command.performedBy,
    p_parent_id: command.parentId ?? null,
    p_category: category,
  });

  const txId = (data as { id?: string } | null)?.id ?? null;
  return { error: error as Error | null, transactionId: txId };
}

export async function findCreditTransaction(key: string): Promise<CreditTransactionLookup | null> {
  const { data } = await supabase
    .from('credit_transactions')
    .select('id, execution_phase')
    .eq('idempotency_key', key)
    .maybeSingle();

  return data as CreditTransactionLookup | null;
}

export async function callCreditPartialConfirm(command: CreditPartialConfirmCommand): Promise<{
  error: Error | null;
  data: unknown;
}> {
  const { error, data } = await supabase.rpc('apply_credit_partial_confirm', {
    p_org_id: command.orgId,
    p_hold_txn_id: command.holdTxnId,
    p_actual_free: command.actualSplit.free,
    p_actual_incentive: command.actualSplit.incentive,
    p_actual_paid: command.actualSplit.paid,
    p_idempotency_key: command.idempotencyKey,
    p_reference_type: command.referenceType,
    p_reference_id: command.referenceId ?? null,
    p_note: command.note,
    p_performed_by: command.performedBy,
  });

  return { error: error as Error | null, data };
}

export async function loadCreditHoldSplit(holdId: string): Promise<CategorySplit | null> {
  const { data } = await supabase
    .from('credit_transactions')
    .select('free_delta, paid_delta, incentive_delta')
    .eq('id', holdId)
    .maybeSingle();

  if (!data) return null;
  const deltas = data as { free_delta?: number | null; paid_delta?: number | null; incentive_delta?: number | null };

  return {
    free: Math.abs(deltas.free_delta ?? 0),
    incentive: Math.abs(deltas.incentive_delta ?? 0),
    paid: Math.abs(deltas.paid_delta ?? 0),
  };
}
