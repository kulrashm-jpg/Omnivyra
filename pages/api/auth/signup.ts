
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
import { sendCompanyAdminReferral } from '../../../backend/services/emailService';
import { logger } from '../../../backend/services/logger';
import { seedRequestContextFromRequest } from '../../../backend/services/requestContext';

type SuccessResponse = { proceed: true };
type ClaimedResponse = {
  claimed: true;
  code: 'COMPANY_CLAIMED';
  alreadyReferred: boolean;
  adminEmailMasked: string | null;
};
type ErrorResponse = { error: string; code?: string };

const SUPPORT_EMAIL = 'support@omnivyra.com';

function maskEmail(email: string): string {
  const [local, domain] = email.split('@');
  if (!local || !domain) return email;
  const head = local.slice(0, Math.min(2, local.length));
  return `${head}${'*'.repeat(Math.max(1, local.length - 2))}@${domain}`;
}

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
  const { email } = body as { email?: string };

  if (!email?.trim()) return res.status(400).json({ error: 'email is required' });

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
  const { data: existingUser } = await supabase
    .from('users')
    .select('id, is_deleted')
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
  }

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
        error: 'An account with this email already exists. Please log in.',
        code:  'ACCOUNT_EXISTS',
      });
    }
  } catch (err: any) {
    logger.warn('auth_signup_auth_confirmed_rpc_threw', { email: normalizedEmail, message: err?.message });
  }

  // ── 4. Domain already claimed by another company admin? ──────────────────
  // Find an active COMPANY_ADMIN whose email ends in @<domain>. If one
  // exists, this domain belongs to an existing org and the would-be signer
  // must be invited by its admin. We send them (once) an email with the
  // admin's contact details; repeat attempts skip the email and tell them
  // the details were already shared.
  const { data: domainMembers } = await supabase
    .from('users')
    .select('id')
    .ilike('email', `%@${domain}`)
    .eq('is_deleted', false);

  if (domainMembers && domainMembers.length > 0) {
    const memberIds = (domainMembers as Array<{ id: string }>).map((m) => m.id);

    const { data: adminRoleRow } = await supabase
      .from('user_company_roles')
      .select('user_id, company_id, created_at')
      .in('user_id', memberIds)
      .eq('status', 'active')
      .eq('role', 'COMPANY_ADMIN')
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle();

    if (adminRoleRow) {
      const adminUserId = (adminRoleRow as any).user_id as string;
      const companyId = (adminRoleRow as any).company_id as string;

      const { data: adminUser } = await supabase
        .from('users')
        .select('name, email')
        .eq('id', adminUserId)
        .maybeSingle();
      const { data: companyRow } = companyId
        ? await supabase.from('companies').select('name').eq('id', companyId).maybeSingle()
        : { data: null };

      // Dedupe email — write/update the signup_referrals row first, then
      // send only on first hit.
      const { data: existingReferral } = await supabase
        .from('signup_referrals')
        .select('id, admin_email_sent_at, attempt_count')
        .eq('email', normalizedEmail)
        .maybeSingle();

      const now = new Date().toISOString();
      let shouldSend = false;

      if (!existingReferral) {
        const { error: insertErr } = await supabase.from('signup_referrals').insert({
          email:               normalizedEmail,
          domain,
          company_id:          companyId,
          admin_user_id:       adminUserId,
          first_attempt_at:    now,
          last_attempt_at:     now,
          attempt_count:       1,
        });
        if (insertErr) {
          logger.error('auth_signup_referral_insert_failed', { email: normalizedEmail, message: insertErr.message });
        } else {
          shouldSend = true;
        }
      } else {
        await supabase
          .from('signup_referrals')
          .update({
            last_attempt_at: now,
            attempt_count:   ((existingReferral as any).attempt_count ?? 1) + 1,
          })
          .eq('id', (existingReferral as any).id);
        shouldSend = !(existingReferral as any).admin_email_sent_at;
      }

      if (shouldSend) {
        try {
          const adminEmail = (adminUser as any)?.email as string | undefined;
          await sendCompanyAdminReferral(
            normalizedEmail,
            {
              admin:        adminEmail ? { name: (adminUser as any)?.name ?? null, email: adminEmail } : null,
              companyName:  (companyRow as any)?.name ?? null,
              supportEmail: SUPPORT_EMAIL,
            },
            `company-referral:${normalizedEmail}`,
          );
          await supabase
            .from('signup_referrals')
            .update({ admin_email_sent_at: now })
            .eq('email', normalizedEmail);
        } catch (err: any) {
          // Don't fail the request if email dispatch fails — the UI message
          // still tells them their domain is claimed, and they can retry.
          logger.error('auth_signup_referral_send_failed', { email: normalizedEmail, message: err?.message });
        }
      }

      return res.status(409).json({
        claimed:          true,
        code:             'COMPANY_CLAIMED',
        alreadyReferred:  !!existingReferral,
        adminEmailMasked: (adminUser as any)?.email ? maskEmail((adminUser as any).email) : null,
      });
    }
  }

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
      email:      normalizedEmail,
      source:     'signup_form',
      status:     'pending',
      expires_at: expiresAt,
    });

    if (insertErr) {
      logger.error('auth_signup_intent_insert_failed', { email: normalizedEmail, message: insertErr.message });
      return res.status(500).json({ error: 'Failed to initiate signup' });
    }
  }

  return res.status(200).json({ proceed: true });
}
