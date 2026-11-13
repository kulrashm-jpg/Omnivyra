import { createApiRoute as __createApiRoute } from '../../../lib/platform/routeFactory';

/**
 * POST /api/auth/login
 *
 * Public endpoint. Per-IP rate limit for the password sign-in, then { proceed: true } for every well-formed request
 * so the frontend can call signInWithPassword(). It deliberately reveals NOTHING about whether an account exists
 * (e1 2026-11-13; see the handler).
 *
 * Body: { email: string }
 * No auth required.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { authRequestIp } from '../../../backend/auth/requestClientIp';
import { checkRateLimit, LOGIN_LIMIT } from '../../../lib/auth/rateLimit';

type SuccessResponse = { proceed: true };
type ErrorResponse   = { error: string; code?: string };

async function handler(
  req: NextApiRequest,
  res: NextApiResponse<SuccessResponse | ErrorResponse>,
) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // Rate limit: 10 pre-check attempts per IP per 15 min. Slows credential stuffing into signInWithPassword
  // downstream (the pre-check itself no longer answers differently per account - see below).
  const ip = authRequestIp(req);
  const rl = await checkRateLimit(ip, LOGIN_LIMIT);
  if (!rl.allowed) {
    return res.status(429).json({ error: 'Too many sign-in attempts. Please try again later.' });
  }

  const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
  const { email } = body as { email?: string };

  if (!email?.trim()) return res.status(400).json({ error: 'email is required' });

  // e1 2026-11-13 (e9 ruling; no CAPTCHA anywhere): the pre-check NO LONGER reveals whether an account exists.
  // It used to answer INVALID_CREDENTIALS for an unknown / deleted address and NO_PASSWORD for an existing account
  // without a password - an existence oracle bounded only by the rate limit. It now answers the SAME 200 for every
  // well-formed request and reads nothing. The browser then calls signInWithPassword, whose failure is the same
  // generic "Invalid login credentials" for an unknown address, a wrong password and a passwordless account; the
  // login page shows one neutral message that points a genuine passwordless user to the magic link (which itself
  // answers uniformly). Soft-deleted accounts are still refused after sign-in by sync-supabase-user (ACCOUNT_DELETED).
  return res.status(200).json({ proceed: true });
}

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/auth/login' });
