/**
 * AUTH-CTX-001 — the boundary as a ROUTE sees it, plus the CP-STRUCT-005
 * re-verification.
 *
 * Two seams share `resolveUserContext`, so both inherited the masking:
 *
 *   enforceCompanyAccess  (tenancy)  — covered in authContextIdentity.test.ts
 *   enforceRole / withRBAC (roles)   — covered here
 *
 * CP-STRUCT-005 is re-verified through the real
 * `/api/company/platform-config` handler, since that is the route whose
 * 403 sent the diagnosis at the wrong subsystem for two rounds.
 */

type Row = Record<string, unknown>;

let authResult: { user: { id: string } | null; error: string | null } = {
  user: { id: 'user-1' }, error: null,
};
let tenantResult: Row = { ok: true, userId: 'user-1', organizationId: 'co-1' };
let roleRows: Row[] = [{ company_id: 'co-1', role: 'COMPANY_ADMIN', status: 'active' }];
let platformRows: Row[] = [{ platform: 'linkedin', content_types: ['post'] }];

jest.mock('../../services/supabaseAuthService', () => ({
  getSupabaseUserFromRequest: jest.fn(async () => authResult),
}));

jest.mock('../../security/TenantGuard', () => ({
  assertTenantAccess: jest.fn(async () => tenantResult),
  requireTenantAccess: jest.fn(),
  requireCampaignTenantAccess: jest.fn(),
}));

jest.mock('../../services/rbacPrimitives', () => ({
  getCompanyRoleIncludingInvited: jest.fn(async () => null),
  normalizePermissionRole: (r: string) => String(r || '').toUpperCase(),
  Role: { COMPANY_ADMIN: 'COMPANY_ADMIN', SUPER_ADMIN: 'SUPER_ADMIN', ADMIN: 'ADMIN' },
}));

jest.mock('../../db/supabaseClient', () => ({
  supabase: {
    from: (table: string) => {
      const builder: any = {};
      for (const op of ['select', 'eq', 'order', 'limit', 'in']) builder[op] = () => builder;
      const payload = () =>
        table === 'user_company_roles' ? roleRows : platformRows;
      builder.maybeSingle = () => Promise.resolve({ data: payload()[0] ?? null, error: null });
      builder.single = () => Promise.resolve({ data: payload()[0] ?? null, error: null });
      builder.then = (r: any) => Promise.resolve({ data: payload(), error: null }).then(r);
      return builder;
    },
  },
}));

// The route's DATA source and its observability wrapper are not under test —
// AUTH-CTX-001 lives entirely in enforceCompanyAccess, which runs before
// either is reached. Stubbing them keeps the real handler's auth path intact
// while avoiding the redis/config chain they pull in.
jest.mock('../../services/companyPlatformService', () => ({
  getCompanyPlatformConfig: jest.fn(async () => ({ platforms: [{ platform: 'linkedin', content_types: ['post'] }] })),
}));
jest.mock('../../../lib/platform/routeFactory', () => ({
  createApiRoute: (h: unknown) => h,
}));

import { enforceRole } from '../../services/rbacService';

function mockRes() {
  const res: any = { statusCode: 0, body: undefined };
  res.status = (c: number) => { res.statusCode = c; return res; };
  res.json = (p: unknown) => { res.body = p; return res; };
  return res;
}
const req = (url = '/api/users/u1/role') => ({ url, headers: {}, query: {}, body: {} }) as any;

const authenticatedAs = (id: string) => { authResult = { user: { id }, error: null }; };
const authFails = (error: string) => { authResult = { user: null, error }; };

beforeEach(() => {
  authenticatedAs('user-1');
  tenantResult = { ok: true, userId: 'user-1', organizationId: 'co-1' };
  roleRows = [{ company_id: 'co-1', role: 'COMPANY_ADMIN', status: 'active' }];
  platformRows = [{ platform: 'linkedin', content_types: ['post'] }];
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

/* ── The RBAC seam ────────────────────────────────────────────────────── */

describe('enforceRole — the role seam shares the resolver, so it shared the bug', () => {
  it('an unauthenticated caller is 401, not FORBIDDEN_ROLE', async () => {
    authFails('MISSING_AUTH');
    const res = mockRes();
    const result = await enforceRole({
      req: req(), res, companyId: 'co-1', allowedRoles: ['SUPER_ADMIN', 'ADMIN'] as never,
    });

    expect(result).toBeNull();
    expect(res.statusCode).toBe(401);
    expect(res.body?.code).toBe('UNAUTHENTICATED');
    // The old answer. A caller with no session was told their ROLE was wrong.
    expect(res.body?.error).not.toBe('FORBIDDEN_ROLE');
  });

  it('an invalid token is 401 too', async () => {
    authFails('INVALID_AUTH');
    const res = mockRes();
    await enforceRole({ req: req(), res, companyId: 'co-1', allowedRoles: ['ADMIN'] as never });
    expect(res.statusCode).toBe(401);
  });

  it('an AUTHENTICATED user with the wrong role is still 403 — authorization intact', async () => {
    authenticatedAs('user-2');
    roleRows = []; // authenticated, but holds no role on this company
    const res = mockRes();
    const result = await enforceRole({
      req: req(), res, companyId: 'co-1', allowedRoles: ['SUPER_ADMIN'] as never,
    });

    expect(result).toBeNull();
    expect(res.statusCode).toBe(403);
  });

  it('an unauthenticated caller is 401 even with no companyId — auth is answered first', async () => {
    authFails('MISSING_AUTH');
    const res = mockRes();
    await enforceRole({ req: req(), res, companyId: null, allowedRoles: ['ADMIN'] as never });
    expect(res.statusCode).toBe(401);
  });
});

/* ── CP-STRUCT-005, re-verified through the real route ────────────────── */

describe('CP-STRUCT-005 — /api/company/platform-config now answers honestly', () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const handler = require('../../../pages/api/company/platform-config').default;
  const cfgReq = (companyId?: string) =>
    ({ method: 'GET', url: '/api/company/platform-config', headers: {}, query: companyId ? { companyId } : {} }) as any;

  it('UNAUTHENTICATED → 401 (it was 403 "Access denied to company")', async () => {
    authFails('MISSING_AUTH');
    const res = mockRes();
    await handler(cfgReq('co-1'), res);

    expect(res.statusCode).toBe(401);
    expect(res.body?.code).toBe('UNAUTHENTICATED');
    expect(res.body?.error).not.toMatch(/access denied/i);
  });

  it('AUTHENTICATED NON-MEMBER → 403, exactly as before', async () => {
    authenticatedAs('user-2');
    tenantResult = { ok: false, reason: 'NOT_A_MEMBER' };
    const res = mockRes();
    await handler(cfgReq('co-1'), res);

    expect(res.statusCode).toBe(403);
    expect(res.body?.error).toBe('Access denied to company');
  });

  it('AUTHENTICATED MEMBER → success', async () => {
    authenticatedAs('user-1');
    tenantResult = { ok: true, userId: 'user-1', organizationId: 'co-1' };
    const res = mockRes();
    await handler(cfgReq('co-1'), res);

    expect(res.statusCode).toBe(200);
  });

  it('the three outcomes are now three DIFFERENT statuses', async () => {
    const seen: number[] = [];

    authFails('MISSING_AUTH');
    let res = mockRes(); await handler(cfgReq('co-1'), res); seen.push(res.statusCode);

    authenticatedAs('user-2');
    tenantResult = { ok: false, reason: 'NOT_A_MEMBER' };
    res = mockRes(); await handler(cfgReq('co-1'), res); seen.push(res.statusCode);

    authenticatedAs('user-1');
    tenantResult = { ok: true, userId: 'user-1', organizationId: 'co-1' };
    res = mockRes(); await handler(cfgReq('co-1'), res); seen.push(res.statusCode);

    expect(seen).toEqual([401, 403, 200]);
    expect(new Set(seen).size).toBe(3);
  });
});
