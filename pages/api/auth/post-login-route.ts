/**
 * GET /api/auth/post-login-route
 *
 * Called by /auth/callback immediately after a magic-link session is established.
 * Returns the correct route for the user:
 *
 *   /dashboard          — existing user, email auth is sufficient
 *   /onboarding/phone   — new user, no phone registered yet
 *   /onboarding/verify-phone — phone verification required (new user finishing
 *                              onboarding, OR company admin flagged as suspicious)
 *   /onboarding/company — authenticated but has no company yet
 *
 * Suspicious-login criteria (company admins only):
 *   • Haven't logged in for more than 30 days
 *
 * Auth: Bearer token
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { createClient } from '@supabase/supabase-js';

type RouteResponse = { route: string };

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<RouteResponse | { error: string }>,
) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const token = (req.headers.authorization ?? '').replace('Bearer ', '').trim();
  if (!token) return res.status(401).json({ error: 'Missing token' });

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );

  const { data: { user }, error: userErr } = await supabase.auth.getUser(token);
  if (userErr || !user) return res.status(401).json({ error: 'Invalid session' });

  // ── 1. Check if user has a phone registered ─────────────────────────────────
  const { data: creditProfile } = await supabase
    .from('free_credit_profiles')
    .select('phone_number')
    .eq('user_id', user.id)
    .maybeSingle();

  const hasPhone = !!(creditProfile as any)?.phone_number;

  if (!hasPhone) {
    // New user or account without phone — needs phone setup
    return res.status(200).json({ route: '/onboarding/phone' });
  }

  // ── 2. Check if user has an active company membership ──────────────────────
  const { data: role } = await supabase
    .from('user_company_roles')
    .select('role, company_id')
    .eq('user_id', user.id)
    .eq('status', 'active')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!role) {
    // Authenticated + has phone but no company → still in onboarding
    return res.status(200).json({ route: '/onboarding/company' });
  }

  const isCompanyAdmin = (role as any).role === 'COMPANY_ADMIN';

  // ── 3. Suspicious-login check (company admins only) ──────────────────────
  if (isCompanyAdmin) {
    const lastSignIn = user.last_sign_in_at ? new Date(user.last_sign_in_at) : null;
    const daysSinceLastLogin = lastSignIn
      ? (Date.now() - lastSignIn.getTime()) / (1000 * 60 * 60 * 24)
      : Infinity;

    if (daysSinceLastLogin > 30) {
      // Admin hasn't logged in for 30+ days — require phone verification
      return res.status(200).json({ route: '/onboarding/verify-phone' });
    }
  }

  // ── 4. Existing user, no red flags — go straight to dashboard ─────────────
  return res.status(200).json({ route: '/dashboard' });
}
