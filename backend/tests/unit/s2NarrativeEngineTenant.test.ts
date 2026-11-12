/**
 * S2 tenant seam (e1, 83 ruling 2) - the narrative engine used to read the latest 100 content_opportunities
 * across ALL tenants in one global call. Now runNarrativeEngine discovers the companies with work (company_id only,
 * last 7 days) and runs generateCampaignNarratives per company under systemTenantContext: each company's
 * narratives come only from its own opportunities (tenantTable) and are written through tenantChildTableOf.
 * Allow-list entry: narrative-cron-company-discovery.
 */
export {};
type Row = Record<string, any>;
const mockDb: Record<string, Row[]> = {};
const mockSelects: Array<{ table: string; cols: string }> = [];
const mockInserts: Array<{ table: string; rows: Row[] }> = [];
function mockTable(table: string) {
  const tests: Array<(r: Row) => boolean> = []; let cap = Infinity; let op = 'select'; let payload: Row[] = [];
  let orderBy: [string, boolean] | null = null;
  const b: any = {
    select: (cols?: string) => { mockSelects.push({ table, cols: cols ?? '*' }); return b; },
    eq: (c: string, v: unknown) => { tests.push((r) => r[c] === v); return b; },
    in: (c: string, v: unknown[]) => { tests.push((r) => v.includes(r[c])); return b; },
    gte: (c: string, v: any) => { tests.push((r) => r[c] >= v); return b; },
    not: (c: string, _o: string, v: unknown) => { tests.push((r) => (r[c] ?? null) !== v); return b; },
    order: (c: string, o?: { ascending?: boolean }) => { orderBy = [c, o?.ascending !== false]; return b; },
    limit: (n: number) => { cap = n; return b; },
    insert: (p: Row | Row[]) => { op = 'insert'; payload = Array.isArray(p) ? p : [p]; return b; },
    then: (ok: any, ko: any) => {
      if (op === 'insert') {
        (mockDb[table] ??= []).push(...payload);
        mockInserts.push({ table, rows: payload });
        return Promise.resolve({ data: null, error: null }).then(ok, ko);
      }
      let hit = (mockDb[table] ?? []).filter((r) => tests.every((t) => t(r)));
      if (orderBy) { const [k, asc] = orderBy; hit = [...hit].sort((x, y) => (asc ? 1 : -1) * String(x[k]).localeCompare(String(y[k]))); }
      return Promise.resolve({ data: hit.slice(0, cap), error: null }).then(ok, ko);
    },
  };
  return b;
}
jest.mock('../../db/writeOwner', () => ({ ownedDbTable: (t: string) => mockTable(t) }));
jest.mock('../../db/supabaseClient', () => ({ supabase: { from: (t: string) => mockTable(t) } }));
// Silence the scheduler's heavy engine import graph (narrativeEngine stays REAL).
jest.mock('../../queue/intelligencePollingQueue', () => ({ addIntelligencePollingJob: jest.fn(), addIntelligencePollingJobsBulk: jest.fn() }));
jest.mock('../../services/externalApiService', () => ({ INTELLIGENCE_POLLER_USER_ID: 'poller', isApiSourceExecutable: () => true }));
jest.mock('../../services/signalClusterEngine', () => ({ clusterRecentSignals: jest.fn() }));
jest.mock('../../services/signalIntelligenceEngine', () => ({ generateSignalIntelligence: jest.fn() }));
jest.mock('../../services/strategicThemeEngine', () => ({ generateStrategicThemes: jest.fn() }));
jest.mock('../../services/campaignOpportunityEngine', () => ({ generateCampaignOpportunities: jest.fn() }));
jest.mock('../../services/contentOpportunityEngine', () => ({ generateContentOpportunities: jest.fn() }));
jest.mock('../../services/communityPostEngine', () => ({ generateCommunityPosts: jest.fn() }));
jest.mock('../../services/threadEngine', () => ({ generateCommunityThreads: jest.fn() }));
jest.mock('../../services/engagementCaptureService', () => ({ captureEngagementSignals: jest.fn() }));
jest.mock('../../services/feedbackIntelligenceEngine', () => ({ generateFeedbackInsights: jest.fn() }));
jest.mock('../../services/intelligenceExecutionContext', () => ({ runInBackgroundJobContext: (_: string, fn: () => unknown) => fn() }));
jest.mock('../../services/companyTrendRelevanceEngine', () => ({ computeThemeRelevanceForCompany: jest.fn(), loadThemesWithTopic: jest.fn() }));
jest.mock('../../services/intelligenceConfigService', () => ({
  getGlobalConfig: jest.fn(async () => ({ job_type: 'narrative_engine', enabled: true, priority: 5, daily_job_limit: 100 })),
  getCompanyOverride: jest.fn(async () => null),
  resolveConfig: (g: Record<string, unknown>) => g,
  getDailyJobCount: jest.fn(async () => 0),
  getCompanyPriorityAdjustment: jest.fn(async () => 'normal'),
  logExecutionStart: jest.fn(async () => 'log-1'),
  logExecutionEnd: jest.fn(async () => undefined),
  logSkipped: jest.fn(async () => undefined),
}));
jest.mock('../../queue/jobQueue', () => ({ jobQueue: { add: jest.fn(), addBulk: jest.fn() } }));
jest.mock('../../queue/leadQueueObservability', () => ({ recordLeadQueueEnqueue: jest.fn() }));

/* eslint-disable @typescript-eslint/no-var-requires */
const { runNarrativeEngine, discoverNarrativeWorkCompanies } = require('../../scheduler/schedulerIntelligenceJobs');
/* eslint-enable @typescript-eslint/no-var-requires */
const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const DORMANT = '33333333-3333-4333-8333-333333333333';
const recent = new Date(Date.now() - 2 * 86400_000).toISOString();
const old = new Date(Date.now() - 30 * 86400_000).toISOString();
beforeEach(() => {
  for (const k of Object.keys(mockDb)) delete mockDb[k];
  mockSelects.length = 0; mockInserts.length = 0;
  mockDb.content_opportunities = [
    { id: 'opp-a', company_id: A, created_at: recent, opportunity_title: 'A topic', opportunity_description: 'A secret plan', opportunity_type: 't' },
    { id: 'opp-b', company_id: B, created_at: recent, opportunity_title: 'B topic', opportunity_description: 'B secret plan', opportunity_type: 't' },
    { id: 'opp-old', company_id: DORMANT, created_at: old, opportunity_title: 'old', opportunity_description: 'old', opportunity_type: 't' },
  ];
  mockDb.campaign_narratives = [];
});

it('discovery reads company_id only, and only companies with recent work', async () => {
  const ids = await discoverNarrativeWorkCompanies();
  expect(ids.sort()).toEqual([A, B].sort());
  const discovery = mockSelects.filter((s) => s.table === 'content_opportunities');
  expect(discovery.map((s) => s.cols)).toEqual(['company_id']);
});

it('each company is processed only with its own opportunities', async () => {
  const res = await runNarrativeEngine();
  expect(res).toMatchObject({ companies_processed: 2, opportunities_processed: 2, narratives_created: 24, errors: [] });
  // 3 angles x 4 platforms per opportunity, each insert batch carries ONE company's opportunity only
  const batches = mockInserts.filter((i) => i.table === 'campaign_narratives').map((i) => [...new Set(i.rows.map((r) => r.opportunity_id))]);
  expect(batches.sort()).toEqual([['opp-a'], ['opp-b']]);
  expect(mockDb.campaign_narratives.filter((n) => n.opportunity_id === 'opp-old')).toEqual([]);
});

it('an opportunity that already has narratives is not processed again', async () => {
  mockDb.campaign_narratives = [{ opportunity_id: 'opp-a', narrative_angle: 'x', platform: 'Blog' }];
  const res = await runNarrativeEngine();
  expect(res.opportunities_processed).toBe(1);
  expect(mockInserts.flatMap((i) => i.rows).every((r) => r.opportunity_id === 'opp-b')).toBe(true);
});
