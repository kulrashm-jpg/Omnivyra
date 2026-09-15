/**
 * SEC-91A (STEP 3AH-91) — identity extension for the ROUTE-AUTH-001 harness.
 *
 * routeAuthHarness.ts (read-only for this workstream) fakes only the database
 * and the identity provider, with three callers (A, B, SUPER). SEC-91A needs
 * more principals to prove its fixes — an invited member, a deactivated super
 * admin, a user who is COMPANY_ADMIN in one company but VIEW_ONLY in another —
 * so this module supplies identity/auth fakes that know those extra tokens and
 * reuses the shared harness's database, fixtures and invoke() unchanged.
 *
 * Wire exactly like the shared harness, swapping only the identity modules:
 *   jest.mock('../../services/supabaseAuthService', () => require('../helpers/sec91AHarness').authModule());
 *   jest.mock('../../security/IdentityResolver', () => require('../helpers/sec91AHarness').identityModule());
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { USER_A, USER_B, USER_SUPER } from './routeAuthHarness';

/** Extra principals (ids are opaque strings, like the shared harness's). */
export const USER_INVITED = 'user-i-00-0000-0000-00000000000i';
export const USER_EXSUPER = 'user-x-00-0000-0000-00000000000x';
export const USER_VIEWER = 'user-v-00-0000-0000-00000000000v';
export const USER_DUAL = 'user-d-00-0000-0000-00000000000d';

export const EXT_TOKENS: Record<string, string> = {
  A: 'tok-user-a',
  B: 'tok-user-b',
  SUPER: 'tok-user-super',
  INVITED: 'tok-user-invited',
  EXSUPER: 'tok-user-exsuper',
  VIEWER: 'tok-user-viewer',
  DUAL: 'tok-user-dual',
};

const USERS_BY_TOKEN: Record<string, { id: string; email: string }> = {
  'tok-user-a': { id: USER_A, email: 'a@example.test' },
  'tok-user-b': { id: USER_B, email: 'b@example.test' },
  'tok-user-super': { id: USER_SUPER, email: 's@example.test' },
  'tok-user-invited': { id: USER_INVITED, email: 'i@example.test' },
  'tok-user-exsuper': { id: USER_EXSUPER, email: 'x@example.test' },
  'tok-user-viewer': { id: USER_VIEWER, email: 'v@example.test' },
  'tok-user-dual': { id: USER_DUAL, email: 'd@example.test' },
};

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
export function bearer(who: keyof typeof EXT_TOKENS): Record<string, string> {
  return { authorization: `Bearer ${EXT_TOKENS[who]}` };
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
