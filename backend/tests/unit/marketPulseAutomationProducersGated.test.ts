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

describe('one gate: every automated-work producer imports it (static)', () => {
  const ROOT = path.join(process.cwd(), 'pages', 'api');
  const files: string[] = [];
  const walk = (d: string) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p); else if (/\.tsx?$/.test(e.name)) files.push(p);
    }
  };
  walk(ROOT);
  const PRODUCER = /upsertAutomationSettings\(|mode:\s*'automated'|=== 'automated'/;

  test('positive control: the scan finds the three known producers', () => {
    const producers = files.filter((f) => PRODUCER.test(fs.readFileSync(f, 'utf8'))).map((f) => path.relative(process.cwd(), f).replace(/\\/g, '/'));
    expect(producers).toEqual(expect.arrayContaining([
      'pages/api/cron/market-pulse-automation.ts', 'pages/api/market-pulse/run.ts', 'pages/api/market-pulse/automation.ts',
    ]));
  });

  test('each producer imports isMarketPulseAutomationEnabled from the shared gate', () => {
    const ungated = files
      .filter((f) => PRODUCER.test(fs.readFileSync(f, 'utf8')))
      .filter((f) => !/import \{[^}]*isMarketPulseAutomationEnabled[^}]*\} from '[./]*backend\/services\/marketPulse\/automationGate'/.test(fs.readFileSync(f, 'utf8')))
      .map((f) => path.relative(process.cwd(), f));
    expect(ungated).toEqual([]);
  });
});
