import type { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../../backend/db/supabaseClient';
import { checkRateLimit, LOGIN_LIMIT } from '../../../lib/auth/rateLimit';
import { seedRequestContextFromRequest } from '../../../backend/services/requestContext';
import {
  deriveSignupLifecycle,
  type SignupLifecycleState,
} from '../../../backend/services/signupLifecycleService';

type SuccessResponse = {
  exists: true;
  hasPassword: boolean;
  nextStep: 'set_password' | 'continue_signup';
  /**
   * AUTH-001R §2 — canonical journey state + server-derived resume step.
   * ADDITIVE: legacy clients keep using exists/hasPassword/nextStep; new
   * clients resume from the lifecycle instead of frontend routing.
   */
  lifecycleState?: SignupLifecycleState;
  lifecycleNextStep?: string;
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

  // Canonical "completed account" signal is an active row in
  // user_company_roles. users.company_id / users.role are deprecated and
  // no longer read here.
  const { data: userRow } = await supabase
    .from('users')
    .select('id, is_deleted, has_password')
    .eq('email', email)
    .maybeSingle();

  if (!userRow || (userRow as any).is_deleted) {
    return res.status(400).json({ error: 'Invalid credentials', code: 'INVALID_CREDENTIALS' });
  }

  const { data: completedMembership } = await supabase
    .from('user_company_roles')
    .select('id')
    .eq('user_id', (userRow as any).id)
    .eq('status', 'active')
    .limit(1)
    .maybeSingle();

  if (completedMembership) {
    return res.status(400).json({ error: 'Account already exists', code: 'ACCOUNT_EXISTS' });
  }

  const hasPassword = (userRow as any).has_password === true;

  // AUTH-001R §2 — canonical, deterministic journey derivation (pure read
  // over the existing authorities; retry/refresh/replay safe). Best-effort:
  // a derivation failure degrades to the legacy response, never a 500.
  const lifecycle = await deriveSignupLifecycle(email);

  return res.status(200).json({
    exists: true,
    hasPassword,
    nextStep: hasPassword ? 'continue_signup' : 'set_password',
    ...(lifecycle ? { lifecycleState: lifecycle.state, lifecycleNextStep: lifecycle.nextStep } : {}),
  });
}
