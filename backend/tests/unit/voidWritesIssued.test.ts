/**
 * "A write that never executes" (e1/05 defect class, e9 2026-11-12).
 *
 * `void ownedDbTable(t).insert/update/upsert(...)` builds a LAZY PostgREST builder and throws it
 * away: nothing awaits it, so no request is ever sent. Four sites on origin/main (an AST scan of
 * backend/, pages/ and lib/ found exactly these): campaign_outcomes upsert, fail_fast_log insert,
 * master_content_cache hit_count update and credit_efficiency_scores credits_saved_total update.
 *
 * NOT KINDER THAN THE REAL THING: the table double is LAZY like postgrest-js. A chain records its
 * calls but issues NOTHING until it is awaited (`then`). Only then is the request logged and
 * answered. So a `void`ed write is never issued here either, and a test asserting the write was
 * ISSUED fails on the old code. Undeclared tables throw.
 *
 * One case per site; restoring `void` at a site fails exactly that site's cases (mutants run by
 * hand, recorded in the commit).
 */
type Op = { method: string; args: unknown[] };
type Issued = { table: string; ops: Op[] };
type Answer = { data?: unknown; error?: { message: string } | null; count?: number | null };

const issued: Issued[] = [];
let answers: Record<string, (ops: Op[]) => Answer> = {};

function lazyTable(table: string) {
  if (!(table in answers)) throw new Error(`undeclared table ${table}`);
  const ops: Op[] = [];
  const builder: Record<string, unknown> = {};
  const methods = ['select', 'insert', 'update', 'upsert', 'delete', 'eq', 'neq', 'in', 'is', 'gte', 'gt', 'lt', 'lte', 'order', 'limit', 'maybeSingle', 'single', 'or', 'not', 'filter', 'match', 'range'];
  for (const m of methods) {
    builder[m] = (...args: unknown[]) => { ops.push({ method: m, args }); return builder; };
  }
  // The request is sent ONLY here, as with postgrest-js.
  builder.then = (resolve: (v: Answer) => unknown, reject: (e: unknown) => unknown) => {
    issued.push({ table, ops: [...ops] });
    try {
      const a = answers[table](ops);
      return Promise.resolve({ data: a.data ?? null, error: a.error ?? null, count: a.count ?? null }).then(resolve, reject);
    } catch (e) {
      return Promise.reject(e).then(resolve, reject);
    }
  };
  return builder;
}

jest.mock('../../db/writeOwner', () => ({ ownedDbTable: (t: string) => lazyTable(t) }));
jest.mock('../../db/supabaseClient', () => ({ supabase: { from: (t: string) => lazyTable(t) } }));
jest.mock('../../services/creditDeductionService', () => ({ getCreditCost: async () => 10 }));
jest.mock('../../services/patternAmplificationService', () => ({
  amplifyWinningPatterns: async () => ({ amplified: [], boosted: [], prompt_context: '' }),
}));
jest.mock('../../services/globalPatternService', () => ({ getPlatformBenchmark: () => ({ avg: 0.05 }) }));

const writesTo = (table: string, method: string) =>
  issued.filter((r) => r.table === table && r.ops.some((o) => o.method === method));

let errorLog: jest.SpyInstance;
beforeEach(() => {
  issued.length = 0;
  answers = {};
  errorLog = jest.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => jest.restoreAllMocks());

const CAMPAIGN = 'c0000000-0000-4000-8000-000000000001';
const COMPANY = 'c0000000-0000-4000-8000-0000000000aa';

describe('SITE 1: campaign_outcomes upsert (measureOutcomeScore)', () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { measureOutcomeScore } = require('../../services/outcomeTrackingService');
  const reads = () => {
    answers = {
      credit_transactions: () => ({ data: [{ credits_delta: -30 }] }),
      campaigns: () => ({ data: { created_at: '2026-11-01T00:00:00Z' } }),
      performance_feedback: () => ({ data: [] }),
      community_ai_actions: () => ({ data: [], count: 0 }),
      prediction_accuracy_log: () => ({ data: null }),
    };
  };

  it('ISSUES the upsert, on campaign_id, with the snapshot it returns', async () => {
    reads();
    answers.campaign_outcomes = () => ({ error: null });
    const snap = await measureOutcomeScore(CAMPAIGN, COMPANY);
    const w = writesTo('campaign_outcomes', 'upsert');
    expect(w).toHaveLength(1);
    const up = w[0].ops.find((o) => o.method === 'upsert')!;
    expect(up.args[0]).toMatchObject({ campaign_id: CAMPAIGN, company_id: COMPANY, credits_used: snap.credits_used });
    expect(up.args[1]).toEqual({ onConflict: 'campaign_id' });
  });

  it('a failed upsert is an error (readers rely on the row)', async () => {
    reads();
    answers.campaign_outcomes = () => ({ error: { message: 'permission denied' } });
    await expect(measureOutcomeScore(CAMPAIGN, COMPANY)).rejects.toThrow('campaign_outcomes upsert failed');
  });
});

describe('SITE 2: fail_fast_log insert (checkAndFailFast, a stop decision)', () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { checkAndFailFast } = require('../../services/failFastService');
  // Enough samples far below the benchmark (avg 0.05) to force `stop`.
  const lowRows = Array.from({ length: 20 }, () => ({ content_type: 'carousel', platform: 'linkedin', engagement_rate: 0.0001 }));

  it('ISSUES the insert for the stop decision', async () => {
    answers = { performance_feedback: () => ({ data: lowRows }), fail_fast_log: () => ({ error: null }) };
    const r = await checkAndFailFast(CAMPAIGN, COMPANY);
    expect(r.decisions.some((d: { decision: string }) => d.decision === 'stop')).toBe(true);
    const w = writesTo('fail_fast_log', 'insert');
    expect(w).toHaveLength(1);
    expect(w[0].ops[0].args[0]).toMatchObject({ company_id: COMPANY, campaign_id: CAMPAIGN, content_type: 'carousel' });
  });

  it('best-effort: a failed insert is logged, and the decision still returns', async () => {
    answers = { performance_feedback: () => ({ data: lowRows }), fail_fast_log: () => ({ error: { message: 'boom' } }) };
    const r = await checkAndFailFast(CAMPAIGN, COMPANY);
    expect(r.decisions.length).toBeGreaterThan(0);
    expect(errorLog.mock.calls.some((c) => String(c[0]).includes('fail_fast_log insert failed'))).toBe(true);
  });
});

describe('SITE 3: master_content_cache hit_count update (getCachedMaster)', () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { getCachedMaster } = require('../../queue/jobProcessors/boltContentJobProcessor');

  it('ISSUES the update with the SELECTED hit_count + 1 (not NaN), and serves the hit', async () => {
    answers = {
      master_content_cache: (ops) => (ops.some((o) => o.method === 'update')
        ? { error: null }
        : { data: { master_content: 'MASTER', expires_at: null, hit_count: 4 } }),
    };
    const hit = await getCachedMaster(COMPANY, 'topic-a');
    expect(hit).toBe('MASTER');
    const read = issued.find((r) => r.table === 'master_content_cache' && r.ops[0].method === 'select')!;
    expect(String(read.ops[0].args[0])).toContain('hit_count');
    const w = writesTo('master_content_cache', 'update');
    expect(w).toHaveLength(1);
    expect(w[0].ops[0].args[0]).toEqual({ hit_count: 5 });
  });

  it('best-effort: a failed counter update never turns the HIT into a miss', async () => {
    answers = {
      master_content_cache: (ops) => {
        if (ops.some((o) => o.method === 'update')) throw new Error('network down');
        return { data: { master_content: 'MASTER', expires_at: null, hit_count: null } };
      },
    };
    await expect(getCachedMaster(COMPANY, 'topic-b')).resolves.toBe('MASTER');
    expect(errorLog.mock.calls.some((c) => String(c[0]).includes('hit_count update threw'))).toBe(true);
  });
});

describe('SITE 4: credit_efficiency_scores credits_saved_total update (optimizeCreditEfficiency)', () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { optimizeCreditEfficiency } = require('../../services/creditEfficiencyEngine');

  it('ISSUES the credits_saved_total update after the tier upsert', async () => {
    answers = {
      campaign_outcomes: () => ({ data: [] }),
      credit_efficiency_scores: () => ({ error: null }),
      content_type_efficiency: () => ({ data: [] }),
      performance_feedback: () => ({ data: [] }),
      campaigns: () => ({ data: [] }),
    };
    const report = await optimizeCreditEfficiency(COMPANY);
    expect(report.efficiency_tier).toBe('standard');
    const scores = issued.filter((r) => r.table === 'credit_efficiency_scores');
    expect(scores.map((r) => r.ops[0].method)).toEqual(['upsert', 'update']);
    expect(scores[1].ops[0].args[0]).toMatchObject({ credits_saved_total: report.credits_saved_estimate });
  });
});
