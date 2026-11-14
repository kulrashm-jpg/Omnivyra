/**
 * OWNER 2026-11-14: every Market Pulse door holds 8 credits x AI region BEFORE anything is written.
 *   - /api/market-pulse/run and the LEGACY /api/market-pulse/job/create: a refused hold -> 402, no job row, no run, no
 *     processing (no AI call); an accepted hold persists the handle on the job (context_payload.credit_reservation)
 *     keyed on the job id it pre-generated; a queue shed releases the hold.
 *   - the cron: cadence honoured (weekly company: once in 7 days; daily: daily); a refused hold skips the company with
 *     nothing written; a run started stamps last_run_at.
 */
const reserveCalls: any[] = [];
const releaseCalls: any[] = [];
let reserveResult: any = { status: 'reserved' };
jest.mock('../../services/creditExecutionService', () => ({
  reserveCreditsForWork: async (o: any) => { reserveCalls.push(o); return reserveResult.status === 'reserved'
    ? { status: 'reserved', orgId: o.orgId, userId: o.userId, action: o.action, referenceType: o.referenceType, referenceId: o.referenceId,
        idempotencyKey: o.idempotencyKey, holdTransactionId: 'hold-1', creditsReserved: o.amountOverride, split: { free: o.amountOverride, paid: 0, incentive: 0 } }
    : reserveResult; },
  releaseCreditReservation: async (h: any) => { releaseCalls.push(h); return { status: 'released' }; },
  confirmCreditReservationToActual: async () => ({ status: 'confirmed' }),
  makeIdempotencyKey: (...p: string[]) => p.join(':'),
}));

const writes: Array<{ table: string; op: string; row?: any }> = [];
let enqueueOk = true;
function builder(table: string, reads: Record<string, any> = {}) {
  const b: any = {};
  b.select = () => b; b.eq = () => b; b.in = () => b; b.gt = () => b; b.order = () => b;
  b.limit = async () => ({ data: reads[table] ?? [], error: null });
  b.insert = (row: any) => { writes.push({ table, op: 'insert', row }); return { select: () => ({ single: async () => ({ data: { id: row.id, status: 'PENDING' }, error: null }) }) }; };
  b.update = (row: any) => { writes.push({ table, op: 'update', row }); return { eq: async () => ({ error: null }) }; };
  return b;
}
let settingsRows: any[] = [];
jest.mock('../../db/supabaseClient', () => ({
  supabase: { from: (t: string) => builder(t, { market_pulse_automation_settings: settingsRows }) },
}));
jest.mock('../../db/writeOwner', () => ({ ownedDbTable: (t: string) => builder(t) }));
jest.mock('../../services/contentArchitectService', () => ({ resolveCompanyAccess: async () => ({ userId: '33333333-3333-4333-8333-333333333333', role: 'COMPANY_ADMIN' }) }));
jest.mock('../../services/userContextService', () => ({ enforceCompanyAccess: async () => ({ userId: '33333333-3333-4333-8333-333333333333' }) }));
jest.mock('../../queue/jobQueue', () => ({ jobQueue: {} }));
jest.mock('../../middleware/queueBackpressure', () => ({
  safeEnqueue: async () => enqueueOk,
  enqueueOrThrow: async () => { if (!enqueueOk) throw new Error('queue down'); },
}));
// Queue-backed processing (production shape): workers ON and a non-local Redis, so every door ENQUEUES.
jest.mock('@/config', () => ({ config: { ENABLE_AUTO_WORKERS: true, REDIS_URL: 'redis://redis.internal:6379', NEXT_PUBLIC_APP_URL: 'https://app.example' } }));
const processed: string[] = [];
jest.mock('../../services/marketPulseJobProcessor', () => ({ processMarketPulseJobV1: async (id: string) => { processed.push(id); } }));
const created: string[] = [];
const upserts: any[] = [];
jest.mock('../../services/marketPulseV2Service', () => ({
  resolveMarketPulseRunInput: async (_c: string, input: any) => ({ context: {}, resolvedInput: input }),
  buildMarketPulseExecutorContext: () => ({}),
  createMarketPulseRun: async (_c: string, _i: any, legacyId: string) => { created.push(legacyId); return { id: 'run-1', status: 'queued' }; },
  syncLegacyJobIntoRun: async () => ({ run: { status: 'completed' } }),
  getAutomationSettings: async () => null,
  upsertAutomationSettings: async (_c: string, p: any) => { upserts.push(p); return p; },
  deleteAutomationSettings: async () => undefined,
}));
jest.mock('../../services/jobRunner', () => ({ runJob: async (_spec: any, fn: () => Promise<any>) => ({ status: 'completed', result: await fn() }) }));
jest.mock('../../services/creditAlertService', () => ({ checkCreditAlerts: async () => ({}) }));

import runRoute from '../../../pages/api/market-pulse/run';
import createRoute from '../../../pages/api/market-pulse/job/create';
import cronRoute from '../../../pages/api/cron/market-pulse-automation';
import automationRoute from '../../../pages/api/market-pulse/automation';

const CO = '11111111-1111-4111-8111-111111111111';
function invoke(route: any, method: string, body: any, headers: Record<string, string> = {}) {
  const res: any = { statusCode: 200, body: undefined, headers: {} };
  res.status = (c: number) => { res.statusCode = c; return res; };
  res.json = (b: any) => { res.body = b; return res; };
  res.setHeader = () => res; res.end = () => res;
  return Promise.resolve(route({ method, headers, query: {}, body, url: '/x', socket: {} }, res)).then(() => res);
}
const savedEnv = { ...process.env };
beforeEach(() => {
  reserveCalls.length = 0; releaseCalls.length = 0; writes.length = 0; processed.length = 0; created.length = 0;
  reserveResult = { status: 'reserved' }; enqueueOk = true; settingsRows = [];
  process.env.CRON_SECRET = 'cs'; process.env.MARKET_PULSE_AUTOMATION_ENABLED = 'true';
});
afterAll(() => { process.env = savedEnv; });
const jobInserts = () => writes.filter((w) => w.table === 'market_pulse_jobs_v1' && w.op === 'insert');

describe.each([
  ['/api/market-pulse/run', () => runRoute, { companyId: CO, mode: 'one_time', custom_regions: ['IN', 'US'], source_strategy: 'hybrid' }],
  ['/api/market-pulse/job/create (LEGACY)', () => createRoute, { companyId: CO, regions: ['IN', 'US'], insight_source: 'hybrid' }],
])('%s', (_name, route, body) => {
  test('refused hold -> 402; no job row, no run, no processing (no AI call)', async () => {
    reserveResult = { status: 'insufficient_credits', required: 16, available: 2 };
    const r = await invoke(route(), 'POST', body);
    expect(r.statusCode).toBe(402);
    expect(r.body).toMatchObject({ code: 'INSUFFICIENT_CREDITS', retryable: false });
    expect(jobInserts()).toEqual([]);
    expect(created).toEqual([]);
    expect(processed).toEqual([]);
  });

  test('accepted: holds 16 (2 regions x 8) BEFORE the insert, keyed on the job id it persists', async () => {
    const r = await invoke(route(), 'POST', body);
    expect([200, 201]).toContain(r.statusCode);
    expect(reserveCalls).toHaveLength(1);
    expect(reserveCalls[0]).toMatchObject({ action: 'market_pulse', amountOverride: 16, orgId: CO });
    const ins = jobInserts();
    expect(ins).toHaveLength(1);
    expect(ins[0].row.id).toBe(reserveCalls[0].referenceId);
    expect(ins[0].row.context_payload.credit_reservation).toMatchObject({ holdTransactionId: 'hold-1', creditsReserved: 16 });
  });

  test('queue shed -> 429, the hold is released and the job closed', async () => {
    enqueueOk = false;
    const prevNodeEnv = process.env.NODE_ENV;
    (process.env as any).NODE_ENV = 'production';   // run.ts processes inline outside production
    try {
      const r = await invoke(route(), 'POST', body);
      expect(r.statusCode).toBe(429);
      expect(releaseCalls).toHaveLength(1);
      expect(releaseCalls[0]).toMatchObject({ holdTransactionId: 'hold-1' });
      expect(writes).toEqual(expect.arrayContaining([expect.objectContaining({ table: 'market_pulse_jobs_v1', op: 'update', row: expect.objectContaining({ status: 'FAILED' }) })]));
      expect(processed).toEqual([]);
    } finally { (process.env as any).NODE_ENV = prevNodeEnv; }
  });
});

describe('cron', () => {
  const NOW = Date.now();
  const row = (cadence: string, lastRunHoursAgo: number | null) => ({
    company_id: CO, is_active: true, cadence, objective: 'growth', categories: [], region_scope: 'custom', custom_regions: ['IN'],
    competitor_scope: 'combined', custom_direction: null, credit_acknowledged: true,
    last_run_at: lastRunHoursAgo === null ? null : new Date(NOW - lastRunHoursAgo * 3600_000).toISOString(),
  });
  const cron = () => invoke(cronRoute, 'POST', {}, { authorization: 'Bearer cs' });

  test('weekly company that ran 3 days ago is NOT run (no hold, nothing written)', async () => {
    settingsRows = [row('weekly', 72)];
    const r = await cron();
    expect(r.statusCode).toBe(200);
    expect(reserveCalls).toEqual([]);
    expect(jobInserts()).toEqual([]);
  });

  test('weekly company that ran 7 days ago IS run, held 8, and its last_run_at stamped', async () => {
    settingsRows = [row('weekly', 24 * 7)];
    await cron();
    expect(reserveCalls).toHaveLength(1);
    expect(reserveCalls[0]).toMatchObject({ amountOverride: 8, validateMembership: false });
    expect(jobInserts()).toHaveLength(1);
    expect(releaseCalls).toEqual([]);
    expect(writes).toEqual(expect.arrayContaining([expect.objectContaining({ table: 'market_pulse_automation_settings', op: 'update' })]));
  });

  test('daily company that ran 23.5h ago IS run; 20h ago is not', async () => {
    settingsRows = [row('daily', 23.5)];
    await cron();
    expect(reserveCalls).toHaveLength(1);
    reserveCalls.length = 0; writes.length = 0;
    settingsRows = [row('daily', 20)];
    await cron();
    expect(reserveCalls).toEqual([]);
  });

  test('enqueue failure after the hold -> the hold is released and the job closed', async () => {
    settingsRows = [row('weekly', null)];
    enqueueOk = false;
    await cron();
    expect(releaseCalls).toHaveLength(1);
    expect(writes).toEqual(expect.arrayContaining([expect.objectContaining({ table: 'market_pulse_jobs_v1', op: 'update', row: expect.objectContaining({ status: 'FAILED' }) })]));
  });

  test('refused hold -> the company is skipped, nothing written, no run', async () => {
    settingsRows = [row('weekly', null)];
    reserveResult = { status: 'insufficient_credits', required: 8, available: 0 };
    const r = await cron();
    expect(reserveCalls).toHaveLength(1);
    expect(jobInserts()).toEqual([]);
    expect(created).toEqual([]);
    expect(r.body).toMatchObject({ skipped_insufficient_credits: 1 });
  });
});

describe('automation settings cadence (owner: weekly default, the choice honoured)', () => {
  test.each([[undefined, 'weekly'], ['weekly', 'weekly'], ['daily', 'daily'], ['hourly', 'weekly']])(
    'cadence %p -> stored %p', async (cadence, stored) => {
      upserts.length = 0;
      await invoke(automationRoute, 'POST', { companyId: CO, is_active: false, ...(cadence ? { cadence } : {}) });
      expect(upserts[0]).toMatchObject({ cadence: stored });
    });
});
