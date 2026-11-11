import { ownedDbTable } from '../db/writeOwner';
/**
 * Earn-more credits service.
 *
 * Actions and amounts:
 *   referral_signup          +200  — invited friend creates a new company account
 *   feedback_approved        +100  — super admin approves submitted feedback
 *   setup_complete           +100  — all 5 setup sub-steps done
 *   website_connected        +150  — blog + lead capture page both connected
 *   first_campaign_published +200  — first campaign post scheduled to any social platform
 *
 * Credits are granted to the ORGANIZATION (not the individual user).
 * All active members of the org are notified.
 */

import { supabase } from '../db/supabaseClient';
import { createCredit, makeIdempotencyKey } from './creditExecutionService';

// ── Action catalogue ──────────────────────────────────────────────────────────

export const EARN_ACTIONS = {
  referral_signup:          { credits: 200, label: 'Invite a friend' },
  feedback_approved:        { credits: 100, label: 'Share feedback' },
  setup_complete:           { credits: 100, label: 'Complete your setup' },
  website_connected:        { credits: 150, label: 'Connect website or social' },
  first_campaign_published: { credits: 200, label: 'Create your first campaign' },
} as const;

export type EarnActionType = keyof typeof EARN_ACTIONS;

// ── Grant credits for a completed action ────────────────────────────────────

export async function grantEarnCredit(params: {
  orgId:        string;
  userId:       string;
  actionType:   EarnActionType;
  referenceId?: string;
}): Promise<{ granted: boolean; credits: number }> {
  const { orgId, userId, actionType, referenceId } = params;
  const action = EARN_ACTIONS[actionType];
  const refId  = referenceId ?? actionType;

  // Idempotency: never grant twice for same org + action + reference
  // MONEY: a failed read is not "not yet granted" (the ledger key would stop a
  // double credit, but the action record and the "you earned" notification
  // would be duplicated). Refuse - this writes NOTHING, so the next completion
  // of the action retries cleanly.
  const { data: existing, error: existingErr } = await ownedDbTable('earn_credit_actions')
    .select('id')
    .eq('organization_id', orgId)
    .eq('action_type', actionType)
    .eq('reference_id', refId)
    .maybeSingle();
  if (existingErr) {
    console.error('[earnCreditsService] idempotency read failed - not granted this time:', actionType, existingErr.message);
    return { granted: false, credits: 0 };
  }

  if (existing) return { granted: false, credits: 0 };

  try {
    await createCredit({
      orgId,
      amount:         action.credits,
      category:       'paid', // approved policy: promo / earn / referral / package incentives → PAID (never expire, consumed after FREE, subscription-locked). No future 'incentive' allocations.
      referenceType:  actionType,
      referenceId:    refId,
      note:           `Earn more: ${action.label}`,
      performedBy:    userId,
      idempotencyKey: makeIdempotencyKey(orgId, actionType, refId),
    });

    // best-effort: the credit is granted (ledger, idempotent key). If this
    // record is not written the next call re-enters, the ledger key prevents a
    // second credit, and the record is written then. Logged.
    const { error: recordErr } = await ownedDbTable('earn_credit_actions').insert({
      organization_id: orgId,
      user_id:         userId,
      action_type:     actionType,
      credits_granted: action.credits,
      reference_id:    refId,
    });
    if (recordErr) console.error('[earnCreditsService] earn action record write failed (credit granted):', actionType, recordErr.message);

    // Notify all active org members
    await notifyEarnCreditsGranted(orgId, actionType, action.credits);

    return { granted: true, credits: action.credits };
  } catch (err: any) {
    console.error('[earnCreditsService] grant failed:', actionType, err.message);
    return { granted: false, credits: 0 };
  }
}

// ── Progress nudge notification ──────────────────────────────────────────────

export async function notifyEarnProgress(params: {
  orgId:      string;
  actionType: EarnActionType;
  message:    string;
}): Promise<void> {
  const { orgId, actionType, message } = params;
  const action = EARN_ACTIONS[actionType];

  // Don't nudge if already earned. best-effort: on a failed read send NO nudge
  // (never nudge for credits that may already be earned); logged.
  const { data: existing, error: existingErr } = await ownedDbTable('earn_credit_actions')
    .select('id')
    .eq('organization_id', orgId)
    .eq('action_type', actionType)
    .maybeSingle();
  if (existingErr) {
    console.error('[earnCreditsService] nudge check read failed - no nudge sent:', actionType, existingErr.message);
    return;
  }

  if (existing) return;

  const userIds = await getOrgAdminUserIds(orgId);
  if (!userIds.length) return;

  const { error: nudgeErr } = await ownedDbTable('notifications').insert(
    userIds.map(uid => ({
      user_id:  uid,
      type:     'earn_credits_nudge',
      title:    `Earn +${action.credits} credits`,
      message,
      metadata: { action_type: actionType, credits: action.credits },
      is_read:  false,
    })),
  );
  if (nudgeErr) console.error('[earnCreditsService] nudge notification write failed:', actionType, nudgeErr.message);
}

// ── Get earn progress for an org ─────────────────────────────────────────────

export async function getEarnProgress(orgId: string): Promise<{
  actions: Array<{
    type:       EarnActionType;
    label:      string;
    credits:    number;
    granted:    boolean;
    granted_at: string | null;
  }>;
  total_earned:    number;
  total_available: number;
}> {
  // A failed read is not "nothing earned" (the page would offer credits the org
  // already has). Throw - the progress route answers 5xx.
  const { data: granted, error: grantedErr } = await ownedDbTable('earn_credit_actions')
    .select('action_type, granted_at')
    .eq('organization_id', orgId);
  if (grantedErr) throw new Error(`[earnCreditsService] earn progress read failed: ${grantedErr.message}`);

  const grantedMap = new Map(
    (granted ?? []).map(r => [r.action_type as string, r.granted_at as string]),
  );

  const actions = (
    Object.entries(EARN_ACTIONS) as [EarnActionType, { credits: number; label: string }][]
  ).map(([type, { credits, label }]) => ({
    type,
    label,
    credits,
    granted:    grantedMap.has(type),
    granted_at: grantedMap.get(type) ?? null,
  }));

  return {
    actions,
    total_earned:    actions.filter(a => a.granted).reduce((s, a) => s + a.credits, 0),
    total_available: actions.filter(a => !a.granted).reduce((s, a) => s + a.credits, 0),
  };
}

// ── Check and grant setup_complete + website_connected ──────────────────────

export async function checkAndGrantSetupCredits(
  orgId:  string,
  userId: string,
): Promise<{ setup_credits: number; website_credits: number }> {
  // A failed read is not "steps not done" (the grant would be silently skipped
  // and the caller told 0 credits). Throw: the step itself is already saved, so
  // the next setup-progress call re-evaluates the grant.
  const { data: setupRow, error: setupErr } = await ownedDbTable('company_setup_progress')
    .select('profile_complete, external_api_connected, social_accounts_connected, website_blog_connected, lead_capture_connected')
    .eq('company_id', orgId)
    .maybeSingle();
  if (setupErr) throw new Error(`[earnCreditsService] setup progress read failed: ${setupErr.message}`);

  const { count: socialCount, error: socialErr } = await ownedDbTable('social_accounts')
    .select('id', { count: 'exact', head: true })
    .eq('company_id', orgId);
  if (socialErr) throw new Error(`[earnCreditsService] social account count failed: ${socialErr.message}`);

  const row = (setupRow as any) ?? {};
  const steps = {
    profile_complete:          !!row.profile_complete,
    external_api_connected:    !!row.external_api_connected,
    social_accounts_connected: (socialCount ?? 0) > 0 || !!row.social_accounts_connected,
    website_blog_connected:    !!row.website_blog_connected,
    lead_capture_connected:    !!row.lead_capture_connected,
  };

  let setup_credits  = 0;
  let website_credits = 0;

  // setup_complete: all 5 steps done
  if (Object.values(steps).every(Boolean)) {
    const r = await grantEarnCredit({ orgId, userId, actionType: 'setup_complete' });
    setup_credits = r.credits;
  }

  // website_connected: blog + lead capture both done
  if (steps.website_blog_connected && steps.lead_capture_connected) {
    const r = await grantEarnCredit({ orgId, userId, actionType: 'website_connected' });
    website_credits = r.credits;
  }

  return { setup_credits, website_credits };
}

// ── Internal helpers ─────────────────────────────────────────────────────────

/** Only COMPANY_ADMIN manages credits — notifications go to them only. */
async function getOrgAdminUserIds(orgId: string): Promise<string[]> {
  // best-effort (notifications only): a failed read notifies nobody; logged.
  const { data, error } = await ownedDbTable('user_company_roles')
    .select('user_id')
    .eq('company_id', orgId)
    .eq('status', 'active')
    .eq('role', 'COMPANY_ADMIN');
  if (error) console.error('[earnCreditsService] org admin read failed - no notification:', orgId, error.message);
  return (data ?? []).map(r => r.user_id as string);
}

async function notifyEarnCreditsGranted(
  orgId:      string,
  actionType: EarnActionType,
  credits:    number,
): Promise<void> {
  const action  = EARN_ACTIONS[actionType];
  const userIds = await getOrgAdminUserIds(orgId);
  if (!userIds.length) return;

  const { error: grantedNoteErr } = await ownedDbTable('notifications').insert(
    userIds.map(uid => ({
      user_id:  uid,
      type:     'earn_credits_granted',
      title:    `+${credits} credits earned!`,
      message:  `You earned ${credits} credits for: ${action.label}`,
      metadata: { action_type: actionType, credits },
      is_read:  false,
    })),
  );
  if (grantedNoteErr) console.error('[earnCreditsService] granted notification write failed:', actionType, grantedNoteErr.message);
}
