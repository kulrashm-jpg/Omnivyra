
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
import { resolveAuthenticatedUser } from '../../../backend/services/authResolver';
import { logAuthEvent } from '../../../lib/auth/auditLog';
import { recordAnomalyEvent } from '../../../lib/auth/anomalyDetector';
import { getPostLoginRoute as getUserPreferenceRoute, upsertUserPreferences } from '../../../backend/services/userPreferencesService';
import { extractDomain } from '../../../backend/services/companyMatchService';
import { selectCompatibleCompanyRole } from '../../../backend/services/companyMembershipIntegrityService';
// ONBOARD-002 §1/§7 — the single server-derived onboarding authority. Post-login
// routing consumes platformReady from here; it never recomputes readiness.
import { buildOnboardingJourney } from '../../../backend/services/onboardingJourneyService';
import { sendAuthError } from '../../../backend/services/sendAuthError';
import { AUTH_ERROR_CODE } from '../../../shared/contracts/security/AuthErrorCodes';

type RouteResponse = { route: string };
type ErrorResponse = { error: string; code?: string };

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<RouteResponse | ErrorResponse>,
) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  // ── 1. Verify Supabase token (Bearer header OR Supabase auth cookie) ─────
  // resolveAuthenticatedUser joins public.users and enforces lifecycle, so we
  // get the application user id back here in one round-trip — no separate .or()
  // lookup is needed below.
  const authResult = await resolveAuthenticatedUser(req);
  if (authResult.error || !authResult.user) {
    if (authResult.error === 'USER_NOT_FOUND') {
      // Ghost session: valid token but no DB row — sync endpoint wasn't called yet.
      console.warn('[post-login-route] ghost_session_detected', {});
      recordAnomalyEvent('ghost_session_detected');
      void logAuthEvent('ghost_session_detected', {
        metadata: { reason: 'user_not_found_in_db', endpoint: 'post-login-route' },
      });
      sendAuthError(res, AUTH_ERROR_CODE.USER_NOT_FOUND, {
        details: 'Your session is valid but your profile is not synced yet.',
      });
      return;
    }
    if (authResult.error === 'ACCOUNT_DELETED') {
      recordAnomalyEvent('ghost_session_detected');
      void logAuthEvent('ghost_session_detected', {
        metadata: { reason: 'user_is_soft_deleted', endpoint: 'post-login-route' },
      });
      sendAuthError(res, AUTH_ERROR_CODE.ACCOUNT_DELETED);
      return;
    }
    sendAuthError(res, AUTH_ERROR_CODE.INVALID_SESSION);
    return;
  }
  const email: string = authResult.user.email;
  const userId: string = authResult.user.id;

  // ── 1a. App-level email-verification gate (AUTH-001 §1) ──────────────────
  // Backstop for the Supabase project "Confirm email" setting: a session
  // whose auth identity is unconfirmed may not proceed into onboarding or
  // the app. Normally unreachable (Supabase refuses password logins for
  // unconfirmed users), so hitting this indicates the dashboard setting is
  // off or a token was minted through an unexpected path.
  if (!authResult.user.emailVerified) {
    return res.status(200).json({
      route: `/login?reason=verify_email&email=${encodeURIComponent(email)}`,
    });
  }

  // ── 2. Look up user-row fields needed for routing ─────────────────────────
  // Safe lookup by primary key (id is the uuid resolved above) — no .or() with
  // raw email/uid string interpolation.
  const { data: userRow } = await supabase
    .from('users')
    .select('id, name, last_sign_in_at, is_deleted, onboarding_state, has_password')
    .eq('id', userId)
    .maybeSingle();

  if (!userRow) {
    // Defensive — the resolver already returned the row at line above. If
    // this fires the row was deleted between resolution and this select.
    console.warn('[post-login-route] user_row_missing_after_resolve', { userId });
    sendAuthError(res, AUTH_ERROR_CODE.USER_NOT_FOUND, {
      details: 'Your session is valid but your profile is not synced yet.',
    });
    return;
  }

  if ((userRow as any).is_deleted) {
    recordAnomalyEvent('ghost_session_detected');
    void logAuthEvent('ghost_session_detected', {
      userId,
      metadata: { reason: 'user_is_soft_deleted', endpoint: 'post-login-route' },
    });
    sendAuthError(res, AUTH_ERROR_CODE.ACCOUNT_DELETED);
    return;
  }

  const hasPassword = (userRow as any).has_password === true;

  if (!hasPassword) {
    return res.status(200).json({ route: '/auth/set-password' });
  }

  // ── 3. Role lookup (for SUPER_ADMIN precedence + preferred landing) ───────
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

  const resolvedRole = roleRow?.role;

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

  // ── 6. ONBOARD-002 §1/§7 — Platform Ready controls routing. Consume the ONE
  // server-derived journey authority (never recompute readiness here):
  //   platformReady  → the workspace (user-preferred landing)
  //   not ready      → the canonical journey, which resumes exactly where the
  //                    user stopped (works before profile/company exist too).
  // Every incomplete state (verify / profile / company / integrations) converges
  // on /onboarding/journey — the single visible onboarding experience.
  let platformReady = false;
  try {
    const journey = await buildOnboardingJourney(userId);
    platformReady = journey.platformReady;
  } catch (err) {
    // Fail-open to the journey — never trap the user; the journey re-derives and
    // routes forward on its own.
    console.warn('[post-login-route] journey_build_failed', { userId, message: err instanceof Error ? err.message : String(err) });
    return res.status(200).json({ route: '/onboarding/journey' });
  }

  if (!platformReady) {
    return res.status(200).json({ route: '/onboarding/journey' });
  }

  // ── 7. Platform Ready → user-preferred workspace landing (command_center | dashboard) ──
  const preferredRoute = await getUserPreferenceRoute(userId);
  await upsertUserPreferences(userId, {
    default_landing: preferredRoute === '/command-center' ? 'command_center' : 'dashboard',
    command_center_pinned: preferredRoute === '/command-center',
  });

  return res.status(200).json({ route: preferredRoute });
}
