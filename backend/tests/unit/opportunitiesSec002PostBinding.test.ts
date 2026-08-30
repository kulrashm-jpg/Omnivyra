/**
 * OPPORTUNITIES-SEC-002 — POST /api/opportunities.
 *
 * Found by the WITHRBAC-STRUCT-001 structural guard, not by a manual pass.
 *
 * withRBAC resolves `req.query.companyId || req.body.companyId` — QUERY FIRST.
 * The POST handler read `req.body.companyId` only, so
 *
 *     POST /api/opportunities?companyId=<own>
 *     { "companyId": "<victim>", "type": "SEASONAL" }
 *
 * authorized one company and operated on another. Every sink took the body
 * value: fillOpportunitySlots passes it to countActive, to the trend generator,
 * and to upsertOpportunities (a WRITE), and the response then returned the
 * victim's opportunity list and count to the caller.
 *
 * The REAL chain runs here — withRBAC -> enforceRole -> getUserRole -> handler.
 * Only the data layer, auth seam and opportunity service are mocked, and the
 * assertions inspect the SINKS: which company reached the generator/upsert path,
 * the listing and the count.
 *
 * GET is covered too, to prove the fix did not disturb the half that was always
 * safe (it reads the query company, which is the wrapper's own precedence).
 */

const ADMIN_A = 'aaaaaaaa-0000-0000-0000-0000000000aa';
const CREATOR_A = 'dddddddd-0000-0000-0000-0000000000dd';
const STALE_B = 'eeeeeeee-0000-0000-0000-0000000000ee';
const SUPERADMIN = 'cccccccc-0000-0000-0000-0000000000cc';
const COMPANY_A = 'a0000000-0000-0000-0000-00000000000a';
const VICTIM = 'b0000000-0000-0000-0000-00000000000b';

const ROLES = [
  { user_id: ADMIN_A, company_id: COMPANY_A, role: 'COMPANY_ADMIN', status: 'active' },
  { user_id: CREATOR_A, company_id: COMPANY_A, role: 'CONTENT_CREATOR', status: 'active' },
  { user_id: SUPERADMIN, company_id: COMPANY_A, role: 'SUPER_ADMIN', status: 'active' },
  // Membership in the victim tenant that is NOT active — must not authorize.
  { user_id: STALE_B, company_id: VICTIM, role: 'COMPANY_ADMIN', status: 'inactive' },
];

let authUser: string | null = ADMIN_A;

const queries: Array<{ table: string; filters: Record<string, unknown> }> = [];
/** Every downstream sink, with the company it actually received. */
const fillCalls: Array<{ companyId: string; type: string }> = [];
const listCalls: Array<{ companyId: string; type: string }> = [];
const countCalls: Array<{ companyId: string; type: string }> = [];

jest.mock('../../services/supabaseAuthService', () => ({
  getSupabaseUserFromRequest: jest.fn(async () =>
    authUser ? { user: { id: authUser, email: 'u@e.com', emailVerified: true }, error: null }
             : { user: null, error: 'MISSING_AUTH' }),
}));

jest.mock('../../db/supabaseClient', () => {
  const build = (table: string) => {
    const filters: Record<string, unknown> = {};
    const b: any = {};
    b.select = () => b;
    b.eq = (c: string, v: unknown) => { filters[c] = v; return b; };
    b.in = (c: string, v: unknown) => { filters[c] = v; return b; };
    b.order = () => b; b.limit = () => b;
    const rows = (): any[] => {
      if (table === 'user_company_roles') {
        return ROLES.filter(r =>
          (filters.user_id === undefined || r.user_id === filters.user_id) &&
          (filters.company_id === undefined || r.company_id === filters.company_id) &&
          (filters.role === undefined || r.role === filters.role) &&
          (filters.status === undefined || r.status === filters.status));
      }
      return [];
    };
    const resolve = () => {
      queries.push({ table, filters: { ...filters } });
      const d = rows();
      return { data: d, count: d.length, error: null };
    };
    b.maybeSingle = () => { const r = resolve(); return Promise.resolve({ data: r.data[0] ?? null, error: null }); };
    b.single = () => { const r = resolve(); return Promise.resolve({ data: r.data[0] ?? null, error: null }); };
    b.then = (fn: any) => Promise.resolve(resolve()).then(fn);
    return b;
  };
  return { supabase: { from: (t: string) => build(t) } };
});
jest.mock('../../db/writeOwner', () => ({
  ownedDbTable: (t: string) => require('../../db/supabaseClient').supabase.from(t),
}));

jest.mock('../../services/opportunityService', () => ({
  fillOpportunitySlots: jest.fn(async (companyId: string, type: string) => { fillCalls.push({ companyId, type }); }),
  listActiveOpportunities: jest.fn(async (companyId: string, type: string) => { listCalls.push({ companyId, type }); return [{ id: 'o1', company_id: companyId }]; }),
  countActive: jest.fn(async (companyId: string, type: string) => { countCalls.push({ companyId, type }); return 1; }),
}));

jest.mock('../../services/logger', () => ({ logger: { warn: jest.fn(), error: jest.fn(), info: jest.fn() } }));
jest.mock('../../../lib/platform/routeFactory', () => ({ createApiRoute: (h: unknown) => h }));

import handler from '../../../pages/api/opportunities/index';

function mockRes() {
  const res: any = { statusCode: 0, body: undefined };
  res.setHeader = () => res;
  res.status = (c: number) => { res.statusCode = c; return res; };
  res.json = (p: unknown) => { res.body = p; return res; };
  return res;
}
async function call(as: string | null, opts: { query?: any; body?: any; method?: string } = {}) {
  authUser = as;
  const res = mockRes();
  await handler({ method: opts.method ?? 'POST', url: '/api/opportunities',
                  query: opts.query ?? {}, body: opts.body ?? {}, headers: {} } as never, res);
  return res;
}

/** No sink ran at all. */
const noSinks = () => {
  expect(fillCalls).toEqual([]);
  expect(listCalls).toEqual([]);
  expect(countCalls).toEqual([]);
};
/** Nothing anywhere touched the victim tenant. */
const noVictimReach = () => {
  expect(fillCalls.filter(c => c.companyId === VICTIM)).toEqual([]);
  expect(listCalls.filter(c => c.companyId === VICTIM)).toEqual([]);
  expect(countCalls.filter(c => c.companyId === VICTIM)).toEqual([]);
};

beforeEach(() => {
  authUser = ADMIN_A;
  queries.length = 0;
  fillCalls.length = 0; listCalls.length = 0; countCalls.length = 0;
  jest.spyOn(console, 'error').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});

/* ── authentication ───────────────────────────────────────────────────── */

describe('authentication', () => {
  it('unauthenticated → 401 and no sink runs', async () => {
    const res = await call(null, { query: { companyId: COMPANY_A }, body: { companyId: VICTIM, type: 'SEASONAL' } });
    expect(res.statusCode).toBe(401);
    noSinks();
  });

  it('invalid authentication is refused the same way', async () => {
    const res = await call(null, { body: { companyId: COMPANY_A, type: 'SEASONAL' } });
    expect(res.statusCode).toBe(401);
    noSinks();
  });
});

/* ── the identifier split ─────────────────────────────────────────────── */

describe('the query/body identifier split', () => {
  it('CRITICAL: attacker query company + victim body company is refused', async () => {
    // THE defect: withRBAC authorizes COMPANY_A from the QUERY; the handler
    // used the body value and operated on VICTIM.
    const res = await call(ADMIN_A, {
      query: { companyId: COMPANY_A }, body: { companyId: VICTIM, type: 'SEASONAL' } });
    expect(res.statusCode).toBe(403);
    noSinks();
    noVictimReach();
  });

  it('CRITICAL: the generator/upsert path never runs for the victim', async () => {
    await call(ADMIN_A, { query: { companyId: COMPANY_A }, body: { companyId: VICTIM, type: 'SEASONAL' } });
    expect(fillCalls).toEqual([]);
  });

  it('CRITICAL: no victim opportunity is listed or counted, and none is returned', async () => {
    const res = await call(ADMIN_A, { query: { companyId: COMPANY_A }, body: { companyId: VICTIM, type: 'SEASONAL' } });
    expect(listCalls).toEqual([]);
    expect(countCalls).toEqual([]);
    expect(res.body.opportunities).toBeUndefined();
    expect(JSON.stringify(res.body)).not.toContain(VICTIM);
  });

  it('victim query + attacker body is refused by the role check', async () => {
    // The wrapper authorizes the QUERY value, which the caller does not hold.
    const res = await call(ADMIN_A, {
      query: { companyId: VICTIM }, body: { companyId: COMPANY_A, type: 'SEASONAL' } });
    expect(res.statusCode).toBe(403);
    noSinks();
  });

  it('conflicting identifiers never reach a sink, in either direction', async () => {
    await call(ADMIN_A, { query: { companyId: COMPANY_A }, body: { companyId: VICTIM, type: 'SEASONAL' } });
    await call(ADMIN_A, { query: { companyId: VICTIM }, body: { companyId: COMPANY_A, type: 'SEASONAL' } });
    noSinks();
  });
});

/* ── legitimate use ───────────────────────────────────────────────────── */

describe('legitimate use is preserved', () => {
  it('body-only companyId still works — the shape the real caller sends', async () => {
    const res = await call(ADMIN_A, { body: { companyId: COMPANY_A, type: 'SEASONAL' } });
    expect(res.statusCode).toBe(200);
    expect(fillCalls).toEqual([{ companyId: COMPANY_A, type: 'SEASONAL' }]);
    expect(listCalls).toEqual([{ companyId: COMPANY_A, type: 'SEASONAL' }]);
    expect(countCalls).toEqual([{ companyId: COMPANY_A, type: 'SEASONAL' }]);
  });

  it('matching query and body identifiers work', async () => {
    const res = await call(ADMIN_A, {
      query: { companyId: COMPANY_A }, body: { companyId: COMPANY_A, type: 'SEASONAL' } });
    expect(res.statusCode).toBe(200);
    expect(fillCalls[0].companyId).toBe(COMPANY_A);
  });

  it('CRITICAL: the sinks receive the AUTHORIZED company, not the raw body value', async () => {
    await call(ADMIN_A, { body: { companyId: COMPANY_A, type: 'SEASONAL' } });
    for (const c of [...fillCalls, ...listCalls, ...countCalls]) {
      expect(c.companyId).toBe(COMPANY_A);
    }
  });

  it('a foreign company named consistently is still refused by the role check', async () => {
    const res = await call(ADMIN_A, { body: { companyId: VICTIM, type: 'SEASONAL' } });
    expect(res.statusCode).toBe(403);
    noSinks();
  });
});

/* ── membership, roles, malformed input ───────────────────────────────── */

describe('membership and role handling', () => {
  it('a stale (inactive) membership does not authorize', async () => {
    const res = await call(STALE_B, { body: { companyId: VICTIM, type: 'SEASONAL' } });
    expect(res.statusCode).toBe(403);
    noSinks();
  });

  it('a CONTENT_CREATOR is refused — the route is COMPANY_ADMIN only', async () => {
    const res = await call(CREATOR_A, { body: { companyId: COMPANY_A, type: 'SEASONAL' } });
    expect(res.statusCode).toBe(403);
    noSinks();
  });

  it('a super admin keeps the platform bypass for the company they name', async () => {
    const res = await call(SUPERADMIN, { body: { companyId: VICTIM, type: 'SEASONAL' } });
    expect(res.statusCode).toBe(200);
    expect(fillCalls).toEqual([{ companyId: VICTIM, type: 'SEASONAL' }]);
  });

  it('CRITICAL: even a super admin cannot mix tenants via the split', async () => {
    // The bypass is for acting AS a tenant, not for pairing one tenant's
    // authorization with another tenant's operation.
    const res = await call(SUPERADMIN, {
      query: { companyId: COMPANY_A }, body: { companyId: VICTIM, type: 'SEASONAL' } });
    expect(res.statusCode).toBe(403);
    noSinks();
  });

  it('omitting every company identifier is refused before the handler', async () => {
    const res = await call(ADMIN_A, { body: { type: 'SEASONAL' } });
    expect(res.statusCode).toBe(400);
    noSinks();
  });

  it('a missing type is rejected before any sink', async () => {
    const res = await call(ADMIN_A, { body: { companyId: COMPANY_A } });
    expect(res.statusCode).toBe(400);
    noSinks();
  });

  it('a malformed company identifier cannot bypass the binding', async () => {
    const res = await call(ADMIN_A, {
      query: { companyId: COMPANY_A }, body: { companyId: "x' OR 1=1--", type: 'SEASONAL' } });
    expect(res.statusCode).toBe(403);
    noSinks();
  });
});

/* ── GET, unchanged ───────────────────────────────────────────────────── */

describe('GET is unchanged and still safe', () => {
  it('a legitimate GET still lists the caller’s own company', async () => {
    const res = await call(ADMIN_A, { method: 'GET', query: { companyId: COMPANY_A, type: 'SEASONAL' } });
    expect(res.statusCode).toBe(200);
    expect(listCalls).toEqual([{ companyId: COMPANY_A, type: 'SEASONAL' }]);
  });

  it('GET cannot be split: the wrapper authorizes the same query value it reads', async () => {
    const res = await call(ADMIN_A, { method: 'GET', query: { companyId: VICTIM, type: 'SEASONAL' } });
    expect(res.statusCode).toBe(403);
    noVictimReach();
  });

  it('an unsupported verb reaches no sink', async () => {
    const res = await call(ADMIN_A, { method: 'DELETE', query: { companyId: COMPANY_A } });
    expect(res.statusCode).toBe(405);
    noSinks();
  });
});
