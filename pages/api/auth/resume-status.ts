// AUTH EXEMPT: auth route handles token exchange/pre-auth flows separately
import type { NextApiRequest, NextApiResponse } from 'next';
import { createServiceRoleMigrationProxy } from '../../../backend/db/supabaseClient';
const supabase = createServiceRoleMigrationProxy('AUTO_MIGRATION_REQUIRED');
import { checkRateLimit, LOGIN_LIMIT } from '../../../lib/auth/rateLimit';
import { seedRequestContextFromRequest } from '../../../backend/services/requestContext';

type SuccessResponse = {
  exists: true;
  hasPassword: boolean;
  nextStep: 'set_password' | 'continue_signup';
};

type ErrorResponse = { error: string; code?: string };

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<SuccessResponse | ErrorResponse>,
) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  seedRequestContextFromRequest(req);

  const ip = String(
    req.headers['x-forwarded-for'] ?? req.socket?.remoteAddress ?? 'unknown',
  ).split(',')[0].trim();
  const rl = await checkRateLimit(ip, { ...LOGIN_LIMIT, keyPrefix: 'rl:auth:resume-status', limit: 10, windowSecs: 15 * 60 });
  if (!rl.allowed) {
    return res.status(429).json({ error: 'Too many requests. Please try again later.' });
  }

  const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body ?? {});
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  if (!email) return res.status(400).json({ error: 'email is required' });

  const { data: userRow } = await supabase
    .from('users')
    .select('id, is_deleted, has_password, company_id, role')
    .eq('email', email)
    .maybeSingle();

  if (!userRow || (userRow as any).is_deleted) {
    return res.status(400).json({ error: 'Invalid credentials', code: 'INVALID_CREDENTIALS' });
  }

  const hasCompletedUserRecord =
    Boolean((userRow as any).company_id) &&
    Boolean((userRow as any).role);

  if (hasCompletedUserRecord) {
    return res.status(400).json({ error: 'Account already exists', code: 'ACCOUNT_EXISTS' });
  }

  const hasPassword = (userRow as any).has_password === true;
  return res.status(200).json({
    exists: true,
    hasPassword,
    nextStep: hasPassword ? 'continue_signup' : 'set_password',
  });
}

