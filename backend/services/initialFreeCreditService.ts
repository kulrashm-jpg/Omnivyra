import { ownedDbTable } from '../db/writeOwner';
/**
 * Initial Free Credit Service — single source of truth for the one-time
 * free-credit grant a brand-new organization receives at signup.
 *
 * Called from:
 *   pages/api/auth/sync-supabase-user.ts   (work-email self-serve signup,
 *                                           on first email verification)
 *   pages/api/onboarding/setup-company.ts  (free-email + invited paths,
 *                                           when the user creates/joins
 *                                           the company explicitly)
 *
 * The model:
 *   • Default amount: configurable via free_credit_config (category =
 *     'initial_free_credit'). Falls back to 50 credits / 14-day expiry
 *     if the config row is missing.
 *   • Category written to free_credit_claims: 'initial_free_credit'.
 *   • Idempotent at app + DB layers — the partial UNIQUE index on
 *     free_credit_claims(organization_id) WHERE category='initial_free_credit'
 *     enforces one grant per org regardless of how many code paths fire.
 *   • Earn-more credits (referral, feedback, setup, etc.) continue to flow
 *     through earnCreditsService.ts and are additive on top of the initial grant.
 */

import { supabase } from '../db/supabaseClient';
import { createCredit, makeIdempotencyKey } from './creditExecutionService';
import { logger } from './logger';

export const INITIAL_FREE_CREDIT_CATEGORY = 'initial_free_credit';
// Canonical signup grant per approved credit policy: 300 FREE credits, 30-day validity.
// Exported (AUTH-001 §12) so callers that pre-compute an "expected amount"
// (onboarding/complete.ts) share these instead of drifting stale copies.
export const INITIAL_FREE_CREDIT_DEFAULT = 300;
export const INITIAL_FREE_CREDIT_EXPIRY_DAYS_DEFAULT = 30;

export type InitialFreeCreditResult =
  | { granted: true; credits: number; expiresAt: string }
  | {
      granted: false;
      reason: 'already_claimed' | 'config_disabled' | 'grant_failed';
      message?: string;
    };

export async function grantInitialFreeCredit(input: {
  orgId: string;
  userId: string;
  emailDomain?: string | null;
}): Promise<InitialFreeCreditResult> {
  // ── Read amount + expiry from config; fall back to defaults ──────────────
  // Read first so the self-healing branch below has everything it needs to
  // reconcile a partial earlier run.
  // MONEY: a failed read is not "no config". Treating it as null granted the
  // DEFAULT amount even when the config disables the grant or sets another
  // amount. Fail closed as grant_failed: setup-company / onboarding/complete log
  // it, and the login-time reconciler (sync-supabase-user ->
  // reconcileInitialFreeCreditForUser) retries the grant on the next login.
  // Safe because this refusal writes NOTHING that could suppress that retry
  // (the retry is unconditional; idempotency lives inside the grant).
  // ACCEPTED COST (weighed 2026-11-12, e1/05): recovery is "next login", not
  // "soon", and the reconciler is fire-and-forget - a persistently unreadable
  // config means no credits with only an error log as the trace. Possibly-late
  // credits are recoverable; a wrong grant against a disabled config is not.
  const { data: config, error: configErr } = await ownedDbTable('free_credit_config')
    .select('credits, expiry_days, is_active')
    .eq('category', INITIAL_FREE_CREDIT_CATEGORY)
    .maybeSingle();
  if (configErr) {
    logger.error('initial_free_credit_config_read_failed', { orgId: input.orgId, message: configErr.message });
    return { granted: false, reason: 'grant_failed', message: 'Could not read the free-credit configuration.' };
  }

  if (config && (config as { is_active?: boolean }).is_active === false) {
    return {
      granted: false,
      reason: 'config_disabled',
      message: 'Initial free credits are currently disabled.',
    };
  }

  const credits = Number((config as { credits?: number } | null)?.credits ?? INITIAL_FREE_CREDIT_DEFAULT);
  const expiryDays = Number(
    (config as { expiry_days?: number } | null)?.expiry_days ?? INITIAL_FREE_CREDIT_EXPIRY_DAYS_DEFAULT,
  );
  const expiresAt = new Date(Date.now() + expiryDays * 86400 * 1000).toISOString();

  // ── Probe current state across all four authorities ─────────────────────
  // We read the ledger, the claim row, and the company stamp BEFORE deciding
  // whether to grant. The four states must agree end-to-end:
  //
  //   1. credit_transactions row with this idempotency key
  //   2. free_credit_claims row (organization_id, category)
  //   3. companies.free_credit_granted_at stamp
  //   4. organization_credits.lifetime_purchased reflects the credits
  //
  // Earlier code only checked #2 and short-circuited as 'already_claimed'.
  // That left a real-world drift: a grant that ran when only #1 existed
  // never repaired #2/#3 even though we re-entered this path. We now
  // self-heal in the bookkeeping branch below.
  const idempotencyKey = makeIdempotencyKey(input.orgId, INITIAL_FREE_CREDIT_CATEGORY, input.orgId);

  const [
    { data: existingClaim, error: claimReadErr },
    { data: existingLedgerRow, error: ledgerReadErr },
    { data: companyRow, error: companyReadErr },
  ] =
    await Promise.all([
      ownedDbTable('free_credit_claims')
        .select('id, credits_granted')
        .eq('organization_id', input.orgId)
        .eq('category', INITIAL_FREE_CREDIT_CATEGORY)
        .maybeSingle(),
      ownedDbTable('credit_transactions')
        .select('id, free_delta, category')
        .eq('idempotency_key', idempotencyKey)
        .maybeSingle(),
      ownedDbTable('companies')
        .select('free_credit_granted_at')
        .eq('id', input.orgId)
        .maybeSingle(),
    ]);

  // A failed probe is "unknown", not "absent": never decide grant-vs-repair on
  // an unread state (the ledger key keeps a re-grant idempotent, but the claim /
  // stamp repairs and the "already claimed" answer would be guesses). The
  // login-time reconciler retries.
  const probeErr = claimReadErr ?? ledgerReadErr ?? companyReadErr;
  if (probeErr) {
    logger.error('initial_free_credit_probe_failed', { orgId: input.orgId, message: probeErr.message });
    return { granted: false, reason: 'grant_failed', message: 'Could not read the free-credit state.' };
  }

  // ── Bookkeeping branch — ledger row exists, but claim/stamp/category drift ─
  // Self-heal without touching the wallet (the credit was already granted).
  if (existingLedgerRow) {
    const ledgerRow = existingLedgerRow as { id: string; free_delta?: number | null; category?: string | null };
    const ledgerCredits = Math.abs(ledgerRow.free_delta ?? credits);

    // Repair miscategorized ledger row (legacy default 'paid' bug).
    // best-effort repairs below: the credit was already granted; each failure is
    // logged so the drift stays visible (and the next login retries it).
    if (ledgerRow.category !== 'free') {
      const { error: catErr } = await ownedDbTable('credit_transactions')
        .update({ category: 'free' })
        .eq('id', ledgerRow.id);
      if (catErr) logger.warn('initial_free_credit_category_repair_failed', { orgId: input.orgId, message: catErr.message });
    }

    // Repair missing claim row.
    if (!existingClaim) {
      const { error: claimErr } = await ownedDbTable('free_credit_claims').insert({
        user_id:         input.userId,
        organization_id: input.orgId,
        category:        INITIAL_FREE_CREDIT_CATEGORY,
        credits_granted: ledgerCredits,
        domain:          input.emailDomain ?? null,
      });
      if (claimErr && (claimErr as { code?: string }).code !== '23505') {
        logger.warn('initial_free_credit_claim_repair_failed', {
          orgId:   input.orgId,
          message: claimErr.message,
        });
      }
    }

    // Repair missing company stamp (only if NULL — never overwrite later stamps).
    if (companyRow && !(companyRow as { free_credit_granted_at?: string | null }).free_credit_granted_at) {
      const { error: stampErr } = await ownedDbTable('companies')
        .update({ free_credit_granted_at: new Date().toISOString() })
        .eq('id', input.orgId)
        .is('free_credit_granted_at', null);
      if (stampErr) logger.warn('initial_free_credit_stamp_repair_failed', { orgId: input.orgId, message: stampErr.message });
    }

    return { granted: false, reason: 'already_claimed' };
  }

  // Claim row present but no ledger row — defensive. Don't double-grant.
  if (existingClaim) {
    return { granted: false, reason: 'already_claimed' };
  }

  // ── Ensure organization_credits row exists for the org ───────────────────
  // best-effort: if the wallet row cannot be ensured, createCredit below fails
  // and is reported as grant_failed; the upsert error itself is logged.
  const { error: walletEnsureErr } = await ownedDbTable('organization_credits').upsert(
    {
      organization_id:    input.orgId,
      free_balance:       0,
      paid_balance:       0,
      incentive_balance:  0,
      lifetime_purchased: 0,
      lifetime_consumed:  0,
      credit_rate_usd:    0.001,
    },
    { onConflict: 'organization_id', ignoreDuplicates: true },
  );
  if (walletEnsureErr) logger.warn('initial_free_credit_wallet_ensure_failed', { orgId: input.orgId, message: walletEnsureErr.message });

  // ── Grant via the credit ledger (idempotent on idempotency_key) ──────────
  try {
    await createCredit({
      orgId:          input.orgId,
      amount:         credits,
      category:       'free',
      referenceType:  'free_credits',
      referenceId:    input.orgId,
      note:           `Free credits — onboarding (expires ${expiresAt.slice(0, 10)})`,
      performedBy:    input.userId,
      idempotencyKey,
    });
  } catch (err) {
    logger.error('initial_free_credit_grant_failed', {
      orgId:   input.orgId,
      userId:  input.userId,
      message: err instanceof Error ? err.message : String(err),
    });
    return {
      granted: false,
      reason:  'grant_failed',
      message: 'Could not grant initial free credits.',
    };
  }

  // ── Log the claim — DB partial UNIQUE on (org, category) deduplicates ────
  const { error: claimErr } = await ownedDbTable('free_credit_claims').insert({
    user_id:         input.userId,
    organization_id: input.orgId,
    category:        INITIAL_FREE_CREDIT_CATEGORY,
    credits_granted: credits,
    domain:          input.emailDomain ?? null,
  });

  // 23505 = unique violation: a concurrent grant won the race. The credit
  // ledger insert was idempotent via idempotencyKey, so this is safe.
  if (claimErr && (claimErr as { code?: string }).code !== '23505') {
    logger.warn('initial_free_credit_claim_log_failed', {
      orgId:   input.orgId,
      userId:  input.userId,
      message: claimErr.message,
    });
  }

  // ── Stamp the org so admin/UI checks know it's been credited ─────────────
  // best-effort: the credit is granted; a missing stamp is repaired by the
  // bookkeeping branch on the next login. Logged.
  const { error: grantStampErr } = await ownedDbTable('companies')
    .update({ free_credit_granted_at: new Date().toISOString() })
    .eq('id', input.orgId)
    .is('free_credit_granted_at', null);
  if (grantStampErr) logger.warn('initial_free_credit_stamp_failed', { orgId: input.orgId, message: grantStampErr.message });

  return { granted: true, credits, expiresAt };
}
