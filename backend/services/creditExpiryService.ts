import { ownedDbTable } from '../db/writeOwner';
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
  // MONEY: a failed read is not "no wallet". Before an expiry it decides how
  // much to expire; after it, it is the paid-balance invariant check - a
  // swallowed error there silently skipped EXPIRY_CATEGORY_VIOLATION. Throw: the
  // per-org catch in runExpiryCheck counts it as an error.
  const { data, error } = await ownedDbTable('organization_credits')
    .select('free_balance, paid_balance, incentive_balance')
    .eq('organization_id', orgId)
    .maybeSingle();
  if (error) throw new Error(`[creditExpiry] wallet read failed for ${orgId}: ${error.message}`);
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

  const { data, error } = await ownedDbTable('free_credit_profiles')
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
  // best-effort, customer-safe direction: a failed read leaves incentive expiry
  // OFF for this run (nothing is expired on an unread config). Logged.
  const { data, error } = await ownedDbTable('free_credit_config')
    .select('is_active, expiry_days')
    .eq('category', 'incentive_expiry')
    .maybeSingle();
  if (error) {
    console.error('[creditExpiry] incentive_expiry config read failed - incentive expiry skipped this run:', error.message);
    return { enabled: false, expiryDays: null };
  }

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
  // ── Runtime guard 1: idempotency key - ONE free expiry per ORG ───────────
  // CLASS 2 (2026-11-12): the key was per org per profile-DAY. Guard 1b below
  // enforces "one free expiry per org" with a plain READ, so two overlapping
  // cron runs handling different profiles of one org (different day keys) both
  // passed it and expired twice. The key is now per ORG, so the ledger's unique
  // idempotency_key makes the second write a no-op (apply_credit_reservation
  // returns the existing row on a duplicate key). Rows written under the OLD
  // per-day key are still honoured by guard 1b (business identity, any key).
  const dayKey = expiredAt.slice(0, 10); // YYYY-MM-DD (note text only)
  const idempotencyKey = createHash('sha256')
    .update(`expire:free:org:${orgId}`)
    .digest('hex')
    .slice(0, 32);

  // A failed read is not "not yet expired this window". Throw (per-org error).
  const { data: existing, error: existingErr } = await ownedDbTable('credit_transactions')
    .select('id')
    .eq('idempotency_key', idempotencyKey)
    .maybeSingle();
  if (existingErr) throw new Error(`[creditExpiry] idempotency read failed for ${orgId}: ${existingErr.message}`);

  if (existing) return 0; // this org's free expiry already exists (per-org key)

  // ── Runtime guard 1b: at most ONE free expiry per ORG (2026-11-12, e1/05) ──
  // free_credit_profiles is UNIQUE per USER (several profiles per org are
  // allowed) and each carries initial_credits + its own expiry date, while the
  // onboarding grant is ONE per org. Keyed per profile date, an org with N
  // profiles had the initial amount expired up to N times - capped only by the
  // free balance, so it drained free credits from other sources. Until expiry
  // is rebuilt on lot accounting (grant / consumed / expired per lot), refuse
  // any further free expiry for an org that already has one. This respects
  // every row written under the existing key (no key-format change).
  const { data: priorFreeExpiry, error: priorErr } = await ownedDbTable('credit_transactions')
    .select('id')
    .eq('organization_id', orgId)
    .eq('execution_phase', 'expire')
    .eq('reference_type', 'expiry')
    .limit(1)
    .maybeSingle();
  if (priorErr) throw new Error(`[creditExpiry] prior-expiry read failed for ${orgId}: ${priorErr.message}`);
  if (priorFreeExpiry) return 0; // this org's single free grant has already been expired

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

  // best-effort: the expiry itself is the ledger row written by the RPC above;
  // this is the history row. A failure is logged with the amounts.
  const { error: freeLogErr } = await ownedDbTable('credit_expiry_log').insert({
    organization_id: orgId,
    user_id:         userId,
    amount_expired:  expired,
    balance_before:  before.free_balance,
    balance_after:   before.free_balance - expired,
    reason:          `free_credit_expiry:${dayKey}`,
  });
  if (freeLogErr) console.error(`[creditExpiry] expiry log write failed for ${orgId} (expired ${expired}):`, freeLogErr.message);

  return expired;
}

// ── Incentive expiry (config-gated) ──────────────────────────────────────────

/**
 * Expire incentive credits older than expiryDays for one org.
 * Only called when incentive_expiry config is active.
 * Paid balance is never touched — guarded at DB level by phase='expire_incentive'.
 */
/** See expireOrgIncentiveCredits: flip to false only together with FIFO lot accounting. */
const INCENTIVE_EXPIRY_REFUSED_UNTIL_FIFO = true;

async function expireOrgIncentiveCredits(
  orgId:      string,
  expiryDays: number,
): Promise<number> {
  // REFUSED BY DESIGN (2026-11-12, e1/05) until FIFO lot accounting lands.
  // The amount below is the sum of ALL incentive grants older than the window,
  // with nothing subtracted for credits already consumed or expired; capped by
  // the current balance, a later day's run expires credits YOUNGER than the
  // window (grant 100 long ago, spend 60, expire 40; receive 30 today; tomorrow
  // the cap expires the new 30). The only thing keeping it off was the
  // free_credit_config 'incentive_expiry' row (is_active=false), which any
  // direct DB write can flip - so the refusal lives HERE. Remove it in the same
  // change that lands FIFO accounting.
  if (INCENTIVE_EXPIRY_REFUSED_UNTIL_FIFO) throw new Error(
    'INCENTIVE_EXPIRY_REFUSED: incentive expiry would expire credits younger than its window '
    + '(grants are not netted against consumption / prior expiry - FIFO lot accounting required). '
    + `Not expiring incentive credits for org ${orgId} (window ${expiryDays}d).`,
  );

  const dayKey = new Date().toISOString().slice(0, 10);
  const idempotencyKey = createHash('sha256')
    .update(`expire:incentive:${orgId}:${dayKey}`)
    .digest('hex')
    .slice(0, 32);

  // A failed read is not "not yet expired this window". Throw (per-org error).
  const { data: existing, error: existingErr } = await ownedDbTable('credit_transactions')
    .select('id')
    .eq('idempotency_key', idempotencyKey)
    .maybeSingle();
  if (existingErr) throw new Error(`[creditExpiry] idempotency read failed for ${orgId}: ${existingErr.message}`);

  if (existing) return 0;

  // Compute how many incentive credits were granted before the expiry window
  const cutoff = new Date(Date.now() - expiryDays * 86400_000).toISOString();

  const { data: grantRows, error: grantErr } = await ownedDbTable('credit_transactions')
    .select('incentive_delta')
    .eq('organization_id', orgId)
    .eq('execution_phase', 'grant')
    .lt('created_at', cutoff)
    .gt('incentive_delta', 0);
  if (grantErr) throw new Error(`[creditExpiry] incentive grant read failed for ${orgId}: ${grantErr.message}`);

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

  // best-effort: see the free-expiry history row above.
  const { error: incLogErr } = await ownedDbTable('credit_expiry_log').insert({
    organization_id: orgId,
    user_id:         null,
    amount_expired:  toExpire,
    balance_before:  before.incentive_balance,
    balance_after:   before.incentive_balance - toExpire,
    reason:          `incentive_credit_expiry:${dayKey}`,
  });
  if (incLogErr) console.error(`[creditExpiry] incentive expiry log write failed for ${orgId} (expired ${toExpire}):`, incLogErr.message);

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
