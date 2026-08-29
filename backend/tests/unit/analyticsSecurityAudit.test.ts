/**
 * ANALYTICS-SEC-001 — the pages/api/analytics/* cluster.
 *
 * Four confirmed defects, one clean route, one root cause:
 *
 *   summary / posts / growth  authenticated, but `company_id` came from the
 *                             QUERY STRING and went straight into a
 *                             service-role predicate. Authentication proved
 *                             who the caller was and nothing about which
 *                             company they could read.
 *   report                    no authentication AT ALL, plus an unauthorized
 *                             campaignId, plus a WRITE (saveAnalyticsReport
 *                             inserts analytics_reports).
 *   force-sync                already correct — it calls requireCompanyAccess
 *                             before touching anything. It is the model the
 *                             other four now follow, and is pinned here so it
 *                             cannot regress.
 *
 * The REAL authorization primitives run in these tests. Only the data layer
 * and the auth seam are mocked, so requireCompanyAccess → assertTenantAccess →
 * the actual membership/org decision tree is exercised rather than simulated.
 * Assertions inspect the SINK: the predicates each query actually carried, and
 * whether the analytics_reports insert happened.
 */

const MEMBER_A = 'aaaaaaaa-0000-0000-0000-0000000000aa';
const MEMBER_B = 'bbbbbbbb-0000-0000-0000-0000000000bb';
const SUPERADMIN = 'cccccccc-0000-0000-0000-0000000000cc';
const COMPANY_A = 'a0000000-0000-0000-0000-00000000000a';
const COMPANY_B = 'b0000000-0000-0000-0000-00000000000b';
const CAMPAIGN_A = 'ca000000-0000-0000-0000-00000000000a';
const CAMPAIGN_B = 'cb000000-0000-0000-0000-00000000000b';

const MEMBERSHIPS: Record<string, string> = {
  [`${MEMBER_A}:${COMPANY_A}`]: 'COMPANY_ADMIN',
  [`${MEMBER_B}:${COMPANY_B}`]: 'COMPANY_ADMIN',
};
const CAMPAIGN_OWNER: Record<string, string> = {
  [CAMPAIGN_A]: COMPANY_A,
  [CAMPAIGN_B]: COMPANY_B,
};

let authUser: string | null = MEMBER_A;
let superAdmins: string[] = [SUPERADMIN];

/** Every predicate every query carried, per table. */
type Q = { table: string; filters: Record<string, unknown> };
const queries: Q[] = [];
/** Every row written, per table. The analytics_reports insert is the write sink. */
const writes: Array<{ table: string; payload: unknown }> = [];

const analyticsQueries = () =>
  queries.filter(q => !['user_company_roles', 'companies', 'campaigns'].includes(q.table));

jest.mock('../../services/supabaseAuthService', () => ({
  getSupabaseUserFromRequest: jest.fn(async () =>
    authUser
      ? { user: { id: authUser, email: 'u@example.com', emailVerified: true }, error: null }
      : { user: null, error: 'MISSING_AUTH' }
  ),
}));

jest.mock('../../services/rbacService', () => ({
  isPlatformSuperAdmin: jest.fn(async (id: string) => superAdmins.includes(id)),
  isSuperAdmin: jest.fn(async (id: string) => superAdmins.includes(id)),
}));

// requireCampaignTenantAccess → requireTenantAccess → resolvePrincipal.
jest.mock('../../security/IdentityResolver', () => ({
  resolvePrincipal: jest.fn(async () =>
    authUser
      ? { ok: true, principal: { userId: authUser, supabaseUid: authUser, legacyCookieSuperAdmin: false } }
      : { ok: false, reason: 'NO_AUTH' }
  ),
}));

jest.mock('../../db/supabaseClient', () => {
  const build = (table: string) => {
    const filters: Record<string, unknown> = {};
    const b: any = {};
    b.select = () => b;
    b.eq = (c: string, v: unknown) => { filters[c] = v; return b; };
    b.in = (c: string, v: unknown) => { filters[c] = v; return b; };
    b.gte = (c: string, v: unknown) => { filters[`${c}__gte`] = v; return b; };
    b.lte = (c: string, v: unknown) => { filters[`${c}__lte`] = v; return b; };
    b.order = () => b;
    b.limit = () => b;
    b.range = () => b;
    b.insert = (payload: unknown) => {
      writes.push({ table, payload });
      return Promise.resolve({ data: null, error: null });
    };
    const resolve = () => {
      queries.push({ table, filters: { ...filters } });
      if (table === 'user_company_roles') {
        const role = MEMBERSHIPS[`${filters.user_id}:${filters.company_id}`];
        return { data: role ? { role, status: 'active' } : null, error: null };
      }
      if (table === 'companies') return { data: { id: filters.id, status: 'active' }, error: null };
      if (table === 'campaigns') {
        const owner = CAMPAIGN_OWNER[String(filters.id)];
        return { data: owner ? { company_id: owner } : null, error: null };
      }
      // Analytics tables: the row set is irrelevant to the boundary — what
      // matters is the predicate the query carried, recorded above.
      return { data: [], count: 0, error: null };
    };
    b.maybeSingle = () => Promise.resolve(resolve());
    b.single = () => Promise.resolve(resolve());
    b.then = (r: any) => Promise.resolve(resolve()).then(r);
    return b;
  };
  return { supabase: { from: (t: string) => build(t) } };
});

jest.mock('../../services/logger', () => ({ logger: { warn: jest.fn(), error: jest.fn(), info: jest.fn() } }));
jest.mock('../../security/audit/SecurityAuditService', () => ({ logSecurityEvent: jest.fn() }));
jest.mock('../../../lib/platform/routeFactory', () => ({ createApiRoute: (h: unknown) => h }));

// force-sync's heavy dependencies — recorded so a denial can be proven to
// reach none of them.
const ingestionRuns: unknown[] = [];
jest.mock('../../services/ingestionScheduler', () => ({
  runIngestionForCompany: jest.fn(async (a: unknown) => { ingestionRuns.push(a); }),
}));
jest.mock('../../services/analyticsIntegrationService', () => ({
  getActiveProperty: jest.fn(async () => null),
  getActiveSearchConsoleProperty: jest.fn(async () => null),
}));
jest.mock('../../services/gscIngestionService', () => ({ buildGscHistoricalBackfillOverride: jest.fn(() => ({})) }));

import summaryHandler from '../../../pages/api/analytics/summary';
import postsHandler from '../../../pages/api/analytics/posts';
import growthHandler from '../../../pages/api/analytics/growth';
import reportHandler from '../../../pages/api/analytics/report';
import forceSyncHandler from '../../../pages/api/analytics/force-sync';

function mockRes() {
  const res: any = { statusCode: 0, body: undefined, headers: {} as Record<string, string> };
  res.setHeader = (k: string, v: string) => { res.headers[k.toLowerCase()] = v; return res; };
  res.status = (c: number) => { res.statusCode = c; return res; };
  res.json = (p: unknown) => { res.body = p; return res; };
  return res;
}

async function call(h: any, as: string | null, opts: { query?: any; body?: any; method?: string } = {}) {
  authUser = as;
  const res = mockRes();
  await h({
    method: opts.method ?? (opts.body ? 'POST' : 'GET'),
    url: '/api/analytics/x',
    query: opts.query ?? {},
    body: opts.body ?? {},
    headers: {},
  } as never, res);
  return res;
}

beforeEach(() => {
  authUser = MEMBER_A;
  superAdmins = [SUPERADMIN];
  queries.length = 0; writes.length = 0; ingestionRuns.length = 0;
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
  jest.spyOn(console, 'debug').mockImplementation(() => {});
  jest.spyOn(console, 'log').mockImplementation(() => {});
});

/* ═══ GET routes: summary / posts / growth — one shared root cause ═══════ */

const GET_ROUTES: Array<[string, () => any, string]> = [
  ['summary', () => summaryHandler, 'content_analytics'],
  ['posts', () => postsHandler, 'content_analytics'],
  ['growth', () => growthHandler, 'platform_metrics_snapshots'],
];

describe.each(GET_ROUTES)('analytics/%s', (name, getHandler, sinkTable) => {
  it('1. unauthenticated → 401, and no analytics query runs', async () => {
    const res = await call(getHandler(), null, { query: { company_id: COMPANY_B } });
    expect(res.statusCode).toBe(401);
    expect(analyticsQueries()).toEqual([]);
  });

  it('2. invalid authentication is refused the same way', async () => {
    const res = await call(getHandler(), null, { query: { company_id: COMPANY_A } });
    expect(res.statusCode).toBe(401);
    expect(res.body).toEqual({ error: 'Unauthorized' });
  });

  it('3. a legitimate member reads their OWN company', async () => {
    const res = await call(getHandler(), MEMBER_A, { query: { company_id: COMPANY_A } });
    expect(res.statusCode).toBe(200);
    expect(analyticsQueries().length).toBeGreaterThan(0);
  });

  it('4/5. CRITICAL: naming another company is refused, and nothing is queried', async () => {
    // The whole defect: MEMBER_A is authenticated but has no role in COMPANY_B.
    const res = await call(getHandler(), MEMBER_A, { query: { company_id: COMPANY_B } });
    expect(res.statusCode).toBe(403);
    expect(analyticsQueries()).toEqual([]);
  });

  it('CRITICAL: no query ever carries a company the caller is not a member of', async () => {
    await call(getHandler(), MEMBER_A, { query: { company_id: COMPANY_B } });
    const leaked = queries.filter(q =>
      JSON.stringify(q.filters).includes(COMPANY_B) && q.table !== 'user_company_roles' && q.table !== 'companies');
    expect(leaked).toEqual([]);
  });

  it(`the ${sinkTable} predicate is the AUTHORIZED company`, async () => {
    await call(getHandler(), MEMBER_A, { query: { company_id: COMPANY_A } });
    const sink = analyticsQueries().find(q => q.table === sinkTable);
    expect(sink).toBeDefined();
    expect(JSON.stringify(sink!.filters)).toContain(COMPANY_A);
    expect(JSON.stringify(sink!.filters)).not.toContain(COMPANY_B);
  });

  it('8. a missing company_id is rejected before any analytics query', async () => {
    const res = await call(getHandler(), MEMBER_A, { query: {} });
    expect(res.statusCode).toBe(400);
    expect(analyticsQueries()).toEqual([]);
  });

  it('9. a platform super-admin keeps the existing privileged bypass', async () => {
    const res = await call(getHandler(), SUPERADMIN, { query: { company_id: COMPANY_B } });
    expect(res.statusCode).toBe(200);
  });

  it('10. date filters cannot widen the tenant predicate', async () => {
    await call(getHandler(), MEMBER_A, {
      query: { company_id: COMPANY_A, date_from: '2020-01-01', date_to: '2030-01-01', platform: 'linkedin' },
    });
    for (const q of analyticsQueries()) {
      expect(JSON.stringify(q.filters)).not.toContain(COMPANY_B);
    }
  });

  it('a non-GET verb reaches nothing', async () => {
    const res = await call(getHandler(), MEMBER_A, { query: { company_id: COMPANY_A }, method: 'POST' });
    expect(res.statusCode).toBe(405);
    expect(analyticsQueries()).toEqual([]);
  });
});

/* ═══ report — no auth, unauthorized campaign, and a WRITE ═══════════════ */

describe('analytics/report', () => {
  const reportWrites = () => writes.filter(w => w.table === 'analytics_reports');

  it('1. CRITICAL: unauthenticated → 401, and NO analytics_reports row is written', async () => {
    // Before the fix this returned 200 to an anonymous POST and inserted a row
    // keyed on the caller-supplied company_id. Confirmed live in production.
    const res = await call(reportHandler, null, { body: { companyId: COMPANY_B } });
    expect(res.statusCode).toBe(401);
    expect(reportWrites()).toEqual([]);
    expect(analyticsQueries()).toEqual([]);
  });

  it('3. a legitimate member gets their own company report', async () => {
    const res = await call(reportHandler, MEMBER_A, { body: { companyId: COMPANY_A } });
    expect(res.statusCode).toBe(200);
  });

  it('4/5. CRITICAL: naming another company is 403 with no write', async () => {
    const res = await call(reportHandler, MEMBER_A, { body: { companyId: COMPANY_B } });
    expect(res.statusCode).toBe(403);
    expect(reportWrites()).toEqual([]);
  });

  it('6. CRITICAL: an own company paired with a FOREIGN campaign is refused', async () => {
    // The second, distinct defect: listPerformanceMetrics selects
    // content_performance_metrics by campaign_id ALONE. Authorizing only the
    // company would still expose another tenant's campaign metrics.
    //
    // 403 (not 404) is the guard's own answer: requireCampaignTenantAccess
    // resolves CAMPAIGN_B to COMPANY_B and denies tenant access there, before
    // the route's company-equality check is reached. That equality check is
    // the second layer — it catches a campaign the caller CAN access but which
    // belongs to a different company than the one being reported on.
    const res = await call(reportHandler, MEMBER_A, { body: { companyId: COMPANY_A, campaignId: CAMPAIGN_B } });
    expect(res.statusCode).toBe(403);
    expect(reportWrites()).toEqual([]);
    const leaked = queries.filter(q => JSON.stringify(q.filters).includes(CAMPAIGN_B) && q.table !== 'campaigns');
    expect(leaked).toEqual([]);
  });

  it('6c. CRITICAL: a super-admin naming a campaign outside the reported company is still refused', async () => {
    // A super-admin passes both requireCompanyAccess and the campaign guard
    // (platform bypass), so ONLY the equality check stands between them and a
    // report that silently mixes COMPANY_B's campaign metrics into a
    // COMPANY_A-labelled analytics_reports row. This is the case the second
    // layer exists for.
    const res = await call(reportHandler, SUPERADMIN, { body: { companyId: COMPANY_A, campaignId: CAMPAIGN_B } });
    expect(res.statusCode).toBe(404);
    expect(reportWrites()).toEqual([]);
    const leaked = queries.filter(q => JSON.stringify(q.filters).includes(CAMPAIGN_B) && q.table !== 'campaigns');
    expect(leaked).toEqual([]);
  });

  it('6b. the caller’s OWN campaign is accepted', async () => {
    const res = await call(reportHandler, MEMBER_A, { body: { companyId: COMPANY_A, campaignId: CAMPAIGN_A } });
    expect(res.statusCode).toBe(200);
  });

  it('7. a nonexistent campaign is 404 with no write', async () => {
    const res = await call(reportHandler, MEMBER_A, {
      body: { companyId: COMPANY_A, campaignId: 'ffffffff-0000-0000-0000-0000000000ff' },
    });
    expect(res.statusCode).toBe(404);
    expect(reportWrites()).toEqual([]);
  });

  it('8. a missing companyId is rejected before any work', async () => {
    const res = await call(reportHandler, MEMBER_A, { body: {} });
    expect(res.statusCode).toBe(400);
    expect(reportWrites()).toEqual([]);
  });

  it('12. CRITICAL: every denial path writes nothing at all', async () => {
    await call(reportHandler, null, { body: { companyId: COMPANY_B } });
    await call(reportHandler, MEMBER_A, { body: { companyId: COMPANY_B } });
    await call(reportHandler, MEMBER_A, { body: { companyId: COMPANY_A, campaignId: CAMPAIGN_B } });
    expect(writes).toEqual([]);
  });

  it('the 500 path does not leak internal error detail', async () => {
    const svc = require('../../services/analyticsService');
    const spy = jest.spyOn(svc, 'computeAnalytics').mockRejectedValueOnce(
      new Error('relation "content_performance_metrics" does not exist')
    );
    const res = await call(reportHandler, MEMBER_A, { body: { companyId: COMPANY_A } });
    expect(res.statusCode).toBe(500);
    expect(res.body).toEqual({ error: 'Failed to compute analytics' });
    expect(JSON.stringify(res.body)).not.toContain('content_performance_metrics');
    spy.mockRestore();
  });

  it('a non-POST verb reaches nothing', async () => {
    const res = await call(reportHandler, MEMBER_A, { method: 'GET', query: {} });
    expect(res.statusCode).toBe(405);
    expect(writes).toEqual([]);
  });
});

/* ═══ force-sync — already correct; pinned against regression ════════════ */

describe('analytics/force-sync — the model the others now follow', () => {
  it('1. unauthenticated → 401 and no ingestion is triggered', async () => {
    const res = await call(forceSyncHandler, null, { body: { companyId: COMPANY_B } });
    expect(res.statusCode).toBe(401);
    expect(ingestionRuns).toEqual([]);
  });

  it('CRITICAL: a caller cannot force a sync for another tenant', async () => {
    const res = await call(forceSyncHandler, MEMBER_A, { body: { companyId: COMPANY_B } });
    expect(res.statusCode).toBe(403);
    expect(ingestionRuns).toEqual([]);
    expect(analyticsQueries()).toEqual([]);
  });

  it('11. authorization happens BEFORE the property lookup and the run', async () => {
    // Denied callers must not even learn whether the target company has a
    // connected property, and must trigger no provider work.
    await call(forceSyncHandler, MEMBER_A, { body: { companyId: COMPANY_B, capability: 'gsc' } });
    expect(ingestionRuns).toEqual([]);
  });

  it('a member reaching their own company gets past authorization', async () => {
    // getActiveProperty is mocked to null, so this stops at 'no_active_property'
    // — which proves authorization passed and the property lookup was reached.
    const res = await call(forceSyncHandler, MEMBER_A, { body: { companyId: COMPANY_A } });
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toBe('no_active_property');
  });

  it('a missing companyId is rejected before authorization', async () => {
    const res = await call(forceSyncHandler, MEMBER_A, { body: {} });
    expect(res.statusCode).toBe(400);
    expect(ingestionRuns).toEqual([]);
  });
});

/* ═══ cluster-wide invariant ═════════════════════════════════════════════ */

describe('cluster-wide: aggregation can never mix tenants', () => {
  it('CRITICAL: across every route, a denied caller leaves zero analytics reads and zero writes', async () => {
    const attempts: Array<Promise<unknown>> = [
      call(summaryHandler, MEMBER_A, { query: { company_id: COMPANY_B } }),
      call(postsHandler, MEMBER_A, { query: { company_id: COMPANY_B } }),
      call(growthHandler, MEMBER_A, { query: { company_id: COMPANY_B } }),
      call(reportHandler, MEMBER_A, { body: { companyId: COMPANY_B } }),
      call(forceSyncHandler, MEMBER_A, { body: { companyId: COMPANY_B } }),
    ];
    for (const a of attempts) await a;
    expect(analyticsQueries()).toEqual([]);
    expect(writes).toEqual([]);
  });

  it('MEDIA-SEC-002 read side: no analytics route reads media_files', () => {
    const fs = require('fs');
    const path = require('path');
    const dir = path.resolve(__dirname, '../../../pages/api/analytics');
    const offenders: string[] = [];
    const walk = (d: string) => {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const full = path.join(d, e.name);
        if (e.isDirectory()) { walk(full); continue; }
        if (!e.name.endsWith('.ts')) continue;
        if (fs.readFileSync(full, 'utf8').includes('media_files')) offenders.push(e.name);
      }
    };
    walk(dir);
    // Analytics never consumes media_files.campaign_id, so the MEDIA-SEC-002
    // write-side association cannot be laundered into a cross-tenant read here.
    expect(offenders).toEqual([]);
  });
});
