/**
 * Initial Free Credit Service — single source of truth for the one-time
 * free-credit grant a brand-new organization receives at signup.
 *
 * Replaces the two inline implementations that previously lived in
 *   pages/api/onboarding/complete.ts        (category 'initial_free_credit', 300)
 *   pages/api/onboarding/setup-company.ts   (category 'initial', 300)
 * which had divergent categories, amounts, and side effects.
 *
 * The new model:
 *   • Default amount: 50 credits, 14-day expiry. Overridable via the
 *     free_credit_config table (category = 'initial_free_credit').
 *   • Category written to free_credit_claims: 'initial_free_credit'.
 *   • Idempotent at app + DB layers — the partial UNIQUE index on
 *     free_credit_claims(organization_id) WHERE category='initial_free_credit'
 *     enforces one grant per org regardless of how many code paths fire.
 *   • Earn-more credits (referral, feedback, setup, etc.) continue to flow
 *     through earnCreditsService.ts and are additive on top of the 50.
 */

import { supabase } from '../db/supabaseClient';
import { createCredit, makeIdempotencyKey } from './creditExecutionService';
import { logger } from './logger';

export const INITIAL_FREE_CREDIT_CATEGORY = 'initial_free_credit';
const INITIAL_FREE_CREDIT_DEFAULT = 50;
const INITIAL_FREE_CREDIT_EXPIRY_DAYS_DEFAULT = 14;

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
  // ── Idempotency check at app layer (DB UNIQUE is the final guardrail) ────
  const { data: existingClaim } = await supabase
    .from('free_credit_claims')
    .select('id, credits_granted')
    .eq('organization_id', input.orgId)
    .eq('category', INITIAL_FREE_CREDIT_CATEGORY)
    .maybeSingle();

  if (existingClaim) {
    return { granted: false, reason: 'already_claimed' };
  }

  // ── Read amount + expiry from config; fall back to defaults ──────────────
  const { data: config } = await supabase
    .from('free_credit_config')
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

  // ── Ensure organization_credits row exists for the org ───────────────────
  await supabase.from('organization_credits').upsert(
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
      idempotencyKey: makeIdempotencyKey(input.orgId, INITIAL_FREE_CREDIT_CATEGORY, input.orgId),
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
  const { error: claimErr } = await supabase.from('free_credit_claims').insert({
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
  await supabase
    .from('companies')
    .update({ free_credit_granted_at: new Date().toISOString() })
    .eq('id', input.orgId)
    .is('free_credit_granted_at', null);

  return { granted: true, credits, expiresAt };
}
