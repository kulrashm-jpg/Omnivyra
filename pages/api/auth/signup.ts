
/**
 * POST /api/auth/signup
 *
 * Public pre-signup gate. Runs the checks that must happen BEFORE the
 * browser fires `supabase.auth.signUp`. Responsibilities:
 *
 *   1. Personal-email / MX / rate-limit gates.
 *   2. ACCOUNT_EXISTS  — email is already a completed user (active role).
 *   3. ACCOUNT_EXISTS  — email is already confirmed in auth.users from a
 *                        prior flow (orphaned). Blocks the silent
 *                        user_repeated_signup failure mode.
 *   4. CLAIMED_DOMAIN — another user from this email's domain is already
 *                        the COMPANY_ADMIN. First time we see this email,
 *                        we send them a referral email with the admin's
 *                        contact details and write a signup_referrals row.
 *                        Subsequent attempts skip the email and return
 *                        alreadyReferred=true.
 *   5. Upsert signup_intents row and return { proceed: true }.
 *
 * Does NOT send a confirmation email — Supabase sends that itself when the
 * client calls `supabase.auth.signUp({ email, password, options: { emailRedirectTo } })`.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../../backend/db/supabaseClient';
import {
  validateCompanyIdentity,
  COMPANY_IDENTITY_VALIDATION_VERSION,
} from '../../../backend/services/companyIdentityValidationService';
import { httpStatusFor, ELIGIBILITY_MESSAGES } from '../../../lib/auth/domainEligibilityModel';
import { checkRateLimit, EMAIL_LINK_LIMIT } from '../../../lib/auth/rateLimit';
import { logger } from '../../../backend/services/logger';
import { seedRequestContextFromRequest } from '../../../backend/services/requestContext';
import { notifyAdminAndProspectOfClaimedDomain } from '../../../backend/services/claimedDomainNotifyService';

type SuccessResponse = { proceed: true };
type ErrorResponse = {
  error: string;
  code?: string;
  /** CLAIMED_DOMAIN only: the prospect was already emailed on a prior attempt. */
  alreadyReferred?: boolean;
  /** CLAIMED_DOMAIN only: masked admin email shown on the contact-admin screen. */
  adminEmailMasked?: string | null;
};

/** "jo••••@acme.com" — enough to recognise the admin without leaking the full address. */
function maskEmail(email: string | null): string | null {
  if (!email) return null;
  const [local, host] = email.split('@');
  if (!local || !host) return null;
  const shown = local.slice(0, 2);
  return `${shown}${'•'.repeat(Math.max(1, local.length - shown.length))}@${host}`;
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<SuccessResponse | ErrorResponse>,
) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  seedRequestContextFromRequest(req);
  const ip = String(req.headers['x-forwarded-for'] ?? req.socket?.remoteAddress ?? 'unknown').split(',')[0].trim();
  const rl = await checkRateLimit(ip, { ...EMAIL_LINK_LIMIT, keyPrefix: 'rl:auth:signup', limit: 5, windowSecs: 3600 });
  if (!rl.allowed) return res.status(429).json({ error: 'Too many requests. Try again later.' });

  const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
  const { email, companyName } = body as { email?: string; companyName?: string };

  if (!email?.trim()) return res.status(400).json({ error: 'email is required' });

  // Company name is required for self-serve signups (the user becomes the
  // COMPANY_ADMIN of this company on first email verify). Stored on the
  // signup_intents row so /auth/callback can bootstrap the company without
  // asking the user again.
  const trimmedCompany = String(companyName ?? '').trim();
  if (!trimmedCompany) return res.status(400).json({ error: 'companyName is required' });
  if (trimmedCompany.length > 80) return res.status(400).json({ error: 'companyName is too long' });

  const normalizedEmail = email.trim().toLowerCase();
  const domain = normalizedEmail.split('@')[1] ?? '';
  if (!domain) return res.status(400).json({ error: 'Invalid email address' });

  // ── 1. Authoritative company-identity gate ───────────────────────────────
  // The single eligibility decision (personal-email, email capability, live
  // canonical website at the email domain, website⇄email-domain match) now
  // runs in section 4.5 below — AFTER the existing-user / orphan / claimed
  // checks — so a returning user whose website is transiently down can still
  // resume, and an already-claimed domain keeps the richer notify flow in
  // section 4. See validateCompanyIdentity (companyIdentityValidationService).

  // ── 2. Same email already a completed user? ──────────────────────────────
  // An existing public.users row with an active role = finished account;
  // route them to /login. Soft-deleted = blocked. Existing row without an
  // active role = abandoned onboarding; fall through (re-signup allowed).
  // Canonical "completed account" signal is an active row in
  // user_company_roles. users.company_id / users.role are deprecated and
  // no longer read here.
  const { data: existingUser } = await supabase
    .from('users')
    .select('id, is_deleted, onboarding_state')
    .eq('email', normalizedEmail)
    .maybeSingle();

  if (existingUser && (existingUser as any).is_deleted) {
    return res.status(403).json({ error: 'This account has been deactivated.', code: 'ACCOUNT_DELETED' });
  }

  if (existingUser) {
    const { data: companyRole } = await supabase
      .from('user_company_roles')
      .select('id')
      .eq('user_id', (existingUser as any).id)
      .eq('status', 'active')
      .limit(1)
      .maybeSingle();

    if (companyRole) {
      return res.status(409).json({
        error: 'An account with this email already exists. Please log in.',
        code:  'ACCOUNT_EXISTS',
      });
    }

    return res.status(409).json({
      error: 'We found an unfinished account for this email. Please sign in to continue setup.',
      code:  'RESUME_SIGNUP',
    });
  }

  // The CLAIMED_DOMAIN gate runs in section 4 below (after the orphaned
  // auth.users check) so a returning user with their OWN email resumes via
  // ACCOUNT_EXISTS / RESUME_SIGNUP instead of being told to contact an admin.

  // ── 3. auth.users already has this email confirmed? ───────────────────────
  // Catches the orphan case where auth.users was created by a prior flow
  // (e.g. the old ensureAuthUserExists hack) but public.users never
  // followed. Without this, Supabase would silently swallow a repeat
  // signup and never send the email.
  try {
    const { data: authConfirmed, error: rpcErr } = await supabase.rpc('auth_user_confirmed', {
      p_email: normalizedEmail,
    });
    if (rpcErr) {
      logger.warn('auth_signup_auth_confirmed_rpc_failed', { email: normalizedEmail, message: rpcErr.message });
    } else if (authConfirmed === true) {
      return res.status(409).json({
        error: 'We found an unfinished account for this email. Please sign in to continue setup.',
        code:  'RESUME_SIGNUP',
      });
    }
  } catch (err: any) {
    logger.warn('auth_signup_auth_confirmed_rpc_threw', { email: normalizedEmail, message: err?.message });
  }

  // ── 4. Domain already claimed by an existing company ─────────────────────
  // If any company already owns this email's domain, a NEW person from that
  // domain CANNOT self-register. We block here — BEFORE the confirmation
  // email is sent — so they never get a verification mail for an account
  // that can't exist. They see the admin's (masked) contact details, and
  // both the prospect and the company admin are emailed. Deduped per
  // prospect email via signup_referrals so repeat attempts don't re-spam
  // the admin (the signup endpoint is also IP rate-limited above).
  // The first user of a domain is unaffected: their company row doesn't
  // exist yet at signup time, so there's nothing to match.
  {
    const { data: byWebsite } = await supabase
      .from('companies')
      .select('id, name')
      .eq('website_domain', domain)
      .maybeSingle();
    const claimedCompany =
      byWebsite ??
      (
        await supabase
          .from('companies')
          .select('id, name')
          .eq('admin_email_domain', domain)
          .maybeSingle()
      ).data;

    if (claimedCompany) {
      const company = claimedCompany as { id: string; name: string | null };

      // Resolve the company admin's email for the masked display.
      const { data: adminRole } = await supabase
        .from('user_company_roles')
        .select('user_id')
        .eq('company_id', company.id)
        .eq('role', 'COMPANY_ADMIN')
        .eq('status', 'active')
        .order('created_at', { ascending: true })
        .limit(1)
        .maybeSingle();
      const adminUserId = (adminRole as { user_id?: string } | null)?.user_id ?? null;
      const { data: adminUser } = adminUserId
        ? await supabase.from('users').select('email').eq('id', adminUserId).maybeSingle()
        : { data: null };
      const adminEmail = (adminUser as { email?: string } | null)?.email ?? null;

      // alreadyReferred = the prospect was already emailed on a prior attempt.
      const { data: priorReferral } = await supabase
        .from('signup_referrals')
        .select('admin_email_sent_at')
        .eq('email', normalizedEmail)
        .maybeSingle();
      const alreadyReferred = !!(priorReferral as { admin_email_sent_at?: string | null } | null)
        ?.admin_email_sent_at;

      // Fire both emails (idempotent / deduped inside the service; never throws).
      await notifyAdminAndProspectOfClaimedDomain(supabase, {
        prospectEmail: normalizedEmail,
        emailDomain:   domain,
        companyId:     company.id,
        companyName:   company.name,
        nowIso:        new Date().toISOString(),
      });

      logger.info('auth_signup_company_claimed_blocked', {
        email:     normalizedEmail,
        domain,
        companyId: company.id,
        alreadyReferred,
      });

      return res.status(httpStatusFor('CLAIMED_DOMAIN')).json({
        error:            ELIGIBILITY_MESSAGES.CLAIMED_DOMAIN,
        code:             'CLAIMED_DOMAIN',
        alreadyReferred,
        adminEmailMasked: maskEmail(adminEmail),
      });
    }
  }

  // ── 4.5. Authoritative company-identity validation (rules 1–4) ───────────
  // THE single eligibility decision. Runs only for genuinely-new, non-claimed
  // signups (returning users resumed in §2/§3; claimed domains returned in §4).
  // Fail-CLOSED: if validation cannot complete, we never let the client create
  // an account — onboarding/setup-company will no longer re-validate (Phase 8),
  // so the verdict must be settled here. Rule 5 (already-claimed) is owned by
  // §4 above, so it is disabled in this call to avoid a second, side-effect-free
  // claimed check racing the notify/referral flow.
  let identity;
  try {
    identity = await validateCompanyIdentity(normalizedEmail, {
      lookupClaimedCompany: async () => null,
    });
  } catch (err: any) {
    logger.error('auth_signup_identity_validation_threw', { email: normalizedEmail, message: err?.message });
    return res.status(503).json({
      error: 'We could not verify your organization right now. Please try again in a moment.',
      code:  'IDENTITY_VALIDATION_UNAVAILABLE',
    });
  }

  if (!identity.eligible) {
    // PUBLIC_EMAIL / NO_EMAIL_CAPABILITY / NO_WEBSITE_FOUND / FORWARDING_DOMAIN /
    // DOMAIN_NOT_CANONICAL / DOMAIN_MISMATCH / BLOCKED — all messaged from the
    // single ELIGIBILITY_MESSAGES source. Review-needed cases surface the
    // "contact our team" copy; no review row is written yet (Phase 5 pending).
    const reason = identity.validationReason ?? 'BLOCKED';
    logger.info('auth_signup_identity_blocked', {
      email: normalizedEmail,
      reason,
      requiresManualReview: identity.requiresManualReview,
    });
    return res.status(httpStatusFor(reason)).json({
      error: ELIGIBILITY_MESSAGES[reason],
      code:  reason,
    });
  }

  // ── 5. Fresh signup path — upsert signup_intents and let the client proceed.
  // The validated identity is persisted on the intent so onboarding/setup-company
  // consume the verdict instead of re-deriving it (system-of-record handoff).
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  const intentData = {
    company_name:             trimmedCompany,
    validated_company_domain: identity.companyIdentityDomain,
    validated_website_domain: identity.normalizedWebsiteDomain,
    validated_website_url:    identity.websiteUrl,
    validated_at:             new Date().toISOString(),
    validation_version:       COMPANY_IDENTITY_VALIDATION_VERSION,
  };

  const { data: existingIntent } = await supabase
    .from('signup_intents')
    .select('id')
    .eq('email', normalizedEmail)
    .eq('status', 'pending')
    .gt('expires_at', new Date().toISOString())
    .maybeSingle();

  if (!existingIntent) {
    const { error: insertErr } = await supabase.from('signup_intents').insert({
      email:       normalizedEmail,
      source:      'signup_form',
      status:      'pending',
      expires_at:  expiresAt,
      intent_data: intentData,
    });

    if (insertErr) {
      logger.error('auth_signup_intent_insert_failed', { email: normalizedEmail, message: insertErr.message });
      return res.status(500).json({ error: 'Failed to initiate signup' });
    }
  } else {
    // Refresh the existing pending intent with the latest company name +
    // validated identity in case the user changed it before re-submitting.
    await supabase
      .from('signup_intents')
      .update({ intent_data: intentData })
      .eq('id', (existingIntent as { id: string }).id);
  }

  return res.status(200).json({ proceed: true });
}
