/**
 * Settled state of a credit HOLD, read when a settle call's outcome is unknown (e9 ruling 2026-11-13, BLOCKING for
 * pricing).
 *
 * When apply_credit_partial_confirm returns an error, the caller used to RELEASE the whole hold. If the confirm had in
 * fact committed (a timeout or dropped response after the server's commit), that release refunded credits the work had
 * already consumed - and the live apply_credit_reservation body has no already-settled guard to stop it. The caller now
 * reads the hold's state first and releases ONLY when the hold is provably open AND the error was a definitive database
 * refusal (nothing committed). Every other case returns the finished work with a SettlementPending marker and leaves the
 * hold reserved for resolution; a read error is no answer.
 */
import { supabase } from '../../db/supabaseClient';

export type HoldSettlementState =
  | { state: 'open' }
  | { state: 'confirmed' | 'released'; transactionId: string }
  | { state: 'unreadable'; message: string };

/**
 * The AI work is DONE but its settle outcome is unknown. The caller gets its result (throwing would lose the content and
 * invite a re-click: a new key, a new hold and a second charge) with this marker; the hold stays reserved and is
 * resolved from the 'credit_settle_pending' ERROR log (one per occurrence, carrying everything a resolver needs).
 */
export type SettlementPending = {
  code: 'CREDIT_SETTLE_AMBIGUOUS';
  holdId: string | null;
  state: HoldSettlementState['state'];
  detail: string;
};

export function pendingSettlement(holdId: string | null, settled: HoldSettlementState, errorMessage: string): SettlementPending {
  return {
    code: 'CREDIT_SETTLE_AMBIGUOUS',
    holdId,
    state: settled.state,
    detail: settled.state === 'unreadable' ? `state unreadable: ${settled.message}` : `hold ${settled.state}; ${errorMessage}`,
  };
}

/**
 * True when the error is a refusal raised BY the database or PostgREST (a SQLSTATE such as P0001 / 23505, or a
 * PGRSTnnn code): the call's transaction did not commit. A network / timeout / client error carries no such code and
 * may have committed server-side.
 */
export function isDefinitiveDbRefusal(error: unknown): boolean {
  const code = String((error as { code?: unknown } | null)?.code ?? '');
  return /^(PGRST\d{3}|[0-9A-Z]{5})$/.test(code);
}

type Row = { id: string; execution_phase: string | null };

function terminal(rows: Row[] | null): HoldSettlementState | null {
  const row = (rows ?? []).find((r) => r.execution_phase === 'confirm' || r.execution_phase === 'release');
  if (!row) return null;
  return { state: row.execution_phase === 'confirm' ? 'confirmed' : 'released', transactionId: row.id };
}

/** The hold's terminal child (by parent id) or keyed settle row; 'unreadable' on ANY read error. */
export async function readHoldSettlementState(input: {
  /** null when the caller lost the hold id (e.g. a resumed hold whose split failed to load): keys only. */
  holdId: string | null;
  confirmKey: string;
  releaseKey: string;
}): Promise<HoldSettlementState> {
  if (input.holdId) {
    const byParent = await supabase
      .from('credit_transactions')
      .select('id, execution_phase')
      .eq('parent_transaction_id', input.holdId)
      .in('execution_phase', ['confirm', 'release'])
      .limit(2);
    if (byParent.error) return { state: 'unreadable', message: byParent.error.message };
    const fromParent = terminal(byParent.data as Row[] | null);
    if (fromParent) return fromParent;
  }

  const byKey = await supabase
    .from('credit_transactions')
    .select('id, execution_phase')
    .in('idempotency_key', [input.confirmKey, input.releaseKey])
    .limit(2);
  if (byKey.error) return { state: 'unreadable', message: byKey.error.message };
  return terminal(byKey.data as Row[] | null) ?? { state: 'open' };
}
