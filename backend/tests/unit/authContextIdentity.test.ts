/**
 * AUTH-CTX-001 — an authentication failure must not become a tenancy denial.
 *
 * `resolveUserContext(req)` did:
 *
 *     const { user, error } = await getSupabaseUserFromRequest(req);
 *     if (error || !user?.id) return resolveFromLib();
 *
 * `getSupabaseUserFromRequest` already computes exactly the distinction the
 * app needs — MISSING_AUTH, INVALID_AUTH, ACCOUNT_DELETED, ACCOUNT_SUSPENDED,
 * SESSION_REVOKED — and that line discarded all of it, substituting the
 * synthetic dev identity from `backend/lib/userContext`:
 *
 *     userId: DEV_USER_ID || 'dev-user'
 *     role:   'admin'                       (DEV_ROLE || 'admin')
 *     companyIds: [most recently updated company_profiles row]
 *
 * No DEV_* variable is set in Vercel production, so that identity is
 * 'dev-user' — a member of no company. Every guard then reported NOT_A_MEMBER,
 * i.e. an unauthenticated caller received **403 "Access denied to company"**
 * instead of 401. That is what sent CP-STRUCT-005 diagnosis at the wrong
 * subsystem for two rounds.
 *
 * These tests pin the full boundary. The 403 cases matter as much as the 401
 * ones: fixing the masking must not weaken tenant authorization.
 */

type Row = Record<string, unknown>;

/* ── Scripted auth + tenancy ──────────────────────────────────────────── */

let authResult: { user: { id: string } | null; error: string | null } = {
  user: { id: 'user-1' }, error: null,
};
let tenantResult: Row = { ok: true, userId: 'user-1', organizationId: 'co-1' };
let roleRows: Row[] = [{ company_id: 'co-1', role: 'COMPANY_ADMIN', status: 'active' }];
let roleError: Row | null = null;
/** Set if the dev fallback is reached — it must never be, on a request. */
let libFallbackCalls = 0;

jest.mock('../../services/supabaseAuthService', () => ({
  getSupabaseUserFromRequest: jest.fn(async () => authResult),
}));

jest.mock('../../security/TenantGuard', () => ({
  assertTenantAccess: jest.fn(async () => tenantResult),
}));

jest.mock('../../lib/userContext', () => ({
  resolveUserContext: jest.fn(async () => {
    libFallbackCalls += 1;
    // The real shape: an admin identity holding a REAL company id.
    return {
      userId: 'dev-user',
      role: 'admin',
      companyIds: ['some-other-companys-id'],
      defaultCompanyId: 'some-other-companys-id',
      membershipType: 'INTERNAL',
    };
  }),
}));

jest.mock('../../db/supabaseClient', () => ({
  supabase: {
    from: () => {
      const builder: any = {};
      for (const op of ['select', 'eq', 'order', 'limit']) builder[op] = () => builder;
      builder.then = (r: any) => Promise.resolve({ data: roleRows, error: roleError }).then(r);
      return builder;
    },
  },
}));

jest.mock('../../services/rbacPrimitives', () => ({
  getCompanyRoleIncludingInvited: jest.fn(async () => null),
  normalizePermissionRole: (r: string) => String(r || '').toUpperCase(),
  Role: { COMPANY_ADMIN: 'COMPANY_ADMIN', SUPER_ADMIN: 'SUPER_ADMIN', ADMIN: 'ADMIN' },
}));

import { resolveUserContext, enforceCompanyAccess } from '../../services/userContextService';

function mockRes() {
  const res: any = { statusCode: 0, body: undefined };
  res.status = (c: number) => { res.statusCode = c; return res; };
  res.json = (p: unknown) => { res.body = p; return res; };
  return res;
}
const req = () => ({ url: '/api/company/platform-config', headers: {}, query: {} }) as any;

const authenticatedAs = (id: string) => { authResult = { user: { id }, error: null }; };
const authFails = (error: string) => { authResult = { user: null, error }; };

beforeEach(() => {
  authenticatedAs('user-1');
  tenantResult = { ok: true, userId: 'user-1', organizationId: 'co-1' };
  roleRows = [{ company_id: 'co-1', role: 'COMPANY_ADMIN', status: 'active' }];
  roleError = null;
  libFallbackCalls = 0;
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

/* ── Case A — valid authentication ────────────────────────────────────── */

describe('Case A — valid authentication + valid membership', () => {
  it('resolves the real user and succeeds', async () => {
    const res = mockRes();
    const user = await enforceCompanyAccess({ req: req(), res, companyId: 'co-1' });

    expect(user).not.toBeNull();
    expect(user!.userId).toBe('user-1');
    expect(res.statusCode).toBe(0); // nothing written — the route continues
    expect(libFallbackCalls).toBe(0);
  });

  it('marks the context as authenticated', async () => {
    const ctx = await resolveUserContext(req());
    expect(ctx.userId).toBe('user-1');
    expect(ctx.authenticated).toBe(true);
  });
});

/* ── Cases B/C/D — authentication failures must be 401 ────────────────── */

describe('authentication failures never become a tenancy denial', () => {
  const cases: Array<[string, string]> = [
    ['Case B — no credentials', 'MISSING_AUTH'],
    ['Case C — invalid credentials', 'INVALID_AUTH'],
    ['Case D — revoked session', 'SESSION_REVOKED'],
    ['Case D — deleted account', 'ACCOUNT_DELETED'],
    ['Case D — suspended account', 'ACCOUNT_SUSPENDED'],
  ];

  it.each(cases)('%s → 401, not 403', async (_label, error) => {
    authFails(error);
    const res = mockRes();
    const user = await enforceCompanyAccess({ req: req(), res, companyId: 'co-1' });

    expect(user).toBeNull();
    expect(res.statusCode).toBe(401);
    expect(res.body?.code).toBe('UNAUTHENTICATED');
  });

  it.each(cases)('%s never fabricates an identity', async (_label, error) => {
    authFails(error);
    const ctx = await resolveUserContext(req());

    expect(ctx.authenticated).toBe(false);
    expect(ctx.userId).toBe('');
    // The dangerous part of the old fallback: an admin role and a REAL
    // company id handed to a caller that never authenticated.
    expect(ctx.role).not.toBe('admin');
    expect(ctx.companyIds).toEqual([]);
    expect(ctx.defaultCompanyId).toBe('');
    expect(libFallbackCalls).toBe(0);
  });

  it('reports WHY authentication failed rather than collapsing the reasons', async () => {
    authFails('SESSION_REVOKED');
    const ctx = await resolveUserContext(req());
    expect(ctx.authError).toBe('SESSION_REVOKED');
  });
});

/* ── Case E — a genuine non-member is STILL denied ────────────────────── */

describe('Case E — authenticated, wrong company', () => {
  it('stays 403 — the fix must not weaken authorization', async () => {
    authenticatedAs('user-2');
    roleRows = []; // belongs to nothing
    tenantResult = { ok: false, reason: 'NOT_A_MEMBER' };

    const res = mockRes();
    const user = await enforceCompanyAccess({ req: req(), res, companyId: 'co-1' });

    expect(user).toBeNull();
    expect(res.statusCode).toBe(403);
    expect(res.body?.error).toBe('Access denied to company');
  });

  it('an inactive/stale membership is also 403', async () => {
    authenticatedAs('user-2');
    tenantResult = { ok: false, reason: 'STALE_MEMBERSHIP' };

    const res = mockRes();
    await enforceCompanyAccess({ req: req(), res, companyId: 'co-1' });
    expect(res.statusCode).toBe(403);
  });

  it('an inactive ORGANISATION is 403, not 401', async () => {
    authenticatedAs('user-2');
    tenantResult = { ok: false, reason: 'ORG_INACTIVE' };

    const res = mockRes();
    await enforceCompanyAccess({ req: req(), res, companyId: 'co-1' });
    expect(res.statusCode).toBe(403);
  });
});

/* ── Case F — infrastructure failure stays 503 ────────────────────────── */

describe('Case F — tenant lookup failure', () => {
  it('remains a retryable 503, never a denial and never a 401', async () => {
    authenticatedAs('user-1');
    tenantResult = { ok: false, reason: 'TENANT_LOOKUP_ERROR' };

    const res = mockRes();
    await enforceCompanyAccess({ req: req(), res, companyId: 'co-1' });

    expect(res.statusCode).toBe(503);
    expect(res.body?.code).toBe('TENANT_LOOKUP_ERROR');
    expect(res.body?.retryable).toBe(true);
  });
});

/* ── Ordering — authentication is checked FIRST ───────────────────────── */

describe('the checks happen in the right order', () => {
  it('an unauthenticated request is 401 even when companyId is missing', async () => {
    // A missing companyId is a 400, but an unauthenticated caller has no
    // business learning anything about request shape first.
    authFails('MISSING_AUTH');
    const res = mockRes();
    await enforceCompanyAccess({ req: req(), res, companyId: null });
    expect(res.statusCode).toBe(401);
  });

  it('an unauthenticated request never reaches TenantGuard', async () => {
    const { assertTenantAccess } = require('../../security/TenantGuard');
    (assertTenantAccess as jest.Mock).mockClear();

    authFails('INVALID_AUTH');
    await enforceCompanyAccess({ req: req(), res: mockRes(), companyId: 'co-1' });

    expect(assertTenantAccess).not.toHaveBeenCalled();
  });
});
