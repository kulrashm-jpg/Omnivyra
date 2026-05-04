// AUTH EXEMPT: auth route handles token exchange/pre-auth flows separately

/**
 * POST /api/auth/accept-invite
 *
 * Public endpoint. Validates an invitation token and returns the associated email.
 * Frontend will then call signInWithOtp(email) to authenticate the user.
 *
 * Body: { token: string }
 * No auth required. Rate-limited by IP.
 * Returns: { ok: true, email: string }
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { createHash } from 'crypto';
import { createServiceRoleMigrationProxy } from '../../../backend/db/supabaseClient';
const supabase = createServiceRoleMigrationProxy('AUTO_MIGRATION_REQUIRED');
import { checkRateLimit, LOGIN_LIMIT } from '../../../lib/auth/rateLimit';
import { logger } from '../../../backend/services/logger';
import { seedRequestContextFromRequest } from '../../../backend/services/requestContext';

type SuccessResponse = { ok: true; email: string };
type ErrorResponse   = { error: string; code?: string };

const ACCEPT_INVITE_LIMIT = { ...LOGIN_LIMIT, keyPrefix: 'rl:accept-invite', limit: 10, windowSecs: 60 * 15 };

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<SuccessResponse | ErrorResponse>,
) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  seedRequestContextFromRequest(req);

  // â”€â”€ 1. Rate limit by IP â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const ip = String(req.headers['x-forwarded-for'] ?? (req.socket as any)?.remoteAddress ?? 'unknown').split(',')[0].trim();
  const rl = await checkRateLimit(ip, ACCEPT_INVITE_LIMIT);
  if (!rl.allowed) return res.status(429).json({ error: 'Too many requests. Try again later.' });

  // â”€â”€ 2. Parse body â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
  const { token } = body as { token?: string };

  if (!token || typeof token !== 'string' || token.length < 16) {
    return res.status(400).json({ error: 'Invalid invitation token', code: 'INVALID_TOKEN' });
  }

  // â”€â”€ 3. Hash token and look up invitation â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const tokenHash = createHash('sha256').update(token).digest('hex');

  const { data: invitation } = await supabase
    .from('invitations')
    .select('id, email, expires_at, accepted_at, revoked_at, token_consumed_at')
    .eq('token_hash', tokenHash)
    .maybeSingle();

  if (!invitation) {
    return res.status(404).json({ error: 'Invitation not found or already used', code: 'NOT_FOUND' });
  }

  // â”€â”€ 4. Validate invitation status â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  if ((invitation as any).accepted_at) {
    return res.status(400).json({ error: 'This invitation has already been accepted', code: 'ALREADY_ACCEPTED' });
  }

  if ((invitation as any).revoked_at) {
    return res.status(400).json({ error: 'This invitation has been revoked', code: 'REVOKED' });
  }

  if ((invitation as any).token_consumed_at) {
    return res.status(400).json({ error: 'This invitation link has already been used', code: 'ALREADY_USED' });
  }

  const expiresAt = new Date((invitation as any).expires_at);
  if (expiresAt < new Date()) {
    await supabase.from('invitations').update({ revoked_at: new Date().toISOString() }).eq('id', (invitation as any).id);
    return res.status(400).json({ error: 'This invitation has expired', code: 'EXPIRED' });
  }

  const consumedAt = new Date().toISOString();
  const { data: consumedRow, error: consumeError } = await supabase
    .from('invitations')
    .update({ token_consumed_at: consumedAt })
    .eq('id', (invitation as any).id)
    .is('token_consumed_at', null)
    .select('id')
    .maybeSingle();

  if (consumeError || !consumedRow) {
    logger.warn('invite_token_consume_failed', {
      invitationId: (invitation as any).id,
      error: consumeError?.message ?? 'already_consumed',
    });
    return res.status(409).json({ error: 'This invitation link has already been used', code: 'ALREADY_USED' });
  }

  // Send the magic link via Supabase Auth â€” Supabase delivers it through
  // the SMTP configured at the project level (your SES sender). This used
  // to wrap generateLink+SES SMTP in a custom transactional pipeline; that
  // is now redundant since Supabase SMTP handles delivery directly.
  const origin = (process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000').replace(/\/$/, '');
  const { error: otpError } = await supabase.auth.signInWithOtp({
    email: (invitation as any).email,
    options: {
      shouldCreateUser: true,
      emailRedirectTo: `${origin}/auth/callback`,
    },
  });

  if (otpError) {
    await supabase
      .from('invitations')
      .update({ token_consumed_at: null })
      .eq('id', (invitation as any).id);
    logger.warn('accept_invite_otp_send_failed', {
      invitationId: (invitation as any).id,
      message: otpError.message,
    });
    return res.status(502).json({ error: 'Could not send sign-in link. Please try again.', code: 'OTP_SEND_FAILED' });
  }

  return res.status(200).json({ ok: true, email: (invitation as any).email });
}

