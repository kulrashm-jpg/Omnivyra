
/**
 * POST /api/auth/signup
 *
 * Public endpoint. Validates a work email and creates a signup_intent row.
 * Returns { proceed: true } so the frontend can call signInWithOtp().
 *
 * Body: { email: string }
 * No auth required.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../../backend/db/supabaseClient';
import { validateWorkEmail } from '../../../lib/auth/serverValidation';
import { sendMagicLink } from '../../../backend/services/emailService';
import { checkRateLimit, EMAIL_LINK_LIMIT } from '../../../lib/auth/rateLimit';
import { logger } from '../../../backend/services/logger';
import { seedRequestContextFromRequest } from '../../../backend/services/requestContext';

type SuccessResponse = { proceed: true };
type ErrorResponse   = { error: string; code?: string };

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<SuccessResponse | ErrorResponse>,
) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  seedRequestContextFromRequest(req);
  const ip = String(req.headers['x-forwarded-for'] ?? req.socket?.remoteAddress ?? 'unknown').split(',')[0].trim();
  const rl = await checkRateLimit(ip, { ...EMAIL_LINK_LIMIT, keyPrefix: 'rl:auth:signup', limit: 5, windowSecs: 3600 });
  if (!rl.allowed) return res.status(429).json({ error: 'Too many requests. Try again later.' });

  const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
  const { email } = body as { email?: string };

  if (!email?.trim()) return res.status(400).json({ error: 'email is required' });

  const normalizedEmail = email.trim().toLowerCase();

  // ── 1. Validate work email (block personal providers) ─────────────────────
  try {
    validateWorkEmail(normalizedEmail);
  } catch (err: any) {
    return res.status(400).json({ error: err.message, code: 'PERSONAL_EMAIL' });
  }

  // ── 2. Check if user + company both exist ─────────────────────────────────
  // Only block signup when BOTH a user record AND an active company membership
  // exist. If a user abandoned onboarding (no company yet), allow re-signup.
  const { data: existingUser } = await supabase
    .from('users')
    .select('id, is_deleted, has_password')
    .eq('email', normalizedEmail)
    .maybeSingle();

  if (existingUser && (existingUser as any).is_deleted) {
    return res.status(403).json({ error: 'This account has been deactivated.', code: 'ACCOUNT_DELETED' });
  }

  if (existingUser) {
    // Check for active company membership
    const { data: companyRole } = await supabase
      .from('user_company_roles')
      .select('id')
      .eq('user_id', (existingUser as any).id)
      .eq('status', 'active')
      .limit(1)
      .maybeSingle();

    if (companyRole) {
      // Full account exists (user + company) — direct them to login
      return res.status(409).json({
        error: 'An account with this email already exists. Please log in.',
        code:  'ACCOUNT_EXISTS',
      });
    }
    // User exists but no company (incomplete signup) — allow re-signup
  }

  // ── 3. Create or reuse signup_intent ──────────────────────────────────────
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(); // 24h

  // Reuse pending intent if one exists
  const { data: existingIntent } = await supabase
    .from('signup_intents')
    .select('id')
    .eq('email', normalizedEmail)
    .eq('status', 'pending')
    .gt('expires_at', new Date().toISOString())
    .maybeSingle();

  if (!existingIntent) {
    const { error: insertErr } = await supabase.from('signup_intents').insert({
      email:      normalizedEmail,
      source:     'signup_form',
      status:     'pending',
      expires_at: expiresAt,
    });

    if (insertErr) {
      logger.error('auth_signup_intent_insert_failed', { email: normalizedEmail, message: insertErr.message });
      return res.status(500).json({ error: 'Failed to initiate signup' });
    }
  }

  const origin = (process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000').replace(/\/$/, '');
  await sendMagicLink(normalizedEmail, `${origin}/auth/callback`, `auth-signup:${normalizedEmail}`);

  return res.status(200).json({ proceed: true });
}
