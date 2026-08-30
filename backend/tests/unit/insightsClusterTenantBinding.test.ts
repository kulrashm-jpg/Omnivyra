/**
 * ANALYTICS-INSIGHTS-BATCH-SEC-001 — the pages/api/insights/* cluster.
 *
 * All five routes are NOT A DEFECT. This suite is characterization: they had no
 * regression coverage, and they are the cleanest tenant-binding pattern in the
 * codebase, so the contract is worth pinning before someone edits it.
 *
 * Why they are safe — the sink receives the AUTHORIZER'S OWN RETURN VALUE:
 *
 *     const companyId = req.query.companyId?.trim() || user.defaultCompanyId;
 *     const companyContext = await requireCompanyContext({ req, res, companyId });
 *     if (!companyContext) return;
 *     ... listDecisionFeatureView({ companyId: companyContext.companyId })
 *
 * That last line is the distinction from every defect this programme has found.
 * Those routes CHECKED a company and then operated on a caller-supplied one;
 * these operate on the value the authorization returned, so the two cannot
 * diverge by construction. The fallback is user.defaultCompanyId — server-
 * derived — so an absent query parameter cannot name a foreign tenant either.
 *
 * The REAL chain runs here: withRBAC -> enforceRole -> getUserRole, and
 * requireCompanyContext -> enforceCompanyAccess -> resolveUserContext. Only the
 * data layer, the auth seam and the view reader are mocked, and the assertions
 * inspect which company actually reached the view.
 */

const MEMBER_A = 'aaaaaaaa-0000-0000-0000-0000000000aa';
const VIEWER_A = 'dddddddd-0000-0000-0000-0000000000dd';
const SUPERADMIN = 'cccccccc-0000-0000-0000-0000000000cc';
const COMPANY_A = 'a0000000-0000-0000-0000-00000000000a';
const VICTIM = 'b0000000-0000-0000-0000-00000000000b';
/** The caller holds an ACTIVE role here, but the company itself is suspended. */
const COMPANY_SUSPENDED = 'e0000000-0000-0000-0000-00000000000e';

const ROLES = [
  { user_id: MEMBER_A, company_id: COMPANY_A, role: 'COMPANY_ADMIN', status: 'active' },
  { user_id: VIEWER_A, company_id: COMPANY_A, role: 'VIEW_ONLY', status: 'active' },
  { user_id: SUPERADMIN, company_id: COMPANY_A, role: 'SUPER_ADMIN', status: 'active' },
  { user_id: MEMBER_A, company_id: COMPANY_SUSPENDED, role: 'COMPANY_ADMIN', status: 'active' },
];

/** Company lifecycle. getUserRole ignores this; assertTenantAccess does not. */
const COMPANY_STATUS: Record<string, string> = {
  [COMPANY_A]: 'active',
  [VICTIM]: 'active',
  [COMPANY_SUSPENDED]: 'suspended',
};

let authUser: string | null = MEMBER_A;

const queries: Array<{ table: string; filters: Record<string, unknown> }> = [];
const writes: Array<{ table: string; payload: unknown }> = [];
/** Every view read, with the company it was actually given. */
const viewReads: Array<{ viewName: string; companyId: string }> = [];

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
    b.insert = (p: unknown) => { writes.push({ table, payload: p }); return b; };
    b.update = (p: unknown) => { writes.push({ table, payload: p }); return b; };
    const rows = (): any[] => {
      if (table === 'user_company_roles') {
        return ROLES.filter(r =>
          (filters.user_id === undefined || r.user_id === filters.user_id) &&
          (filters.company_id === undefined || r.company_id === filters.company_id) &&
          (filters.role === undefined || r.role === filters.role) &&
          (filters.status === undefined || r.status === filters.status));
      }
      if (table === 'companies') {
        return [{ id: filters.id, status: COMPANY_STATUS[String(filters.id)] ?? 'active' }];
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

jest.mock('../../services/insightViewService', () => ({
  listDecisionFeatureView: jest.fn(async (p: any) => {
    viewReads.push({ viewName: p.viewName, companyId: p.companyId });
    return [{ id: 'item-1', company_id: p.companyId }];
  }),
  // insights/market reads a different view; both are recorded so no real
  // service escapes the harness.
  listMarketPulseView: jest.fn(async (p: any) => {
    viewReads.push({ viewName: 'market_pulse_view', companyId: p.companyId });
    return [{ id: 'item-1', company_id: p.companyId }];
  }),
}));
jest.mock('../../services/intelligenceExecutionContext', () => ({
  runInApiReadContext: jest.fn(async (_n: string, fn: any) => fn()),
}));
jest.mock('../../services/logger', () => ({ logger: { warn: jest.fn(), error: jest.fn(), info: jest.fn() } }));
jest.mock('../../../lib/platform/routeFactory', () => ({ createApiRoute: (h: unknown) => h }));

import campaignHandler from '../../../pages/api/insights/campaign';
import contentHandler from '../../../pages/api/insights/content';
import engagementHandler from '../../../pages/api/insights/engagement';
import leadsHandler from '../../../pages/api/insights/leads';
import marketHandler from '../../../pages/api/insights/market';

function mockRes() {
  const res: any = { statusCode: 0, body: undefined };
  res.setHeader = () => res;
  res.status = (c: number) => { res.statusCode = c; return res; };
  res.json = (p: unknown) => { res.body = p; return res; };
  return res;
}
async function call(h: any, as: string | null, opts: { query?: any; body?: any; method?: string } = {}) {
  authUser = as;
  const res = mockRes();
  await h({ method: opts.method ?? 'GET', url: '/api/insights/x',
            query: opts.query ?? {}, body: opts.body ?? {}, headers: {} } as never, res);
  return res;
}
/** Nothing belonging to the victim was read or returned. */
function noVictimReach(body?: unknown) {
  expect(viewReads.filter(v => v.companyId === VICTIM)).toEqual([]);
  expect(writes).toEqual([]);
  if (body !== undefined) expect(JSON.stringify(body ?? {})).not.toContain(VICTIM);
}

beforeEach(() => {
  authUser = MEMBER_A;
  queries.length = 0; writes.length = 0; viewReads.length = 0;
  jest.spyOn(console, 'error').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});

const ROUTES: Array<[string, () => any]> = [
  ['insights/campaign', () => campaignHandler],
  ['insights/content', () => contentHandler],
  ['insights/engagement', () => engagementHandler],
  ['insights/leads', () => leadsHandler],
  ['insights/market', () => marketHandler],
];

describe.each(ROUTES)('%s', (_name, getHandler) => {
  it('unauthenticated is denied and the view is never read', async () => {
    const res = await call(getHandler(), null, { query: { companyId: VICTIM } });
    expect([401, 403]).toContain(res.statusCode);
    expect(viewReads).toEqual([]);
    noVictimReach(res.body);
  });

  it('a legitimate member reads their OWN company', async () => {
    const res = await call(getHandler(), MEMBER_A, { query: { companyId: COMPANY_A } });
    expect(res.statusCode).toBe(200);
    expect(viewReads).toHaveLength(1);
    expect(viewReads[0].companyId).toBe(COMPANY_A);
  });

  it('CRITICAL: naming another company is refused and the view is never read', async () => {
    const res = await call(getHandler(), MEMBER_A, { query: { companyId: VICTIM } });
    expect([401, 403, 404]).toContain(res.statusCode);
    expect(viewReads).toEqual([]);
    noVictimReach(res.body);
  });

  it('the view receives the company that passed authorization', async () => {
    // Stated precisely: requireCompanyContext RETURNS the value it was given, so
    // `companyContext.companyId` and `companyId` are equal by construction here.
    // The security property is not which expression is used — it is that a
    // company which fails authorization never reaches the sink at all, which the
    // foreign-company and suspended-company cases below prove.
    await call(getHandler(), MEMBER_A, { query: { companyId: COMPANY_A } });
    expect(viewReads[0].companyId).toBe(COMPANY_A);
  });

  it('CRITICAL: a SUSPENDED company is refused and the view is never read', async () => {
    // This is what the second binder buys. enforceRole checks only that the
    // caller has an ACTIVE ROLE — it never looks at the company's own lifecycle.
    // assertTenantAccess, behind requireCompanyContext, answers ORG_INACTIVE.
    // Remove that binder and this request would reach the sink.
    const res = await call(getHandler(), MEMBER_A, { query: { companyId: COMPANY_SUSPENDED } });
    // Assert the binder's OWN denial (403 'Access denied to company'), not merely
    // "not 200". Dropping the `if (!companyContext) return;` guard still avoids a
    // leak — but only because dereferencing null throws into the catch and yields
    // a 500. Pinning 403 distinguishes a proper denial from an accidental crash.
    expect(res.statusCode).toBe(403);
    expect(res.body).toEqual({ error: 'Access denied to company' });
    expect(viewReads).toEqual([]);
  });

  it('CRITICAL: the query/body split cannot reach another tenant', async () => {
    // withRBAC resolves query||body; this handler reads the query and otherwise
    // falls back to the caller's own defaultCompanyId. A body-only companyId
    // therefore never becomes the operative company.
    const res = await call(getHandler(), MEMBER_A, { query: {}, body: { companyId: VICTIM } });
    expect(viewReads.filter(v => v.companyId === VICTIM)).toEqual([]);
    noVictimReach(res.body);
  });

  it('omitting the company is a denial, and the view is never read', async () => {
    // The handler falls back to user.defaultCompanyId, but that branch is
    // unreachable through the wrapper: withRBAC resolves
    // `req.query.companyId || req.body.companyId` and enforceRole answers 400
    // without one. Recorded as the actual contract rather than assumed.
    const res = await call(getHandler(), MEMBER_A, { query: {} });
    expect(res.statusCode).toBe(400);
    expect(viewReads).toEqual([]);
  });

  it('a VIEW_ONLY member is allowed and still scoped to their own company', async () => {
    const res = await call(getHandler(), VIEWER_A, { query: { companyId: COMPANY_A } });
    expect(res.statusCode).toBe(200);
    expect(viewReads[0].companyId).toBe(COMPANY_A);
  });

  it('a super admin keeps the platform bypass', async () => {
    const res = await call(getHandler(), SUPERADMIN, { query: { companyId: VICTIM } });
    expect(res.statusCode).toBe(200);
    expect(viewReads[0].companyId).toBe(VICTIM);
  });

  it('a malformed company cannot bypass the binder', async () => {
    const res = await call(getHandler(), MEMBER_A, { query: { companyId: "x' OR 1=1--" } });
    expect(res.statusCode).not.toBe(200);
    expect(viewReads).toEqual([]);
  });

  it('a non-GET verb reaches nothing', async () => {
    const res = await call(getHandler(), MEMBER_A, { query: { companyId: COMPANY_A }, method: 'POST' });
    expect(res.statusCode).toBe(405);
    expect(viewReads).toEqual([]);
  });

  it('the route is read-only', async () => {
    await call(getHandler(), MEMBER_A, { query: { companyId: COMPANY_A } });
    expect(writes).toEqual([]);
  });
});

describe('cluster-wide', () => {
  it('CRITICAL: across all five routes a foreign company reaches no view and no write', async () => {
    for (const [, getHandler] of ROUTES) {
      await call(getHandler(), MEMBER_A, { query: { companyId: VICTIM } });
    }
    noVictimReach();
  });

  it('every successful read is scoped to exactly one authorized company', async () => {
    for (const [, getHandler] of ROUTES) {
      await call(getHandler(), MEMBER_A, { query: { companyId: COMPANY_A } });
    }
    expect(viewReads).toHaveLength(ROUTES.length);
    expect([...new Set(viewReads.map(v => v.companyId))]).toEqual([COMPANY_A]);
  });
});
