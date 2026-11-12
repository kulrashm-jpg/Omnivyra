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

/**
 * SETTLE-ONCE GUARD (2026-11-12, e9 URGENT ruling). The prod body of
 * apply_credit_reservation does NOT refuse a second settlement of a HOLD (the
 * 20260625 "HOLD already settled" guard was never installed - 83/C17, 05). Its
 * idempotent return only collapses a repeat of the SAME key, so a CONFIRM and a
 * RELEASE (different keys) of one hold can BOTH apply. Until the guarded
 * function lands, every confirm / release / partial confirm checks - by
 * BUSINESS IDENTITY, not by key - that no terminal settlement of that hold
 * exists under another key:
 *   - by parent:   credit_transactions.parent_transaction_id = <hold id>
 *   - by key family: <base>:confirm / <base>:release (holds settled before
 *     parent ids were always written)
 * A settlement under the SAME key passes through (apply_credit_reservation's
 * live body returns the existing row for a repeated key). A read error refuses.
 * NOT atomic (two different-key settles in the same instant can both pass) -
 * the post-check below detects that and logs CRITICAL; the DB guard
 * (apply_credit_reservation_guarded) closes it.
 * COVERAGE BOUND (05): the guard relates settlements by SAME PARENT or SAME KEY
 * FAMILY. A settlement with a NULL parent_transaction_id under a DIFFERENT key
 * family (e.g. a safeRetry `retry:<key>:<lineage>` base) is invisible to both
 * and is NOT refused - prod does not require p_parent_id (a 20260625 guard
 * that was never installed). Closing that needs the mandatory parent of the
 * guarded function; until then this is not complete coverage. The bound is
 * confined to settlements written through apply_credit_reservation: the LIVE
 * apply_credit_partial_confirm (83/C21 body, reviewed by 05 2026-11-12)
 * requires the hold row and always writes parent_transaction_id = the hold, so
 * the by-parent half sees every partial-confirm settlement.
 * apply_credit_partial_confirm (live, md5 ff208f60, matches NO repo version):
 * it has NO "already settled" refusal and no FOR UPDATE on the hold row, so
 * this app-side guard is the ONLY double-settlement protection on that path
 * (measured, 05). Its key is optional live (IF p_idempotency_key IS NOT NULL)
 * and it handles a duplicate key; the same-key pass-through above relies on
 * that and on apply_credit_reservation's idempotent return.
 */
const SETTLE_PHASES = ['confirm', 'release'] as const;

function keyBase(key: string): string | null {
  const m = /^(.*):(confirm|release)$/.exec(key);
  return m ? m[1] : null;
}

async function findOtherSettlement(holdId: string | null | undefined, ownKey: string): Promise<{ error: Error | null; other: { id: string; idempotency_key: string; execution_phase: string } | null }> {
  const rows: Array<{ id: string; idempotency_key: string; execution_phase: string }> = [];
  if (holdId) {
    const { data, error } = await supabase
      .from('credit_transactions')
      .select('id, idempotency_key, execution_phase')
      .eq('parent_transaction_id', holdId)
      .in('execution_phase', [...SETTLE_PHASES]);
    if (error) return { error: new Error(`[creditExecution] settle-once check failed for hold ${holdId}: ${error.message}`), other: null };
    rows.push(...((data ?? []) as typeof rows));
  }
  const base = keyBase(ownKey);
  if (base) {
    const { data, error } = await supabase
      .from('credit_transactions')
      .select('id, idempotency_key, execution_phase')
      .in('idempotency_key', [`${base}:confirm`, `${base}:release`]);
    if (error) return { error: new Error(`[creditExecution] settle-once check failed for ${base}: ${error.message}`), other: null };
    rows.push(...((data ?? []) as typeof rows));
  }
  const other = rows.find((r) => r.idempotency_key !== ownKey) ?? null;
  return { error: null, other };
}

async function postCheckSingleSettlement(holdId: string | null | undefined, key: string): Promise<void> {
  if (!holdId) return;
  const { data, error } = await supabase
    .from('credit_transactions')
    .select('id')
    .eq('parent_transaction_id', holdId)
    .in('execution_phase', [...SETTLE_PHASES]);
  if (error) {
    console.error('[creditExecution] settle-once post-check read failed:', holdId, error.message);
    return;
  }
  if (Array.isArray(data) && data.length > 1) {
    console.error('[creditExecution] CRITICAL HOLD_DOUBLE_SETTLED: hold has more than one terminal settlement', { holdId, key, settlements: data.length });
  }
}

export async function callCreditReservation(command: CreditReservationCommand): Promise<{
  error: Error | null;
  transactionId: string | null;
}> {
  if ((SETTLE_PHASES as readonly string[]).includes(command.phase)) {
    const { error: checkErr, other } = await findOtherSettlement(command.parentId, command.idempotencyKey);
    if (checkErr) return { error: checkErr, transactionId: null };
    if (other) {
      return {
        error: new Error(`HOLD_ALREADY_SETTLED: hold ${command.parentId ?? '(by key)'} already has a ${other.execution_phase} (${other.id}); refusing ${command.phase}`),
        transactionId: null,
      };
    }
  }
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
  if (!error && (SETTLE_PHASES as readonly string[]).includes(command.phase)) {
    await postCheckSingleSettlement(command.parentId, command.idempotencyKey);
  }
  return { error: error as Error | null, transactionId: txId };
}

/**
 * THE idempotency guard of every credit primitive (reserve / confirm / release /
 * executeWithCredits): "is this key already held / confirmed / released?".
 * MONEY (2026-11-12): a failed read used to answer null = "no", so a retried
 * request whose work was already confirmed RE-RAN the paid work (provider call,
 * artifact) and placed/settled again under DB idempotency alone. A failed read
 * is "unknown": throw, and the caller fails closed (routes 5xx; the image-credit
 * helper maps it to 'unavailable').
 */
export async function findCreditTransaction(key: string): Promise<CreditTransactionLookup | null> {
  const { data, error } = await supabase
    .from('credit_transactions')
    .select('id, execution_phase')
    .eq('idempotency_key', key)
    .maybeSingle();
  if (error) throw new Error(`[creditExecution] idempotency lookup failed for ${key}: ${error.message}`);

  return data as CreditTransactionLookup | null;
}

export async function callCreditPartialConfirm(command: CreditPartialConfirmCommand): Promise<{
  error: Error | null;
  data: unknown;
}> {
  // SETTLE-ONCE GUARD (see above): a partial confirm is a settlement too.
  const { error: checkErr, other } = await findOtherSettlement(command.holdTxnId, command.idempotencyKey);
  if (checkErr) return { error: checkErr, data: null };
  if (other) {
    return { error: new Error(`HOLD_ALREADY_SETTLED: hold ${command.holdTxnId} already has a ${other.execution_phase} (${other.id}); refusing partial confirm`), data: null };
  }
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

  if (!error) await postCheckSingleSettlement(command.holdTxnId, command.idempotencyKey);
  return { error: error as Error | null, data };
}

export async function loadCreditHoldSplit(holdId: string): Promise<CategorySplit | null> {
  // A failed read is not a "corrupted hold": callers treat null as "start a
  // fresh hold with a zero split". Throw instead.
  const { data, error } = await supabase
    .from('credit_transactions')
    .select('free_delta, paid_delta, incentive_delta')
    .eq('id', holdId)
    .maybeSingle();
  if (error) throw new Error(`[creditExecution] hold split read failed for ${holdId}: ${error.message}`);

  if (!data) return null;
  const deltas = data as { free_delta?: number | null; paid_delta?: number | null; incentive_delta?: number | null };

  return {
    free: Math.abs(deltas.free_delta ?? 0),
    incentive: Math.abs(deltas.incentive_delta ?? 0),
    paid: Math.abs(deltas.paid_delta ?? 0),
  };
}
