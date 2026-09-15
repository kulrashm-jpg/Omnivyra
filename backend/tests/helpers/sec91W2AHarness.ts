/**
 * SEC-91 W2-A (STEP 3AH-91, wave 2) — role-aware identity extension for the
 * ROUTE-AUTH-001 harness.
 *
 * routeAuthHarness.ts (read-only) fakes the database and the identity provider
 * with three callers (A, B, SUPER), all of them admins. The W2-A fixes are
 * SAME-company role decisions (VIEW_ONLY vs content roles vs admins), so this
 * module adds one principal per company role in company A and supplies the
 * matching identity / auth-resolver fakes. The shared harness's database,
 * fixtures and invoke() are reused unchanged.
 *
 * Wire exactly like the shared harness, swapping only the identity modules:
 *   jest.mock('../../services/supabaseAuthService', () => require('../helpers/sec91W2AHarness').authModule());
 *   jest.mock('../../security/IdentityResolver', () => require('../helpers/sec91W2AHarness').identityModule());
 *   jest.mock('../../services/authResolver', () => require('../helpers/sec91W2AHarness').authResolverModule());
 * and seed the extra membership rows with `seed({ user_company_roles: roleRows(), ... })`.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { CO_A, USER_A, USER_B, USER_SUPER } from './routeAuthHarness';

export const USER_VIEWER = 'user-w-00-0000-0000-00000000000v';
export const USER_CREATOR = 'user-w-00-0000-0000-00000000000c';
export const USER_PUBLISHER = 'user-w-00-0000-0000-00000000000p';
export const USER_REVIEWER = 'user-w-00-0000-0000-00000000000r';
/** Legacy alias rows ('VIEWER', 'CONTENT_ENGAGER') normalise to VIEW_ONLY. */
export const USER_ENGAGER = 'user-w-00-0000-0000-00000000000e';

export const W2A_TOKENS = {
  A: 'tok-user-a',
  B: 'tok-user-b',
  SUPER: 'tok-user-super',
  VIEWER: 'tok-w2a-viewer',
  CREATOR: 'tok-w2a-creator',
  PUBLISHER: 'tok-w2a-publisher',
  REVIEWER: 'tok-w2a-reviewer',
  ENGAGER: 'tok-w2a-engager',
} as const;
export type W2APrincipal = keyof typeof W2A_TOKENS;

const USERS_BY_TOKEN: Record<string, { id: string; email: string }> = {
  'tok-user-a': { id: USER_A, email: 'a@example.test' },
  'tok-user-b': { id: USER_B, email: 'b@example.test' },
  'tok-user-super': { id: USER_SUPER, email: 's@example.test' },
  'tok-w2a-viewer': { id: USER_VIEWER, email: 'viewer@example.test' },
  'tok-w2a-creator': { id: USER_CREATOR, email: 'creator@example.test' },
  'tok-w2a-publisher': { id: USER_PUBLISHER, email: 'publisher@example.test' },
  'tok-w2a-reviewer': { id: USER_REVIEWER, email: 'reviewer@example.test' },
  'tok-w2a-engager': { id: USER_ENGAGER, email: 'engager@example.test' },
};

/** Active company-A membership rows for the extra principals. */
export function roleRows(): Array<Record<string, unknown>> {
  return [
    { user_id: USER_VIEWER, company_id: CO_A, role: 'VIEW_ONLY', status: 'active' },
    { user_id: USER_CREATOR, company_id: CO_A, role: 'CONTENT_CREATOR', status: 'active' },
    { user_id: USER_PUBLISHER, company_id: CO_A, role: 'CONTENT_PUBLISHER', status: 'active' },
    { user_id: USER_REVIEWER, company_id: CO_A, role: 'CONTENT_REVIEWER', status: 'active' },
    { user_id: USER_ENGAGER, company_id: CO_A, role: 'CONTENT_ENGAGER', status: 'active' },
  ];
}

function tokenOf(req: any): string | null {
  const h = req?.headers?.authorization || req?.headers?.Authorization;
  if (typeof h === 'string' && h.startsWith('Bearer ')) return h.slice(7);
  return null;
}

export function userForRequest(req: any): { id: string; email: string } | null {
  const t = tokenOf(req);
  return t ? USERS_BY_TOKEN[t] ?? null : null;
}

/** Authorization header for a named principal. */
export function as(who: W2APrincipal): Record<string, string> {
  return { authorization: `Bearer ${W2A_TOKENS[who]}` };
}

export function authModule() {
  const getSupabaseUserFromRequest = jest.fn(async (req: any) => {
    const u = userForRequest(req);
    if (u) return { user: { ...u, emailVerified: true }, error: null };
    return { user: null, error: tokenOf(req) ? 'INVALID_AUTH' : 'MISSING_AUTH' };
  });
  return {
    getSupabaseUserFromRequest,
    extractAccessToken: (req: any) => tokenOf(req),
  };
}

export function identityModule() {
  return {
    resolvePrincipal: jest.fn(async (req: any) => {
      const u = userForRequest(req);
      return u
        ? { ok: true, principal: { userId: u.id, supabaseUid: u.id, email: u.email, legacyCookieSuperAdmin: false, organizations: [] } }
        : { ok: false, reason: 'NO_AUTH' };
    }),
  };
}

/** authMiddleware.requireAuth resolves through authResolver directly. */
export function authResolverModule() {
  return {
    resolveAuthenticatedUser: jest.fn(async (req: any) => {
      const u = userForRequest(req);
      return u
        ? { user: { id: u.id, supabaseUid: u.id, email: u.email, status: 'active', emailVerified: true }, error: null }
        : { user: null, error: 'NO_TOKEN' };
    }),
    extractAccessToken: (req: any) => tokenOf(req),
    extractBearerToken: (req: any) => tokenOf(req),
  };
}
