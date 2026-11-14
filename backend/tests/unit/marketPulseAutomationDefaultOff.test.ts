/**
 * e9 BLOCKING-NOW 2026-11-14: the automated Market Pulse cron makes AI calls and bills nothing; the owner ruled automated
 * scans OFF until charging is live. The cron is default-OFF behind MARKET_PULSE_AUTOMATION_ENABLED === 'true':
 *   - flag absent / any other value -> 200 skipped, NOTHING read, no job run, no AI processor call;
 *   - unauthenticated -> still 401 (the gate sits after auth);
 *   - flag 'true' -> the settings read happens (positive control: the gate is the only thing that changed).
 */
const reads: string[] = [];
const runJobCalls: unknown[] = [];
const processed: unknown[] = [];

jest.mock('../../db/supabaseClient', () => ({
  supabase: {
    from: (t: string) => {
      reads.push(t);
      const b: any = {};
      b.select = () => b; b.eq = () => b; b.limit = async () => ({ data: [], error: null });
      return b;
    },
  },
}));
jest.mock('../../db/writeOwner', () => ({ ownedDbTable: (t: string) => { reads.push(`owned:${t}`); throw new Error('no write expected'); } }));
jest.mock('../../queue/jobQueue', () => ({ jobQueue: {} }));
jest.mock('../../services/jobRunner', () => ({ runJob: async (...a: unknown[]) => { runJobCalls.push(a); return { ok: true, result: { mode: 'inline' } }; } }));
jest.mock('../../services/marketPulseV2Service', () => ({
  buildMarketPulseExecutorContext: jest.fn(), createMarketPulseRun: jest.fn(),
  resolveMarketPulseRunInput: jest.fn(), syncLegacyJobIntoRun: jest.fn(),
}));
jest.mock('../../services/marketPulseJobProcessor', () => ({ processMarketPulseJobV1: async (...a: unknown[]) => { processed.push(a); } }));

import handler from '../../../pages/api/cron/market-pulse-automation';

const FLAG = 'MARKET_PULSE_AUTOMATION_ENABLED';
const saved = { flag: process.env[FLAG], secret: process.env.CRON_SECRET };
afterAll(() => {
  if (saved.flag === undefined) delete process.env[FLAG]; else process.env[FLAG] = saved.flag;
  if (saved.secret === undefined) delete process.env.CRON_SECRET; else process.env.CRON_SECRET = saved.secret;
});
beforeEach(() => { reads.length = 0; runJobCalls.length = 0; processed.length = 0; process.env.CRON_SECRET = 'cron-test-secret'; });

function call(auth = 'Bearer cron-test-secret') {
  const res: any = { statusCode: 200, body: undefined as unknown, headers: {} as Record<string, unknown> };
  res.status = (c: number) => { res.statusCode = c; return res; };
  res.json = (b: unknown) => { res.body = b; return res; };
  res.setHeader = (k: string, v: unknown) => { res.headers[k] = v; return res; };
  res.end = () => res;
  const req: any = { method: 'POST', headers: { authorization: auth }, query: {}, body: {}, url: '/api/cron/market-pulse-automation', socket: {} };
  return Promise.resolve((handler as any)(req, res)).then(() => res);
}

describe('market-pulse automation cron is default-OFF', () => {
  test.each([[undefined], ['false'], ['1'], ['TRUE'], ['']])('flag %p -> 200 skipped; nothing read, no job, no AI', async (v) => {
    if (v === undefined) delete process.env[FLAG]; else process.env[FLAG] = v as string;
    const res = await call();
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ ok: true, skipped: 'automation_disabled' });
    expect(reads).toEqual([]);
    expect(runJobCalls).toEqual([]);
    expect(processed).toEqual([]);
  });

  test('unauthenticated is still 401 with the flag off (the gate sits after auth)', async () => {
    delete process.env[FLAG];
    const res = await call('Bearer wrong');
    expect(res.statusCode).toBe(401);
    expect(reads).toEqual([]);
  });

  test("positive control: flag 'true' -> the settings read happens", async () => {
    process.env[FLAG] = 'true';
    const res = await call();
    expect(reads).toContain('market_pulse_automation_settings');
    expect(res.body).not.toEqual({ ok: true, skipped: 'automation_disabled' });
  });
});
