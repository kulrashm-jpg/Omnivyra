/**
 * e9 BLOCKING-NOW 2026-11-14 (05 found the second producer): EVERY producer of automated Market Pulse work goes through
 * the one gate backend/services/marketPulse/automationGate (MARKET_PULSE_AUTOMATION_ENABLED === 'true'):
 *   - POST /api/market-pulse/run with mode 'automated' -> 409 MARKET_PULSE_AUTOMATION_DISABLED before any read/insert/AI;
 *     a one_time run is NOT gated by this flag (control: it proceeds);
 *   - POST /api/market-pulse/automation with is_active true -> 409; turning it off still works;
 *   - a static scan: any API route that produces automated work imports the gate.
 */
import * as fs from 'fs';
import * as path from 'path';

const effects: string[] = [];
jest.mock('../../db/supabaseClient', () => ({
  supabase: {
    from: (t: string) => {
      effects.push(`from:${t}`);
      const b: any = {};
      b.insert = () => b; b.select = () => b;
      b.single = async () => ({ data: { id: 'job-1', status: 'PENDING' }, error: null });
      return b;
    },
  },
}));
jest.mock('../../services/contentArchitectService', () => ({ resolveCompanyAccess: async () => ({ ok: true }) }));
jest.mock('../../queue/jobQueue', () => ({ jobQueue: {} }));
jest.mock('../../middleware/queueBackpressure', () => ({ safeEnqueue: async () => { effects.push('enqueue'); return true; } }));
jest.mock('../../services/marketPulseJobProcessor', () => ({ processMarketPulseJobV1: async () => { effects.push('process'); } }));
jest.mock('../../services/marketPulseV2Service', () => ({
  resolveMarketPulseRunInput: async (_c: string, input: unknown) => { effects.push('resolve'); return { context: {}, resolvedInput: input }; },
  buildMarketPulseExecutorContext: () => ({}),
  createMarketPulseRun: async () => { effects.push('createRun'); return { id: 'run-1', status: 'queued' }; },
  syncLegacyJobIntoRun: async () => ({ run: { status: 'completed' } }),
  getAutomationSettings: async () => null,
  upsertAutomationSettings: async (_c: string, p: Record<string, unknown>) => { effects.push(`upsert:${p.is_active}`); return p; },
  deleteAutomationSettings: async () => { effects.push('delete'); },
}));

import runRoute from '../../../pages/api/market-pulse/run';
import automationRoute from '../../../pages/api/market-pulse/automation';

const FLAG = 'MARKET_PULSE_AUTOMATION_ENABLED';
const saved = process.env[FLAG];
afterAll(() => { if (saved === undefined) delete process.env[FLAG]; else process.env[FLAG] = saved; });
beforeEach(() => { effects.length = 0; delete process.env[FLAG]; });

function invoke(route: unknown, method: string, body: Record<string, unknown>, query: Record<string, string> = {}) {
  const res: any = { statusCode: 200, body: undefined as unknown, headers: {} };
  res.status = (c: number) => { res.statusCode = c; return res; };
  res.json = (b: unknown) => { res.body = b; return res; };
  res.setHeader = (k: string, v: unknown) => { res.headers[k] = v; return res; };
  res.end = () => res;
  const req: any = { method, headers: {}, query, body, url: '/api/market-pulse', socket: {} };
  return Promise.resolve((route as any)(req, res)).then(() => res);
}
const DISABLED = { code: 'MARKET_PULSE_AUTOMATION_DISABLED', retryable: false };

describe('POST /api/market-pulse/run', () => {
  test("mode 'automated' with the flag off -> 409, nothing resolved/inserted/queued/processed", async () => {
    const r = await invoke(runRoute, 'POST', { companyId: 'c1', mode: 'automated', credit_acknowledged: true });
    expect(r.statusCode).toBe(409);
    expect(r.body).toMatchObject(DISABLED);
    expect(effects).toEqual([]);
  });

  test("control: a one_time run is not gated by this flag (proceeds to resolve + insert)", async () => {
    const r = await invoke(runRoute, 'POST', { companyId: 'c1', mode: 'one_time' });
    expect(r.statusCode).toBe(201);
    expect(effects).toEqual(expect.arrayContaining(['resolve', 'from:market_pulse_jobs_v1']));
  });

  test("positive control: mode 'automated' with the flag 'true' proceeds", async () => {
    process.env[FLAG] = 'true';
    const r = await invoke(runRoute, 'POST', { companyId: 'c1', mode: 'automated', credit_acknowledged: true });
    expect(r.statusCode).toBe(201);
    expect(effects).toContain('resolve');
  });
});

describe('POST /api/market-pulse/automation', () => {
  test('enabling with the flag off -> 409, settings not written', async () => {
    const r = await invoke(automationRoute, 'POST', { companyId: 'c1', is_active: true, credit_acknowledged: true });
    expect(r.statusCode).toBe(409);
    expect(r.body).toMatchObject(DISABLED);
    expect(effects).toEqual([]);
  });

  test('turning automation OFF is always allowed', async () => {
    const r = await invoke(automationRoute, 'POST', { companyId: 'c1', is_active: false });
    expect(r.statusCode).toBe(200);
    expect(effects).toEqual(['upsert:false']);
  });

  test("positive control: enabling with the flag 'true' writes the settings", async () => {
    process.env[FLAG] = 'true';
    const r = await invoke(automationRoute, 'POST', { companyId: 'c1', is_active: true, credit_acknowledged: true });
    expect(r.statusCode).toBe(200);
    expect(effects).toEqual(['upsert:true']);
  });
});

describe('closed set over the two Market Pulse tables (05: scan the TABLE, not a list of function spellings)', () => {
  // Every file that names the enrolment table (market_pulse_automation_settings) or the run table
  // (market_pulse_jobs_v1) is a potential producer - direct (runs) or indirect (enrols). The set is pinned: a NEW file
  // naming either table fails here until it is reviewed and, if it produces automated work, routed through the gate.
  const REVIEWED: Record<string, string> = {
    'backend/queue/jobQueue.ts': 'queue typing only',
    'backend/services/marketPulse/executorContext.ts': 'doc comment only',
    'backend/services/marketPulseJobProcessor.ts': 'processes an existing job (no enrolment, no new run)',
    'backend/services/marketPulseV2ServiceEngine.ts': 'THE settings writer - upsertAutomationSettings enforces the gate',
    'backend/services/operationsCenterService.ts': 'count reader',
    'pages/api/cron/market-pulse-automation.ts': 'automated producer - gated',
    'pages/api/market-pulse/job/[id].ts': 'reader',
    'pages/api/market-pulse/job/[id]/cancel.ts': 'cancel (status write only)',
    'pages/api/market-pulse/job/create.ts': 'ONE-TIME producer (legacy) - unbilled, with e9/owner; not automated',
    'pages/api/market-pulse/run.ts': "producer - mode 'automated' gated, one_time with e9/owner",
    'pages/api/market-pulse/runs/[id]/cancel.ts': 'cancel (status write only)',
    'pages/api/market-pulse/runs/[id]/index.ts': 'reader; local-only stale-job recovery of an existing job',
  };
  const files: string[] = [];
  const walk = (d: string) => {
    if (!fs.existsSync(d)) return;
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (['node_modules', '.next', 'tests'].includes(e.name)) continue;
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p); else if (/\.(ts|tsx|js)$/.test(e.name)) files.push(p);
    }
  };
  for (const d of ['backend', 'pages', 'lib', 'shared', 'components', 'hooks', 'scripts']) walk(path.join(process.cwd(), d));
  const naming = files
    .filter((f) => /market_pulse_automation_settings|market_pulse_jobs_v1/.test(fs.readFileSync(f, 'utf8')))
    .map((f) => path.relative(process.cwd(), f).split(path.sep).join('/'))
    .sort();

  test('positive control: the scan finds the known producers and the writer', () => {
    expect(naming).toEqual(expect.arrayContaining([
      'pages/api/cron/market-pulse-automation.ts', 'pages/api/market-pulse/run.ts',
      'backend/services/marketPulseV2ServiceEngine.ts',
    ]));
  });

  test('every file naming either table is in the reviewed set (a new one must be reviewed and gated)', () => {
    expect(naming).toEqual(Object.keys(REVIEWED).sort());
  });

  test('the gated producers and the writer import the shared gate', () => {
    for (const f of ['pages/api/cron/market-pulse-automation.ts', 'pages/api/market-pulse/run.ts',
      'pages/api/market-pulse/automation.ts', 'backend/services/marketPulseV2ServiceEngine.ts']) {
      expect([f, /isMarketPulseAutomationEnabled/.test(fs.readFileSync(path.join(process.cwd(), f), 'utf8'))]).toEqual([f, true]);
    }
  });
});
