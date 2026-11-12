/**
 * Referral completion at company setup (extracted from pages/api/onboarding/
 * setup-company.ts, 2026-11-12) so it can be tested on its own.
 *
 * CLASS 1 + 2 fixes:
 *  - The lookup was `.eq(referral_code).eq(status, 'pending').maybeSingle()`
 *    with its error unread. A referrer has ONE code and one pending row per
 *    invited email (UNIQUE (referral_code, invited_email)), so a referrer who
 *    invited two or more people made maybeSingle ERROR - read as "no referral"
 *    and the referrer was silently never credited.
 *  - Which row (05, 2026-11-12): NEVER an arbitrary pending row - that consumed
 *    someone ELSE's named invite (row says invited_email = alice, referee = bob;
 *    Alice's later signup then credits nobody). Tiers:
 *      0. heal: a row this code already COMPLETED for THIS user (a grant that
 *         failed after the CAS) is re-granted - idempotent per referral id, and
 *         pinned to this referee so no other signup can claim it;
 *      a. a pending row invited for this user's email (exact eq - never a
 *         first-N window that may not contain it);
 *      b. else the OLDEST pending code-only row (invited_email IS NULL - a
 *         shared link; NULLs are distinct in the UNIQUE, so several may exist);
 *      c. else complete NOTHING -> 'no_matching_invite'.
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
  | { status: 'no_matching_invite' }
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

  type RefRow = { id: string; referrer_user_id: string; referrer_org_id: string; invited_email: string | null };
  const cols = 'id, referrer_user_id, referrer_org_id, status, invited_email';
  const readFailed = (message: string): ReferralOutcome => {
    console.error('[referralCompletion] referral read failed - referral not processed:', code, message);
    return { status: 'failed', step: 'read', message };
  };

  // Tier 0 - heal a completion whose grant failed (same referee only).
  const { data: mine, error: mineErr } = await args.db
    .from('referrals').select(cols)
    .eq('referral_code', code).eq('status', 'completed').eq('referee_user_id', args.userId)
    .limit(1);
  if (mineErr) return readFailed(mineErr.message);
  const healed = ((mine ?? []) as RefRow[])[0];
  if (healed) {
    const regrant = await grantEarnCredit({
      orgId: healed.referrer_org_id, userId: healed.referrer_user_id, actionType: 'referral_signup', referenceId: healed.id,
    });
    return { status: 'completed', referralId: healed.id, granted: regrant.granted || regrant.reason === 'already_granted' };
  }

  // Tier a - the invite for THIS email.
  const email = (args.userEmail ?? '').trim().toLowerCase();
  let referral: RefRow | undefined;
  if (email) {
    const { data: invited, error: invitedErr } = await args.db
      .from('referrals').select(cols)
      .eq('referral_code', code).eq('status', 'pending').eq('invited_email', email)
      .limit(1);
    if (invitedErr) return readFailed(invitedErr.message);
    referral = ((invited ?? []) as RefRow[])[0];
  }
  // Tier b - the oldest code-only (shared-link) row.
  if (!referral) {
    const { data: shared, error: sharedErr } = await args.db
      .from('referrals').select(cols)
      .eq('referral_code', code).eq('status', 'pending').is('invited_email', null)
      .order('created_at', { ascending: true })
      .limit(1);
    if (sharedErr) return readFailed(sharedErr.message);
    referral = ((shared ?? []) as RefRow[])[0];
  }
  // Tier c - nothing that belongs to this signup: consume no one's invite.
  if (!referral) return { status: 'no_matching_invite' };
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
  return { status: 'completed', referralId: referral.id, granted: grant.granted || grant.reason === 'already_granted' };
}
