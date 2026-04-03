
/**
 * GET /api/auth/post-login-route
 *
 * Called by /auth/callback after Supabase auth completes.
 * Returns the correct next route for the user:
 *
 *   /onboarding/profile  — new user, no name yet
 *   /onboarding/company  — has profile but no active company membership
 *   /dashboard           — existing user, all checks pass
 *
 * Auth: Supabase access token in Authorization: Bearer <token>
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../../backend/db/supabaseClient';
import { verifySupabaseAuthHeader } from '../../../lib/auth/serverValidation';
import { logAuthEvent } from '../../../lib/auth/auditLog';
import { recordAnomalyEvent } from '../../../lib/auth/anomalyDetector';
import { getPostLoginRoute as getUserPreferenceRoute, upsertUserPreferences } from '../../../backend/services/userPreferencesService';

type RouteResponse = { route: string };
type ErrorResponse = { error: string; code?: string };

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<RouteResponse | ErrorResponse>,
) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  // ── 1. Verify Supabase token ──────────────────────────────────────────────
  let supabaseUid: string;
  let email: string;
  try {
    const verified = await verifySupabaseAuthHeader(req.headers.authorization);
    supabaseUid = verified.id;
    email       = verified.email;
  } catch {
    return res.status(401).json({ error: 'Invalid or missing session token' });
  }

  // ── 2. Look up user row ───────────────────────────────────────────────────
  const { data: userRow } = await supabase
    .from('users')
    .select('id, name, company_id, last_sign_in_at, is_deleted')
    .or(`supabase_uid.eq.${supabaseUid},email.eq.${email.toLowerCase()}`)
    .maybeSingle();

  if (!userRow) {
    // Ghost session: valid token but no DB row — sync endpoint wasn't called yet.
    console.warn('[post-login-route] ghost_session_detected', { supabaseUid });
    recordAnomalyEvent('ghost_session_detected');
    void logAuthEvent('ghost_session_detected', {
      metadata: { reason: 'user_not_found_in_db', endpoint: 'post-login-route' },
    });
    return res.status(401).json({ error: 'ACCOUNT_DELETED', code: 'AUTH_001' });
  }

  if ((userRow as any).is_deleted) {
    recordAnomalyEvent('ghost_session_detected');
    void logAuthEvent('ghost_session_detected', {
      userId:   (userRow as any).id,
      metadata: { reason: 'user_is_soft_deleted', endpoint: 'post-login-route' },
    });
    return res.status(401).json({ error: 'ACCOUNT_DELETED', code: 'AUTH_001' });
  }

  const userId: string = (userRow as any).id;

  // ── 3. New user: no name set yet → complete profile ───────────────────────
  if (!(userRow as any).name) {
    return res.status(200).json({ route: '/onboarding/profile' });
  }

  // ── 4. No active company membership → company setup ──────────────────────
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

  // ── 5. Validate role exists (safety fallback) ──────────────────────────────
  // If role is missing/invalid, default to dashboard for safety
  const userRole = (roleRow as any)?.role;
  if (!userRole) {
    console.warn('[post-login-route] Invalid or missing role', { userId });
    return res.status(200).json({ route: '/dashboard' });
  }

  // ── 6. Check user preferences for post-login landing page ────────────────
  // Default: first-time users → /command-center
  // Returning users: check if they've dismissed the command center
  const preferredRoute = await getUserPreferenceRoute(userId);

  // Create/update preferences if this is first time (auto-upsert)
  try {
    await upsertUserPreferences(userId, {
      default_landing: preferredRoute === '/command-center' ? 'command_center' : 'dashboard',
      command_center_pinned: preferredRoute === '/command-center',
    });
  } catch (err) {
    // Silently fail — preference creation is nice-to-have, not critical
    console.warn('[post-login-route] Failed to upsert preferences:', err);
  }

  return res.status(200).json({ route: preferredRoute });
}
