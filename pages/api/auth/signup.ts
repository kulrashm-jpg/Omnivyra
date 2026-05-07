
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
 *   4. COMPANY_CLAIMED — another user from this email's domain is already
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
import { validateWorkEmail } from '../../../lib/auth/serverValidation';
import { checkDomainEligibility } from '../../../backend/services/domainEligibilityService';
import { checkRateLimit, EMAIL_LINK_LIMIT } from '../../../lib/auth/rateLimit';
import { logger } from '../../../backend/services/logger';
import { seedRequestContextFromRequest } from '../../../backend/services/requestContext';

type SuccessResponse = { proceed: true };
type ErrorResponse = { error: string; code?: string };

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

  // ── 1. Work email (block personal providers) ─────────────────────────────
  try {
    validateWorkEmail(normalizedEmail);
  } catch (err: any) {
    return res.status(400).json({ error: err.message, code: 'PERSONAL_EMAIL' });
  }

  // ── 1a. Domain/MX check ───────────────────────────────────────────────────
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

  // (moved to post-email-auth) The pre-auth COMPANY_CLAIMED check that
  // used to live here returned a 409 the moment a domain match was found.
  // Detection + the two emails (referral to prospect, notice to admin)
  // now run inside /api/auth/sync-supabase-user once the user has
  // verified their email — we only contact the admin about real humans.

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

  // ── 4. (moved to post-email-auth) Domain-claimed handling ────────────────
  // Detection of a claimed domain + the two emails it triggers (referral
  // email to the prospect, notification email to the existing admin) now
  // run inside /api/auth/sync-supabase-user → bootstrapCompanyFromSignupIntent
  // AFTER the user has verified their email. This ensures emails only fly
  // for verified humans and gives the admin a real-person notification.
  // Signup is allowed to proceed here so the verification email is sent.

  // ── 5. Fresh signup path — upsert signup_intents and let the client proceed.
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
