import { createApiRoute as __createApiRoute } from '../../../lib/platform/routeFactory';

/**
 * POST /api/auth/magic-link
 *
 * Pre-check for the "Send me a magic link" button on /login. Returns
 * { proceed: true } if a usable account exists, and the client then calls
 * `supabase.auth.signInWithOtp({ email, options: { shouldCreateUser: false, emailRedirectTo } })`.
 *
 * Magic link is login-only; signup requires a password. We keep this
 * pre-check so we can return a real "no account" error code (Supabase,
 * by design, does not distinguish) without leaking enumeration — callers
 * only see it after passing our own rate limiter.
 *
 * Body: { email: string }
 * No auth required.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../../backend/db/supabaseClient';
import { checkRateLimit, EMAIL_LINK_LIMIT } from '../../../lib/auth/rateLimit';
import { seedRequestContextFromRequest } from '../../../backend/services/requestContext';

type SuccessResponse = { proceed: true };
type ErrorResponse   = { error: string; code?: string };

async function handler(
  req: NextApiRequest,
  res: NextApiResponse<SuccessResponse | ErrorResponse>,
) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  seedRequestContextFromRequest(req);
  // Prefer Vercel-authoritative `x-real-ip` (single value, set by Vercel's
  // edge after sanitizing client-supplied headers) over the leftmost token of
  // `x-forwarded-for`. On Vercel both produce the real client IP; off-Vercel
  // the x-forwarded-for[0] path is attacker-controlled and would allow
  // rate-limit bypass or poisoning of another user's bucket.
  const realIp = req.headers['x-real-ip'];
  const forwardedFor = String(req.headers['x-forwarded-for'] ?? '').split(',')[0].trim();
  const ip = String((Array.isArray(realIp) ? realIp[0] : realIp) || forwardedFor || req.socket?.remoteAddress || 'unknown').trim();
  const rl = await checkRateLimit(ip, { ...EMAIL_LINK_LIMIT, keyPrefix: 'rl:auth:magic-link', limit: 5, windowSecs: 3600 });
  if (!rl.allowed) return res.status(429).json({ error: 'Too many requests. Try again later.' });

  const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
  const { email } = body as { email?: string };

  if (!email?.trim()) return res.status(400).json({ error: 'email is required' });

  const normalizedEmail = email.trim().toLowerCase();

  const { data: userRow } = await supabase
    .from('users')
    .select('id, is_deleted')
    .eq('email', normalizedEmail)
    .maybeSingle();

  if (!userRow) {
    try {
      const { data: authConfirmed, error: rpcErr } = await supabase.rpc('auth_user_confirmed', {
        p_email: normalizedEmail,
      });
      if (!rpcErr && authConfirmed === true) {
        return res.status(200).json({ proceed: true });
      }
    } catch {
      // Fall through to generic error
    }
    return res.status(400).json({ error: 'Invalid credentials', code: 'INVALID_CREDENTIALS' });
  }

  if ((userRow as any).is_deleted) {
    return res.status(400).json({ error: 'Invalid credentials', code: 'INVALID_CREDENTIALS' });
  }

  return res.status(200).json({ proceed: true });
}

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/auth/magic-link' });
