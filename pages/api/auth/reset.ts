/**
 * POST /api/auth/reset
 *
 * Rate-limit gate for password reset. Always returns { ok: true } to avoid
 * email enumeration. The client calls
 * `supabase.auth.resetPasswordForEmail(email, { redirectTo })`
 * directly afterwards; Supabase sends the email itself.
 *
 * Body: { email: string }
 * No auth required.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { checkRateLimit, EMAIL_LINK_LIMIT } from '../../../lib/auth/rateLimit';
import { seedRequestContextFromRequest } from '../../../backend/services/requestContext';
import { verifyCaptchaToken, CAPTCHA_FAILED_RESPONSE } from '../../../lib/auth/captcha';

type SuccessResponse = { ok: true };
type ErrorResponse = { error: string };

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<SuccessResponse | ErrorResponse>,
) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  seedRequestContextFromRequest(req);
  const ip = String(req.headers['x-forwarded-for'] ?? req.socket?.remoteAddress ?? 'unknown').split(',')[0].trim();
  const rl = await checkRateLimit(ip, { ...EMAIL_LINK_LIMIT, keyPrefix: 'rl:auth:reset', limit: 5, windowSecs: 3600 });
  if (!rl.allowed) return res.status(429).json({ error: 'Too many requests. Try again later.' });

  const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body ?? {});
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  if (!email) return res.status(400).json({ error: 'email is required' });

  // CAPTCHA (no-op until CAPTCHA_PROVIDER is configured — AUTH-001 §3).
  const captcha = await verifyCaptchaToken(body.captchaToken, ip);
  if (!captcha.ok) return res.status(400).json(CAPTCHA_FAILED_RESPONSE);

  return res.status(200).json({ ok: true });
}
