import type { NextApiRequest, NextApiResponse } from 'next';
import { sendReset } from '../../../backend/services/emailService';
import { supabase } from '../../../backend/db/supabaseClient';
import { checkRateLimit, EMAIL_LINK_LIMIT } from '../../../lib/auth/rateLimit';
import { seedRequestContextFromRequest } from '../../../backend/services/requestContext';

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

  const origin = (process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000').replace(/\/$/, '');
  const { data: userRow } = await supabase
    .from('users')
    .select('id, is_deleted, has_password')
    .eq('email', email)
    .maybeSingle();

  if (userRow && !(userRow as any).is_deleted && (userRow as any).has_password) {
    await sendReset(email, `${origin}/auth/set-password?flow=recovery`, `auth-reset:${email}`);
  }

  return res.status(200).json({ ok: true });
}
