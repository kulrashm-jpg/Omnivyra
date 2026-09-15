/**
 * SEC-91 W2-G (STEP 3AH-91, wave 2 residuals) — extra principals for the
 * ROUTE-AUTH-001 harness, on top of the W2-A role principals.
 *
 * routeAuthHarness.ts fakes the database with two companies and three admins;
 * sec91W2AHarness.ts adds one principal per company role in company A. W2-G
 * also needs principals whose MEMBERSHIP SHAPE matters:
 *
 *   INVITED_ADMIN    — status='invited' COMPANY_ADMIN row in A (the legacy
 *                      invited-admin fallback of enforceCompanyAccess)
 *   INVITED_CREATOR  — status='invited' CONTENT_CREATOR row in A (never admitted)
 *   LEGACY_ADMIN     — active 'ADMIN' row in A        (normalises to COMPANY_ADMIN)
 *   LEGACY_MANAGER   — active 'CONTENT_MANAGER' row   (normalises to CONTENT_CREATOR)
 *   LEGACY_VIEWER    — active 'VIEWER' row            (normalises to VIEW_ONLY)
 *   SPLIT            — VIEW_ONLY in A, COMPANY_ADMIN in B (role must come from
 *                      the company the route authorized)
 *   ARCHITECT        — the synthetic `content_architect` principal
 *
 * Every other token is delegated to the W2-A harness, so the W2-A principals
 * (VIEWER, CREATOR, …) and the shared ones (A, B, SUPER) keep working. Wire:
 *   jest.mock('../../services/supabaseAuthService', () => require('../helpers/sec91W2GHarness').authModule());
 *   jest.mock('../../security/IdentityResolver', () => require('../helpers/sec91W2GHarness').identityModule());
 *   jest.mock('../../services/authResolver', () => require('../helpers/sec91W2GHarness').authResolverModule());
 * and seed `user_company_roles: [...roleRows(), ...w2gRoleRows()]`.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { CO_A, CO_B } from './routeAuthHarness';
import { W2A_TOKENS, userForRequest as w2aUserForRequest } from './sec91W2AHarness';

export const USER_INVITED_ADMIN = 'user-g-00-0000-0000-0000000000ia';
export const USER_INVITED_CREATOR = 'user-g-00-0000-0000-0000000000ic';
export const USER_LEGACY_ADMIN = 'user-g-00-0000-0000-0000000000la';
export const USER_LEGACY_MANAGER = 'user-g-00-0000-0000-0000000000lm';
export const USER_LEGACY_VIEWER = 'user-g-00-0000-0000-0000000000lv';
export const USER_SPLIT = 'user-g-00-0000-0000-0000000000sp';
export const USER_ARCHITECT = 'content_architect';

const W2G_TOKENS = {
  INVITED_ADMIN: 'tok-w2g-invited-admin',
  INVITED_CREATOR: 'tok-w2g-invited-creator',
  LEGACY_ADMIN: 'tok-w2g-legacy-admin',
  LEGACY_MANAGER: 'tok-w2g-legacy-manager',
  LEGACY_VIEWER: 'tok-w2g-legacy-viewer',
  SPLIT: 'tok-w2g-split',
  ARCHITECT: 'tok-w2g-architect',
} as const;

export const TOKENS = { ...W2A_TOKENS, ...W2G_TOKENS } as const;
export type W2GPrincipal = keyof typeof TOKENS;

const EXTRA_USERS: Record<string, { id: string; email: string }> = {
  [W2G_TOKENS.INVITED_ADMIN]: { id: USER_INVITED_ADMIN, email: 'invited-admin@example.test' },
  [W2G_TOKENS.INVITED_CREATOR]: { id: USER_INVITED_CREATOR, email: 'invited-creator@example.test' },
  [W2G_TOKENS.LEGACY_ADMIN]: { id: USER_LEGACY_ADMIN, email: 'legacy-admin@example.test' },
  [W2G_TOKENS.LEGACY_MANAGER]: { id: USER_LEGACY_MANAGER, email: 'legacy-manager@example.test' },
  [W2G_TOKENS.LEGACY_VIEWER]: { id: USER_LEGACY_VIEWER, email: 'legacy-viewer@example.test' },
  [W2G_TOKENS.SPLIT]: { id: USER_SPLIT, email: 'split@example.test' },
  [W2G_TOKENS.ARCHITECT]: { id: USER_ARCHITECT, email: 'architect@example.test' },
};

/** Membership rows for the W2-G principals (the architect has none by design). */
export function w2gRoleRows(): Array<Record<string, unknown>> {
  return [
    { user_id: USER_INVITED_ADMIN, company_id: CO_A, role: 'COMPANY_ADMIN', status: 'invited' },
    { user_id: USER_INVITED_CREATOR, company_id: CO_A, role: 'CONTENT_CREATOR', status: 'invited' },
    { user_id: USER_LEGACY_ADMIN, company_id: CO_A, role: 'ADMIN', status: 'active' },
    { user_id: USER_LEGACY_MANAGER, company_id: CO_A, role: 'CONTENT_MANAGER', status: 'active' },
    { user_id: USER_LEGACY_VIEWER, company_id: CO_A, role: 'VIEWER', status: 'active' },
    { user_id: USER_SPLIT, company_id: CO_A, role: 'VIEW_ONLY', status: 'active' },
    { user_id: USER_SPLIT, company_id: CO_B, role: 'COMPANY_ADMIN', status: 'active' },
  ];
}

function tokenOf(req: any): string | null {
  const h = req?.headers?.authorization || req?.headers?.Authorization;
  if (typeof h === 'string' && h.startsWith('Bearer ')) return h.slice(7);
  return null;
}

export function userForRequest(req: any): { id: string; email: string } | null {
  const t = tokenOf(req);
  if (t && EXTRA_USERS[t]) return EXTRA_USERS[t];
  return w2aUserForRequest(req);
}

/** Authorization header for a named principal. */
export function as(who: W2GPrincipal): Record<string, string> {
  return { authorization: `Bearer ${TOKENS[who]}` };
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
