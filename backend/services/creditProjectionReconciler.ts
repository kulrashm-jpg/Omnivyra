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

/**
 * Recompute the wallet from the ledger using the LIVE 20260323 RPC's net
 * accounting (see file header). GREATEST(0, …) clamps every balance to a
 * non-negative integer, exactly like the RPC's GREATEST/`>= 0` guards.
 */
export function computeFromLedger(rows: LedgerRow[]): ComputedWallet {
  let g_f = 0, g_p = 0, g_i = 0;       // grant
  let h_f = 0, h_p = 0, h_i = 0;       // hold
  let r_f = 0, r_p = 0, r_i = 0;       // release
  let c_f = 0, c_p = 0, c_i = 0;       // confirm
  let e_f = 0;                          // expire (free)
  let e_i = 0;                          // expire_incentive

  for (const row of rows) {
    if (isPhase(row, 'grant')) { g_f += abs(row.free_delta); g_p += abs(row.paid_delta); g_i += abs(row.incentive_delta); }
    else if (isPhase(row, 'hold')) { h_f += abs(row.free_delta); h_p += abs(row.paid_delta); h_i += abs(row.incentive_delta); }
    else if (isPhase(row, 'release')) { r_f += abs(row.free_delta); r_p += abs(row.paid_delta); r_i += abs(row.incentive_delta); }
    else if (isPhase(row, 'confirm')) { c_f += abs(row.free_delta); c_p += abs(row.paid_delta); c_i += abs(row.incentive_delta); }
    else if (isPhase(row, 'expire')) { e_f += abs(row.free_delta); }
    else if (isPhase(row, 'expire_incentive')) { e_i += abs(row.incentive_delta); }
  }

  const gz = (n: number) => Math.max(0, Math.trunc(n));

  // Balances follow the live RPC: confirm does NOT re-deduct balance (it only
  // moves reserved→consumed). reserved nets hold − release − confirm.
  return {
    free_balance:       gz(g_f - h_f + r_f - e_f),
    paid_balance:       gz(g_p - h_p + r_p),
    incentive_balance:  gz(g_i - h_i + r_i - e_i),
    reserved_free:      gz(h_f - r_f - c_f),
    reserved_paid:      gz(h_p - r_p - c_p),
    reserved_incentive: gz(h_i - r_i - c_i),
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
      .select('execution_phase, free_delta, paid_delta, incentive_delta')
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
