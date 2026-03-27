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
import { supabase } from '../../../backend/db/supabaseClient';
import { checkRateLimit, LOGIN_LIMIT } from '../../../lib/auth/rateLimit';

type SuccessResponse = { ok: true; email: string };
type ErrorResponse   = { error: string; code?: string };

const ACCEPT_INVITE_LIMIT = { ...LOGIN_LIMIT, keyPrefix: 'rl:accept-invite', limit: 10, windowSecs: 60 * 15 };

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<SuccessResponse | ErrorResponse>,
) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // ── 1. Rate limit by IP ───────────────────────────────────────────────────
  const ip = String(req.headers['x-forwarded-for'] ?? (req.socket as any)?.remoteAddress ?? 'unknown').split(',')[0].trim();
  const rl = await checkRateLimit(ip, ACCEPT_INVITE_LIMIT);
  if (!rl.allowed) return res.status(429).json({ error: 'Too many requests. Try again later.' });

  // ── 2. Parse body ─────────────────────────────────────────────────────────
  const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
  const { token } = body as { token?: string };

  if (!token || typeof token !== 'string' || token.length < 16) {
    return res.status(400).json({ error: 'Invalid invitation token', code: 'INVALID_TOKEN' });
  }

  // ── 3. Hash token and look up invitation ──────────────────────────────────
  const tokenHash = createHash('sha256').update(token).digest('hex');

  const { data: invitation } = await supabase
    .from('invitations')
    .select('id, email, expires_at, accepted_at, revoked_at')
    .eq('token_hash', tokenHash)
    .maybeSingle();

  if (!invitation) {
    return res.status(404).json({ error: 'Invitation not found or already used', code: 'NOT_FOUND' });
  }

  // ── 4. Validate invitation status ─────────────────────────────────────────
  if ((invitation as any).accepted_at) {
    return res.status(400).json({ error: 'This invitation has already been accepted', code: 'ALREADY_ACCEPTED' });
  }

  if ((invitation as any).revoked_at) {
    return res.status(400).json({ error: 'This invitation has been revoked', code: 'REVOKED' });
  }

  const expiresAt = new Date((invitation as any).expires_at);
  if (expiresAt < new Date()) {
    return res.status(400).json({ error: 'This invitation has expired', code: 'EXPIRED' });
  }

  // ── 5. Return email — frontend will call signInWithOtp(email) ─────────────
  return res.status(200).json({ ok: true, email: (invitation as any).email });
}
