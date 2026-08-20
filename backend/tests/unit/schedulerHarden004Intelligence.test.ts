/**
 * HARDEN-004 — scheduler batching regression suite (part 2):
 * scheduled lead detection (batched throttle counts + bulk insert/enqueue)
 * and company trend relevance (hoisted config/themes + bounded concurrency).
 * Both must produce IDENTICAL decisions/outputs to the sequential versions.
 */

// ── DB mock (chainable builder, scripted per table) ──
type TableCall = { table: string; op: string; args: unknown[] };
const dbCalls: TableCall[] = [];
const dbResponses: Record<string, unknown> = {};

jest.mock('../../db/writeOwner', () => ({
  ownedDbTable: (table: string) => {
    const ctx: TableCall[] = [];
    const record = (op: string, ...args: unknown[]) => { const c = { table, op, args }; ctx.push(c); dbCalls.push(c); };
    const builder: any = {
      select: (...a: unknown[]) => { record('select', ...a); return builder; },
      insert: (...a: unknown[]) => { record('insert', ...a); return builder; },
      upsert: (...a: unknown[]) => { record('upsert', ...a); return builder; },
      eq: (...a: unknown[]) => { record('eq', ...a); return builder; },
      in: (...a: unknown[]) => { record('in', ...a); return builder; },
      not: (...a: unknown[]) => { record('not', ...a); return builder; },
      gt: (...a: unknown[]) => { record('gt', ...a); return builder; },
      gte: (...a: unknown[]) => { record('gte', ...a); return builder; },
      order: (...a: unknown[]) => { record('order', ...a); return builder; },
      limit: (...a: unknown[]) => { record('limit', ...a); return builder; },
      single: () => { record('single'); return builder; },
      maybeSingle: () => { record('maybeSingle'); return builder; },
      then: (resolve: any, reject: any) => {
        const kind = ctx.some((c) => c.op === 'insert') ? 'insert' : ctx.some((c) => c.op === 'upsert') ? 'upsert' : 'select';
        record('resolve');
        const responder = dbResponses[`${table}:${kind}`];
        const out = typeof responder === 'function' ? (responder as (calls: TableCall[]) => unknown)(ctx) : responder;
        return Promise.resolve(out ?? { data: [], error: null }).then(resolve, reject);
      },
    };
    return builder;
  },
}));

// ── Silence the heavy engine import graph ──
jest.mock('../../queue/intelligencePollingQueue', () => ({
  addIntelligencePollingJob: jest.fn(async () => 'job'),
  addIntelligencePollingJobsBulk: jest.fn(async () => []),
}));
jest.mock('../../services/externalApiService', () => ({
  INTELLIGENCE_POLLER_USER_ID: 'poller',
  isApiSourceExecutable: () => true,
}));
jest.mock('../../services/signalClusterEngine', () => ({ clusterRecentSignals: jest.fn() }));
jest.mock('../../services/signalIntelligenceEngine', () => ({ generateSignalIntelligence: jest.fn() }));
jest.mock('../../services/strategicThemeEngine', () => ({ generateStrategicThemes: jest.fn() }));
jest.mock('../../services/campaignOpportunityEngine', () => ({ generateCampaignOpportunities: jest.fn() }));
jest.mock('../../services/contentOpportunityEngine', () => ({ generateContentOpportunities: jest.fn() }));
jest.mock('../../services/narrativeEngine', () => ({ generateCampaignNarratives: jest.fn() }));
jest.mock('../../services/communityPostEngine', () => ({ generateCommunityPosts: jest.fn() }));
jest.mock('../../services/threadEngine', () => ({ generateCommunityThreads: jest.fn() }));
jest.mock('../../services/engagementCaptureService', () => ({ captureEngagementSignals: jest.fn() }));
jest.mock('../../services/feedbackIntelligenceEngine', () => ({ generateFeedbackInsights: jest.fn() }));
jest.mock('../../services/intelligenceExecutionContext', () => ({ runInBackgroundJobContext: (_: string, fn: () => unknown) => fn() }));

type ThemeRelevanceArgs = Parameters<typeof import('../../services/companyTrendRelevanceEngine')['computeThemeRelevanceForCompany']>;
const computeThemeRelevanceForCompany = jest.fn(async (...[companyId]: ThemeRelevanceArgs) => ({
  company_id: companyId,
  themes_scored: 7,
  errors: [] as string[],
}));
const loadThemesWithTopic = jest.fn(async () => [{ id: 't1', intelligence_id: 'i1', keywords: [], companies: [], topic: 'x' }]);
jest.mock('../../services/companyTrendRelevanceEngine', () => ({
  computeThemeRelevanceForCompany: (...a: ThemeRelevanceArgs) => computeThemeRelevanceForCompany(...a),
  loadThemesWithTopic: () => loadThemesWithTopic(),
}));

type GlobalCfgArgs = Parameters<typeof import('../../services/intelligenceConfigService')['getGlobalConfig']>;
const getGlobalConfig = jest.fn(async (..._a: GlobalCfgArgs) => ({ job_type: 'trend_relevance', enabled: true, priority: 5, daily_job_limit: 100 }));
jest.mock('../../services/intelligenceConfigService', () => ({
  getGlobalConfig: (...a: GlobalCfgArgs) => getGlobalConfig(...a),
  getCompanyOverride: jest.fn(async () => null),
  resolveConfig: (g: Record<string, unknown>) => g,
  getDailyJobCount: jest.fn(async () => 0),
  getCompanyPriorityAdjustment: jest.fn(async () => 'normal'),
  logExecutionStart: jest.fn(async () => 'log-1'),
  logExecutionEnd: jest.fn(async () => undefined),
  logSkipped: jest.fn(async () => undefined),
}));

type QueueAddArgs = Parameters<import('bullmq').Queue['add']>;
const jobQueueAdd = jest.fn(async (..._a: QueueAddArgs) => ({}));
const jobQueueAddBulk = jest.fn(async (jobs: unknown[]) => jobs);
jest.mock('../../queue/jobQueue', () => ({
  jobQueue: { add: jobQueueAdd, addBulk: jobQueueAddBulk },
}));
const recordLeadQueueEnqueue = jest.fn();
jest.mock('../../queue/leadQueueObservability', () => ({
  recordLeadQueueEnqueue: (...a: unknown[]) => recordLeadQueueEnqueue(...a),
}));

import { enqueueScheduledLeadDetection, runCompanyTrendRelevance } from '../../scheduler/schedulerIntelligenceJobs';

beforeEach(() => {
  jest.clearAllMocks();
  dbCalls.length = 0;
  for (const k of Object.keys(dbResponses)) delete dbResponses[k];
});

describe('enqueueScheduledLeadDetection — batched throttle + bulk insert/enqueue', () => {
  it('applies the identical >=2-in-24h skip rule from ONE batched read, bulk-inserts the rest', async () => {
    dbResponses['company_profiles:select'] = { data: [{ company_id: 'A' }, { company_id: 'B' }, { company_id: 'C' }], error: null };
    // B already has 2 recent lead jobs → skipped, exactly like the per-company count.
    dbResponses['lead_jobs_v1:select'] = { data: [{ company_id: 'B' }, { company_id: 'B' }, { company_id: 'C' }], error: null };
    dbResponses['lead_jobs_v1:insert'] = (calls: TableCall[]) => {
      const rows = (calls.find((c) => c.op === 'insert')?.args[0] ?? []) as Array<{ company_id: string }>;
      return { data: rows.map((r, i) => ({ id: `lj-${r.company_id}`, company_id: r.company_id })), error: null };
    };

    const res = await enqueueScheduledLeadDetection();
    expect(res.enqueued).toBe(2);
    expect(res.errors).toEqual([]);

    // Row payloads identical to the sequential version.
    const insertedRows = dbCalls.find((c) => c.table === 'lead_jobs_v1' && c.op === 'insert')!.args[0] as Array<Record<string, unknown>>;
    expect(insertedRows.map((r) => r.company_id)).toEqual(['A', 'C']);
    expect(insertedRows[0]).toMatchObject({
      platforms: ['reddit', 'linkedin', 'twitter'],
      regions: ['GLOBAL'],
      mode: 'REACTIVE',
      status: 'PENDING',
      context_payload: { scheduled_run: true },
    });

    // Idempotent jobIds preserved; one pipelined enqueue; per-job latency metric count preserved.
    const jobs = jobQueueAddBulk.mock.calls[0][0] as any[];
    expect(jobs.map((j) => j.opts.jobId)).toEqual(['lead-detection:lj-A', 'lead-detection:lj-C']);
    expect(jobs.map((j) => j.data)).toEqual([
      { type: 'LEAD', jobId: 'lj-A' },
      { type: 'LEAD', jobId: 'lj-C' },
    ]);
    expect(recordLeadQueueEnqueue).toHaveBeenCalledTimes(2);
    expect(jobQueueAdd).not.toHaveBeenCalled();

    // Round-trips: 1 companies + 1 recent-jobs + 1 bulk insert = 3 (was 1 + 2×N).
    expect(dbCalls.filter((c) => c.op === 'resolve')).toHaveLength(3);
  });

  it('bulk failure → identical per-company fallback (insert + add per company)', async () => {
    dbResponses['company_profiles:select'] = { data: [{ company_id: 'A' }, { company_id: 'B' }], error: null };
    dbResponses['lead_jobs_v1:select'] = { data: [], error: null };
    let insertCalls = 0;
    dbResponses['lead_jobs_v1:insert'] = (calls: TableCall[]) => {
      insertCalls++;
      if (insertCalls === 1) return { data: null, error: { message: 'bulk exploded' } };
      const row = calls.find((c) => c.op === 'insert')!.args[0] as { company_id: string };
      return { data: { id: `lj-${row.company_id}` }, error: null };
    };
    const res = await enqueueScheduledLeadDetection();
    expect(res.enqueued).toBe(2);
    expect(jobQueueAdd).toHaveBeenCalledTimes(2);
    expect(jobQueueAdd.mock.calls[0][2]).toEqual({ jobId: 'lead-detection:lj-A' });
  });

  it('all companies throttled → zero inserts/enqueues', async () => {
    dbResponses['company_profiles:select'] = { data: [{ company_id: 'A' }], error: null };
    dbResponses['lead_jobs_v1:select'] = { data: [{ company_id: 'A' }, { company_id: 'A' }, { company_id: 'A' }], error: null };
    const res = await enqueueScheduledLeadDetection();
    expect(res).toEqual({ enqueued: 0, errors: [] });
    expect(jobQueueAddBulk).not.toHaveBeenCalled();
    expect(dbCalls.filter((c) => c.table === 'lead_jobs_v1' && c.op === 'insert')).toHaveLength(0);
  });
});

describe('runCompanyTrendRelevance — hoisted config/themes + bounded concurrency', () => {
  it('loads global config and themes ONCE, aggregates identical totals in input order', async () => {
    dbResponses['companies:select'] = { data: [{ id: 'A' }, { id: 'B' }, { id: 'C' }], error: null };
    computeThemeRelevanceForCompany
      .mockResolvedValueOnce({ company_id: 'A', themes_scored: 3, errors: [] })
      .mockResolvedValueOnce({ company_id: 'B', themes_scored: 4, errors: ['b-oops'] })
      .mockResolvedValueOnce({ company_id: 'C', themes_scored: 5, errors: [] });

    const res = await runCompanyTrendRelevance();
    expect(res.companies_processed).toBe(3);
    expect(res.total_themes_scored).toBe(12);
    expect(res.errors).toEqual(['b-oops']);

    // N+1 elimination proof: jobType-constant lookups hoisted out of the loop.
    expect(getGlobalConfig).toHaveBeenCalledTimes(1);
    expect(loadThemesWithTopic).toHaveBeenCalledTimes(1);
    expect(computeThemeRelevanceForCompany).toHaveBeenCalledTimes(3);
    // Preloaded theme set is passed to every company run.
    for (const call of computeThemeRelevanceForCompany.mock.calls) {
      expect(call[1]).toEqual(await loadThemesWithTopic.mock.results[0].value);
    }
  });

  it('a failing company is isolated with the identical error entry, others still run', async () => {
    dbResponses['companies:select'] = { data: [{ id: 'A' }, { id: 'B' }], error: null };
    computeThemeRelevanceForCompany
      .mockRejectedValueOnce(new Error('engine down'))
      .mockResolvedValueOnce({ company_id: 'B', themes_scored: 2, errors: [] });
    const res = await runCompanyTrendRelevance();
    expect(res.companies_processed).toBe(2);
    expect(res.total_themes_scored).toBe(2);
    expect(res.errors).toEqual(['company A: engine down']);
  });

  it('disabled job → every company skipped (identical gate)', async () => {
    dbResponses['companies:select'] = { data: [{ id: 'A' }, { id: 'B' }], error: null };
    getGlobalConfig.mockResolvedValueOnce({ job_type: 'trend_relevance', enabled: false, priority: 5, daily_job_limit: 100 });
    const res = await runCompanyTrendRelevance();
    expect(res.total_themes_scored).toBe(0);
    expect(computeThemeRelevanceForCompany).not.toHaveBeenCalled();
  });
});
