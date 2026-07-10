/**
 * creditProjectionReconciler — gated, idempotent self-heal for the
 * `organization_credits` wallet projection.
 *
 * Source of truth: the append-only, immutable `credit_transactions` ledger.
 *
 * The recompute formula mirrors the LIVE, PRODUCTION-APPLIED reservation RPC
 * `apply_credit_reservation` (migration 20260323_remove_balance_credits) — the
 * authority that actually maintains every wallet in this environment. It is
 * deliberately NOT a port of 20260634's rebuild SQL: 20260634 is unapplied in
 * production AND its formula subtracts `confirm` from balances, which would
 * systematically UNDERSTATE balances for any org with confirmed consumption.
 * Net per-phase effects reproduced here (identical to the 20260323 RPC):
 *   grant   : balance += amount ; lifetime_purchased += amount
 *   hold    : balance -= amount ; reserved += amount
 *   release : balance += amount ; reserved -= amount
 *   confirm : reserved -= amount ; lifetime_consumed += amount   (balance unchanged)
 *   expire  : free_balance -= amount        (incentive variant tolerated if present)
 * No new consumption/pricing math is introduced.
 *
 * Safety model (Phase D — "persisting heal, gated"):
 *   • Runs ONLY when the projection is structurally broken: row absent (with
 *     ledger activity) OR impossible negative balances. It never touches a
 *     row whose values are all non-negative — so it cannot fight the live
 *     apply_credit_reservation RPC during normal operation, and cannot
 *     "correct" a legitimate zero.
 *   • The write is an ABSOLUTE set computed from the immutable ledger, so it
 *     is deterministic and idempotent — repeated/concurrent runs converge.
 *   • In-process single-flight per org dedupes concurrent rebuilds.
 *   • credit_rate_usd / created_at are never written (preserved on upsert).
 *   • Fresh org with NO ledger activity and NO row → intentionally NOT
 *     created (that is a genuine "no credit account yet", not a drift).
 */

import { supabase } from '../db/supabaseClient';
import { logger } from './logger';

const LEDGER_PAGE = 1000;

export type ReconcileOutcome =
  | 'rebuilt'              // projection recomputed + persisted from ledger
  | 'created_zero'         // row was absent but ledger empty → no-op (not created)
  | 'skipped_healthy'      // row present & non-negative → nothing to do
  | 'failed';              // could not produce a consistent projection

export interface ReconcileResult {
  outcome: ReconcileOutcome;
  organizationId: string;
}

interface LedgerRow {
  execution_phase: string | null;
  free_delta: number | null;
  paid_delta: number | null;
  incentive_delta: number | null;
  idempotency_key: string | null;
}

interface ComputedWallet {
  free_balance: number;
  paid_balance: number;
  incentive_balance: number;
  reserved_free: number;
  reserved_paid: number;
  reserved_incentive: number;
  lifetime_purchased: number;
  lifetime_consumed: number;
  ledgerRows: number;
}

// One in-flight reconcile per org, per process.
const inFlight = new Map<string, Promise<ReconcileResult>>();

function diag(event: string, detail: Record<string, unknown>): void {
  logger.warn(`credit_projection_${event}`, detail);
}

const abs = (n: number | null | undefined): number => Math.abs(n ?? 0);
const isPhase = (row: LedgerRow, phase: string): boolean => row.execution_phase === phase;

/** Reservation base key: rows are written as `${base}:hold|:confirm|:release`. */
function reservationBase(key: string | null): { base: string; phase: 'hold' | 'confirm' | 'release' } | null {
  if (!key) return null;
  const m = /^(.*):(hold|confirm|release)$/.exec(key);
  if (!m) return null;
  return { base: m[1], phase: m[2] as 'hold' | 'confirm' | 'release' };
}

/**
 * Recompute the wallet from the ledger, faithful to the LIVE 20260323 RPC's
 * OBSERVED settle semantics (incident 2026-07-09, org 4bdbec26):
 *
 *   grant   : balance += amount ; lifetime_purchased += amount
 *   hold    : balance -= amount ; reserved += amount
 *   release : balance += amount ; reserved -= amount   (hold closed)
 *   confirm : reserved -= FULL HELD amount ; lifetime_consumed += confirmed
 *             amount ; balance += (held − confirmed) — the RPC returns the
 *             unspent remainder WITHOUT writing a ledger delta row for it.
 *
 * The previous formula (`reserved = holds − releases − confirms` by amount)
 * assumed confirm rows carry the held amount. They carry the ACTUAL cost
 * (often 0–15 of a 50-credit exposure hold), so every settled job stranded
 * its remainder in `reserved` and understated `balance` by the same amount —
 * a rebuild against a healthy org locked 1,185 credits. Holds are therefore
 * paired to their confirm/release by reservation idempotency key; a paired
 * hold contributes NOTHING to reserved and its remainder is credited back.
 * Rows without parseable reservation keys fall back to the legacy net
 * accounting (identical to the old behavior for legacy data).
 */
export function computeFromLedger(rows: LedgerRow[]): ComputedWallet {
  let g_f = 0, g_p = 0, g_i = 0;       // grant
  let e_f = 0;                          // expire (free)
  let e_i = 0;                          // expire_incentive
  let c_f = 0, c_p = 0, c_i = 0;       // confirm totals (lifetime_consumed)

  // Legacy (keyless) rows keep the old net accounting.
  let lh_f = 0, lh_p = 0, lh_i = 0;    // legacy hold
  let lr_f = 0, lr_p = 0, lr_i = 0;    // legacy release
  let lc_f = 0, lc_p = 0, lc_i = 0;    // legacy confirm

  type Group = {
    hold: [number, number, number];
    confirm: [number, number, number];
    released: boolean;
    confirmed: boolean;
  };
  const groups = new Map<string, Group>();
  const groupFor = (base: string): Group => {
    let g = groups.get(base);
    if (!g) { g = { hold: [0, 0, 0], confirm: [0, 0, 0], released: false, confirmed: false }; groups.set(base, g); }
    return g;
  };

  for (const row of rows) {
    const deltas: [number, number, number] = [abs(row.free_delta), abs(row.paid_delta), abs(row.incentive_delta)];
    if (isPhase(row, 'grant')) { g_f += deltas[0]; g_p += deltas[1]; g_i += deltas[2]; continue; }
    if (isPhase(row, 'expire')) { e_f += deltas[0]; continue; }
    if (isPhase(row, 'expire_incentive')) { e_i += deltas[2]; continue; }

    const keyed = reservationBase(row.idempotency_key);
    if (isPhase(row, 'hold')) {
      if (keyed) { const g = groupFor(keyed.base); g.hold[0] += deltas[0]; g.hold[1] += deltas[1]; g.hold[2] += deltas[2]; }
      else { lh_f += deltas[0]; lh_p += deltas[1]; lh_i += deltas[2]; }
    } else if (isPhase(row, 'release')) {
      if (keyed) { groupFor(keyed.base).released = true; }
      else { lr_f += deltas[0]; lr_p += deltas[1]; lr_i += deltas[2]; }
    } else if (isPhase(row, 'confirm')) {
      c_f += deltas[0]; c_p += deltas[1]; c_i += deltas[2];
      if (keyed) { const g = groupFor(keyed.base); g.confirmed = true; g.confirm[0] += deltas[0]; g.confirm[1] += deltas[1]; g.confirm[2] += deltas[2]; }
      else { lc_f += deltas[0]; lc_p += deltas[1]; lc_i += deltas[2]; }
    }
  }

  // Keyed holds: open holds sit in reserved; closed holds return their
  // unspent portion to balance (full amount on release, remainder on confirm).
  // NOTE: confirm rows may record their deltas in a DIFFERENT bucket than the
  // hold (observed: free-bucket 50-credit hold settled by a paid-category
  // confirm row), so consumption is computed per GROUP across buckets and
  // attributed back to the hold's buckets proportionally.
  let open_f = 0, open_p = 0, open_i = 0;          // reserved (open holds)
  let spent_f = 0, spent_p = 0, spent_i = 0;       // net leaving balance
  for (const g of groups.values()) {
    if (g.released) continue;                       // fully returned; net zero
    const holdTotal = g.hold[0] + g.hold[1] + g.hold[2];
    if (g.confirmed) {
      if (holdTotal <= 0) continue;
      const confirmTotal = g.confirm[0] + g.confirm[1] + g.confirm[2];
      const consumed = Math.min(holdTotal, confirmTotal);
      spent_f += consumed * (g.hold[0] / holdTotal);
      spent_p += consumed * (g.hold[1] / holdTotal);
      spent_i += consumed * (g.hold[2] / holdTotal);
      continue;                                     // remainder returned; not reserved
    }
    open_f += g.hold[0]; open_p += g.hold[1]; open_i += g.hold[2];
    spent_f += g.hold[0]; spent_p += g.hold[1]; spent_i += g.hold[2];
  }

  const gz = (n: number) => Math.max(0, Math.trunc(n));

  return {
    free_balance:       gz(g_f - spent_f - (lh_f - lr_f) - e_f),
    paid_balance:       gz(g_p - spent_p - (lh_p - lr_p)),
    incentive_balance:  gz(g_i - spent_i - (lh_i - lr_i) - e_i),
    reserved_free:      gz(open_f + (lh_f - lr_f - lc_f)),
    reserved_paid:      gz(open_p + (lh_p - lr_p - lc_p)),
    reserved_incentive: gz(open_i + (lh_i - lr_i - lc_i)),
    lifetime_purchased: gz(g_f + g_p + g_i),
    lifetime_consumed:  gz(c_f + c_p + c_i),
    ledgerRows:         rows.length,
  };
}

/** Page through the org's ledger (immutable rows; order is irrelevant to the sum). */
async function loadLedger(organizationId: string): Promise<LedgerRow[] | null> {
  const rows: LedgerRow[] = [];
  for (let from = 0; ; from += LEDGER_PAGE) {
    const { data, error } = await supabase
      .from('credit_transactions')
      .select('execution_phase, free_delta, paid_delta, incentive_delta, idempotency_key')
      .eq('organization_id', organizationId)
      .range(from, from + LEDGER_PAGE - 1);
    if (error) {
      diag('ledger_read_failed', { organizationId, message: error.message });
      return null;
    }
    const batch = (data ?? []) as LedgerRow[];
    rows.push(...batch);
    if (batch.length < LEDGER_PAGE) break;
  }
  return rows;
}

async function reconcileImpl(organizationId: string): Promise<ReconcileResult> {
  const ledger = await loadLedger(organizationId);
  if (ledger === null) {
    return { outcome: 'failed', organizationId };
  }

  if (ledger.length === 0) {
    // No activity to project from. Do NOT fabricate a wallet — this is a
    // genuine "no credit account yet", surfaced explicitly upstream.
    diag('reconcile_skipped_no_ledger', { organizationId });
    return { outcome: 'created_zero', organizationId };
  }

  const w = computeFromLedger(ledger);

  // WRITE GUARD (incident 2026-07-09): the reconcile trigger can fire off a
  // TRANSIENT failed wallet read that is indistinguishable from "row absent"
  // to the caller. Re-read the row immediately before writing — if a healthy
  // row exists, the projection was never broken: skip the write entirely so
  // a live wallet is never clobbered by a rebuild.
  const { data: existingRow } = await supabase
    .from('organization_credits')
    .select('free_balance, paid_balance, incentive_balance, lifetime_purchased, lifetime_consumed')
    .eq('organization_id', organizationId)
    .maybeSingle();
  if (existingRow && !projectionIsBroken(existingRow as Record<string, unknown>)) {
    diag('reconcile_skipped_row_healthy', { organizationId });
    return { outcome: 'skipped_healthy', organizationId };
  }

  // Absolute, deterministic upsert. credit_rate_usd / created_at deliberately
  // omitted so existing values are preserved (PostgREST upserts only the
  // provided columns on conflict).
  const { error } = await supabase
    .from('organization_credits')
    .upsert(
      {
        organization_id:    organizationId,
        free_balance:       w.free_balance,
        paid_balance:       w.paid_balance,
        incentive_balance:  w.incentive_balance,
        reserved_free:      w.reserved_free,
        reserved_paid:      w.reserved_paid,
        reserved_incentive: w.reserved_incentive,
        lifetime_purchased: w.lifetime_purchased,
        lifetime_consumed:  w.lifetime_consumed,
        updated_at:         new Date().toISOString(),
      },
      { onConflict: 'organization_id' },
    );

  if (error) {
    diag('reconcile_write_failed', { organizationId, message: error.message });
    return { outcome: 'failed', organizationId };
  }

  diag('reconcile_rebuilt', {
    organizationId,
    ledgerRows:         w.ledgerRows,
    free_balance:       w.free_balance,
    paid_balance:       w.paid_balance,
    incentive_balance:  w.incentive_balance,
    lifetime_purchased: w.lifetime_purchased,
    lifetime_consumed:  w.lifetime_consumed,
  });
  return { outcome: 'rebuilt', organizationId };
}

/**
 * Reconcile one org's projection. Single-flight per org per process.
 * Idempotent: the absolute recompute converges regardless of how many
 * callers race here.
 */
export async function reconcileOrgCreditProjection(
  organizationId: string,
): Promise<ReconcileResult> {
  if (!organizationId) return { outcome: 'failed', organizationId };

  const existing = inFlight.get(organizationId);
  if (existing) return existing;

  const p = reconcileImpl(organizationId).finally(() => {
    inFlight.delete(organizationId);
  });
  inFlight.set(organizationId, p);
  return p;
}

/**
 * Structural health gate. Returns true when the projection is broken in a
 * way self-heal is allowed to repair: row absent, or any impossible
 * (negative / null) balance. A present row with all non-negative values is
 * considered healthy and is LEFT UNTOUCHED (so normal RPC operation and
 * legitimate zero balances are never disturbed).
 */
export function projectionIsBroken(
  row: Record<string, unknown> | null | undefined,
): boolean {
  if (!row) return true;
  const cols = [
    'free_balance', 'paid_balance', 'incentive_balance',
    'lifetime_purchased', 'lifetime_consumed',
  ];
  for (const c of cols) {
    const v = row[c];
    if (v == null || typeof v !== 'number' || !Number.isFinite(v) || v < 0) return true;
  }
  return false;
}
