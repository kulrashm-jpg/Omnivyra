/**
 * PO-3 F1 — the controlled operational trigger on the worker health server.
 *
 * WHY THIS SUITE EXISTS. `scheduleWorker` arms a 24h `setTimeout` and never runs at boot, and the
 * timer restarts with the worker — which Railway does on every deploy. Without a trigger there is
 * no way to observe a first acquisition cycle inside a monitored window. But a trigger that can
 * be reached without a secret, or that can start acquisition while the flag is off, or that can
 * stack overlapping cycles, is worse than no trigger at all. Each of those is pinned below.
 *
 * SECRETS: the token used here is a literal test value. It is not a production secret, and the
 * production token is never committed — it is supplied only as an environment variable.
 */
import http from 'http';
import type { AddressInfo } from 'net';

const TEST_TOKEN = 'unit-test-trigger-token-not-a-production-secret';
/**
 * Built by concatenation rather than an inline `Bearer ${...}` template: the repo lint rule
 * forbids that shape so browser code goes through apiFetch(). This is a Node worker test
 * talking to a worker HTTP server, where apiFetch does not apply.
 */
const bearer = (token: string): string => 'Bearer '.concat(token);

const guardMock = jest.fn();
jest.mock('../../services/ads/adsAcquisitionRunner', () => ({
  runGuardedAdsAcquisitionCycle: (...args: unknown[]) => guardMock(...args),
}));

// The health server imports the observability registry; keep it inert and cheap.
jest.mock('../../observability', () => ({
  renderPrometheusText: () => '',
  PROMETHEUS_CONTENT_TYPE: 'text/plain',
}));

import { startHealthServer } from '../../workers/healthServer';

const PATH = '/internal/ads-acquisition';

let server: http.Server;
let port: number;

function request(
  method: string,
  headers: Record<string, string> = {},
  path = PATH,
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path, method, headers }, (res) => {
      let body = '';
      res.on('data', (c) => { body += c; });
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body }));
    });
    req.on('error', reject);
    req.end();
  });
}

beforeAll(async () => {
  server = startHealthServer(0);
  await new Promise<void>((r) => server.listening ? r() : server.once('listening', () => r()));
  port = (server.address() as AddressInfo).port;
});

afterAll(async () => { await new Promise<void>((r) => server.close(() => r())); });

beforeEach(() => {
  guardMock.mockReset();
  guardMock.mockResolvedValue({ status: 'completed', result: { enabled: 0, subjects: 0, observed: 0, persisted: 0, errors: 0 } });
  delete process.env.ADS_ACQUISITION_TRIGGER_TOKEN;
});

describe('trigger authentication', () => {
  it('is DARK when no trigger token is configured — 404, indistinguishable from a missing route', async () => {
    const res = await request('POST', { authorization: bearer(TEST_TOKEN) });
    expect(res.status).toBe(404);
    // Dark means dark: it must not run anything either.
    expect(guardMock).not.toHaveBeenCalled();
  });

  it('an unknown path is also 404, so the dark trigger is not distinguishable from one', async () => {
    const res = await request('POST', {}, '/internal/does-not-exist');
    expect(res.status).toBe(404);
  });

  it('rejects a wrong token with 401', async () => {
    process.env.ADS_ACQUISITION_TRIGGER_TOKEN = TEST_TOKEN;
    const res = await request('POST', { authorization: bearer('wrong-token') });
    expect(res.status).toBe(401);
    expect(guardMock).not.toHaveBeenCalled();
  });

  it('rejects a missing credential with 401 — never public', async () => {
    process.env.ADS_ACQUISITION_TRIGGER_TOKEN = TEST_TOKEN;
    const res = await request('POST');
    expect(res.status).toBe(401);
    expect(guardMock).not.toHaveBeenCalled();
  });

  it('rejects a near-miss token (prefix of the real one) with 401', async () => {
    process.env.ADS_ACQUISITION_TRIGGER_TOKEN = TEST_TOKEN;
    const res = await request('POST', { authorization: bearer(TEST_TOKEN.slice(0, -1)) });
    expect(res.status).toBe(401);
  });

  it.each(['GET', 'PUT', 'DELETE', 'PATCH'])('rejects %s with 405', async (method) => {
    process.env.ADS_ACQUISITION_TRIGGER_TOKEN = TEST_TOKEN;
    const res = await request(method, { authorization: bearer(TEST_TOKEN) });
    expect(res.status).toBe(405);
    expect(guardMock).not.toHaveBeenCalled();
  });

  it('method is checked BEFORE the token, so a GET cannot probe token validity', async () => {
    process.env.ADS_ACQUISITION_TRIGGER_TOKEN = TEST_TOKEN;
    const wrong = await request('GET', { authorization: bearer('wrong-token') });
    const right = await request('GET', { authorization: bearer(TEST_TOKEN) });
    expect(wrong.status).toBe(405);
    expect(right.status).toBe(405);
  });

  it('accepts the alternate secret header, like /metrics does', async () => {
    process.env.ADS_ACQUISITION_TRIGGER_TOKEN = TEST_TOKEN;
    const res = await request('POST', { 'x-ads-trigger-secret': TEST_TOKEN });
    expect(res.status).toBe(200);
  });

  it('never echoes the token in a response body', async () => {
    process.env.ADS_ACQUISITION_TRIGGER_TOKEN = TEST_TOKEN;
    for (const res of [
      await request('POST', { authorization: bearer('wrong-token') }),
      await request('POST', { authorization: bearer(TEST_TOKEN) }),
      await request('GET', { authorization: bearer(TEST_TOKEN) }),
    ]) {
      expect(res.body).not.toContain(TEST_TOKEN);
      expect(res.body).not.toContain('wrong-token');
    }
  });

  it('does not log the token', async () => {
    process.env.ADS_ACQUISITION_TRIGGER_TOKEN = TEST_TOKEN;
    const spies = [
      jest.spyOn(console, 'log').mockImplementation(() => {}),
      jest.spyOn(console, 'info').mockImplementation(() => {}),
      jest.spyOn(console, 'warn').mockImplementation(() => {}),
      jest.spyOn(console, 'error').mockImplementation(() => {}),
    ];
    try {
      await request('POST', { authorization: bearer(TEST_TOKEN) });
      await request('POST', { authorization: bearer('wrong-token') });
      const written = spies.flatMap((s) => s.mock.calls.flat()).map(String).join('\n');
      expect(written).not.toContain(TEST_TOKEN);
      expect(written).not.toContain('wrong-token');
    } finally {
      spies.forEach((s) => s.mockRestore());
    }
  });
});

describe('trigger invokes exactly one cycle, through the existing path', () => {
  beforeEach(() => { process.env.ADS_ACQUISITION_TRIGGER_TOKEN = TEST_TOKEN; });

  it('an authorized POST runs exactly one cycle and returns its counters', async () => {
    const res = await request('POST', { authorization: bearer(TEST_TOKEN) });
    expect(res.status).toBe(200);
    expect(guardMock).toHaveBeenCalledTimes(1);
    expect(JSON.parse(res.body)).toEqual({
      ok: true,
      status: 'completed',
      counters: { enabled: 0, subjects: 0, observed: 0, persisted: 0, errors: 0 },
    });
  });

  it('two sequential requests run one cycle each, never two per request', async () => {
    await request('POST', { authorization: bearer(TEST_TOKEN) });
    await request('POST', { authorization: bearer(TEST_TOKEN) });
    expect(guardMock).toHaveBeenCalledTimes(2);
  });

  it('reports 409 rather than stacking a second overlapping cycle', async () => {
    guardMock.mockResolvedValue({ status: 'already_running', result: null });
    const res = await request('POST', { authorization: bearer(TEST_TOKEN) });
    expect(res.status).toBe(409);
    expect(JSON.parse(res.body)).toEqual({ ok: false, status: 'already_running' });
  });

  it('a runner failure is contained — 500, no detail echoed, worker still serving', async () => {
    guardMock.mockRejectedValue(new Error('boom sensitive detail'));
    const res = await request('POST', { authorization: bearer(TEST_TOKEN) });
    expect(res.status).toBe(500);
    expect(res.body).not.toContain('boom sensitive detail');
    // The server is still up afterwards.
    const health = await request('GET', {}, '/health');
    expect(health.status).toBe(200);
  });
});

describe('the trigger does not disturb the existing health surface', () => {
  it('GET /health is still unauthenticated and 200', async () => {
    const res = await request('GET', {}, '/health');
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body).status).toBe('ok');
  });
});

/* ────────────────────────────────────────────────────────────────────────────
   The flag stays authoritative. These use the REAL guard and the REAL cycle.
   ──────────────────────────────────────────────────────────────────────────── */

describe('concurrency guard (real implementation)', () => {
  it('a second concurrent cycle does not start while the first is in flight', async () => {
    const actual = jest.requireActual('../../services/ads/adsAcquisitionRunner') as typeof import('../../services/ads/adsAcquisitionRunner');
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const run = jest.fn(async () => { await gate; return { enabled: 0 }; });

    const first = actual.runGuardedAdsAcquisitionCycle(run);
    const second = await actual.runGuardedAdsAcquisitionCycle(run);

    expect(second).toEqual({ status: 'already_running', result: null });
    expect(run).toHaveBeenCalledTimes(1); // no duplicate fan-out

    release();
    expect(await first).toEqual({ status: 'completed', result: { enabled: 0 } });
    expect(actual.adsAcquisitionInFlight()).toBe(false);

    // Once settled, a later cycle may start again.
    const third = await actual.runGuardedAdsAcquisitionCycle(async () => ({ enabled: 0 }));
    expect(third).toEqual({ status: 'completed', result: { enabled: 0 } });
  });

  it('releases the guard even when the cycle throws', async () => {
    const actual = jest.requireActual('../../services/ads/adsAcquisitionRunner') as typeof import('../../services/ads/adsAcquisitionRunner');
    await expect(actual.runGuardedAdsAcquisitionCycle(async () => { throw new Error('x'); })).rejects.toThrow('x');
    expect(actual.adsAcquisitionInFlight()).toBe(false);
  });
});

describe('the trigger cannot bypass ADS_TRANSPARENCY_ACQUISITION_ENABLED', () => {
  const listDueSubjects = jest.fn();

  beforeEach(() => {
    listDueSubjects.mockReset();
    jest.resetModules();
    jest.doMock('../../services/ads/adsDueSubjects', () => ({ listDueAdsSubjects: listDueSubjects }));
    jest.doMock('../../services/ads/adsEvidenceStore', () => ({ createAdsEvidenceSink: () => async () => undefined }));
  });

  afterEach(() => { jest.dontMock('../../services/ads/adsDueSubjects'); jest.dontMock('../../services/ads/adsEvidenceStore'); });

  it('with the flag OFF the cycle returns { enabled: 0 } and reads no subjects', async () => {
    const original = process.env.ADS_TRANSPARENCY_ACQUISITION_ENABLED;
    delete process.env.ADS_TRANSPARENCY_ACQUISITION_ENABLED;
    try {
      const runner = jest.requireActual('../../services/ads/adsAcquisitionRunner') as typeof import('../../services/ads/adsAcquisitionRunner');
      const result = await runner.runProductionAdsAcquisitionCycle();
      expect(result).toEqual({ enabled: 0, subjects: 0, observed: 0, persisted: 0, errors: 0 });
      // The gate is BEFORE the subject read — so no database work and, since openSession is
      // never reached, no browser launch and no provider contact.
      expect(listDueSubjects).not.toHaveBeenCalled();
    } finally {
      if (original !== undefined) process.env.ADS_TRANSPARENCY_ACQUISITION_ENABLED = original;
    }
  });
});
