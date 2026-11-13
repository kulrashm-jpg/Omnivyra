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
  /** More than one terminal row (two confirms, or a confirm and a release): a double settle that already happened. */
  | { state: 'double_settled'; transactionIds: string[]; rows: Array<{ id: string; phase: string | null; key: string | null }> }
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
 *     JWT errors - raised BEFORE the statement runs, EXCEPT PGRST116 (singular-response mismatch), which is raised
 *     AFTER execution and is safe only because PostgREST rolls the transaction back on it. It cannot arise on the
 *     settle calls today: creditExecutionRepository's rpc() calls request no .single()/.maybeSingle() - pinned by
 *     settleRpcNoSingular.test.ts. Also PGRST000 / PGRST002 / PGRST003 (no connection, schema cache load, pool
 *     timeout: the request never reached a transaction). NOT PGRST001 (database client error, which can be a
 *     connection lost mid-call) and not PGRST5xx.
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
 * The execution_phase vocabulary PROD writes to credit_transactions (verified against the live bodies, C100 record
 * 2026-11-13, committed under backend/tests/fixtures/live-credit-functions-20261113/): apply_credit_reservation
 * (20260322 body) writes 'hold' / 'confirm' / 'release' (plus 'grant' / 'expire' / 'expire_incentive', which never
 * settle a hold); apply_credit_partial_confirm (hand-applied body, md5 ff208f60) writes ONE 'confirm_partial' row and
 * returns the unused remainder to the wallet inside the same UPDATE. liveCreditPhaseVocabulary.test.ts reads those
 * bodies and fails if they write a phase this module does not classify.
 */
export const CONFIRM_PHASES: readonly string[] = ['confirm', 'confirm_partial'];
export const SETTLE_PHASES: readonly string[] = [...CONFIRM_PHASES, 'release'];
/** Phases the live bodies write that never settle a hold (classified as "not a settle row"). */
export const NON_SETTLE_PHASES: readonly string[] = ['hold', 'grant', 'expire', 'expire_incentive'];

/** The remainder-release key of a confirm, or null when the confirm has no key (never derive from ''). */
function remainderKeyOf(confirmKey: string | null): string | null {
  return confirmKey ? `${confirmKey}:release-remainder` : null;
}

/**
 * Classify the settle rows of ONE hold. More than one terminal row is a double settle that already happened - with ONE
 * exception: the 20260625 convention (NOT live today; may go live with 20270217000053) settles a partial confirm as a
 * 'confirm' row plus a 'release' row keyed '<confirm key>:release-remainder'. That pair is ONE settle. Today's live
 * partial confirm writes a single 'confirm_partial' row and no remainder row.
 */
function classify(rows: Row[]): HoldSettlementState | null {
  const all = [...new Map(rows.map((r) => [r.id, r])).values()];
  const confirms = all.filter((r) => CONFIRM_PHASES.includes(r.execution_phase ?? ''));
  const remainderKeys = new Set(confirms.map((c) => remainderKeyOf(c.idempotency_key)).filter((k): k is string => k !== null));
  const releases = all.filter((r) => r.execution_phase === 'release' && !(r.idempotency_key && remainderKeys.has(r.idempotency_key)));
  if (confirms.length + releases.length > 1) {
    return {
      state: 'double_settled',
      transactionIds: [...confirms, ...releases].map((r) => r.id),
      rows: [...confirms, ...releases].map((r) => ({ id: r.id, phase: r.execution_phase, key: r.idempotency_key })),
    };
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
      .in('execution_phase', [...SETTLE_PHASES])
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
    // e9: name every terminal row's phase and key, plus the keys this caller expected, so an unrecognised convention
    // is distinguishable from unrelated terminal rows.
    logger.error('credit_hold_double_settled', {
      holdId: input.holdId, expectedConfirmKey: input.confirmKey, expectedReleaseKey: input.releaseKey,
      expectedRemainderKey: remainderKeyOf(input.confirmKey), rows: state.rows,
    });
  } else if (state.state === 'released') {
    logger.error('credit_settle_released_before_confirm', { holdId: input.holdId, confirmKey: input.confirmKey, releaseId: state.transactionId });
  }
  return state;
}

/**
 * Settled amounts from an apply_credit_partial_confirm RESULT, whichever shape it has (e9 follow-up, 2026-11-14):
 *   - a FRESH call returns {total_consumed, total_released, is_underfunded, ...};
 *   - a REPLAY (same key) and the unique_violation path return row_to_json(the ledger row) - no total_* fields, but the
 *     row's deltas are -(consumed) per category (live body, C100).
 * The settlement report previously read only total_* and silently fell back to the PLANNED amounts on every replay.
 * Planned is now used only when the payload carries neither shape, and is then flagged (amountEstimated).
 */
export function settledAmountsFromPartialConfirm(
  data: unknown,
  held: number,
  planned: { consumed: number; released: number },
): { consumed: number; released: number; underfunded: boolean; amountEstimated: boolean } {
  const d = (data ?? {}) as Record<string, unknown>;
  const underfunded = d.is_underfunded === true;
  const total = Number(d.total_consumed);
  if (d.total_consumed !== undefined && d.total_consumed !== null && Number.isFinite(total)) {
    const rel = Number(d.total_released);
    return { consumed: total, released: Number.isFinite(rel) ? rel : Math.max(0, held - total), underfunded, amountEstimated: false };
  }
  const deltas = [d.free_delta, d.paid_delta, d.incentive_delta];
  if (deltas.some((v) => v !== undefined && v !== null)) {
    const consumed = deltas.reduce<number>((sum, v) => sum + Math.abs(Number(v ?? 0) || 0), 0);
    return { consumed, released: Math.max(0, held - consumed), underfunded, amountEstimated: false };
  }
  return { consumed: planned.consumed, released: planned.released, underfunded, amountEstimated: true };
}
