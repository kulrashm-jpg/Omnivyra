/**
 * PHASE 168 — /api/bolt/execute duplicate arbitration, at the endpoint.
 *
 * The fingerprint is tested separately; this exercises the ENDPOINT's decision
 * table, because that is where the Phase 167 defect actually lived: the guard
 * that existed could not fire, and the lookup that fed it discarded its error.
 *
 * The Supabase fake below holds real rows and honours the filters the handler
 * applies, so "returns the existing run" is proven by the handler finding a row,
 * not by a stubbed return value.
 */

type Row = Record<string, unknown>;

const runs: Row[] = [];
let lookupError: { message: string } | null = null;
let insertError: { code?: string; message: string } | null = null;
let insertedCount = 0;

function chain(table: string) {
  const eqs: Array<[string, unknown]> = [];
  const ins: Array<[string, unknown[]]> = [];
  let ors: string | null = null;

  // PostgREST addresses JSONB members as `column->>key`; the handler filters on
  // `payload->>idempotency_key`. Resolving it literally would compare against a
  // column that does not exist and silently match nothing — which is precisely
  // how a guard can look correct and never fire.
  const cell = (r: Row, col: string): unknown => {
    const arrow = col.indexOf('->>');
    if (arrow === -1) return r[col];
    const container = r[col.slice(0, arrow)];
    const key = col.slice(arrow + 3);
    if (!container || typeof container !== 'object') return undefined;
    const raw = (container as Record<string, unknown>)[key];
    return raw === undefined || raw === null ? raw : String(raw);
  };

  const matches = (r: Row) =>
    eqs.every(([c, v]) => cell(r, c) === v) &&
    ins.every(([c, vs]) => vs.includes(r[c] as never)) &&
    (ors === null || ors.split(',').some((cl) => {
      const [col, op, ...rest] = cl.split('.');
      return op === 'eq' && r[col] === rest.join('.');
    }));

  const api: Record<string, (...a: any[]) => any> = {
    select: () => api,
    eq: (c: string, v: unknown) => { eqs.push([c, v]); return api; },
    in: (c: string, v: unknown[]) => { ins.push([c, v]); return api; },
    or: (e: string) => { ors = e; return api; },
    limit: () => api,
    lt: () => api,
    is: () => api,
    update: () => ({ eq: () => Promise.resolve({ data: null, error: null }), in: () => Promise.resolve({ data: null, error: null }), lt: () => Promise.resolve({ data: null, error: null }), or: () => api, is: () => api, select: () => Promise.resolve({ data: [], error: null }) }),
    maybeSingle: async () => {
      if (lookupError) return { data: null, error: lookupError };
      return { data: runs.filter(matches)[0] ?? null, error: null };
    },
    insert: (values: Row) => ({
      select: () => ({
        single: async () => {
          if (insertError) return { data: null, error: insertError };
          insertedCount += 1;
          const row = { id: `run-${runs.length + 1}`, status: 'started', ...values };
          runs.push(row);
          return { data: { id: row.id }, error: null };
        },
      }),
    }),
  };
  void table;
  return api;
}

jest.mock('../../../lib/platform/routeFactory', () => ({ createApiRoute: (h: unknown) => h }));
jest.mock('../../db/supabaseClient', () => ({ supabase: { from: jest.fn((t: string) => chain(t)) } }));
jest.mock('../../db/writeOwner', () => ({ ownedDbTable: jest.fn((t: string) => chain(t)) }));
jest.mock('../../services/userContextService', () => ({
  enforceCompanyAccess: jest.fn(async () => ({ userId: '11111111-1111-4111-8111-111111111111' })),
}));
jest.mock('../../services/boltSchemaReadiness', () => ({
  probeBoltSchemaReadiness: jest.fn(async () => ({ ready: true, missing_blocking: [] })),
}));
jest.mock('../../services/boltPreExecutionValidator', () => ({
  validateBoltPreExecution: jest.fn(async () => ({ ok: true, errors: [] })),
}));
jest.mock('../../services/boltStrategyDifferential', () => ({
  computeSiblingDifferential: jest.fn(async () => null),
}));
jest.mock('../../queue/boltQueue', () => ({ getBoltQueue: jest.fn(() => ({})) }));
jest.mock('../../middleware/queueBackpressure', () => ({ safeEnqueue: jest.fn(async () => ({ id: 'job-1' })) }));

import handler from '../../../pages/api/bolt/execute';

const BODY = {
  companyId: 'company-1',
  title: 'Why Ai-driven Insights for Campaign Success Is Becoming Hard',
  outcomeView: 'week_plan',
  recId: 'rec-1',
  executionConfig: { campaign_mode: 'text', frequency: 3, selected_platforms: ['linkedin'] },
  sourceStrategicTheme: { id: 'theme-1', title: 'Insight-led GTM' },
};

function mockRes() {
  const res: any = { statusCode: 0, body: null };
  res.status = (c: number) => { res.statusCode = c; return res; };
  res.json = (b: unknown) => { res.body = b; return res; };
  return res;
}

const post = async (body: Record<string, unknown> = BODY) => {
  const res = mockRes();
  await (handler as unknown as (q: unknown, s: unknown) => Promise<void>)(
    { method: 'POST', body } as never, res as never,
  );
  return res;
};

beforeEach(() => {
  runs.length = 0;
  lookupError = null;
  insertError = null;
  insertedCount = 0;
});

describe('A. the Phase 167 double-submit', () => {
  test('the first request creates a run', async () => {
    const res = await post();
    expect(res.statusCode).toBe(202);
    expect(insertedCount).toBe(1);
    expect(res.body.run_id).toBe('run-1');
  });

  test('an immediate identical resubmission returns the ORIGINAL run', async () => {
    const first = await post();
    const second = await post();
    expect(second.statusCode).toBe(202);
    expect(second.body.run_id).toBe(first.body.run_id);
    expect(second.body.deduplicated).toBe(true);
    // The defect was a SECOND execution; exactly one row must exist.
    expect(insertedCount).toBe(1);
  });

  test('a genuinely different request still creates its own run', async () => {
    await post();
    const other = await post({ ...BODY, executionConfig: { campaign_mode: 'creator', frequency: 3 } });
    expect(other.statusCode).toBe(202);
    expect(insertedCount).toBe(2);
  });

  test('a different company is unaffected by another tenant\'s live run', async () => {
    await post();
    await post({ ...BODY, companyId: 'company-2' });
    expect(insertedCount).toBe(2);
  });
});

describe('B. legitimate reruns are preserved', () => {
  test('a FAILED original does not block an identical retry', async () => {
    await post();
    runs[0].status = 'failed';
    const retry = await post();
    expect(retry.body.deduplicated).toBeUndefined();
    expect(insertedCount).toBe(2);
  });

  test('a COMPLETED original does not block running it again', async () => {
    await post();
    runs[0].status = 'completed';
    await post();
    expect(insertedCount).toBe(2);
  });

  test('a run reclaimed by recovery stops blocking', async () => {
    await post();
    // What sweepStaleExecutions / reconcileAbandonedBoltRun do to a stuck run.
    runs[0].status = 'failed';
    runs[0].abandonment_reason = 'cron_stale_execution_sweep';
    await post();
    expect(insertedCount).toBe(2);
  });
});

describe('C. a failed lookup is never read as "no duplicate"', () => {
  test('an idempotency lookup error refuses rather than starting a rival run', async () => {
    lookupError = { message: 'connection reset' };
    const res = await post();
    expect(res.statusCode).toBe(503);
    expect(res.body.code).toBe('DUPLICATE_CHECK_UNAVAILABLE');
    expect(insertedCount).toBe(0);
  });
});

describe('D. concurrent duplicates are arbitrated by the database', () => {
  test('the loser of a 23505 race resolves to the winner\'s run', async () => {
    // Winner already inserted; loser's INSERT is rejected by the live index.
    await post();
    insertError = {
      code: '23505',
      message: 'duplicate key value violates unique constraint "uidx_bolt_runs_live_request_fingerprint"',
    };
    // Force past the pre-insert check to simulate a true interleave.
    const saved = runs[0].status;
    runs[0].status = 'completed';
    const res = await post();
    runs[0].status = saved;
    expect(res.statusCode).toBe(409);
    expect(res.body.code).toBe('DUPLICATE_EXECUTION_REQUEST');
  });

  test('an unrelated 23505 is still a 500, not a silent dedupe', async () => {
    insertError = { code: '23505', message: 'duplicate key value violates unique constraint "other_idx"' };
    const res = await post();
    expect(res.statusCode).toBe(500);
  });
});
