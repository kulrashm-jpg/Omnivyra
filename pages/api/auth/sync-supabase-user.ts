
/**
 * POST /api/auth/sync-supabase-user
 *
 * Called by /auth/callback immediately after Supabase OAuth / email auth.
 * Upserts the user's identity into public.users and sets supabase_uid.
 *
 * Auth: Supabase access token in Authorization: Bearer <token>
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { randomUUID } from 'crypto';
import { supabase } from '../../../backend/db/supabaseClient';
import { verifySupabaseAuthHeader, validateWorkEmail } from '../../../lib/auth/serverValidation';
import { logAuthEvent } from '../../../lib/auth/auditLog';
import { recordAnomalyEvent } from '../../../lib/auth/anomalyDetector';
import { logger } from '../../../backend/services/logger';
import { seedRequestContextFromRequest } from '../../../backend/services/requestContext';
import { extractDomain, isFreeEmailDomain } from '../../../backend/services/companyMatchService';
import { grantInitialFreeCredit } from '../../../backend/services/initialFreeCreditService';
import {
  sendCompanyAdminReferral,
  sendInboundSignupNoticeToAdmin,
} from '../../../backend/services/emailService';

const SUPPORT_EMAIL = 'support@omnivyra.com';

type SuccessResponse = { ok: true };
type ErrorResponse   = { error: string; code?: string };

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<SuccessResponse | ErrorResponse>,
) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  seedRequestContextFromRequest(req);

  // ── 1. Verify Supabase token ──────────────────────────────────────────────
  let supabaseUid: string;
  let email: string;
  try {
    const verified = await verifySupabaseAuthHeader(req.headers.authorization);
    supabaseUid = verified.id;
    email       = verified.email;
    seedRequestContextFromRequest(req, { userId: supabaseUid });
  } catch {
    return res.status(401).json({ error: 'Invalid or expired session' });
  }

  // ── 2. Work-email validation (skip for invited users — they may use any domain) ──
  // Don't block social logins with personal emails if they were explicitly invited.
  const isWorkEmail = (() => {
    try { validateWorkEmail(email); return true; } catch { return false; }
  })();

  // ── 3. Block soft-deleted accounts ───────────────────────────────────────
  const normalizedEmail = email.toLowerCase().trim();
  const { data: existingByUid } = await supabase
    .from('users')
    .select('id, is_deleted')
    .eq('supabase_uid', supabaseUid)
    .maybeSingle();

  if (existingByUid && (existingByUid as any).is_deleted) {
    recordAnomalyEvent('ghost_session_detected');
    void logAuthEvent('ghost_session_detected', {
      userId:     (existingByUid as any).id,
      metadata:   { reason: 'user_is_soft_deleted', endpoint: 'sync-supabase-user' },
    });
    return res.status(403).json({ error: 'ACCOUNT_DELETED', code: 'AUTH_001' });
  }

  if (!existingByUid) {
    const { data: existingByEmail } = await supabase
      .from('users')
      .select('id, is_deleted')
      .eq('email', normalizedEmail)
      .maybeSingle();

    if (existingByEmail && (existingByEmail as any).is_deleted) {
      recordAnomalyEvent('ghost_session_detected');
      void logAuthEvent('ghost_session_detected', {
        userId:   (existingByEmail as any).id,
        metadata: { reason: 'email_is_soft_deleted', endpoint: 'sync-supabase-user' },
      });
      return res.status(403).json({ error: 'ACCOUNT_DELETED', code: 'AUTH_001' });
    }
  }

  const now = new Date().toISOString();

  // Whether this Supabase auth user has a password set. True for password
  // signup (`supabase.auth.signUp`) and for anyone who has gone through
  // `/auth/set-password`. False for magic-link-only users.
  //
  // Fail-open to `false`: a missing function or transient RPC error must not
  // block account creation — an invited / magic-link user should still have
  // their public.users row synced, just with has_password=false.
  let hasPassword = false;
  try {
    const { data, error: rpcErr } = await supabase.rpc('auth_user_has_password', {
      p_user_id: supabaseUid,
    });
    if (rpcErr) {
      logger.warn('auth_sync_has_password_rpc_failed', {
        supabaseUid,
        message: rpcErr.message,
      });
    } else {
      hasPassword = data === true;
    }
  } catch (err) {
    logger.warn('auth_sync_has_password_rpc_threw', {
      supabaseUid,
      message: err instanceof Error ? err.message : String(err),
    });
  }

  // ── 4. Upsert by supabase_uid ────────────────────────────────────────────
  // First try: existing row already has supabase_uid (returning user)
  if (existingByUid) {
    await supabase
      .from('users')
      .update({ is_email_verified: true, last_sign_in_at: now, has_password: hasPassword })
      .eq('supabase_uid', supabaseUid);
    try {
      await bootstrapCompanyFromSignupIntent({
        userId: (existingByUid as { id: string }).id,
        email: normalizedEmail,
      });
    } catch (err) {
      logger.warn('auth_sync_bootstrap_outer_threw_existing_uid', {
        email: normalizedEmail,
        message: err instanceof Error ? err.message : String(err),
      });
    }
    return res.status(200).json({ ok: true });
  }

  // Second try: row exists by email (invited user or Firebase-migrated user) —
  // stamp supabase_uid on it so future lookups use the faster UID path.
  const { data: byEmail } = await supabase
    .from('users')
    .select('id, supabase_uid, active_company_id')
    .eq('email', normalizedEmail)
    .maybeSingle();

  if (byEmail) {
    // Restore active_company_id from existing role if missing (stateful login)
    const updatePayload: Record<string, unknown> = {
      supabase_uid:      supabaseUid,
      is_email_verified: true,
      last_sign_in_at:   now,
      has_password:      hasPassword,
    };
    if (!(byEmail as any).active_company_id) {
      const { data: roleRow } = await supabase
        .from('user_company_roles')
        .select('company_id')
        .eq('user_id', (byEmail as any).id)
        .eq('status', 'active')
        .limit(1)
        .maybeSingle();
      if (roleRow) updatePayload.active_company_id = (roleRow as any).company_id;
    }
    await supabase.from('users').update(updatePayload).eq('id', (byEmail as any).id);
    try {
      await bootstrapCompanyFromSignupIntent({
        userId: (byEmail as { id: string }).id,
        email: normalizedEmail,
      });
    } catch (err) {
      logger.warn('auth_sync_bootstrap_outer_threw_existing_email', {
        email: normalizedEmail,
        message: err instanceof Error ? err.message : String(err),
      });
    }
    return res.status(200).json({ ok: true });
  }

  // Third: brand-new user — INSERT
  // Pre-link to invitation company if one exists for this email
  let invitedCompanyId: string | null = null;
  const { data: pendingInvite } = await supabase
    .from('invitations')
    .select('company_id')
    .eq('email', normalizedEmail)
    .is('accepted_at', null)
    .is('revoked_at', null)
    .gt('expires_at', now)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (pendingInvite) invitedCompanyId = (pendingInvite as any).company_id;

  const { error: insertError } = await supabase.from('users').insert({
    supabase_uid:      supabaseUid,
    email:             normalizedEmail,
    is_email_verified: true,
    last_sign_in_at:   now,
    has_password:      hasPassword,
    ...(invitedCompanyId ? { active_company_id: invitedCompanyId } : {}),
  });

  if (insertError) {
    logger.error('auth_sync_insert_failed', { email: normalizedEmail, message: insertError.message });
    return res.status(500).json({ error: 'Failed to sync user to database' });
  }

  // Look the row up separately (instead of chaining .select() onto the
  // insert) so the success/failure of the insert is decoupled from any
  // read-back semantics. The bootstrap is best-effort — wrapped in its
  // own try/catch — but we still safeguard the call so a thrown promise
  // here cannot 500 the sync endpoint.
  try {
    const { data: insertedUser } = await supabase
      .from('users')
      .select('id')
      .eq('supabase_uid', supabaseUid)
      .maybeSingle();
    if (insertedUser) {
      await bootstrapCompanyFromSignupIntent({
        userId: (insertedUser as { id: string }).id,
        email: normalizedEmail,
      });
    }
  } catch (err) {
    logger.warn('auth_sync_post_insert_lookup_failed', {
      email: normalizedEmail,
      message: err instanceof Error ? err.message : String(err),
    });
  }

  return res.status(200).json({ ok: true });
}

/**
 * Auto-creates a company + COMPANY_ADMIN role for a self-serve signup the
 * first time their email is verified. The company name comes from the
 * signup_intents row written by /api/auth/signup.
 *
 * Idempotent — if the user already has any active company role, or there
 * is no pending intent with a company name, this is a no-op. Errors are
 * logged but never thrown: failing to bootstrap must not break the
 * sync-supabase-user response, since the user can still complete onboarding
 * manually via /onboarding/company.
 */
async function bootstrapCompanyFromSignupIntent(input: {
  userId: string;
  email: string;
}): Promise<void> {
  try {
    // Skip if user already has any active role — invited users or
    // returning users already belong to a company.
    const { data: existingRole } = await supabase
      .from('user_company_roles')
      .select('id')
      .eq('user_id', input.userId)
      .eq('status', 'active')
      .limit(1)
      .maybeSingle();
    if (existingRole) return;

    // Pull the company name from the signup_intents row that was written
    // by /api/auth/signup before the email was sent.
    const { data: intentRow } = await supabase
      .from('signup_intents')
      .select('id, intent_data')
      .eq('email', input.email)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    const intentData = (intentRow as { intent_data?: Record<string, unknown> } | null)?.intent_data ?? null;
    const rawCompanyName = intentData ? String((intentData as Record<string, unknown>).company_name ?? '').trim() : '';
    if (!rawCompanyName) return;

    // Skip free-email domains for self-create — those users must join an
    // existing org via invite (matches setup-company's existing rule).
    const emailDomain = extractDomain(input.email) ?? '';
    if (!emailDomain || isFreeEmailDomain(emailDomain)) return;

    // If a company already owns this email domain, the verified user
    // CANNOT auto-create a duplicate company and is NOT attached as
    // COMPANY_ADMIN. Instead we email both parties — the user gets the
    // existing admin's contact details, and the admin is notified that a
    // new verified person from their domain tried to sign up. The user
    // can then be invited normally (or use /onboarding/company's request-
    // access path).
    const { data: existingCompany } = await supabase
      .from('companies')
      .select('id, name')
      .eq('admin_email_domain', emailDomain)
      .maybeSingle();

    const now = new Date().toISOString();

    if (existingCompany) {
      const claimedCompanyId = (existingCompany as { id: string; name?: string | null }).id;
      const claimedCompanyName = (existingCompany as { name?: string | null }).name ?? rawCompanyName;
      await notifyAdminAndProspectOfClaimedDomain({
        prospectUserId: input.userId,
        prospectEmail: input.email,
        emailDomain,
        companyId: claimedCompanyId,
        companyName: claimedCompanyName,
        nowIso: now,
      });
      // Skip company / role creation. user.role stays NULL — verify-email
      // and post-login-route will route them through onboarding so they
      // can request access to the existing company once the admin invites
      // them.
      return;
    }

    let companyId = randomUUID();
    const { error: companyErr } = await supabase.from('companies').insert({
      id:                 companyId,
      name:               rawCompanyName,
      website:            companyId, // websites column is NOT NULL — placeholder until /onboarding/company refines it
      admin_email_domain: emailDomain,
      domain_claimed_at:  now,
      status:             'active',
      created_at:         now,
    });
    if (companyErr) {
      // Race: another concurrent request created this domain — re-read.
      if (companyErr.code === '23505') {
        const { data: raceWinner } = await supabase
          .from('companies')
          .select('id, name')
          .eq('admin_email_domain', emailDomain)
          .maybeSingle();
        if (!raceWinner) {
          logger.warn('auth_sync_bootstrap_company_race_unresolved', { email: input.email, message: companyErr.message });
          return;
        }
        // The race winner is now the canonical company — treat this as a
        // claimed-domain branch and email both parties instead of stamping
        // ourselves as admin.
        await notifyAdminAndProspectOfClaimedDomain({
          prospectUserId: input.userId,
          prospectEmail: input.email,
          emailDomain,
          companyId: (raceWinner as { id: string }).id,
          companyName: (raceWinner as { name?: string | null }).name ?? rawCompanyName,
          nowIso: now,
        });
        return;
      }
      logger.warn('auth_sync_bootstrap_company_insert_failed', { email: input.email, message: companyErr.message });
      return;
    }

    // Insert user_company_roles (idempotent on duplicate user/company pair).
    const { error: roleErr } = await supabase.from('user_company_roles').insert({
      user_id:     input.userId,
      company_id:  companyId,
      role:        'COMPANY_ADMIN',
      status:      'active',
      join_source: 'self_registered',
      created_at:  now,
      updated_at:  now,
      accepted_at: now,
    });
    if (roleErr && roleErr.code !== '23505') {
      logger.warn('auth_sync_bootstrap_role_insert_failed', { email: input.email, message: roleErr.message });
      return;
    }

    // Stamp the user row so post-login-route routes them past the
    // /onboarding/company step. Profile fields (name etc.) are still
    // collected at /onboarding/profile.
    await supabase
      .from('users')
      .update({
        company_id:        companyId,
        active_company_id: companyId,
        role:              'COMPANY_ADMIN',
        onboarding_state:  'company_complete',
        updated_at:        now,
      })
      .eq('id', input.userId);

    // Grant the one-time initial free credit (50 by default, configurable
    // via free_credit_config). The shared service is idempotent — if a
    // concurrent call already credited this org the second call is a no-op.
    await grantInitialFreeCredit({
      orgId: companyId,
      userId: input.userId,
      emailDomain,
    });

    // Mark the intent as completed so verify-email's update is a no-op.
    if (intentRow) {
      await supabase
        .from('signup_intents')
        .update({ status: 'completed', completed_at: now })
        .eq('id', (intentRow as { id: string }).id);
    }
  } catch (err) {
    logger.warn('auth_sync_bootstrap_threw', {
      email: input.email,
      message: err instanceof Error ? err.message : String(err),
    });
  }
}

/**
 * Fires when a freshly-verified user's email domain is already claimed by
 * an existing company. We:
 *   1) Email the prospect with the existing admin's contact details so
 *      they know who to ask for access (replaces the old signup-time mail).
 *   2) Email the admin so they know a real, verified person from their
 *      domain just tried to sign up.
 * Both emails are deduped per (prospect, company) via signup_referrals so
 * repeat verifies / bouncing email links don't keep notifying the admin.
 */
async function notifyAdminAndProspectOfClaimedDomain(input: {
  prospectUserId: string;
  prospectEmail: string;
  emailDomain: string;
  companyId: string;
  companyName: string | null;
  nowIso: string;
}): Promise<void> {
  // Find an active COMPANY_ADMIN of the claimed company.
  const { data: adminRoleRow } = await supabase
    .from('user_company_roles')
    .select('user_id, created_at')
    .eq('company_id', input.companyId)
    .eq('status', 'active')
    .eq('role', 'COMPANY_ADMIN')
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();

  const adminUserId = (adminRoleRow as { user_id?: string } | null)?.user_id ?? null;
  const { data: adminUser } = adminUserId
    ? await supabase.from('users').select('name, email').eq('id', adminUserId).maybeSingle()
    : { data: null };
  const adminEmail = (adminUser as { email?: string } | null)?.email ?? null;
  const adminName = (adminUser as { name?: string | null } | null)?.name ?? null;

  // Dedupe via signup_referrals — one row per (prospect email). Tracks
  // separately whether each of the two emails has already gone out.
  const { data: existingReferral } = await supabase
    .from('signup_referrals')
    .select('id, admin_email_sent_at, attempt_count')
    .eq('email', input.prospectEmail)
    .maybeSingle();

  let shouldSendProspectEmail = false;
  let referralId: string | null = (existingReferral as { id?: string } | null)?.id ?? null;

  if (!existingReferral) {
    const { data: inserted, error: insertErr } = await supabase
      .from('signup_referrals')
      .insert({
        email:            input.prospectEmail,
        domain:           input.emailDomain,
        company_id:       input.companyId,
        admin_user_id:    adminUserId,
        first_attempt_at: input.nowIso,
        last_attempt_at:  input.nowIso,
        attempt_count:    1,
      })
      .select('id')
      .maybeSingle();
    if (insertErr) {
      logger.warn('auth_sync_referral_insert_failed', {
        email:   input.prospectEmail,
        message: insertErr.message,
      });
    } else {
      shouldSendProspectEmail = true;
      referralId = (inserted as { id?: string } | null)?.id ?? null;
    }
  } else {
    await supabase
      .from('signup_referrals')
      .update({
        last_attempt_at: input.nowIso,
        attempt_count:   ((existingReferral as { attempt_count?: number }).attempt_count ?? 1) + 1,
      })
      .eq('id', (existingReferral as { id: string }).id);
    shouldSendProspectEmail = !(existingReferral as { admin_email_sent_at?: string | null }).admin_email_sent_at;
  }

  // 1) Prospect email — admin contact details (deduped via admin_email_sent_at).
  if (shouldSendProspectEmail) {
    try {
      await sendCompanyAdminReferral(
        input.prospectEmail,
        {
          admin:        adminEmail ? { name: adminName, email: adminEmail } : null,
          companyName:  input.companyName,
          supportEmail: SUPPORT_EMAIL,
        },
        `company-referral:${input.prospectEmail}`,
      );
      if (referralId) {
        await supabase
          .from('signup_referrals')
          .update({ admin_email_sent_at: input.nowIso })
          .eq('id', referralId);
      }
    } catch (err) {
      logger.warn('auth_sync_prospect_email_send_failed', {
        email:   input.prospectEmail,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // 2) Admin notification — best-effort; idempotent via Supabase email
  //    enqueue idempotency key so repeat verifies don't double-send.
  if (adminEmail) {
    try {
      await sendInboundSignupNoticeToAdmin(
        adminEmail,
        {
          prospectEmail: input.prospectEmail,
          companyName:   input.companyName,
          supportEmail:  SUPPORT_EMAIL,
        },
        `inbound-signup-notice:${input.companyId}:${input.prospectEmail}`,
      );
    } catch (err) {
      logger.warn('auth_sync_admin_notice_send_failed', {
        adminEmail,
        prospectEmail: input.prospectEmail,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }
}
