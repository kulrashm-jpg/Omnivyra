/**
 * PL-09(b) — dual-token acceptance on the metrics scrape token (rotation without a scrape gap).
 *
 * Both scrape targets (worker /metrics and /api/observability/metrics) must behave IDENTICALLY:
 *   current -> 200, previous -> 200, wrong -> 401, none -> 401, previous set but current unset -> 404 (dark),
 *   previous = '' -> as unset. The 401 body is the same whichever token was wrong (no oracle); no-store stays.
 * The ads trigger (ADS_ACQUISITION_TRIGGER_TOKEN) stays SINGLE-token: neither metrics token authorises it.
 * Both comparisons always run (no short-circuit), through the constant-time helper.
 */
import http from 'http';

jest.mock('../../security/constantTimeEqual', () => {
  const actual = jest.requireActual('../../security/constantTimeEqual');
  return { constantTimeEqual: jest.fn(actual.constantTimeEqual), bearerTokenMatches: actual.bearerTokenMatches };
});
jest.mock('../../../lib/platform/routeFactory', () => ({ createApiRoute: (h: unknown) => h }));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const helper = require('../../security/constantTimeEqual') as { constantTimeEqual: jest.Mock };
import { decideMetricsExportToken } from '../../security/metricsExportToken';
import { startHealthServer } from '../../workers/healthServer';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const apiHandler = require('../../../pages/api/observability/metrics').default as (req: unknown, res: unknown) => Promise<unknown>;

const CUR = 'metrics-current-token-A1';
const PREV = 'metrics-previous-token-B2';
const ENV_KEYS = ['OBSERVABILITY_EXPORT_TOKEN', 'OBSERVABILITY_EXPORT_TOKEN_PREVIOUS', 'ADS_ACQUISITION_TRIGGER_TOKEN'] as const;
const saved: Record<string, string | undefined> = {};
beforeAll(() => { for (const k of ENV_KEYS) saved[k] = process.env[k]; });
afterAll(() => { for (const k of ENV_KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; } });
function setEnv(cur?: string, prev?: string) {
  if (cur === undefined) delete process.env.OBSERVABILITY_EXPORT_TOKEN; else process.env.OBSERVABILITY_EXPORT_TOKEN = cur;
  if (prev === undefined) delete process.env.OBSERVABILITY_EXPORT_TOKEN_PREVIOUS; else process.env.OBSERVABILITY_EXPORT_TOKEN_PREVIOUS = prev;
}
beforeEach(() => { setEnv(CUR, PREV); helper.constantTimeEqual.mockClear(); });

describe('decideMetricsExportToken', () => {
  it('both comparisons always run - no short-circuit when CURRENT matches, nor when PREVIOUS is unset', () => {
    expect(decideMetricsExportToken(CUR)).toBe('accepted');
    expect(helper.constantTimeEqual).toHaveBeenCalledTimes(2);
    helper.constantTimeEqual.mockClear();
    setEnv(CUR, undefined);
    expect(decideMetricsExportToken('nope')).toBe('rejected');
    expect(helper.constantTimeEqual).toHaveBeenCalledTimes(2);
  });
  it('PREVIOUS unset: the second comparison cannot accept the previous value', () => {
    setEnv(CUR, undefined);
    expect(decideMetricsExportToken(PREV)).toBe('rejected');
  });
  it('whitespace-only PREVIOUS is unset (cannot match a trimmed presented value anyway)', () => {
    setEnv(CUR, '   ');
    expect(decideMetricsExportToken('   ')).toBe('rejected');
  });
});

// ── the two scrape targets, one matrix ────────────────────────────────────────

type Hit = { status: number; body: unknown; cacheControl?: string; text?: string };

let server: http.Server;
let port: number;
beforeAll(async () => {
  server = startHealthServer(0);
  await new Promise<void>((resolve) => server.on('listening', () => resolve()));
  port = (server.address() as { port: number }).port;
});
afterAll(() => { server.close(); });

async function hitWorker(headers: Record<string, string>): Promise<Hit> {
  const r = await fetch(`http://127.0.0.1:${port}/metrics`, { headers });
  const text = await r.text();
  let body: unknown = text;
  try { body = JSON.parse(text); } catch { /* prometheus text */ }
  return { status: r.status, body: r.status === 200 ? 'metrics' : body, cacheControl: r.headers.get('cache-control') ?? undefined, text };
}
async function hitApi(headers: Record<string, string>): Promise<Hit> {
  const hdrs: Record<string, string> = {};
  const res: any = {
    statusCode: 0, body: undefined,
    status(n: number) { res.statusCode = n; return res; },
    json(b: unknown) { res.body = b; return res; },
    send(b: unknown) { res.body = 'metrics'; res.text = String(b); return res; },
    end() { return res; },
    setHeader(k: string, v: string) { hdrs[k.toLowerCase()] = v; return res; },
  };
  await apiHandler({ method: 'GET', headers }, res);
  return { status: res.statusCode, body: res.statusCode === 200 ? 'metrics' : res.body, cacheControl: hdrs['cache-control'], text: res.text };
}

describe.each([
  ['worker /metrics', hitWorker],
  ['/api/observability/metrics', hitApi],
] as const)('%s', (_name, hit) => {
  it('CURRENT token -> 200 (Bearer and x-metrics-secret), no-store', async () => {
    const a = await hit({ authorization: `Bearer ${CUR}` });
    expect(a.status).toBe(200);
    expect(a.cacheControl).toBe('no-store');
    expect((await hit({ 'x-metrics-secret': CUR })).status).toBe(200);
  });
  it('PREVIOUS token -> 200 (Bearer and x-metrics-secret), no-store', async () => {
    const a = await hit({ authorization: `Bearer ${PREV}` });
    expect(a.status).toBe(200);
    expect(a.cacheControl).toBe('no-store');
    expect((await hit({ 'x-metrics-secret': PREV })).status).toBe(200);
  });
  it('wrong token and no token -> the SAME 401 (no oracle)', async () => {
    const wrong = await hit({ authorization: 'Bearer metrics-current-token-A2' });
    const nearPrev = await hit({ authorization: 'Bearer metrics-previous-token-B3' });
    const none = await hit({});
    for (const h of [wrong, nearPrev, none]) {
      expect(h.status).toBe(401);
      expect(h.body).toEqual({ error: 'Unauthorized' });
    }
  });
  it('PREVIOUS set but CURRENT unset -> 404 (dark), even presenting PREVIOUS', async () => {
    setEnv(undefined, PREV);
    expect((await hit({ authorization: `Bearer ${PREV}` })).status).toBe(404);
    setEnv('', PREV);
    expect((await hit({ authorization: `Bearer ${PREV}` })).status).toBe(404);
  });
  it("PREVIOUS = '' behaves as unset: CURRENT still 200, the old value 401", async () => {
    setEnv(CUR, '');
    expect((await hit({ authorization: `Bearer ${CUR}` })).status).toBe(200);
    expect((await hit({ authorization: `Bearer ${PREV}` })).status).toBe(401);
  });
  it('05: a configured PREVIOUS is VISIBLE on the token-protected body (gauge 1), and 0 once removed', async () => {
    const on = await hit({ authorization: `Bearer ${CUR}` });
    expect(on.text).toMatch(/^observability_export_token_previous_configured 1$/m);
    setEnv(CUR, undefined);
    const off = await hit({ authorization: `Bearer ${CUR}` });
    expect(off.text).toMatch(/^observability_export_token_previous_configured 0$/m);
    setEnv(CUR, '');
    expect((await hit({ authorization: `Bearer ${CUR}` })).text).toMatch(/^observability_export_token_previous_configured 0$/m);
  });
  it('05: the 401 answer carries no rotation hint', async () => {
    const r = await hit({ authorization: 'Bearer nope' });
    expect(JSON.stringify(r.body)).not.toContain('previous');
    expect(r.text ?? '').not.toContain('previous_configured');
  });
  it('PREVIOUS unset: only CURRENT is accepted', async () => {
    setEnv(CUR, undefined);
    expect((await hit({ authorization: `Bearer ${CUR}` })).status).toBe(200);
    expect((await hit({ authorization: `Bearer ${PREV}` })).status).toBe(401);
  });
});

// ── the ads trigger stays single-token ────────────────────────────────────────

describe('ads trigger (/internal/ads-acquisition) is NOT widened', () => {
  const post = (headers: Record<string, string>) =>
    fetch(`http://127.0.0.1:${port}/internal/ads-acquisition`, { method: 'POST', headers });
  afterEach(() => { delete process.env.ADS_ACQUISITION_TRIGGER_TOKEN; });

  it('neither metrics token (current or previous) authorises it -> 401', async () => {
    process.env.ADS_ACQUISITION_TRIGGER_TOKEN = 'ads-trigger-token-Z9';
    for (const t of [PREV, CUR]) {
      const r = await post({ authorization: `Bearer ${t}` });
      expect(r.status).toBe(401);
      await r.text();
      const r2 = await post({ 'x-ads-trigger-secret': t });
      expect(r2.status).toBe(401);
      await r2.text();
    }
  });
  it('ads token unset -> 404 (dark) even with OBSERVABILITY_EXPORT_TOKEN_PREVIOUS set', async () => {
    delete process.env.ADS_ACQUISITION_TRIGGER_TOKEN;
    const r = await post({ authorization: `Bearer ${PREV}` });
    expect(r.status).toBe(404);
    await r.text();
  });
});
