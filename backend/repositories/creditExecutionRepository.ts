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
 * GUARDED FUNCTIONS (20270217000023, e9 option C): every write goes through
 * apply_credit_reservation_guarded / apply_credit_partial_confirm_guarded. For a
 * settlement they REQUIRE the parent hold, serialise on a per-hold advisory lock
 * and refuse a second settlement under ANY key (HOLD_ALREADY_SETTLED) - the
 * atomic guard the app-side check below could not be. DEPLOY ORDER: the
 * migration must be applied BEFORE this code runs (an absent function fails
 * every credit write closed). The old pair is not called from app code
 * (pinned by creditLegacyRpcNotCalled.test.ts); its service_role EXECUTE is
 * revoked later by 20270217000024.
 *
 * The app-side check stays as DEFENCE IN DEPTH (and to return a clean
 * HOLD_ALREADY_SETTLED before a round trip). Settlement rows are confirm,
 * release and confirm_partial; the guarded partial confirm also writes the
 * released remainder as its own 'release' row keyed <confirm key>:remainder,
 * which belongs to that settlement (never "another" one).
 *
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
 * COVERAGE BOUND (05): the app check relates settlements by SAME PARENT or SAME
 * KEY FAMILY. A settlement with a NULL parent under a DIFFERENT key family (e.g.
 * a safeRetry `retry:<key>:<lineage>` base) is invisible to both. The guarded
 * functions close that: they REFUSE a parentless settlement
 * (SETTLEMENT_PARENT_REQUIRED). A partial confirm always writes
 * parent_transaction_id = the hold with execution_phase 'confirm_partial'; the
 * by-parent half reads that phase (it did NOT before 2026-11-12 - the key-family
 * half was what saw partial confirms, via the <base>:confirm key).
 */
const SETTLE_PHASES = ['confirm', 'release'] as const;
/** Ledger phases that settle a hold (the partial confirm writes 'confirm_partial'). */
const SETTLEMENT_ROW_PHASES = ['confirm', 'release', 'confirm_partial'] as const;
const REMAINDER_SUFFIX = ':remainder';

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
      .in('execution_phase', [...SETTLEMENT_ROW_PHASES]);
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
  const own = new Set([ownKey, `${ownKey}${REMAINDER_SUFFIX}`]);
  const other = rows.find((r) => !own.has(r.idempotency_key)) ?? null;
  return { error: null, other };
}

async function postCheckSingleSettlement(holdId: string | null | undefined, key: string): Promise<void> {
  if (!holdId) return;
  const { data, error } = await supabase
    .from('credit_transactions')
    .select('id, idempotency_key')
    .eq('parent_transaction_id', holdId)
    .in('execution_phase', [...SETTLEMENT_ROW_PHASES]);
  if (error) {
    console.error('[creditExecution] settle-once post-check read failed:', holdId, error.message);
    return;
  }
  // A released remainder belongs to its partial confirm: count settlements, not rows.
  const settlements = (Array.isArray(data) ? data : []).filter(
    (r) => !String((r as { idempotency_key?: string }).idempotency_key ?? '').endsWith(REMAINDER_SUFFIX));
  if (settlements.length > 1) {
    console.error('[creditExecution] CRITICAL HOLD_DOUBLE_SETTLED: hold has more than one terminal settlement', { holdId, key, settlements: settlements.length });
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
  const { error, data } = await supabase.rpc('apply_credit_reservation_guarded', {
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
  const { error, data } = await supabase.rpc('apply_credit_partial_confirm_guarded', {
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
