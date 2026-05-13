
/**
 * GET /api/auth/post-login-route
 *
 * Called by /auth/callback after Supabase auth completes.
 * Returns the correct next route for the user:
 *
 *   /onboarding/profile  — new user, no name yet
 *   /onboarding/company  — has profile but no active company membership
 *   /command-center      — default workspace landing for eligible users
 *
 * Auth: Supabase access token in Authorization: Bearer <token>
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../../backend/db/supabaseClient';
import { verifySupabaseAuthHeader } from '../../../lib/auth/serverValidation';
import { logAuthEvent } from '../../../lib/auth/auditLog';
import { recordAnomalyEvent } from '../../../lib/auth/anomalyDetector';
import { getPostLoginRoute as getUserPreferenceRoute, upsertUserPreferences } from '../../../backend/services/userPreferencesService';
import { extractDomain } from '../../../backend/services/companyMatchService';
import { selectCompatibleCompanyRole } from '../../../backend/services/companyMembershipIntegrityService';
import { sendAuthError } from '../../../backend/services/sendAuthError';
import { AUTH_ERROR_CODE } from '../../../shared/contracts/security/AuthErrorCodes';

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
    sendAuthError(res, AUTH_ERROR_CODE.INVALID_SESSION);
    return;
  }

  // ── 2. Look up user row ───────────────────────────────────────────────────
  // Note: we no longer SELECT users.company_id / users.role — both are
  // deprecated identity authorities. Active org and role are derived from
  // user_company_roles below.
  const { data: userRow } = await supabase
    .from('users')
    .select('id, name, last_sign_in_at, is_deleted, onboarding_state, has_password')
    .or(`supabase_uid.eq.${supabaseUid},email.eq.${email.toLowerCase()}`)
    .maybeSingle();

  if (!userRow) {
    // Ghost session: valid token but no DB row — sync endpoint wasn't called yet.
    console.warn('[post-login-route] ghost_session_detected', { supabaseUid });
    recordAnomalyEvent('ghost_session_detected');
    void logAuthEvent('ghost_session_detected', {
      metadata: { reason: 'user_not_found_in_db', endpoint: 'post-login-route' },
    });
    sendAuthError(res, AUTH_ERROR_CODE.USER_NOT_FOUND, {
      details: 'Your session is valid but your profile is not synced yet.',
    });
    return;
  }

  if ((userRow as any).is_deleted) {
    recordAnomalyEvent('ghost_session_detected');
    void logAuthEvent('ghost_session_detected', {
      userId:   (userRow as any).id,
      metadata: { reason: 'user_is_soft_deleted', endpoint: 'post-login-route' },
    });
    sendAuthError(res, AUTH_ERROR_CODE.ACCOUNT_DELETED);
    return;
  }

  const userId: string = (userRow as any).id;
  const onboardingState = String((userRow as any).onboarding_state ?? '');
  const hasPassword = (userRow as any).has_password === true;

  if (!hasPassword) {
    return res.status(200).json({ route: '/auth/set-password' });
  }

  // ── 3. New user: no name set yet → complete profile ───────────────────────
  if (
    !(userRow as any).name ||
    onboardingState === 'verified' ||
    onboardingState === 'pending_verification'
  ) {
    return res.status(200).json({ route: '/onboarding/profile' });
  }

  // ── 4. Active company membership lookup → company setup if missing ───────
  // Authority: user_company_roles is the canonical role + active-org store.
  // We do NOT back-fill users.company_id / users.role any more — both are
  // deprecated runtime authorities.
  const { data: activeRoleRows } = await supabase
    .from('user_company_roles')
    .select('role, company_id, join_source, created_at')
    .eq('user_id', userId)
    .eq('status', 'active')
    .order('created_at', { ascending: false });

  const rawRoleRows = (activeRoleRows as Array<{ role?: string | null; company_id?: string | null; join_source?: string | null }> | null) ?? [];
  const companyIds = Array.from(new Set(rawRoleRows.map((row) => row.company_id).filter(Boolean) as string[]));
  const { data: companyRows } = companyIds.length
    ? await supabase
        .from('companies')
        .select('id, website_domain, admin_email_domain')
        .in('id', companyIds)
    : { data: [] as any[] };
  const companyById = new Map((companyRows || []).map((row: any) => [String(row.id), row]));
  const emailDomain = extractDomain(email);
  const roleRow = selectCompatibleCompanyRole({
    rows: rawRoleRows,
    companyById,
    userEmail: email,
  });
  if (rawRoleRows.length > 0 && !roleRow) {
    console.warn('[post-login-route] ignoring mismatched self-registered company role', {
      userId,
      emailDomain,
      companyIds,
    });
  }

  if (!roleRow) {
    return res.status(200).json({ route: '/onboarding/company' });
  }

  // ── 5. Validate role exists (safety fallback) ──────────────────────────────
  // If role is missing/invalid, default to command center for safety
  const resolvedRole = roleRow.role;
  if (!resolvedRole) {
    console.warn('[post-login-route] Invalid or missing role', { userId });
    return res.status(200).json({ route: '/command-center' });
  }

  // ── 5a. Platform-operator routing — SUPER_ADMIN takes precedence ─────────
  // SUPER_ADMINs are platform operators, not tenant users. They MUST land
  // in the platform runtime (/super-admin/dashboard), never in the customer
  // command-center / onboarding / free-credit funnels — those are tenant UX
  // and would surface customer artefacts (300-credit prompts, onboarding
  // modals, tenant company chrome) to a platform principal.
  //
  // This check sits AFTER role resolution so that a SUPER_ADMIN whose only
  // user_company_roles row was somehow inactive still falls through to the
  // standard command-center flow with no role; once they have an active
  // SUPER_ADMIN role row (which is the canonical bootstrap shape) they go
  // straight to the platform runtime regardless of user preferences.
  if (resolvedRole === 'SUPER_ADMIN') {
    return res.status(200).json({ route: '/super-admin/dashboard' });
  }

  // ── 6. Check user preferences for post-login landing page ────────────────
  // Default: first-time users → /command-center
  // Returning users: check if they've dismissed the command center
  const preferredRoute = await getUserPreferenceRoute(userId);

  // Create/update preferences if this is first time (auto-upsert)
  await upsertUserPreferences(userId, {
    default_landing: preferredRoute === '/command-center' ? 'command_center' : 'dashboard',
    command_center_pinned: preferredRoute === '/command-center',
  });

  return res.status(200).json({ route: preferredRoute });
}
