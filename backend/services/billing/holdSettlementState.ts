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
import { logger } from '../logger';

export type HoldSettlementState =
  | { state: 'open' }
  /** creditsSettled: the absolute credit movement on the terminal row, as recorded (null when the row carries none). */
  | { state: 'confirmed' | 'released'; transactionId: string; creditsSettled: number | null }
  /** Two confirms, or a confirm plus a release that is not its own remainder: a double settle that already happened. */
  | { state: 'double_settled'; transactionIds: string[] }
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
 * True ONLY for codes known to mean "the statement failed and its transaction rolled back" (05, BLOCKING finding on the
 * first version, which was a SHAPE test: any 5-char code passed - including 08007 transaction_resolution_unknown, the
 * 57P0x shutdown codes and Node's EPIPE, exactly the may-have-committed cases). This is an ALLOWLIST with a safe
 * default: every unrecognised code - and no code at all - is NOT definitive, so the hold is never released on it.
 *
 *   PostgREST: PGRST1xx request errors, PGRST2xx schema-cache errors (e.g. PGRST202 function not found), PGRST3xx
 *     JWT errors - all raised BEFORE the statement runs - and PGRST000 / PGRST002 / PGRST003 (no connection, schema
 *     cache load, pool timeout: the request never reached a transaction). NOT PGRST001 (database client error, which
 *     can be a connection lost mid-call) and not PGRST5xx.
 *   SQLSTATE: P0001 (RAISE EXCEPTION), classes 22 data exception, 23 integrity constraint violation, 25 invalid
 *     transaction state, 42 syntax error / access rule violation, 54 program limit exceeded, 55 object not in
 *     prerequisite state, and 40001 / 40P01 (serialization failure / deadlock - rolled back).
 *   Never: class 53 (insufficient resources - e9: can arise around commit, so left pending), class 08 (connection
 *     exception, incl. 08007 transaction_resolution_unknown), 57 (operator intervention, incl. 57P01-57P03), 58, XX,
 *     and any Node socket code (EPIPE, EBADF, ECONNRESET, ...).
 */
export function isDefinitiveDbRefusal(error: unknown): boolean {
  const code = String((error as { code?: unknown } | null)?.code ?? '');
  if (/^PGRST[123]\d{2}$/.test(code)) return true;
  if (code === 'PGRST000' || code === 'PGRST002' || code === 'PGRST003') return true;
  if (code === 'P0001' || code === '40001' || code === '40P01') return true;
  return /^(22|23|25|42|54|55)[0-9A-Z]{3}$/.test(code);
}

type Row = {
  id: string;
  execution_phase: string | null;
  idempotency_key: string | null;
  free_delta: number | null;
  paid_delta: number | null;
  incentive_delta: number | null;
};

const SELECT = 'id, execution_phase, idempotency_key, free_delta, paid_delta, incentive_delta';

function creditsOf(r: Row): number | null {
  const parts = [r.free_delta, r.paid_delta, r.incentive_delta];
  if (parts.every((v) => v === null || v === undefined)) return null;
  return parts.reduce<number>((sum, v) => sum + Math.abs(Number(v ?? 0)), 0);
}

/**
 * Classify the settle rows of ONE hold. apply_credit_partial_confirm legitimately writes a 'confirm' row plus a
 * 'release' row keyed '<confirm key>:release-remainder' (the unused remainder returned) - that pair is ONE settle, not
 * two (20260625 body; the live body is to be confirmed by C100). Anything beyond that is a double settle.
 */
function classify(rows: Row[]): HoldSettlementState | null {
  const byId = new Map(rows.map((r) => [r.id, r]));
  const all = [...byId.values()];
  const confirms = all.filter((r) => r.execution_phase === 'confirm');
  const remainderKeys = new Set(confirms.map((c) => `${c.idempotency_key ?? ''}:release-remainder`));
  const releases = all.filter((r) => r.execution_phase === 'release' && !remainderKeys.has(r.idempotency_key ?? ''));
  if (confirms.length > 1 || (confirms.length >= 1 && releases.length >= 1) || releases.length > 1) {
    return { state: 'double_settled', transactionIds: [...confirms, ...releases].map((r) => r.id) };
  }
  if (confirms.length === 1) return { state: 'confirmed', transactionId: confirms[0].id, creditsSettled: creditsOf(confirms[0]) };
  if (releases.length === 1) return { state: 'released', transactionId: releases[0].id, creditsSettled: creditsOf(releases[0]) };
  return null;
}

/**
 * The hold's settle rows, from BOTH the parent link and the settle keys (merged, so a confirm found one way and a
 * release found the other is still seen as a double settle); 'unreadable' on ANY read error - never 'open'.
 */
export async function readHoldSettlementState(input: {
  /** null when the caller lost the hold id (e.g. a resumed hold whose split failed to load): keys only. */
  holdId: string | null;
  confirmKey: string;
  releaseKey: string;
}): Promise<HoldSettlementState> {
  const rows: Row[] = [];
  if (input.holdId) {
    const byParent = await supabase
      .from('credit_transactions')
      .select(SELECT)
      .eq('parent_transaction_id', input.holdId)
      .in('execution_phase', ['confirm', 'release'])
      .limit(10);
    if (byParent.error) return { state: 'unreadable', message: byParent.error.message };
    rows.push(...((byParent.data as Row[] | null) ?? []));
  }
  const byKey = await supabase
    .from('credit_transactions')
    .select(SELECT)
    .in('idempotency_key', [input.confirmKey, input.releaseKey, `${input.confirmKey}:release-remainder`])
    .limit(10);
  if (byKey.error) return { state: 'unreadable', message: byKey.error.message };
  rows.push(...((byKey.data as Row[] | null) ?? []));
  const state = classify(rows) ?? { state: 'open' };
  // Alerts (05): a double settle that ALREADY happened, and a hold released by someone else while its work completed
  // (free work) - both must be visible as patterns, not just per-call outcomes.
  if (state.state === 'double_settled') {
    logger.error('credit_hold_double_settled', { holdId: input.holdId, confirmKey: input.confirmKey, transactionIds: state.transactionIds });
  } else if (state.state === 'released') {
    logger.error('credit_settle_released_before_confirm', { holdId: input.holdId, confirmKey: input.confirmKey, releaseId: state.transactionId });
  }
  return state;
}
