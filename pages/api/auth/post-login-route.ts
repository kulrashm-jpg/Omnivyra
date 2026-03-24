/**
 * GET /api/auth/post-login-route
 *
 * Called by /auth/verify immediately after Firebase email-link verification.
 * Returns the correct next route for the user:
 *
 *   /onboarding/phone   — no phone on record yet (new user)
 *   /onboarding/company — has phone but no company yet
 *   /onboarding/verify-phone — company admin, hasn't logged in for 30+ days
 *   /dashboard          — existing user, all checks pass
 *
 * Auth: Firebase ID token in Authorization: Bearer <idToken>
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { createClient } from '@supabase/supabase-js';
import { verifyAuthHeader } from '../../../lib/auth/serverValidation';
import { logAuthEvent } from '../../../lib/auth/auditLog';
import { recordAnomalyEvent } from '../../../lib/auth/anomalyDetector';

type RouteResponse = { route: string };
type ErrorResponse = { error: string; code?: string };

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<RouteResponse | ErrorResponse>,
) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  // ── 1. Verify Firebase ID token — checkRevoked=true so tokens explicitly
  //    revoked via revokeRefreshTokens() (called on user deletion) are rejected
  //    immediately rather than remaining valid for up to 1 hour.
  let firebaseUid: string;
  try {
    const verified = await verifyAuthHeader(req.headers.authorization, true);
    firebaseUid = verified.uid;
  } catch {
    return res.status(401).json({ error: 'Invalid or missing Firebase token' });
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );

  // ── 2. Look up user row by firebase_uid ───────────────────────────────────
  const { data: userRow } = await supabase
    .from('users')
    .select('id, is_phone_verified, company_id, last_sign_in_at, is_deleted')
    .eq('firebase_uid', firebaseUid)
    .maybeSingle();

  if (!userRow) {
    // Ghost session: valid Firebase token but no matching DB row.
    console.warn('[post-login-route] ghost_session_detected', {
      event:  'ghost_session_detected',
      uid:    firebaseUid,
      reason: 'user_not_found_in_db',
    });
    recordAnomalyEvent('ghost_session_detected');
    void logAuthEvent('ghost_session_detected', {
      firebaseUid,
      metadata: { reason: 'user_not_found_in_db', endpoint: 'post-login-route' },
    });
    return res.status(401).json({ error: 'ACCOUNT_DELETED', code: 'AUTH_001' });
  }

  if ((userRow as any).is_deleted) {
    // Soft-deleted user: account was explicitly removed. Block re-access.
    console.warn('[post-login-route] ghost_session_detected', {
      event:  'ghost_session_detected',
      uid:    firebaseUid,
      reason: 'user_is_soft_deleted',
    });
    recordAnomalyEvent('ghost_session_detected');
    void logAuthEvent('ghost_session_detected', {
      userId:     (userRow as any).id,
      firebaseUid,
      metadata: { reason: 'user_is_soft_deleted', endpoint: 'post-login-route' },
    });
    return res.status(401).json({ error: 'ACCOUNT_DELETED', code: 'AUTH_001' });
  }

  const userId: string = (userRow as any).id;

  // ── 3. Check phone verification ────────────────────────────────────────────
  if (!(userRow as any).is_phone_verified) {
    return res.status(200).json({ route: '/onboarding/phone' });
  }

  // ── 4. Check company membership ───────────────────────────────────────────
  const { data: roleRow } = await supabase
    .from('user_company_roles')
    .select('role, company_id')
    .eq('user_id', userId)
    .eq('status', 'active')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!roleRow) {
    return res.status(200).json({ route: '/onboarding/company' });
  }

  // ── 5. Suspicious-login check (company admins only) ───────────────────────
  const isCompanyAdmin = (roleRow as any).role === 'COMPANY_ADMIN';
  if (isCompanyAdmin) {
    const lastSignIn = (userRow as any).last_sign_in_at
      ? new Date((userRow as any).last_sign_in_at)
      : null;
    const daysSince = lastSignIn
      ? (Date.now() - lastSignIn.getTime()) / (1000 * 60 * 60 * 24)
      : Infinity;

    if (daysSince > 30) {
      return res.status(200).json({ route: '/onboarding/verify-phone' });
    }
  }

  return res.status(200).json({ route: '/dashboard' });
}
