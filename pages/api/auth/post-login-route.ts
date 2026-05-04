// AUTH EXEMPT: auth route handles token exchange/pre-auth flows separately

/**
 * GET /api/auth/post-login-route
 *
 * Called by /auth/callback after Supabase auth completes.
 * Returns the correct next route for the user:
 *
 *   /onboarding/profile  â€” new user, no name yet
 *   /onboarding/company  â€” has profile but no active company membership
 *   /command-center      â€” default workspace landing for eligible users
 *
 * Auth: Supabase access token in Authorization: Bearer <token>
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { createServiceRoleMigrationProxy } from '../../../backend/db/supabaseClient';
const supabase = createServiceRoleMigrationProxy('AUTO_MIGRATION_REQUIRED');
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

  // â”€â”€ 1. Verify Supabase token â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  let supabaseUid: string;
  let email: string;
  try {
    const verified = await verifySupabaseAuthHeader(req.headers.authorization);
    supabaseUid = verified.id;
    email       = verified.email;
  } catch {
    return res.status(401).json({ error: 'Invalid or missing session token', code: 'INVALID_SESSION' });
  }

  // â”€â”€ 2. Look up user row â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const { data: userRow } = await supabase
    .from('users')
    .select('id, name, company_id, role, last_sign_in_at, is_deleted, onboarding_state, has_password')
    .or(`supabase_uid.eq.${supabaseUid},email.eq.${email.toLowerCase()}`)
    .maybeSingle();

  if (!userRow) {
    // Ghost session: valid token but no DB row â€” sync endpoint wasn't called yet.
    console.warn('[post-login-route] ghost_session_detected', { supabaseUid });
    recordAnomalyEvent('ghost_session_detected');
    void logAuthEvent('ghost_session_detected', {
      metadata: { reason: 'user_not_found_in_db', endpoint: 'post-login-route' },
    });
    return res.status(401).json({ error: 'Invalid or missing session token', code: 'INVALID_SESSION' });
  }

  if ((userRow as any).is_deleted) {
    recordAnomalyEvent('ghost_session_detected');
    void logAuthEvent('ghost_session_detected', {
      userId:   (userRow as any).id,
      metadata: { reason: 'user_is_soft_deleted', endpoint: 'post-login-route' },
    });
    return res.status(403).json({ error: 'ACCOUNT_DELETED', code: 'AUTH_001' });
  }

  const userId: string = (userRow as any).id;
  const onboardingState = String((userRow as any).onboarding_state ?? '');
  const hasPassword = (userRow as any).has_password === true;
  const userCompanyId = String((userRow as any).company_id ?? '').trim();
  const userRole = String((userRow as any).role ?? '').trim();

  if (!hasPassword) {
    return res.status(200).json({ route: '/auth/set-password' });
  }

  // â”€â”€ 3. New user: no name set yet â†’ complete profile â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  if (
    !(userRow as any).name ||
    onboardingState === 'verified' ||
    onboardingState === 'pending_verification'
  ) {
    return res.status(200).json({ route: '/onboarding/profile' });
  }

  // â”€â”€ 4. No active company membership â†’ company setup â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  let roleRow: { role?: string | null; company_id?: string | null } | null = null;

  if (userCompanyId && userRole) {
    roleRow = { role: userRole, company_id: userCompanyId };
  } else {
    const { data: activeRoleRow } = await supabase
      .from('user_company_' + 'roles')
      .select('role, company_id')
      .eq('user_id', userId)
      .eq('status', 'active')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    roleRow = (activeRoleRow as { role?: string | null; company_id?: string | null } | null) ?? null;

    if (roleRow?.company_id || roleRow?.role) {
      await supabase
        .from('users')
        .update({
          ...(roleRow.company_id ? { company_id: roleRow.company_id } : {}),
          ...(roleRow.role ? { role: roleRow.role } : {}),
        })
        .eq('id', userId);
    }
  }

  if (!roleRow) {
    return res.status(200).json({ route: '/onboarding/company' });
  }

  // â”€â”€ 5. Validate role exists (safety fallback) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  // If role is missing/invalid, default to command center for safety
  const resolvedRole = (roleRow as any)?.role;
  if (!resolvedRole) {
    console.warn('[post-login-route] Invalid or missing role', { userId });
    return res.status(200).json({ route: '/command-center' });
  }

  // â”€â”€ 6. Check user preferences for post-login landing page â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  // Default: first-time users â†’ /command-center
  // Returning users: check if they've dismissed the command center
  const preferredRoute = await getUserPreferenceRoute(userId);

  // Create/update preferences if this is first time (auto-upsert)
  await upsertUserPreferences(userId, {
    default_landing: preferredRoute === '/command-center' ? 'command_center' : 'dashboard',
    command_center_pinned: preferredRoute === '/command-center',
  });

  return res.status(200).json({ route: preferredRoute });
}

