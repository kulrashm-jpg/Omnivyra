// AUTH EXEMPT: auth route handles token exchange/pre-auth flows separately

/**
 * POST /api/auth/signup
 *
 * Public pre-signup gate. Runs the checks that must happen BEFORE the
 * browser fires `supabase.auth.signUp`. Responsibilities (in order â€” domain
 * checks run early so a duplicate is rejected before any other DB work):
 *
 *   1. Personal-email / MX / rate-limit gates.
 *   2. COMPANY_CLAIMED â€” the email's domain (or its canonical form) is
 *                        already claimed by another company. We surface
 *                        the existing admin's contact details so the
 *                        prospect can reach out for an invite. NO emails
 *                        are sent and no signup_referrals row is written
 *                        here â€” those are post-verify side-effects owned
 *                        exclusively by /api/auth/sync-supabase-user, so
 *                        spam attempts that never verify can't ping real
 *                        admins.
 *   3. ACCOUNT_EXISTS / RESUME_SIGNUP â€” email is already a completed user
 *                        (active role) or already confirmed in auth.users
 *                        from a prior flow.
 *   4. Upsert signup_intents and return { proceed: true }.
 *
 * Does NOT send a confirmation email â€” Supabase sends that itself when the
 * client calls `supabase.auth.signUp({ email, password, options: { emailRedirectTo } })`.
 *
 * One-domain-one-account invariant: only the FIRST self-serve user from a
 * given (canonical) domain becomes the COMPANY_ADMIN. Every subsequent
 * signup attempt from that domain is rejected here pre-verify and again
 * post-verify in sync-supabase-user.ts as defense-in-depth. Additional
 * users from the same domain must be invited by the admin.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { createServiceRoleMigrationProxy } from '../../../backend/db/supabaseClient';
const supabase = createServiceRoleMigrationProxy('AUTO_MIGRATION_REQUIRED');
import { validateWorkEmail } from '../../../lib/auth/serverValidation';
import { checkDomainEligibility } from '../../../backend/services/domainEligibilityService';
import { checkRateLimit, EMAIL_LINK_LIMIT, DOMAIN_RESOLUTION_LIMIT } from '../../../lib/auth/rateLimit';
import { isFreeEmailDomain } from '../../../backend/services/companyMatchService';
import { lookupClaimedDomain, maskEmail } from '../../../backend/services/companyDomainLookup';
import { resolveDomain } from '../../../backend/services/domainCanonicalService';
import { logger } from '../../../backend/services/logger';
import { seedRequestContextFromRequest } from '../../../backend/services/requestContext';

type SuccessResponse = { proceed: true };
type ClaimedResponse = {
  claimed: true;
  code: 'COMPANY_CLAIMED';
  companyName: string | null;
  adminName: string | null;
  adminEmailMasked: string | null;
};
type ErrorResponse = { error: string; code?: string };

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<SuccessResponse | ClaimedResponse | ErrorResponse>,
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

  // â”€â”€ 1a. Work email (block personal providers) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  try {
    validateWorkEmail(normalizedEmail);
  } catch (err: any) {
    return res.status(400).json({ error: err.message, code: 'PERSONAL_EMAIL' });
  }

  // â”€â”€ 1b. Domain/MX check â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  try {
    const eligibility = await checkDomainEligibility(normalizedEmail);
    if (eligibility.status === 'blocked') {
      return res.status(400).json({
        error: eligibility.reason === 'no_mx'
          ? 'That domain cannot receive email. Please use a valid work email.'
          : 'This email domain is not eligible. Please use a valid work email.',
        code: 'INVALID_DOMAIN',
      });
    }
  } catch (err: any) {
    logger.warn('auth_signup_mx_check_failed', { email: normalizedEmail, message: err?.message });
  }

  // â”€â”€ 2. Domain-claimed check (runs before any user/auth lookup) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  // Skip the canonical resolve for free email providers â€” they can never
  // claim a company anyway, so the lookup is guaranteed to miss.
  if (!isFreeEmailDomain(domain)) {
    // 2a. Cheap match: companies.admin_email_domain == domain, plus any
    // company_domains row with this exact input/final_domain. One round
    // trip; catches the common case (kuldeep@omnivyra.com is the admin â†’
    // admin@omnivyra.com is rejected).
    let claim = await lookupClaimedDomain({ emailDomain: domain });

    // 2b. Canonical resolve: if the cheap match missed, follow HTTP
    // redirects to the canonical host and re-check. Catches the case where
    // a forwarded subdomain (`app.omnivyra.com â†’ omnivyra.com`) has been
    // registered under its primary form. Best-effort â€” if resolveDomain
    // fails for network/SSRF reasons we DON'T block the signup; the
    // post-verify path in sync-supabase-user.ts will run the authoritative
    // canonical check after email verification.
    if (!claim) {
      const resolveAllowed = await checkRateLimit(ip, DOMAIN_RESOLUTION_LIMIT);
      if (resolveAllowed.allowed) {
        try {
          const resolution = await resolveDomain(domain);
          const finalDomain =
            !resolution.resolution_failed &&
            !resolution.resolution_blocked &&
            resolution.final_domain &&
            resolution.final_domain !== domain
              ? resolution.final_domain
              : null;
          if (finalDomain) {
            claim = await lookupClaimedDomain({ emailDomain: domain, finalDomain });
          }
        } catch (err: any) {
          logger.warn('auth_signup_canonical_resolve_threw', {
            email: normalizedEmail,
            message: err?.message,
          });
        }
      }
    }

    if (claim) {
      logger.info('auth_signup_company_claimed_blocked', {
        email: normalizedEmail,
        company_id: claim.companyId,
        matched_via: claim.matchedVia,
      });
      return res.status(409).json({
        claimed: true,
        code: 'COMPANY_CLAIMED',
        companyName: claim.companyName,
        adminName: claim.admin?.name ?? null,
        adminEmailMasked: claim.admin?.email ? maskEmail(claim.admin.email) : null,
      });
    }
  }

  // â”€â”€ 3. Same email already a completed user? â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  // An existing public.users row with an active role = finished account;
  // route them to /login. Soft-deleted = blocked. Existing row without an
  // active role = abandoned onboarding; fall through (re-signup allowed).
  const { data: existingUser } = await supabase
    .from('users')
    .select('id, is_deleted, company_id, role, onboarding_state')
    .eq('email', normalizedEmail)
    .maybeSingle();

  if (existingUser && (existingUser as any).is_deleted) {
    return res.status(403).json({ error: 'This account has been deactivated.', code: 'ACCOUNT_DELETED' });
  }

  if (existingUser) {
    const { data: companyRole } = await supabase
      .from('user_company_' + 'roles')
      .select('id')
      .eq('user_id', (existingUser as any).id)
      .eq('status', 'active')
      .limit(1)
      .maybeSingle();

    const hasCompletedUserRecord =
      Boolean((existingUser as any).company_id) &&
      Boolean((existingUser as any).role) &&
      !!companyRole;

    if (hasCompletedUserRecord) {
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

  // â”€â”€ 4. auth.users already has this email confirmed? â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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

  // â”€â”€ 5. Fresh signup path â€” upsert signup_intents and let the client proceed.
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

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
      intent_data: { company_name: trimmedCompany },
    });

    if (insertErr) {
      logger.error('auth_signup_intent_insert_failed', { email: normalizedEmail, message: insertErr.message });
      return res.status(500).json({ error: 'Failed to initiate signup' });
    }
  } else {
    // Refresh the existing pending intent with the latest company name in
    // case the user changed it before re-submitting the signup form.
    await supabase
      .from('signup_intents')
      .update({ intent_data: { company_name: trimmedCompany } })
      .eq('id', (existingIntent as { id: string }).id);
  }

  return res.status(200).json({ proceed: true });
}

