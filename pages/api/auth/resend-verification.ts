import { createApiRoute as __createApiRoute } from '../../../lib/platform/routeFactory';
/**
 * POST /api/auth/resend-verification
 *
 * Closes the most common dead-end in the signup flow: a user signs up,
 * doesn't click the verification email in time, and has no way to
 * recover without re-signing-up (which is blocked by the existing
 * signup_intents row).
 *
 * Body: { email: string }
 *
 * Behavior:
 *   1. Per-IP + per-email rate limit. Constant-response (don't leak
 *      whether the email exists).
 *   2. If a soft-deleted account exists for this email → constant 200.
 *      The user must contact support; we don't surface that path here.
 *   3. If a user exists with `is_email_verified=true` → constant 200.
 *      No-op — no need to verify.
 *   4. Otherwise → call `supabase.auth.signInWithOtp` to send a fresh
 *      magic-link / verification email. Same SMTP path used by signup
 *      and accept-invite, so the user-facing experience is uniform.
 *
 * Always returns { ok: true } on success — no enumeration. Audit row
 * carries the actual decision (sent / soft_deleted / already_verified
 * / not_found) so an operator can investigate volume per outcome.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../../backend/db/supabaseClient';
import { checkRateLimit, EMAIL_LINK_LIMIT } from '../../../lib/auth/rateLimit';
import { seedRequestContextFromRequest } from '../../../backend/services/requestContext';
import { logger } from '../../../backend/services/logger';
import { getCanonicalAppUrl } from '../../../backend/config/getCanonicalAppUrl';
import { verifyCaptchaToken, CAPTCHA_FAILED_RESPONSE } from '../../../lib/auth/captcha';
import {
  emitSignupEvent,
  ensureSignupCorrelationId,
  requestUserAgent,
} from '../../../backend/services/signupEventService';

type SuccessResponse = { ok: true };
type ErrorResponse   = { error: string };

async function handler(
  req: NextApiRequest,
  res: NextApiResponse<SuccessResponse | ErrorResponse>,
) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  seedRequestContextFromRequest(req);

  const ip = String(req.headers['x-forwarded-for'] ?? req.socket?.remoteAddress ?? 'unknown')
    .split(',')[0]
    .trim();

  // Per-IP gate: cap at the same volume as password reset (5/hour).
  const ipRl = await checkRateLimit(ip, {
    ...EMAIL_LINK_LIMIT,
    keyPrefix:  'rl:auth:resend-verification:ip',
    limit:      5,
    windowSecs: 3600,
  });
  if (!ipRl.allowed) {
    return res.status(429).json({ error: 'Too many requests. Try again later.' });
  }

  const body  = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body ?? {});
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  if (!email) return res.status(400).json({ error: 'email is required' });

  // CAPTCHA (no-op until CAPTCHA_PROVIDER is configured — AUTH-001 §3).
  const captcha = await verifyCaptchaToken(body.captchaToken, ip);
  if (!captcha.ok) return res.status(400).json(CAPTCHA_FAILED_RESPONSE);

  // Per-email gate: separate bucket so an attacker can't burn one user's
  // budget by spamming the email field.
  const emailRl = await checkRateLimit(email, {
    ...EMAIL_LINK_LIMIT,
    keyPrefix:  'rl:auth:resend-verification:email',
    limit:      3,
    windowSecs: 3600,
  });
  if (!emailRl.allowed) {
    // Constant response — same shape as success — to avoid enumeration.
    return res.status(200).json({ ok: true });
  }

  // Look up the user. We use service-role supabase + public.users so the
  // soft-delete / verified state can be read without going through the
  // auth.users surface (which is more restricted).
  const { data: userRow } = await supabase
    .from('users')
    .select('id, is_deleted, is_email_verified')
    .eq('email', email)
    .maybeSingle();

  let outcome: 'sent' | 'soft_deleted' | 'already_verified' | 'not_found' = 'not_found';

  if (userRow) {
    if ((userRow as { is_deleted?: boolean }).is_deleted) {
      outcome = 'soft_deleted';
    } else if ((userRow as { is_email_verified?: boolean }).is_email_verified === true) {
      outcome = 'already_verified';
    } else {
      // Send a fresh magic-link / verification email. This same Supabase
      // primitive is used by signup + accept-invite, so the SMTP delivery
      // path is uniform.
      const origin = getCanonicalAppUrl();
      const { error: otpError } = await supabase.auth.signInWithOtp({
        email,
        options: {
          // Don't create a new auth.users row — we know one exists.
          shouldCreateUser: false,
          emailRedirectTo:  `${origin}/auth/callback`,
        },
      });

      if (otpError) {
        logger.warn('resend_verification_otp_failed', { email, message: otpError.message });
      } else {
        outcome = 'sent';
      }
    }
  }

  // Audit the actual outcome — operators can see volume per branch
  // even though the public response is constant. Emitted as the canonical
  // signup.VerificationSent event (AUTH-001 §9), correlated to the signup
  // journey when one exists for this email.
  void ensureSignupCorrelationId(email).then((correlationId) =>
    emitSignupEvent({
      event:         'VerificationSent',
      outcome:       outcome === 'sent' ? 'allowed' : 'denied',
      correlationId,
      email,
      reason:        `resend outcome=${outcome}`,
      ip,
      userAgent:     requestUserAgent(req),
    }),
  );

  return res.status(200).json({ ok: true });
}

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/auth/resend-verification' });
