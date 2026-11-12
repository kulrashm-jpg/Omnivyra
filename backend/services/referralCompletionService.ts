/**
 * Referral completion at company setup (extracted from pages/api/onboarding/
 * setup-company.ts, 2026-11-12) so it can be tested on its own.
 *
 * CLASS 1 + 2 fixes:
 *  - The lookup was `.eq(referral_code).eq(status, 'pending').maybeSingle()`
 *    with its error unread. A referrer has ONE code and one pending row per
 *    invited email (UNIQUE (referral_code, invited_email)), so a referrer who
 *    invited two or more people made maybeSingle ERROR - read as "no referral"
 *    and the referrer was silently never credited. Now: list the pending rows,
 *    prefer the one invited for this user's email, else the first.
 *  - The completion was an update BY ID ONLY: two signups with the same code
 *    both "completed" it and the second overwrote the referee. Now a CAS on
 *    status 'pending' with a row count; the grant runs only for the winner
 *    (grantEarnCredit is also idempotent per referral id).
 * Best-effort by design: company setup never fails on a referral; every
 * failure is logged and reported in the outcome.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { grantEarnCredit } from './earnCreditsService';

export type ReferralOutcome =
  | { status: 'none' }
  | { status: 'self_referral' }
  | { status: 'completed'; referralId: string; granted: boolean }
  | { status: 'lost_race'; referralId: string }
  | { status: 'failed'; step: 'read' | 'complete'; message: string };

export async function completeSignupReferral(args: {
  db: Pick<SupabaseClient, 'from'>;
  refCode: string;
  userId: string;
  userEmail: string | null | undefined;
  companyId: string;
  now: string;
}): Promise<ReferralOutcome> {
  const code = args.refCode.trim().toLowerCase();
  if (!code) return { status: 'none' };

  const { data: rows, error: readErr } = await args.db
    .from('referrals')
    .select('id, referrer_user_id, referrer_org_id, status, invited_email')
    .eq('referral_code', code)
    .eq('status', 'pending')
    .limit(50);
  if (readErr) {
    console.error('[referralCompletion] pending referral read failed - referral not processed:', code, readErr.message);
    return { status: 'failed', step: 'read', message: readErr.message };
  }
  const pending = (rows ?? []) as Array<{ id: string; referrer_user_id: string; referrer_org_id: string; invited_email: string | null }>;
  if (pending.length === 0) return { status: 'none' };

  const email = (args.userEmail ?? '').trim().toLowerCase();
  const referral = pending.find((r) => email && (r.invited_email ?? '').toLowerCase() === email) ?? pending[0];
  if (referral.referrer_user_id === args.userId) return { status: 'self_referral' };

  const { data: completed, error: completeErr } = await args.db
    .from('referrals')
    .update({
      status:          'completed',
      referee_user_id: args.userId,
      referee_org_id:  args.companyId,
      completed_at:    args.now,
    })
    .eq('id', referral.id)
    .eq('status', 'pending')
    .select('id');
  if (completeErr) {
    console.error('[referralCompletion] referral completion write failed:', referral.id, completeErr.message);
    return { status: 'failed', step: 'complete', message: completeErr.message };
  }
  if (!Array.isArray(completed) || completed.length !== 1) {
    return { status: 'lost_race', referralId: referral.id };
  }

  const grant = await grantEarnCredit({
    orgId:       referral.referrer_org_id,
    userId:      referral.referrer_user_id,
    actionType:  'referral_signup',
    referenceId: referral.id,
  });
  return { status: 'completed', referralId: referral.id, granted: grant.granted };
}
