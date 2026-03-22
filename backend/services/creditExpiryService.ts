/**
 * Credit Expiry Service
 *
 * Daily job: finds organizations with expired free credits and expires them
 * via a ledger debit entry. The DB function apply_credit_reservation with
 * phase='expire' handles the balance mutation atomically.
 *
 * Category safety guarantees (enforced at every layer):
 *   free      — expired when credit_expiry_at is in the past (primary job)
 *   incentive — expired only when free_credit_config.incentive_expiry.is_active=true
 *   paid      — NEVER expired, blocked at service + DB level
 *
 * Expiry source of truth:
 *   free       → free_credit_profiles.credit_expiry_at
 *   incentive  → free_credit_config incentive_expiry_days (counted from grant date)
 *
 * Called by: POST /api/cron/credit-expiry (daily, via Vercel/Railway cron)
 */

import { supabase } from '../db/supabaseClient';
import { createHash } from 'crypto';
import type { CategorySplit } from './creditPriorityService';

// ── Category constants — expiry is ONLY allowed for these ─────────────────────

/** Categories that may be expired. paid is deliberately absent. */
const EXPIRABLE_CATEGORIES = new Set(['free', 'incentive'] as const);

/** Hard-coded zero — paid_balance must never appear in an expiry call. */
const PAID_AMOUNT_FOR_EXPIRY = 0 as const;

export interface ExpiryResult {
  processed:             number;   // orgs evaluated for free expiry
  expired:               number;   // orgs with free credits actually expired
  total_expired_credits: number;
  incentive_expired:     number;   // total incentive credits expired (if enabled)
  errors:                number;
}

// ── Wallet snapshot helper ─────────────────────────────────────────────────────

interface WalletSnapshot {
  free_balance:      number;
  incentive_balance: number;
  paid_balance:      number;
}

async function getWalletSnapshot(orgId: string): Promise<WalletSnapshot | null> {
  const { data } = await supabase
    .from('organization_credits')
    .select('free_balance, paid_balance, incentive_balance')
    .eq('organization_id', orgId)
    .maybeSingle();
  if (!data) return null;
  const d = data as any;
  return {
    free_balance:      d.free_balance      ?? 0,
    incentive_balance: d.incentive_balance ?? 0,
    paid_balance:      d.paid_balance      ?? 0,
  };
}

// ── Free credit profile query ─────────────────────────────────────────────────

async function findExpiredProfiles(): Promise<Array<{
  user_id:          string;
  organization_id:  string;
  initial_credits:  number;
  credit_expiry_at: string;
}>> {
  const now = new Date().toISOString();

  const { data, error } = await supabase
    .from('free_credit_profiles')
    .select('user_id, organization_id, initial_credits, credit_expiry_at')
    .not('organization_id', 'is', null)
    .lt('credit_expiry_at', now);

  if (error) {
    console.error('[creditExpiry] failed to fetch expired profiles:', error.message);
    return [];
  }

  return (data ?? []) as Array<{
    user_id: string;
    organization_id: string;
    initial_credits: number;
    credit_expiry_at: string;
  }>;
}

// ── Incentive expiry config ───────────────────────────────────────────────────

interface IncentiveExpiryConfig {
  enabled:     boolean;
  expiryDays:  number | null;
}

async function getIncentiveExpiryConfig(): Promise<IncentiveExpiryConfig> {
  const { data } = await supabase
    .from('free_credit_config')
    .select('is_active, expiry_days')
    .eq('category', 'incentive_expiry')
    .maybeSingle();

  return {
    enabled:    (data as any)?.is_active    ?? false,
    expiryDays: (data as any)?.expiry_days  ?? null,
  };
}

// ── Core expiry function — FREE credits only ──────────────────────────────────

/**
 * Expire free credits for one org.
 *
 * Runtime guards:
 *   1. p_paid_amount is the literal constant 0 — cannot drift.
 *   2. paid_balance is read before and after; throws if it changed.
 *   3. DB function raises EXPIRY_CATEGORY_GUARD if non-zero paid/incentive
 *      amounts are somehow passed.
 *
 * Returns the number of credits actually expired (≤ amount).
 */
async function expireOrgFreeCredits(
  orgId:     string,
  userId:    string,
  amount:    number,
  expiredAt: string,
): Promise<number> {
  // ── Runtime guard 1: idempotency key (one expiry per org per day) ────────
  const dayKey = expiredAt.slice(0, 10); // YYYY-MM-DD
  const idempotencyKey = createHash('sha256')
    .update(`expire:free:${orgId}:${dayKey}`)
    .digest('hex')
    .slice(0, 32);

  const { data: existing } = await supabase
    .from('credit_transactions')
    .select('id')
    .eq('idempotency_key', idempotencyKey)
    .maybeSingle();

  if (existing) return 0; // already processed this expiry window

  // ── Runtime guard 2: snapshot paid_balance BEFORE expiry ─────────────────
  const before = await getWalletSnapshot(orgId);
  if (!before) return 0;

  const toExpire = Math.min(amount, before.free_balance);
  if (toExpire <= 0) return 0;

  // ── Runtime guard 3: explicit assertion — paid amount is ALWAYS zero ─────
  // This is a compile-time constant, not a variable. If this line ever changes
  // to pass a non-zero value, the type system will reject it.
  const paidAmount: typeof PAID_AMOUNT_FOR_EXPIRY = PAID_AMOUNT_FOR_EXPIRY;

  // ── DB call — expire phase only touches free_balance ─────────────────────
  // The DB function will RAISE EXCEPTION if paidAmount or incentive != 0.
  const { error: expireErr } = await supabase.rpc('apply_credit_reservation', {
    p_org_id:           orgId,
    p_phase:            'expire',
    p_free_amount:      toExpire,
    p_incentive_amount: 0,          // incentive expiry is a separate phase
    p_paid_amount:      paidAmount, // typed constant — always 0
    p_idempotency_key:  idempotencyKey,
    p_reference_type:   'expiry',
    p_reference_id:     null,
    p_note:             `Free credit expiry (${dayKey})`,
    p_performed_by:     userId,
    p_parent_id:        null,
  });

  if (expireErr) {
    console.error(`[creditExpiry] DB expiry failed for ${orgId}:`, expireErr.message);
    return 0;
  }

  // ── Runtime guard 4: verify paid_balance is unchanged after expiry ────────
  const after = await getWalletSnapshot(orgId);
  if (after && after.paid_balance !== before.paid_balance) {
    // This should be structurally impossible given the DB guard, but if it
    // ever fires it means the DB function was modified unsafely.
    const msg = `EXPIRY_CATEGORY_VIOLATION: paid_balance changed during free expiry for org ${orgId} `
      + `(before=${before.paid_balance}, after=${after.paid_balance})`;
    console.error(`[creditExpiry] ${msg}`);
    throw new Error(msg);
  }

  const expired = toExpire;

  await supabase.from('credit_expiry_log').insert({
    organization_id: orgId,
    user_id:         userId,
    amount_expired:  expired,
    balance_before:  before.free_balance,
    balance_after:   before.free_balance - expired,
    reason:          `free_credit_expiry:${dayKey}`,
  });

  return expired;
}

// ── Incentive expiry (config-gated) ──────────────────────────────────────────

/**
 * Expire incentive credits older than expiryDays for one org.
 * Only called when incentive_expiry config is active.
 * Paid balance is never touched — guarded at DB level by phase='expire_incentive'.
 */
async function expireOrgIncentiveCredits(
  orgId:      string,
  expiryDays: number,
): Promise<number> {
  const dayKey = new Date().toISOString().slice(0, 10);
  const idempotencyKey = createHash('sha256')
    .update(`expire:incentive:${orgId}:${dayKey}`)
    .digest('hex')
    .slice(0, 32);

  const { data: existing } = await supabase
    .from('credit_transactions')
    .select('id')
    .eq('idempotency_key', idempotencyKey)
    .maybeSingle();

  if (existing) return 0;

  // Compute how many incentive credits were granted before the expiry window
  const cutoff = new Date(Date.now() - expiryDays * 86400_000).toISOString();

  const { data: grantRows } = await supabase
    .from('credit_transactions')
    .select('incentive_delta')
    .eq('organization_id', orgId)
    .eq('execution_phase', 'grant')
    .lt('created_at', cutoff)
    .gt('incentive_delta', 0);

  const totalGrantedBefore = (grantRows ?? []).reduce(
    (sum, r) => sum + ((r as any).incentive_delta ?? 0), 0,
  );
  if (totalGrantedBefore <= 0) return 0;

  const before = await getWalletSnapshot(orgId);
  if (!before) return 0;

  const toExpire = Math.min(totalGrantedBefore, before.incentive_balance);
  if (toExpire <= 0) return 0;

  const { error: expireErr } = await supabase.rpc('apply_credit_reservation', {
    p_org_id:           orgId,
    p_phase:            'expire_incentive', // separate named phase — cannot touch paid
    p_free_amount:      0,                  // guarded at DB: free must be 0
    p_incentive_amount: toExpire,
    p_paid_amount:      0,                  // guarded at DB: paid must be 0
    p_idempotency_key:  idempotencyKey,
    p_reference_type:   'incentive_expiry',
    p_reference_id:     null,
    p_note:             `Incentive credit expiry (>${expiryDays}d, ${dayKey})`,
    p_performed_by:     null,
    p_parent_id:        null,
  });

  if (expireErr) {
    console.error(`[creditExpiry] incentive expiry failed for ${orgId}:`, expireErr.message);
    return 0;
  }

  // Verify paid_balance unchanged
  const after = await getWalletSnapshot(orgId);
  if (after && after.paid_balance !== before.paid_balance) {
    const msg = `EXPIRY_CATEGORY_VIOLATION: paid_balance changed during incentive expiry for org ${orgId}`;
    console.error(`[creditExpiry] ${msg}`);
    throw new Error(msg);
  }

  await supabase.from('credit_expiry_log').insert({
    organization_id: orgId,
    user_id:         null,
    amount_expired:  toExpire,
    balance_before:  before.incentive_balance,
    balance_after:   before.incentive_balance - toExpire,
    reason:          `incentive_credit_expiry:${dayKey}`,
  });

  return toExpire;
}

// ── Main entry point ──────────────────────────────────────────────────────────

/**
 * Main entry point for the daily cron job.
 *
 * Pass 1 — free credit expiry:   always runs.
 * Pass 2 — incentive expiry:     runs only when config is active.
 * Paid credits:                  never processed, structurally excluded.
 */
export async function runExpiryCheck(): Promise<ExpiryResult> {
  // Load incentive config once before iterating
  const incentiveConfig = await getIncentiveExpiryConfig();

  if (incentiveConfig.enabled) {
    console.log(
      `[creditExpiry] incentive expiry enabled — window: ${incentiveConfig.expiryDays ?? 'unset'} days`,
    );
  }

  const profiles = await findExpiredProfiles();

  let processed             = 0;
  let expired               = 0;
  let totalExpiredCredits   = 0;
  let incentiveExpiredTotal = 0;
  let errors                = 0;

  // Build a unique org list from free profiles (profiles may duplicate org if
  // multiple users share an org)
  const orgsProcessed = new Set<string>();

  for (const profile of profiles) {
    if (!profile.organization_id) continue;

    processed++;
    try {
      const amount = await expireOrgFreeCredits(
        profile.organization_id,
        profile.user_id,
        profile.initial_credits,
        profile.credit_expiry_at,
      );

      if (amount > 0) {
        expired++;
        totalExpiredCredits += amount;
      }

      orgsProcessed.add(profile.organization_id);
    } catch (err: any) {
      console.error(`[creditExpiry] free expiry error for ${profile.organization_id}:`, err?.message);
      errors++;
    }
  }

  // Pass 2: incentive expiry (config-gated, paid never touched)
  if (incentiveConfig.enabled && incentiveConfig.expiryDays != null) {
    for (const orgId of orgsProcessed) {
      try {
        const incentiveExpired = await expireOrgIncentiveCredits(
          orgId,
          incentiveConfig.expiryDays,
        );
        incentiveExpiredTotal += incentiveExpired;
      } catch (err: any) {
        console.error(`[creditExpiry] incentive expiry error for ${orgId}:`, err?.message);
        errors++;
      }
    }
  }

  return {
    processed,
    expired,
    total_expired_credits: totalExpiredCredits,
    incentive_expired:     incentiveExpiredTotal,
    errors,
  };
}
