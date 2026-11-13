/**
 * BLOCKING (binding rule, e9 2026-11-14): "central intelligence holds NO tenant activity".
 * enqueueIntelligencePolling enqueues PLATFORM polls (companyId null), whose results are written to
 * intelligence_signals as platform rows. A TENANT-OWNED external_api_sources row (company_id set) must therefore never
 * be enqueued by it - in either mode (global fallback, or company-config mode). A platform source still is
 * (positive control).
 */
type Row = Record<string, unknown>;
const tables: Record<string, Row[]> = {};

jest.mock('../../db/writeOwner', () => ({
  // A filter-honouring fake: eq / is / in / gte / lt narrow the seeded rows, so a missing predicate is visible.
  ownedDbTable: (table: string) => {
    const preds: Array<(r: Row) => boolean> = [];
    const b: any = {
      select: () => b,
      eq: (c: string, v: unknown) => { preds.push((r) => r[c] === v); return b; },
      is: (c: string, v: unknown) => { preds.push((r) => (v === null ? r[c] === null || r[c] === undefined : r[c] === v)); return b; },
      in: (c: string, vs: unknown[]) => { preds.push((r) => vs.includes(r[c])); return b; },
      gte: () => b, lt: () => b, order: () => b, limit: () => b,
      then: (ok: any, err: any) =>
        Promise.resolve({ data: (tables[table] ?? []).filter((r) => preds.every((p) => p(r))), error: null }).then(ok, err),
    };
    return b;
  },
}));
const enqueued: Array<{ apiSourceId: string; companyId: unknown }> = [];
jest.mock('../../queue/intelligencePollingQueue', () => ({
  addIntelligencePollingJob: jest.fn(async (p: { apiSourceId: string; companyId: unknown }) => { enqueued.push(p); return 'job'; }),
  addIntelligencePollingJobsBulk: jest.fn(async (jobs: Array<{ payload: { apiSourceId: string; companyId: unknown } }>) => {
    for (const j of jobs) enqueued.push(j.payload);
    return [];
  }),
}));
jest.mock('../../services/externalApiService', () => ({ INTELLIGENCE_POLLER_USER_ID: 'poller', isApiSourceExecutable: () => true }));
for (const m of ['signalClusterEngine', 'signalIntelligenceEngine', 'strategicThemeEngine', 'campaignOpportunityEngine',
  'contentOpportunityEngine', 'narrativeEngine', 'communityPostEngine', 'threadEngine', 'engagementCaptureService',
  'feedbackIntelligenceEngine', 'companyTrendRelevanceEngine', 'intelligenceConfigService']) {
  jest.doMock(`../../services/${m}`, () => ({}));
}
jest.mock('../../services/intelligenceExecutionContext', () => ({ runInBackgroundJobContext: (_: string, fn: () => unknown) => fn() }));
jest.mock('../../queue/jobQueue', () => ({ jobQueue: { add: jest.fn(), addBulk: jest.fn() } }));
jest.mock('../../queue/leadQueueObservability', () => ({ recordLeadQueueEnqueue: jest.fn() }));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { enqueueIntelligencePolling } = require('../../scheduler/schedulerIntelligenceJobs');

const PLATFORM_SRC = { id: 'src-platform', name: 'platform', is_active: true, company_id: null, rate_limit_per_min: 60 };
const TENANT_SRC = { id: 'src-tenant', name: 'tenant-owned', is_active: true, company_id: 'c0000000-0000-4000-8000-0000000000c1', rate_limit_per_min: 60 };

beforeEach(() => {
  enqueued.length = 0;
  for (const k of Object.keys(tables)) delete tables[k];
  tables.external_api_sources = [PLATFORM_SRC, TENANT_SRC];
});

describe('platform polling never enqueues a tenant-owned source', () => {
  it('global fallback (no company configs): the platform source is enqueued, the tenant-owned one is not', async () => {
    tables.company_api_configs = [];
    await enqueueIntelligencePolling();
    const ids = enqueued.map((p) => p.apiSourceId);
    expect(ids).toContain('src-platform'); // positive control
    expect(ids).not.toContain('src-tenant');
    expect(enqueued.every((p) => p.companyId === null)).toBe(true);
  });
  it('company-config mode: even a company config naming the tenant-owned source does not get it platform-polled', async () => {
    tables.company_api_configs = [
      { api_source_id: 'src-platform', polling_frequency: 'hourly', enabled: true },
      { api_source_id: 'src-tenant', polling_frequency: 'hourly', enabled: true },
    ];
    await enqueueIntelligencePolling();
    const ids = enqueued.map((p) => p.apiSourceId);
    expect(ids).toContain('src-platform'); // positive control
    expect(ids).not.toContain('src-tenant');
  });
});
