/**
 * Credit Expiry Service
 *
 * Daily job: finds organizations with expired free credits and expires them
 * via a ledger debit entry.  The DB function expire_org_free_credits
 * (apply_credit_reservation with phase='expire') handles the balance mutation
 * atomically.
 *
 * Expiry source of truth: free_credit_profiles.credit_expiry_at
 *
 * Called by: POST /api/cron/credit-expiry (daily, via Vercel/Railway cron)
 */

import { supabase } from '../db/supabaseClient';
import { createHash } from 'crypto';

export interface ExpiryResult {
  processed:  number;   // orgs evaluated
  expired:    number;   // orgs with credits actually expired
  total_expired_credits: number;
  errors:     number;
}

/**
 * Find free_credit_profiles rows where credit_expiry_at has passed
 * and the org still has a positive free_balance.
 */
async function findExpiredProfiles(): Promise<Array<{
  user_id:         string;
  organization_id: string | null;
  initial_credits: number;
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

/**
 * Expire free credits for one org.
 * Returns the number of credits actually expired (may be less than initialCredits
 * if the org already spent some).
 */
async function expireOrgFreeCredits(
  orgId:  string,
  userId: string,
  amount: number,
  expiredAt: string,
): Promise<number> {
  // Idempotency: one expiry per org per expiry date
  const dayKey = expiredAt.slice(0, 10); // YYYY-MM-DD
  const idempotencyKey = createHash('sha256')
    .update(`expire:${orgId}:${dayKey}`)
    .digest('hex')
    .slice(0, 32);

  // Check if already expired
  const { data: existing } = await supabase
    .from('credit_transactions')
    .select('id')
    .eq('idempotency_key', idempotencyKey)
    .maybeSingle();

  if (existing) return 0; // already processed

  // Call DB function to atomically expire credits
  const { data: amountExpired, error } = await supabase.rpc(
    'expire_org_free_credits',
    { p_org_id: orgId, p_amount: amount, p_note: `Free credit expiry (${dayKey})` },
  );

  if (error) {
    console.error(`[creditExpiry] DB expiry failed for ${orgId}:`, error.message);
    return 0;
  }

  const expired = (amountExpired as number) ?? 0;
  if (expired === 0) return 0;

  // Audit: insert expiry transaction record with idempotency key
  await supabase.from('credit_transactions').upsert({
    organization_id:  orgId,
    transaction_type: 'deduction',
    credits_delta:    -expired,
    free_delta:       -expired,
    reference_type:   'expiry',
    note:             `Free credit expiry (${dayKey})`,
    performed_by:     userId,
    idempotency_key:  idempotencyKey,
    execution_phase:  'expire',
    category:         'free',
  }, { onConflict: 'idempotency_key' });

  // Log to credit_expiry_log
  await supabase.from('credit_expiry_log').insert({
    organization_id: orgId,
    user_id:         userId,
    amount_expired:  expired,
    balance_before:  expired,   // approximation — exact tracked in transaction
    balance_after:   0,
    reason:          `free_credit_expiry:${dayKey}`,
  });

  return expired;
}

/**
 * Main entry point for the daily cron job.
 * Processes all orgs with expired free credit profiles.
 */
export async function runExpiryCheck(): Promise<ExpiryResult> {
  const profiles = await findExpiredProfiles();

  let processed = 0;
  let expired   = 0;
  let totalExpiredCredits = 0;
  let errors    = 0;

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
    } catch (err: any) {
      console.error(`[creditExpiry] unexpected error for ${profile.organization_id}:`, err?.message);
      errors++;
    }
  }

  return { processed, expired, total_expired_credits: totalExpiredCredits, errors };
}
