/**
 * Credit Priority Service
 *
 * Computes how a credit deduction is split across wallet categories.
 * Consumption order: free → incentive → paid
 *
 * Also provides wallet snapshot reads and total available balance.
 */

import { supabase } from '../db/supabaseClient';

// ── Types ──────────────────────────────────────────────────────────────────────

export interface WalletSnapshot {
  free_balance:       number;
  paid_balance:       number;
  incentive_balance:  number;
  reserved_free:      number;
  reserved_paid:      number;
  reserved_incentive: number;
}

export interface CategorySplit {
  free:      number;
  incentive: number;
  paid:      number;
}

export interface AvailableBalance {
  free:      number;
  incentive: number;
  paid:      number;
  total:     number;
}

// ── Wallet reads ───────────────────────────────────────────────────────────────

/**
 * Fetch the current wallet state for an org from the DB.
 * Returns null if no wallet row exists.
 */
export async function getWalletSnapshot(orgId: string): Promise<WalletSnapshot | null> {
  const { data } = await supabase
    .from('organization_credits')
    .select('free_balance, paid_balance, incentive_balance, reserved_free, reserved_paid, reserved_incentive')
    .eq('organization_id', orgId)
    .maybeSingle();

  if (!data) return null;

  const d = data as WalletSnapshot;
  return {
    free_balance:       d.free_balance       ?? 0,
    paid_balance:       d.paid_balance       ?? 0,
    incentive_balance:  d.incentive_balance  ?? 0,
    reserved_free:      d.reserved_free      ?? 0,
    reserved_paid:      d.reserved_paid      ?? 0,
    reserved_incentive: d.reserved_incentive ?? 0,
  };
}

/**
 * Compute available (unreserved) balance per category.
 */
export function computeAvailable(wallet: WalletSnapshot): AvailableBalance {
  const free      = Math.max(0, wallet.free_balance      - wallet.reserved_free);
  const incentive = Math.max(0, wallet.incentive_balance - wallet.reserved_incentive);
  const paid      = Math.max(0, wallet.paid_balance      - wallet.reserved_paid);
  return { free, incentive, paid, total: free + incentive + paid };
}

/**
 * Compute how `amount` credits should be split across categories.
 * Priority: free → incentive → paid
 *
 * Returns null if total available is insufficient.
 */
export function computeSplit(amount: number, available: AvailableBalance): CategorySplit | null {
  if (amount <= 0) return { free: 0, incentive: 0, paid: 0 };

  let remaining = amount;
  const split: CategorySplit = { free: 0, incentive: 0, paid: 0 };

  const fromFree = Math.min(remaining, available.free);
  split.free = fromFree;
  remaining -= fromFree;

  const fromIncentive = Math.min(remaining, available.incentive);
  split.incentive = fromIncentive;
  remaining -= fromIncentive;

  const fromPaid = Math.min(remaining, available.paid);
  split.paid = fromPaid;
  remaining -= fromPaid;

  if (remaining > 0) return null;   // insufficient total balance
  return split;
}

/**
 * Resolves wallet state and split in one call.
 * Returns null wallet if no account exists, null split if insufficient funds.
 */
export async function resolveDeduction(orgId: string, amount: number): Promise<{
  wallet:    WalletSnapshot | null;
  available: AvailableBalance | null;
  split:     CategorySplit   | null;
}> {
  const wallet = await getWalletSnapshot(orgId);
  if (!wallet) return { wallet: null, available: null, split: null };

  const available = computeAvailable(wallet);
  const split = computeSplit(amount, available);

  return { wallet, available, split };
}

/**
 * Returns total available (unreserved) balance across all categories.
 * Fast — single DB read.
 */
export async function getTotalAvailable(orgId: string): Promise<number | null> {
  const wallet = await getWalletSnapshot(orgId);
  if (!wallet) return null;
  return computeAvailable(wallet).total;
}
