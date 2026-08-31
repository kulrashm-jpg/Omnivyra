/**
 * SETTINGS-INTELLIGENCE-ACCESS-SEC-001 — pages/api/settings/intelligence-access.
 *
 * The last write-capable route in the tenant-authz baseline: it upserts
 * company_execution_config, upserts company_intelligence_config, and DELETEs
 * from both. It is gated by a bespoke resolveAccess(userId, requested, mode)
 * with its own SUPER_ADMIN branch and a GLOBAL_DEFAULT_PROFILE_ID mode, none of
 * which any guard or detector understands — so nothing was pinning it.
 *
 * The route is SAFE, and the reason is worth stating precisely, because it is
 * the opposite of every defect this programme has found:
 *
 *   For an ordinary COMPANY_ADMIN the requested company is IGNORED. The
 *   operative company is read out of the caller's OWN active role row, so
 *   "authorize A, operate on B" is not expressible — there is no path that
 *   carries a caller-supplied company into a sink.
 *
 *   Global mode returns a server-owned constant and is refused to anyone who is
 *   not a super admin.
 *
 *   A super admin MAY name any company. That matches established platform
 *   policy (rbacService.enforceRole: "They are Omnivyra platform admins who
 *   control the whole app"), and this route is in fact STRICTER than the
 *   platform primitive — isPlatformSuperAdmin does not filter on membership
 *   status, whereas resolveAccess only counts status='active' rows.
 *
 * These tests assert the company that actually reaches each sink, never a
 * status code alone.
 */

export {};

const ADMIN_A = 'aaaaaaaa-0000-0000-0000-0000000000aa';
const ADMIN_MULTI = 'ffffffff-0000-0000-0000-0000000000ff';
const VIEWER = 'bbbbbbbb-0000-0000-0000-0000000000bb';
const STALE = 'dddddddd-0000-0000-0000-0000000000dd';
const SUPERADMIN = 'cccccccc-0000-0000-0000-0000000000cc';
const NOBODY = 'eeeeeeee-0000-0000-0000-0000000000ee';

const COMPANY_A = 'a0000000-0000-0000-0000-00000000000a';
const COMPANY_B = 'b0000000-0000-0000-0000-00000000000b';
const VICTIM = 'c0000000-0000-0000-0000-00000000000c';
const GLOBAL = '__GLOBAL_DEFAULT__';

const ROLES = [
  { user_id: ADMIN_A, company_id: COMPANY_A, role: 'COMPANY_ADMIN', status: 'active' },
  { user_id: ADMIN_MULTI, company_id: COMPANY_A, role: 'COMPANY_ADMIN', status: 'active' },
  { user_id: ADMIN_MULTI, company_id: COMPANY_B, role: 'COMPANY_ADMIN', status: 'active' },
  { user_id: VIEWER, company_id: COMPANY_A, role: 'VIEW_ONLY', status: 'active' },
  { user_id: STALE, company_id: COMPANY_A, role: 'COMPANY_ADMIN', status: 'inactive' },
  { user_id: SUPERADMIN, company_id: COMPANY_A, role: 'SUPER_ADMIN', status: 'active' },
];

let authUser: string | null = ADMIN_A;

/** Every table operation, with the company predicate/payload it carried. */
const reads: Array<{ table: string; filters: Record<string, unknown> }> = [];
const writes: Array<{ table: string; op: string; company: unknown }> = [];

jest.mock('../../services/supabaseAuthService', () => ({
  getSupabaseUserFromRequest: jest.fn(async () =>
    authUser ? { user: { id: authUser }, error: null } : { user: null, error: 'NO_AUTH' }),
}));
jest.mock('../../services/intelligenceUnitService', () => ({
  listIntelligenceUnits: jest.fn(async () => []),
  listCompanyIntelligenceUnits: jest.fn(async () => []),
}));
jest.mock('../../services/intentExecutionService', () => ({}));

jest.mock('../../db/supabaseClient', () => {
  const build = (table: string) => {
    const filters: Record<string, unknown> = {};
    const b: any = {};
    b.select = () => b;
    b.eq = (c: string, v: unknown) => { filters[c] = v; return b; };
    b.limit = () => b;
    b.order = () => b;
    const companyOf = (p: any) =>
      Array.isArray(p) ? [...new Set(p.map((r) => r.company_id))] : p?.company_id;
    b.upsert = (p: any) => { writes.push({ table, op: 'upsert', company: companyOf(p) }); return Promise.resolve({ data: null, error: null }); };
    b.insert = (p: any) => { writes.push({ table, op: 'insert', company: companyOf(p) }); return Promise.resolve({ data: null, error: null }); };
    b.update = (p: any) => { writes.push({ table, op: 'update', company: companyOf(p) }); return b; };
    b.delete = () => {
      // The predicate is applied AFTER .delete(); capture it lazily.
      const d: any = {
        eq: (c: string, v: unknown) => {
          filters[c] = v;
          writes.push({ table, op: 'delete', company: v });
          return Promise.resolve({ data: null, error: null });
        },
      };
      return d;
    };
    const rows = (): any[] => {
      reads.push({ table, filters: { ...filters } });
      if (table === 'user_company_roles') {
        return ROLES.filter(r =>
          (filters.user_id === undefined || r.user_id === filters.user_id) &&
          (filters.status === undefined || r.status === filters.status) &&
          (filters.role === undefined || r.role === filters.role));
      }
      if (table === 'companies') return [{ id: COMPANY_A, name: 'A' }, { id: VICTIM, name: 'V' }];
      return [];
    };
    b.maybeSingle = () => Promise.resolve({ data: rows()[0] ?? null, error: null });
    b.single = () => Promise.resolve({ data: rows()[0] ?? null, error: null });
    b.then = (fn: any) => Promise.resolve({ data: rows(), error: null }).then(fn);
    return b;
  };
  return { supabase: { from: (t: string) => build(t) } };
});

const route = require('../../../pages/api/settings/intelligence-access').default;

function mockRes() {
  const res: any = { statusCode: 0, body: undefined, headers: {} };
  res.status = (c: number) => { res.statusCode = c; return res; };
  res.json = (b: unknown) => { res.body = b; return res; };
  res.end = () => res;
  res.setHeader = () => res;
  return res;
}

async function call(user: string | null, opts: { query?: any; body?: any; method?: string } = {}) {
  authUser = user;
  reads.length = 0; writes.length = 0;
  const res = mockRes();
  await route({ method: opts.method ?? 'GET', url: '/x', headers: {},
    query: opts.query ?? {}, body: opts.body ?? {} } as never, res);
  return res;
}

/** Every distinct company that reached a write sink. */
const writtenCompanies = () => [...new Set(writes.flatMap(w => Array.isArray(w.company) ? w.company : [w.company]))];

const PUT_BODY = { insights: { market_trends: true }, units: [{ id: 'u1', enabled: true }], resetToDefault: true };

beforeEach(() => { authUser = ADMIN_A; });

describe('authorization matrix', () => {
  it('unauthenticated is refused and reaches no sink', async () => {
    const res = await call(null, { method: 'PUT', body: PUT_BODY });
    expect(res.statusCode).toBe(401);
    expect(writes).toEqual([]);
    expect(reads).toEqual([]);
  });

  it('a caller with no memberships is refused', async () => {
    const res = await call(NOBODY, { method: 'PUT', body: PUT_BODY });
    expect(res.statusCode).toBe(403);
    expect(writes).toEqual([]);
  });

  it('a stale (inactive) membership is refused', async () => {
    const res = await call(STALE, { method: 'PUT', body: PUT_BODY });
    expect(res.statusCode).toBe(403);
    expect(writes).toEqual([]);
  });

  it('a non-admin member (VIEW_ONLY) is refused', async () => {
    const res = await call(VIEWER, { method: 'PUT', body: PUT_BODY });
    expect(res.statusCode).toBe(403);
    expect(writes).toEqual([]);
  });

  it('the membership lookup requires status=active', async () => {
    await call(ADMIN_A);
    expect(reads[0]).toMatchObject({ table: 'user_company_roles', filters: { user_id: ADMIN_A, status: 'active' } });
  });

  it('a company admin operates on their own company', async () => {
    const res = await call(ADMIN_A, { method: 'PUT', body: PUT_BODY });
    expect(res.statusCode).toBe(200);
    expect(res.body.companyId).toBe(COMPANY_A);
    expect(writtenCompanies()).toEqual([COMPANY_A]);
  });

  it('a non-GET/PUT verb reaches nothing', async () => {
    const res = await call(ADMIN_A, { method: 'DELETE' });
    expect(res.statusCode).toBe(405);
    expect(writes).toEqual([]);
    expect(reads).toEqual([]);
  });
});

describe('CRITICAL — a caller-supplied company cannot reach any sink', () => {
  it('a company admin naming a FOREIGN company still writes only their own', async () => {
    const res = await call(ADMIN_A, { method: 'PUT', body: { ...PUT_BODY, companyId: VICTIM } });
    expect(res.statusCode).toBe(200);
    expect(res.body.companyId).toBe(COMPANY_A);
    expect(writtenCompanies()).toEqual([COMPANY_A]);
    expect(writtenCompanies()).not.toContain(VICTIM);
  });

  it('the same via the QUERY string is equally ignored', async () => {
    const res = await call(ADMIN_A, { method: 'PUT', query: { companyId: VICTIM }, body: PUT_BODY });
    expect(res.body.companyId).toBe(COMPANY_A);
    expect(writtenCompanies()).not.toContain(VICTIM);
  });

  it('conflicting query and body companies are both ignored', async () => {
    const res = await call(ADMIN_A, {
      method: 'PUT', query: { companyId: VICTIM }, body: { ...PUT_BODY, companyId: COMPANY_B },
    });
    expect(res.body.companyId).toBe(COMPANY_A);
    expect(writtenCompanies()).toEqual([COMPANY_A]);
  });

  it('naming the GLOBAL profile as a company is ignored for an ordinary admin', async () => {
    const res = await call(ADMIN_A, { method: 'PUT', body: { ...PUT_BODY, companyId: GLOBAL } });
    expect(res.body.companyId).toBe(COMPANY_A);
    expect(writtenCompanies()).not.toContain(GLOBAL);
  });

  it('a malformed company id is ignored rather than reaching a sink', async () => {
    const res = await call(ADMIN_A, { method: 'PUT', body: { ...PUT_BODY, companyId: "x' OR 1=1--" } });
    expect(res.body.companyId).toBe(COMPANY_A);
    expect(writtenCompanies()).toEqual([COMPANY_A]);
  });

  it('every DELETE carries the authorized company predicate', async () => {
    await call(ADMIN_A, { method: 'PUT', body: { resetToDefault: true, companyId: VICTIM } });
    const deletes = writes.filter(w => w.op === 'delete');
    expect(deletes.length).toBe(2);
    for (const d of deletes) expect(d.company).toBe(COMPANY_A);
  });

  it('every UPSERT payload carries the authorized company', async () => {
    await call(ADMIN_A, { method: 'PUT', body: { ...PUT_BODY, companyId: VICTIM } });
    const upserts = writes.filter(w => w.op === 'upsert');
    expect(upserts.length).toBeGreaterThan(0);
    for (const u of upserts) {
      const c = Array.isArray(u.company) ? u.company : [u.company];
      expect(c).toEqual([COMPANY_A]);
    }
  });
});

describe('global mode', () => {
  it('CRITICAL an ordinary company admin cannot enter global mode', async () => {
    const res = await call(ADMIN_A, { method: 'PUT', body: { ...PUT_BODY, mode: 'global' } });
    expect(res.statusCode).toBe(403);
    expect(writes).toEqual([]);
  });

  it('CRITICAL global mode via the QUERY string is equally refused', async () => {
    const res = await call(ADMIN_A, { method: 'PUT', query: { mode: 'global' }, body: PUT_BODY });
    expect(res.statusCode).toBe(403);
    expect(writes).toEqual([]);
  });

  it('a viewer cannot enter global mode either', async () => {
    const res = await call(VIEWER, { method: 'PUT', body: { ...PUT_BODY, mode: 'global' } });
    expect(res.statusCode).toBe(403);
    expect(writes).toEqual([]);
  });

  it('a super admin in global mode writes the SERVER-OWNED constant, never a caller company', async () => {
    const res = await call(SUPERADMIN, {
      method: 'PUT', body: { ...PUT_BODY, mode: 'global', companyId: VICTIM },
    });
    expect(res.statusCode).toBe(200);
    expect(res.body.companyId).toBe(GLOBAL);
    expect(writtenCompanies()).toEqual([GLOBAL]);
    expect(writtenCompanies()).not.toContain(VICTIM);
  });

  it('global mode skips the per-company reset path', async () => {
    await call(SUPERADMIN, { method: 'PUT', body: { resetToDefault: true, mode: 'global' } });
    expect(writes.filter(w => w.op === 'delete')).toEqual([]);
  });
});

describe('super-admin contract — matches platform policy, and is stricter', () => {
  it('a super admin MAY target another company (established platform policy)', async () => {
    const res = await call(SUPERADMIN, { method: 'PUT', body: { ...PUT_BODY, companyId: VICTIM } });
    expect(res.statusCode).toBe(200);
    expect(res.body.companyId).toBe(VICTIM);
    expect(writtenCompanies()).toEqual([VICTIM]);
  });

  it('a super admin with no requested company falls back to their own role row', async () => {
    const res = await call(SUPERADMIN, { method: 'PUT', body: PUT_BODY });
    expect(res.body.companyId).toBe(COMPANY_A);
  });

  it('CRITICAL super-admin status requires an ACTIVE role row', async () => {
    /*
     * This route is stricter than the platform primitive: isPlatformSuperAdmin
     * queries user_company_roles WITHOUT a status filter, while resolveAccess
     * only counts status='active'. A deactivated super admin is refused here.
     */
    const res = await call(STALE, { method: 'PUT', body: { ...PUT_BODY, companyId: VICTIM } });
    expect(res.statusCode).toBe(403);
    expect(writes).toEqual([]);
  });

  it('only a super admin receives the company picker', async () => {
    const sa = await call(SUPERADMIN);
    expect(sa.body.availableCompanies).toBeDefined();
    const admin = await call(ADMIN_A);
    expect(admin.body.availableCompanies).toBeUndefined();
  });
});

describe('read path', () => {
  it('a GET performs no writes', async () => {
    await call(ADMIN_A, { query: { companyId: VICTIM } });
    expect(writes).toEqual([]);
  });

  it('a GET reads only the authorized company plus the global defaults', async () => {
    await call(ADMIN_A, { query: { companyId: VICTIM } });
    const cfg = reads.filter(r => r.table === 'company_execution_config');
    const seen = [...new Set(cfg.map(r => r.filters.company_id))];
    expect(seen.sort()).toEqual([COMPANY_A, GLOBAL].sort());
    expect(seen).not.toContain(VICTIM);
  });
});
