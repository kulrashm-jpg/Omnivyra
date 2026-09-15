/**
 * ROUTE-AUTH-001 (STEP 3AH-85) — "Campaigns" family, part 1: campaign-keyed
 * routes that read/write campaign tables directly.
 *
 * THE DEFECT: every route below answered anonymous requests and trusted the
 * campaignId (or record id) it was given, so anyone could read or overwrite
 * any tenant's campaign data. Each now authenticates and binds the campaign to
 * the caller's tenant through requireCampaignAccess (campaign_versions owner).
 *
 * The real guard chain runs; only the database and identity provider are fake.
 */
import {
  seed, invoke, writeCalls, sinkCalls, leaksB, rows,
  CAMPAIGN_A, CAMPAIGN_B, UNKNOWN_ID, CANARY_B, CO_B,
} from '../helpers/routeAuthHarness';

jest.mock('@/config', () => ({ config: { DEV_USER_ID: '', NODE_ENV: 'production' } }));
jest.mock('../../db/supabaseClient', () => require('../helpers/routeAuthHarness').supabaseModule());
jest.mock('../../db/writeOwner', () => require('../helpers/routeAuthHarness').writeOwnerModule());
jest.mock('../../services/supabaseAuthService', () => require('../helpers/routeAuthHarness').authModule());
jest.mock('../../security/IdentityResolver', () => require('../helpers/routeAuthHarness').identityModule());

/* eslint-disable @typescript-eslint/no-var-requires */
const route = (p: string) => require(`../../../pages/api/campaigns/${p}`).default;
const twelveWeekPlans = route('12week-plans');
const campaignSummary = route('campaign-summary');
const campaignSummaryUpdate = route('campaign-summary-update');
const getStrategy = route('get-strategy');
const performanceData = route('performance-data');
const weeklyRefinements = route('weekly-refinements');
const metrics = route('metrics');
const weeklyPerformance = route('weekly-performance');
/* eslint-enable @typescript-eslint/no-var-requires */

function world() {
  seed({
    weekly_content_refinements: [
      { id: 'wr-a', campaign_id: CAMPAIGN_A, week_number: 1, theme: 'Theme A' },
      { id: 'wr-b', campaign_id: CAMPAIGN_B, week_number: 1, theme: CANARY_B },
    ],
    campaign_performance: [
      { id: 'perf-a', campaign_id: CAMPAIGN_A, week_number: 1, reach: 3, date: '2026-01-01', conversions: 1 },
      { id: 'perf-b', campaign_id: CAMPAIGN_B, week_number: 1, reach: 9, date: '2026-01-01', conversions: 20, weekly_theme: CANARY_B, total_reach: 7 },
    ],
    campaign_strategies: [
      { campaign_id: CAMPAIGN_A, objective: 'Objective A' },
      { campaign_id: CAMPAIGN_B, objective: CANARY_B },
    ],
    content_pillars: [{ id: 'pil-b', campaign_id: CAMPAIGN_B, pillar_name: CANARY_B }],
    platform_strategies: [{ campaign_id: CAMPAIGN_B, platform: CANARY_B, content_frequency: 3 }],
    campaign_performance_metrics: [
      { id: 'met-a', campaign_id: CAMPAIGN_A, platform: 'linkedin', date: '2026-01-01', impressions: 5 },
      { id: 'met-b', campaign_id: CAMPAIGN_B, platform: CANARY_B, date: '2026-01-01', impressions: 9 },
    ],
  });
}

beforeEach(world);

type Req = { method: string; query?: Record<string, unknown>; body?: unknown };
type RouteCase = {
  name: string;
  handler: any;
  req: (campaignId: string) => Req;
  /** Tables the route reads/writes AFTER the guard (never touched by the guard itself). */
  sink: string[];
  ok: number;
  okCheck?: (body: any) => void;
};

const campaignRoutes: RouteCase[] = [
  {
    name: 'GET 12week-plans',
    handler: twelveWeekPlans,
    req: (id) => ({ method: 'GET', query: { campaignId: id } }),
    sink: ['weekly_content_refinements'],
    ok: 200,
    okCheck: (b) => expect(b.plans.map((p: any) => p.id)).toEqual(['wr-a']),
  },
  {
    name: 'GET campaign-summary',
    handler: campaignSummary,
    req: (id) => ({ method: 'GET', query: { campaignId: id } }),
    sink: ['campaign_goals', 'weekly_content_refinements', 'daily_content_plans'],
    ok: 200,
    okCheck: (b) => expect(b.campaign.id).toBe(CAMPAIGN_A),
  },
  {
    name: 'GET campaign-summary-update',
    handler: campaignSummaryUpdate,
    req: (id) => ({ method: 'GET', query: { campaignId: id } }),
    sink: ['campaigns'],
    ok: 200,
    okCheck: (b) => expect(b.id).toBe(CAMPAIGN_A),
  },
  {
    name: 'PUT campaign-summary-update',
    handler: campaignSummaryUpdate,
    req: (id) => ({ method: 'PUT', query: { campaignId: id }, body: { objective: 'rewritten' } }),
    sink: ['campaigns'],
    ok: 200,
    okCheck: () => expect(rows('campaigns').find((c) => c.id === CAMPAIGN_A)?.objective).toBe('rewritten'),
  },
  {
    name: 'GET get-strategy',
    handler: getStrategy,
    req: (id) => ({ method: 'GET', query: { campaignId: id } }),
    sink: ['campaign_strategies', 'content_pillars', 'platform_strategies'],
    ok: 200,
    okCheck: (b) => expect(b.objective).toBe('Objective A'),
  },
  {
    name: 'GET performance-data',
    handler: performanceData,
    req: (id) => ({ method: 'GET', query: { campaignId: id } }),
    sink: ['campaign_performance'],
    ok: 200,
    okCheck: (b) => expect(b.metrics.reach).toBe(3),
  },
  {
    name: 'GET weekly-refinements',
    handler: weeklyRefinements,
    req: (id) => ({ method: 'GET', query: { campaignId: id } }),
    sink: ['weekly_content_refinements'],
    ok: 200,
    okCheck: (b) => expect(b.refinements.map((r: any) => r.id)).toEqual(['wr-a']),
  },
  {
    name: 'GET metrics',
    handler: metrics,
    req: (id) => ({ method: 'GET', query: { campaignId: id } }),
    sink: ['campaign_performance_metrics'],
    ok: 200,
    okCheck: (b) => expect(b.data.metrics.map((m: any) => m.id)).toEqual(['met-a']),
  },
  {
    name: 'POST metrics',
    handler: metrics,
    req: (id) => ({ method: 'POST', body: { campaignId: id, metricsData: [{ platform: 'linkedin', impressions: 7 }] } }),
    sink: ['campaign_performance_metrics', 'weekly_content_plans', 'campaigns'],
    ok: 200,
    okCheck: () => {
      const written = writeCalls(['campaign_performance_metrics'])[0];
      expect((written.payload as any[]).every((r) => r.campaign_id === CAMPAIGN_A)).toBe(true);
    },
  },
  {
    name: 'GET weekly-performance',
    handler: weeklyPerformance,
    req: (id) => ({ method: 'GET', query: { campaignId: id } }),
    sink: ['campaign_performance'],
    ok: 200,
    okCheck: (b) => expect(b.map((r: any) => r.id)).toEqual(['perf-a']),
  },
  {
    name: 'POST weekly-performance',
    handler: weeklyPerformance,
    req: (id) => ({ method: 'POST', body: { campaign_id: id, week_number: 2 } }),
    sink: ['campaign_performance'],
    ok: 201,
    okCheck: (b) => expect(b.data.campaign_id).toBe(CAMPAIGN_A),
  },
];

describe.each(campaignRoutes)('$name', (c) => {
  it('unauthenticated → 401, sink never reached', async () => {
    const r = await invoke(c.handler, { ...c.req(CAMPAIGN_A), as: null });
    expect(r.status).toBe(401);
    expect(sinkCalls(c.sink)).toHaveLength(0);
    expect(writeCalls()).toHaveLength(0);
  });

  it('member of A cannot use B\'s campaign → 403/404, no leak, nothing written', async () => {
    const r = await invoke(c.handler, { ...c.req(CAMPAIGN_B), as: 'A' });
    expect([403, 404]).toContain(r.status);
    expect(leaksB(r.body)).toBe(false);
    expect(sinkCalls(c.sink)).toHaveLength(0);
    expect(writeCalls()).toHaveLength(0);
  });

  it('unknown campaign → 404, sink never reached', async () => {
    const r = await invoke(c.handler, { ...c.req(UNKNOWN_ID), as: 'A' });
    expect(r.status).toBe(404);
    expect(sinkCalls(c.sink)).toHaveLength(0);
  });

  it('member of A with own campaign → success, only A\'s data', async () => {
    const r = await invoke(c.handler, { ...c.req(CAMPAIGN_A), as: 'A' });
    expect(r.status).toBe(c.ok);
    expect(leaksB(r.body)).toBe(false);
    c.okCheck?.(r.body);
  });

  it('member of B still reaches B\'s own campaign (binding is per tenant, not a blanket deny)', async () => {
    const r = await invoke(c.handler, { ...c.req(CAMPAIGN_B), as: 'B' });
    expect(r.status).toBe(c.ok);
  });
});

describe('campaign-summary-update PUT — B\'s campaign row is never modified by A', () => {
  it('denied write leaves the row untouched', async () => {
    const before = { ...rows('campaigns').find((x) => x.id === CAMPAIGN_B) };
    const r = await invoke(campaignSummaryUpdate, { method: 'PUT', as: 'A', query: { campaignId: CAMPAIGN_B }, body: { objective: 'pwned', weekly_themes: [] } });
    expect([403, 404]).toContain(r.status);
    expect(rows('campaigns').find((x) => x.id === CAMPAIGN_B)).toEqual(before);
  });
});

describe('weekly-performance PUT — record id is authorized through its OWN campaign', () => {
  it('unauthenticated → 401 before the record is even looked up', async () => {
    const r = await invoke(weeklyPerformance, { method: 'PUT', as: null, query: { id: 'perf-a' }, body: { total_reach: 1 } });
    expect(r.status).toBe(401);
    expect(sinkCalls(['campaign_performance'])).toHaveLength(0);
  });

  it('member of A cannot update B\'s record → 403/404, record unchanged', async () => {
    const r = await invoke(weeklyPerformance, { method: 'PUT', as: 'A', query: { id: 'perf-b' }, body: { total_reach: 999 } });
    expect([403, 404]).toContain(r.status);
    expect(leaksB(r.body)).toBe(false);
    expect(writeCalls()).toHaveLength(0);
    expect(rows('campaign_performance').find((x) => x.id === 'perf-b')?.total_reach).toBe(7);
  });

  it('unknown record id → 404, nothing written', async () => {
    const r = await invoke(weeklyPerformance, { method: 'PUT', as: 'A', query: { id: UNKNOWN_ID }, body: { total_reach: 1 } });
    expect(r.status).toBe(404);
    expect(writeCalls()).toHaveLength(0);
  });

  it('member of A updates A\'s own record', async () => {
    const r = await invoke(weeklyPerformance, { method: 'PUT', as: 'A', query: { id: 'perf-a' }, body: { total_reach: 42 } });
    expect(r.status).toBe(200);
    expect(rows('campaign_performance').find((x) => x.id === 'perf-a')?.total_reach).toBe(42);
    const upd = writeCalls(['campaign_performance'])[0];
    expect(upd.filters).toMatchObject({ id: 'perf-a', campaign_id: CAMPAIGN_A });
  });
});

describe('client-supplied tenant ids are not honoured by campaign-keyed routes', () => {
  it('POST weekly-performance with a companyId=B body field still writes only under A\'s bound campaign', async () => {
    const r = await invoke(weeklyPerformance, { method: 'POST', as: 'A', body: { campaign_id: CAMPAIGN_A, week_number: 3, company_id: CO_B, companyId: CO_B } });
    expect(r.status).toBe(201);
    const ins = writeCalls(['campaign_performance'])[0];
    expect((ins.payload as any).campaign_id).toBe(CAMPAIGN_A);
    expect(JSON.stringify(ins.payload)).not.toContain(CO_B);
  });
});
