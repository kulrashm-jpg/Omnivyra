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
  const { data: config } = await ownedDbTable('free_credit_config')
    .select('credits, expiry_days, is_active')
    .eq('category', INITIAL_FREE_CREDIT_CATEGORY)
    .maybeSingle();

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

  const [{ data: existingClaim }, { data: existingLedgerRow }, { data: companyRow }] =
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

  // ── Bookkeeping branch — ledger row exists, but claim/stamp/category drift ─
  // Self-heal without touching the wallet (the credit was already granted).
  if (existingLedgerRow) {
    const ledgerRow = existingLedgerRow as { id: string; free_delta?: number | null; category?: string | null };
    const ledgerCredits = Math.abs(ledgerRow.free_delta ?? credits);

    // Repair miscategorized ledger row (legacy default 'paid' bug).
    if (ledgerRow.category !== 'free') {
      await ownedDbTable('credit_transactions')
        .update({ category: 'free' })
        .eq('id', ledgerRow.id);
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
      await ownedDbTable('companies')
        .update({ free_credit_granted_at: new Date().toISOString() })
        .eq('id', input.orgId)
        .is('free_credit_granted_at', null);
    }

    return { granted: false, reason: 'already_claimed' };
  }

  // Claim row present but no ledger row — defensive. Don't double-grant.
  if (existingClaim) {
    return { granted: false, reason: 'already_claimed' };
  }

  // ── Ensure organization_credits row exists for the org ───────────────────
  await ownedDbTable('organization_credits').upsert(
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
  await ownedDbTable('companies')
    .update({ free_credit_granted_at: new Date().toISOString() })
    .eq('id', input.orgId)
    .is('free_credit_granted_at', null);

  return { granted: true, credits, expiresAt };
}
