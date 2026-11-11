/**
 * 2026-11-11 (non-blocking-scheduled, triaged by 83): POST /api/external-apis/access
 * "ensured" the companies row with an UPSERT ON CONFLICT (id) whenever the
 * read failed OR found nothing. A transient read error on an EXISTING company
 * therefore overwrote its name and website and set status='active' - which
 * re-activates a suspended company. Owner ruling (c), 2026-11-11: the route no
 * longer creates companies at all - its premise ("company_api_configs FK
 * requires it") was false. Missing company -> 404 COMPANY_NOT_FOUND, zero
 * writes; read error -> 500, zero writes; an existing company is untouched.
 *
 * Also pinned: an INVITED (not yet accepted) member is refused the write. The
 * real rbacService/rbacPrimitives run against the fake, so this exercises the
 * route's actual role fallback (getCompanyRoleIncludingInvited, active-only
 * since Closure-015E).
 */
const CO = '00000000-0000-4000-8000-0000000000aa';
const ADMIN = 'user-admin';
const INVITED = 'user-invited';

type Row = Record<string, unknown>;
let db: Record<string, Row[]> = {};
let failRead: Record<string, boolean> = {};
let writes: Array<{ table: string; op: string; payload: unknown; opts?: unknown }> = [];
let currentUser = ADMIN;

function table(name: string) {
  const eqs: Array<[string, unknown]> = [];
  let op: 'select' | 'upsert' | 'insert' | 'update' = 'select';
  let payload: unknown = null;
  let opts: Record<string, unknown> | undefined;
  let cap: number | null = null;
  const rows = () => (db[name] = db[name] ?? []);
  const match = () => rows().filter((r) => eqs.every(([c, v]) => r[c] === v));
  const run = () => {
    if (op === 'select') {
      if (failRead[name]) return { data: null, error: { message: 'transient read failure' } };
      const hits = match();
      return { data: cap === null ? hits : hits.slice(0, cap), error: null };
    }
    writes.push({ table: name, op, payload, opts });
    if (op === 'upsert') {
      const list = Array.isArray(payload) ? payload : [payload];
      for (const p of list as Row[]) {
        const existing = rows().find((r) => r.id === p.id);
        if (existing) { if (!opts?.ignoreDuplicates) Object.assign(existing, p); }
        else rows().push({ status: 'active', ...p });
      }
    }
    return { data: null, error: null };
  };
  const b: Record<string, unknown> = {};
  for (const m of ['select', 'gte', 'in', 'or', 'order', 'neq', 'is']) b[m] = () => b;
  b.eq = (c: string, v: unknown) => { eqs.push([c, v]); return b; };
  b.limit = (n: number) => { cap = n; return b; };
  b.upsert = (p: unknown, o?: Record<string, unknown>) => { op = 'upsert'; payload = p; opts = o; return b; };
  b.insert = (p: unknown) => { op = 'insert'; payload = p; return b; };
  b.update = (p: unknown) => { op = 'update'; payload = p; return b; };
  b.maybeSingle = async () => {
    const r = run();
    return { data: Array.isArray(r.data) ? (r.data[0] ?? null) : null, error: r.error };
  };
  b.then = (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) => Promise.resolve(run()).then(ok, ko);
  return b;
}

jest.mock('../../db/supabaseClient', () => ({ supabase: { from: (t: string) => table(t) } }));
jest.mock('../../db/writeOwner', () => ({ ownedDbTable: (t: string) => table(t) }));
jest.mock('../../services/supabaseAuthService', () => ({
  getSupabaseUserFromRequest: async () => ({ user: { id: currentUser }, error: null }),
}));
jest.mock('../../services/superAdminSession', () => ({ getLegacySuperAdminSession: () => null }));
jest.mock('../../services/externalApiService', () => ({
  getAvailableApis: async () => [],
  getCompanyDefaultApiIds: async () => [],
  getEnabledApis: async () => [],
  getEnabledApiIdsFromCompanyConfig: async () => [],
  getUserApiAccess: async () => [],
}));
jest.mock('../../services/companyApiConfigCache', () => ({
  invalidateCompanyConfigCache: () => undefined,
  getCompanyConfigRows: async () => [],
}));
jest.mock('../../../lib/platform/routeFactory', () => ({ createApiRoute: (h: unknown) => h }));

import handler from '../../../pages/api/external-apis/access';

async function post(body: Row = {}) {
  const res = { code: 0, body: {} as Row };
  const r = {
    status: (c: number) => { res.code = c; return r; },
    json: (b: Row) => { res.body = b; return r; },
    setHeader: () => r,
  };
  await (handler as unknown as (q: unknown, s: unknown) => Promise<void>)(
    { method: 'POST', query: { companyId: CO }, body, headers: {}, cookies: {}, url: '/api/external-apis/access' }, r);
  return res;
}
const companyWrites = () => writes.filter((w) => w.table === 'companies');

beforeEach(() => {
  currentUser = ADMIN;
  failRead = {};
  writes = [];
  db = {
    user_company_roles: [
      { id: 'm1', user_id: ADMIN, company_id: CO, role: 'COMPANY_ADMIN', status: 'active' },
      { id: 'm2', user_id: INVITED, company_id: CO, role: 'COMPANY_ADMIN', status: 'invited' },
    ],
    companies: [{ id: CO, name: 'Acme Ltd', website: 'https://acme.example', status: 'suspended' }],
    company_profiles: [{ company_id: CO, name: 'Profile Name' }],
  };
});

describe('the companies ensure-row never modifies an existing company', () => {
  it('a READ ERROR on companies fails closed (500) and writes NOTHING', async () => {
    failRead.companies = true;
    const res = await post({});
    expect(res.code).toBe(500);
    expect(companyWrites()).toHaveLength(0);
    expect(db.companies[0]).toEqual({ id: CO, name: 'Acme Ltd', website: 'https://acme.example', status: 'suspended' });
  });

  it('an existing SUSPENDED company stays suspended, name and website untouched', async () => {
    await post({});
    expect(companyWrites()).toHaveLength(0);
    expect(db.companies[0]).toEqual({ id: CO, name: 'Acme Ltd', website: 'https://acme.example', status: 'suspended' });
  });

  it('a MISSING company -> 404 COMPANY_NOT_FOUND and ZERO writes (nothing created, nothing configured)', async () => {
    db.companies = [];
    const res = await post({ company_default_api_ids: [] });
    expect(res.code).toBe(404);
    expect(res.body).toMatchObject({ code: 'COMPANY_NOT_FOUND' });
    expect(writes).toHaveLength(0);
    expect(db.companies).toHaveLength(0);
  });

  it('an EXISTING company -> unchanged behaviour (passes the check, reaches validation, companies untouched)', async () => {
    const before = JSON.stringify(db.companies);
    const res = await post({});
    expect(res.code).toBe(400); // api_source_id is required - past the company check
    expect(companyWrites()).toHaveLength(0);
    expect(JSON.stringify(db.companies)).toBe(before);
  });

  it('an EXISTING company with a bulk config save still writes its configs, never the companies table', async () => {
    const res = await post({ company_default_api_ids: [] });
    expect(res.code).toBeLessThan(300);
    expect(companyWrites()).toHaveLength(0);
  });
});

describe('membership', () => {
  it('an INVITED (not accepted) member is refused the write (403) and nothing is written', async () => {
    currentUser = INVITED;
    const res = await post({ company_default_api_ids: [] });
    expect(res.code).toBe(403);
    expect(writes).toHaveLength(0);
  });

  it('an ACTIVE member passes the role check (reaches validation)', async () => {
    const res = await post({});
    expect(res.code).toBe(400); // api_source_id is required - past auth and the ensure-row
  });
});
