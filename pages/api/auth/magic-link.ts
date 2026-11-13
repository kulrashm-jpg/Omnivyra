import { createApiRoute as __createApiRoute } from '../../../lib/platform/routeFactory';

/**
 * POST /api/auth/magic-link
 *
 * Sends the "Send me a magic link" sign-in email for /login. The SERVER sends
 * it (Supabase `signInWithOtp`, shouldCreateUser:false) and only when a usable
 * account exists; the client no longer calls signInWithOtp itself.
 *
 * P2-D (no CAPTCHA anywhere, owner ruling): this route used to answer
 * { proceed: true } for an account and 400 INVALID_CREDENTIALS for none — an
 * enumeration oracle bounded only by the per-IP limiter. It is now uniform:
 *
 *   - Per-IP limit (5/h) AND a global limit (MAGIC_LINK_GLOBAL_LIMIT), both
 *     decided before any lookup; refusal = explicit 429 + Retry-After.
 *   - Identical 200 body (MAGIC_LINK_UNIFORM_BODY) for: account exists (link
 *     sent), no account, soft-deleted account, lookup error, send error.
 *   - Constant work: the public.users lookup and the auth_user_confirmed RPC
 *     both run on every well-formed request.
 *   - Uniform timing: every response is padded to
 *     AUTH_ENUMERATION_MIN_RESPONSE_MS from request start, and the email send
 *     runs detached from the response so its latency cannot mark a hit.
 *
 * Body: { email: string }
 * No auth required.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { authRequestIp } from '../../../backend/auth/requestClientIp';
import { supabase } from '../../../backend/db/supabaseClient';
import { checkRateLimit, EMAIL_LINK_LIMIT, MAGIC_LINK_GLOBAL_LIMIT } from '../../../lib/auth/rateLimit';
import { seedRequestContextFromRequest } from '../../../backend/services/requestContext';
import { getCanonicalAppUrl } from '../../../backend/config/getCanonicalAppUrl';
import { logger } from '../../../backend/services/logger';
import {
  AUTH_RATE_LIMITED_BODY,
  MAGIC_LINK_UNIFORM_BODY,
  getAuthResponseClock,
  padToMinimumLatency,
  retryAfterSeconds,
  runDetachedFromResponse,
} from '../../../backend/auth/uniformAuthResponse';

type Outcome = { status: number; body: unknown; retryAfter?: number };
type Lookup = { data: unknown; error: unknown };

async function accountCanReceiveLink(normalizedEmail: string): Promise<boolean> {
  // Both lookups always run (constant work); the RPC covers a confirmed
  // auth.users identity whose public.users mirror row does not exist yet.
  const failed = (message: string): Lookup => ({ data: null, error: { message } });
  const [userLookup, authLookup] = await Promise.all([
    Promise.resolve(
      supabase.from('users').select('id, is_deleted').eq('email', normalizedEmail).maybeSingle(),
    ).then((r) => r as Lookup, () => failed('lookup_failed')),
    Promise.resolve(
      supabase.rpc('auth_user_confirmed', { p_email: normalizedEmail }),
    ).then((r) => r as Lookup, () => failed('rpc_failed')),
  ]);
  const userRow = userLookup.error ? null : (userLookup.data as { is_deleted?: boolean } | null);
  if (userRow) return userRow.is_deleted !== true;
  return !authLookup.error && authLookup.data === true;
}

async function sendLink(normalizedEmail: string): Promise<void> {
  try {
    const { error } = await supabase.auth.signInWithOtp({
      email: normalizedEmail,
      options: {
        shouldCreateUser: false,
        emailRedirectTo: `${getCanonicalAppUrl()}/auth/callback?mode=passwordless`,
      },
    });
    // Never log the address; the message alone is enough to triage.
    if (error) logger.warn('magic_link_send_failed', { message: error.message });
  } catch (err) {
    logger.warn('magic_link_send_failed', { message: err instanceof Error ? err.message : String(err) });
  }
}

async function decide(req: NextApiRequest): Promise<Outcome> {
  // SEC91-W2B-3: the platform-trusted client IP (lib/security/clientIp). On Vercel
  // that is the edge-set address; off Vercel no forwarding header is trusted
  // unless TRUSTED_PROXY_HOPS is set.
  const ip = authRequestIp(req);
  const rl = await checkRateLimit(ip, { ...EMAIL_LINK_LIMIT, keyPrefix: 'rl:auth:magic-link', limit: 5, windowSecs: 3600 });
  if (!rl.allowed) return { status: 429, body: AUTH_RATE_LIMITED_BODY, retryAfter: retryAfterSeconds(rl.resetAt, Date.now()) };
  // Checked after the per-IP limit so a refused IP never spends the shared budget.
  const globalRl = await checkRateLimit('global', MAGIC_LINK_GLOBAL_LIMIT);
  if (!globalRl.allowed) return { status: 429, body: AUTH_RATE_LIMITED_BODY, retryAfter: retryAfterSeconds(globalRl.resetAt, Date.now()) };

  let body: unknown = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body || '{}'); } catch { return { status: 400, body: { error: 'Invalid request body' } }; }
  }
  const email = (body as { email?: unknown } | null)?.email;
  if (typeof email !== 'string' || !email.trim()) return { status: 400, body: { error: 'email is required' } };

  const normalizedEmail = email.trim().toLowerCase();
  if (await accountCanReceiveLink(normalizedEmail)) {
    runDetachedFromResponse(sendLink(normalizedEmail));
  }
  return { status: 200, body: MAGIC_LINK_UNIFORM_BODY };
}

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  seedRequestContextFromRequest(req);
  const clock = getAuthResponseClock();
  const startedAt = clock.now();
  let out: Outcome;
  try {
    out = await decide(req);
  } catch {
    // Fail without a signal: the uniform body, and nothing was sent.
    out = { status: 200, body: MAGIC_LINK_UNIFORM_BODY };
  }
  await padToMinimumLatency(startedAt, clock);
  if (out.retryAfter !== undefined) res.setHeader('Retry-After', String(out.retryAfter));
  return res.status(out.status).json(out.body);
}

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/auth/magic-link' });
