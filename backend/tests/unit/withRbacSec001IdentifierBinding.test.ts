/**
 * WITHRBAC-SEC-001 — six routes that authorized one company and operated on another.
 *
 * A survey of all 80 withRBAC consumers found one recurring class. withRBAC
 * authorizes `req.query.companyId || req.body.companyId` and exposes only
 * `{ userId, role }` on `req.rbac` — it never tells the handler WHICH company it
 * authorized. Handlers that re-derive the tenant some other way can therefore
 * operate on a company the wrapper never checked:
 *
 *   analytics/campaign-roi                    select campaigns BY ID, then use
 *   analytics/campaign-optimization           campaignRow.company_id — derived
 *   analytics/campaign-optimization-proposal  from the row, bound to nothing
 *   campaigns/health-report                   same, and it allows ALL_ROLES
 *   collaboration-plans                       opportunity BY ID, then INSERT
 *   outreach-plans                            opportunity BY ID, then INSERT
 *
 * Fix: the resource's server-owned company decides authorization —
 * requireCampaignTenantAccess for the campaign routes, requireCompanyAccess on
 * the opportunity's own company_id for the plan routes.
 *
 * The REAL chain runs here: withRBAC -> enforceRole -> getUserRole, and
 * requireCampaignTenantAccess / requireCompanyAccess -> assertTenantAccess.
 * Only the data layer and the auth seam are mocked; the routes' downstream
 * modules run for real against the same recording data layer.
 */

const ADMIN_A = 'aaaaaaaa-0000-0000-0000-0000000000aa';
const CREATOR_A = 'dddddddd-0000-0000-0000-0000000000dd';
const VIEWER_A = 'eeeeeeee-0000-0000-0000-0000000000ee';
const COMPANY_A = 'a0000000-0000-0000-0000-00000000000a';
const VICTIM = 'b0000000-0000-0000-0000-00000000000b';
const CAMPAIGN_A = 'ca000000-0000-0000-0000-00000000000a';
const CAMPAIGN_V = 'cb000000-0000-0000-0000-00000000000b';
const OPP_A = 'oa000000-0000-0000-0000-00000000000a';
const OPP_V = 'ob000000-0000-0000-0000-00000000000b';

const ROLES = [
  { user_id: ADMIN_A, company_id: COMPANY_A, role: 'COMPANY_ADMIN', status: 'active' },
  { user_id: CREATOR_A, company_id: COMPANY_A, role: 'CONTENT_CREATOR', status: 'active' },
  { user_id: VIEWER_A, company_id: COMPANY_A, role: 'VIEW_ONLY', status: 'active' },
];
const CAMPAIGN_OWNER: Record<string, string> = { [CAMPAIGN_A]: COMPANY_A, [CAMPAIGN_V]: VICTIM };
const OPP_OWNER: Record<string, string> = { [OPP_A]: COMPANY_A, [OPP_V]: VICTIM };

let authUser: string | null = ADMIN_A;

const queries: Array<{ table: string; filters: Record<string, unknown> }> = [];
const writes: Array<{ table: string; payload: any }> = [];

/** Queries other than the authorization chain's own lookups. */
const appQueries = () => queries.filter(q => !['user_company_roles', 'companies'].includes(q.table));

jest.mock('../../services/supabaseAuthService', () => ({
  getSupabaseUserFromRequest: jest.fn(async () =>
    authUser ? { user: { id: authUser, email: 'u@e.com', emailVerified: true }, error: null }
             : { user: null, error: 'MISSING_AUTH' }),
}));
jest.mock('../../security/IdentityResolver', () => ({
  resolvePrincipal: jest.fn(async () =>
    authUser ? { ok: true, principal: { userId: authUser, supabaseUid: authUser, legacyCookieSuperAdmin: false } }
             : { ok: false, reason: 'NO_AUTH' }),
}));

jest.mock('../../db/supabaseClient', () => {
  const build = (table: string) => {
    const filters: Record<string, unknown> = {};
    const b: any = {};
    b.select = () => b;
    b.eq = (c: string, v: unknown) => { filters[c] = v; return b; };
    b.in = (c: string, v: unknown) => { filters[c] = v; return b; };
    b.gte = (c: string, v: unknown) => { filters[c + '__gte'] = v; return b; };
    b.lte = (c: string, v: unknown) => { filters[c + '__lte'] = v; return b; };
    b.order = () => b; b.limit = () => b; b.range = () => b;
    b.insert = (p: any) => { writes.push({ table, payload: p }); return b; };
    b.update = (p: any) => { writes.push({ table, payload: p }); return b; };
    b.delete = () => { writes.push({ table, payload: 'delete' }); return b; };
    const rows = (): any[] => {
      if (table === 'user_company_roles') {
        return ROLES.filter(r =>
          (filters.user_id === undefined || r.user_id === filters.user_id) &&
          (filters.company_id === undefined || r.company_id === filters.company_id) &&
          (filters.role === undefined || r.role === filters.role) &&
          (filters.status === undefined || r.status === filters.status));
      }
      if (table === 'companies') return [{ id: filters.id, status: 'active' }];
      if (table === 'campaigns') {
        const owner = CAMPAIGN_OWNER[String(filters.id)];
        if (!owner) return [];
        if (filters.company_id !== undefined && filters.company_id !== owner) return [];
        return [{ id: filters.id, company_id: owner, name: 'c', status: 'active' }];
      }
      if (table === 'campaign_versions') {
        const owner = CAMPAIGN_OWNER[String(filters.campaign_id)];
        return owner ? [{ company_id: owner, campaign_id: filters.campaign_id }] : [];
      }
      if (table === 'opportunity_items') {
        const owner = OPP_OWNER[String(filters.id)];
        return owner ? [{ id: filters.id, company_id: owner }] : [];
      }
      if (table === 'collaboration_plans' || table === 'outreach_plans') return [{ id: 'plan1' }];
      return [];
    };
    // PostgREST returns data: [] with error: null for a list query; only
    // single() errors on an empty result. Getting this wrong made a route's
    // legitimate "no rows" path look like a 500.
    const resolve = () => {
      queries.push({ table, filters: { ...filters } });
      const d = rows();
      return { data: d, count: d.length, error: null };
    };
    b.maybeSingle = () => { const r = resolve(); return Promise.resolve({ data: r.data[0] ?? null, error: null }); };
    b.single = () => { const r = resolve(); return Promise.resolve({ data: r.data[0] ?? null, error: r.data.length ? null : { message: 'no rows' } }); };
    b.then = (fn: any) => Promise.resolve(resolve()).then(fn);
    return b;
  };
  return { supabase: { from: (t: string) => build(t) } };
});
jest.mock('../../db/writeOwner', () => ({
  ownedDbTable: (t: string) => require('../../db/supabaseClient').supabase.from(t),
}));

jest.mock('../../services/logger', () => ({ logger: { warn: jest.fn(), error: jest.fn(), info: jest.fn() } }));
jest.mock('../../security/audit/SecurityAuditService', () => ({ logSecurityEvent: jest.fn() }));
jest.mock('../../../lib/platform/routeFactory', () => ({ createApiRoute: (h: unknown) => h }));

import roiHandler from '../../../pages/api/analytics/campaign-roi';
import optHandler from '../../../pages/api/analytics/campaign-optimization';
import propHandler from '../../../pages/api/analytics/campaign-optimization-proposal';
import healthHandler from '../../../pages/api/campaigns/health-report';
import collabHandler from '../../../pages/api/collaboration-plans/index';
import outreachHandler from '../../../pages/api/outreach-plans/index';

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
  await h({ method: opts.method ?? 'GET', url: '/api/x',
            query: opts.query ?? {}, body: opts.body ?? {}, headers: {} } as never, res);
  return res;
}

/**
 * Nothing belonging to the victim tenant was reached.
 *
 * This rests on the supabase mock, which records EVERY query and write the
 * route and its real downstream modules make. An earlier draft asserted on
 * mocked service recorders pathed at modules these routes do not import, so
 * those assertions passed vacuously. Recorded database predicates cannot go
 * vacuous: remove the boundary and the victim's company_id appears in a filter.
 */
function noVictimReach() {
  expect(writes).toEqual([]);
  const leaked = appQueries().filter(q => JSON.stringify(q.filters).includes(VICTIM));
  expect(leaked).toEqual([]);
}

beforeEach(() => {
  authUser = ADMIN_A;
  queries.length = 0; writes.length = 0;
  jest.spyOn(console, 'error').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'debug').mockImplementation(() => {});
});

/* Group 1 — campaign-derived company */

describe.each([
  ['analytics/campaign-roi', () => roiHandler],
  ['analytics/campaign-optimization', () => optHandler],
  ['analytics/campaign-optimization-proposal', () => propHandler],
])('%s', (_name, getHandler) => {
  it('unauthenticated is denied and reaches no campaign', async () => {
    const res = await call(getHandler(), null, { query: { companyId: COMPANY_A, campaignId: CAMPAIGN_V } });
    expect([401, 403]).toContain(res.statusCode);
    noVictimReach();
  });

  it('CRITICAL: own companyId + FOREIGN campaignId is refused, victim untouched', async () => {
    const res = await call(getHandler(), ADMIN_A, { query: { companyId: COMPANY_A, campaignId: CAMPAIGN_V } });
    expect([403, 404]).toContain(res.statusCode);
    noVictimReach();
  });

  it('CRITICAL: authorization runs BEFORE the handler reads the campaign', async () => {
    // noVictimReach() alone cannot see this: the handler's own campaign read is
    // filtered by campaign id, not company id, so a foreign row can be fetched
    // without the victim's company appearing in any predicate. The discriminator
    // is HOW MANY times `campaigns` is read on a denied request — exactly once,
    // by requireCampaignTenantAccess resolving the owner. A second read means
    // the handler ran first and the guard came too late.
    await call(getHandler(), ADMIN_A, { query: { companyId: COMPANY_A, campaignId: CAMPAIGN_V } });
    expect(appQueries().filter(q => q.table === 'campaigns')).toHaveLength(1);
  });

  it('a legitimate caller can still read their OWN campaign', async () => {
    const res = await call(getHandler(), ADMIN_A, { query: { companyId: COMPANY_A, campaignId: CAMPAIGN_A } });
    expect(res.statusCode).toBe(200);
  });

  it('a nonexistent campaign is refused and writes nothing', async () => {
    const res = await call(getHandler(), ADMIN_A, {
      query: { companyId: COMPANY_A, campaignId: 'ff000000-0000-0000-0000-0000000000ff' } });
    expect([403, 404]).toContain(res.statusCode);
    expect(writes).toEqual([]);
  });

  it('a missing campaignId is rejected first', async () => {
    const res = await call(getHandler(), ADMIN_A, { query: { companyId: COMPANY_A } });
    expect(res.statusCode).toBe(400);
  });
});

describe('campaigns/health-report (ALL_ROLES — widest blast radius)', () => {
  it('CRITICAL: the query/body split cannot read a foreign campaign', async () => {
    // companyId in the QUERY satisfies withRBAC; the body carries only the
    // victim's campaignId, which the handler used to derive the company.
    const res = await call(healthHandler, ADMIN_A, {
      method: 'POST', query: { companyId: COMPANY_A }, body: { campaignId: CAMPAIGN_V } });
    expect([403, 404]).toContain(res.statusCode);
    noVictimReach();
  });

  it('CRITICAL: even a VIEW_ONLY member cannot use the split', async () => {
    const res = await call(healthHandler, VIEWER_A, {
      method: 'POST', query: { companyId: COMPANY_A }, body: { campaignId: CAMPAIGN_V } });
    expect([403, 404]).toContain(res.statusCode);
    noVictimReach();
  });

  it('CRITICAL: naming the victim company in the body is refused too', async () => {
    const res = await call(healthHandler, ADMIN_A, {
      method: 'POST', query: { companyId: COMPANY_A }, body: { companyId: VICTIM, campaignId: CAMPAIGN_V } });
    expect([403, 404]).toContain(res.statusCode);
    noVictimReach();
  });

  it('a non-POST verb reaches nothing', async () => {
    const res = await call(healthHandler, ADMIN_A, { method: 'GET', query: { companyId: COMPANY_A } });
    expect(res.statusCode).toBe(405);
    expect(writes).toEqual([]);
  });
});

/* Group 2 — opportunity by id, then INSERT */

describe.each([
  ['collaboration-plans', () => collabHandler, 'collaboration_plans'],
  ['outreach-plans', () => outreachHandler, 'outreach_plans'],
])('%s', (_name, getHandler, table) => {
  it('unauthenticated is denied and nothing is written', async () => {
    const res = await call(getHandler(), null, {
      method: 'POST', body: { opportunityId: OPP_V, companyId: COMPANY_A } });
    expect([401, 403]).toContain(res.statusCode);
    expect(writes).toEqual([]);
  });

  it('CRITICAL: a plan cannot be attached to another tenant opportunity', async () => {
    const res = await call(getHandler(), ADMIN_A, {
      method: 'POST', body: { opportunityId: OPP_V, companyId: COMPANY_A } });
    expect(res.statusCode).toBe(403);
    expect(writes.filter(w => w.table === table)).toEqual([]);
  });

  it('CRITICAL: a CONTENT_CREATOR cannot either', async () => {
    const res = await call(getHandler(), CREATOR_A, {
      method: 'POST', body: { opportunityId: OPP_V, companyId: COMPANY_A } });
    expect(res.statusCode).toBe(403);
    expect(writes).toEqual([]);
  });

  it('legitimate use still works on their OWN opportunity', async () => {
    const res = await call(getHandler(), ADMIN_A, {
      method: 'POST', body: { opportunityId: OPP_A, companyId: COMPANY_A } });
    expect(res.statusCode).toBe(201);
    expect(writes.filter(w => w.table === table)).toHaveLength(1);
  });

  it('the OPPORTUNITY own company is what gets authorized', async () => {
    await call(getHandler(), ADMIN_A, { method: 'POST', body: { opportunityId: OPP_A, companyId: COMPANY_A } });
    const guard = queries.filter(q => q.table === 'user_company_roles' && q.filters.company_id === COMPANY_A);
    expect(guard.length).toBeGreaterThan(0);
  });

  it('a nonexistent opportunity writes nothing', async () => {
    const res = await call(getHandler(), ADMIN_A, {
      method: 'POST', body: { opportunityId: 'ff000000-0000-0000-0000-0000000000ff', companyId: COMPANY_A } });
    expect(res.statusCode).toBe(404);
    expect(writes).toEqual([]);
  });

  it('a non-POST verb writes nothing', async () => {
    const res = await call(getHandler(), ADMIN_A, {
      method: 'GET', body: { opportunityId: OPP_A, companyId: COMPANY_A } });
    expect(res.statusCode).toBe(405);
    expect(writes).toEqual([]);
  });
});

/* cluster-wide */

describe('cluster-wide', () => {
  it('CRITICAL: across all six routes the victim tenant is never reached', async () => {
    await call(roiHandler, ADMIN_A, { query: { companyId: COMPANY_A, campaignId: CAMPAIGN_V } });
    await call(optHandler, ADMIN_A, { query: { companyId: COMPANY_A, campaignId: CAMPAIGN_V } });
    await call(propHandler, ADMIN_A, { query: { companyId: COMPANY_A, campaignId: CAMPAIGN_V } });
    await call(healthHandler, ADMIN_A, { method: 'POST', query: { companyId: COMPANY_A }, body: { campaignId: CAMPAIGN_V } });
    await call(collabHandler, ADMIN_A, { method: 'POST', body: { opportunityId: OPP_V, companyId: COMPANY_A } });
    await call(outreachHandler, ADMIN_A, { method: 'POST', body: { opportunityId: OPP_V, companyId: COMPANY_A } });
    noVictimReach();
  });
});
