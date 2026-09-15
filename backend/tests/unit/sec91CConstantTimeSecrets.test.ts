/**
 * SEC-C4 (STEP 3AH-91) — machine-secret comparisons are constant-time.
 *
 * Pins:
 *   1. The shared helper keeps strict-equality semantics (exact match only)
 *      and fails closed on an unset/empty secret or a non-string header.
 *   2. No in-scope endpoint compares a secret with `===` / `!==` any more —
 *      every one goes through backend/security/constantTimeEqual.
 *   3. Behaviour is unchanged for the endpoints exercised end-to-end (right
 *      secret → allowed, wrong/absent → refused, unset → refused/dark), AND
 *      the decision is made by the constant-time helper (spied).
 */
import fs from 'fs';
import path from 'path';
import http from 'http';

import { constantTimeEqual, bearerTokenMatches } from '../../security/constantTimeEqual';

const REPO_ROOT = path.resolve(__dirname, '../../..');

describe('constantTimeEqual — strict-equality semantics without a timing channel', () => {
  it('matches only an identical non-empty string', () => {
    expect(constantTimeEqual('s3cret-value', 's3cret-value')).toBe(true);
    expect(constantTimeEqual('s3cret-valuE', 's3cret-value')).toBe(false);
    expect(constantTimeEqual('s3cret', 's3cret-value')).toBe(false); // prefix
    expect(constantTimeEqual('s3cret-value-extra', 's3cret-value')).toBe(false); // longer
    expect(constantTimeEqual(' s3cret-value', 's3cret-value')).toBe(false); // no trimming
    expect(constantTimeEqual('ünïcødé', 'ünïcødé')).toBe(true);
  });

  it('fails closed on a missing or empty secret (undefined === undefined never authenticates)', () => {
    expect(constantTimeEqual(undefined, undefined)).toBe(false);
    expect(constantTimeEqual('', '')).toBe(false);
    expect(constantTimeEqual('anything', undefined)).toBe(false);
    expect(constantTimeEqual('anything', '')).toBe(false);
    expect(constantTimeEqual(undefined, 'secret')).toBe(false);
    expect(constantTimeEqual('', 'secret')).toBe(false);
  });

  it('refuses non-string presented values (repeated headers arrive as string[])', () => {
    expect(constantTimeEqual(['secret'], 'secret')).toBe(false);
    expect(constantTimeEqual(null, 'secret')).toBe(false);
    expect(constantTimeEqual(123, '123')).toBe(false);
  });

  it('bearerTokenMatches == (secret && header === `Bearer ${secret}`)', () => {
    expect(bearerTokenMatches('Bearer abc123', 'abc123')).toBe(true);
    expect(bearerTokenMatches('bearer abc123', 'abc123')).toBe(false); // case preserved, as before
    expect(bearerTokenMatches('abc123', 'abc123')).toBe(false);
    expect(bearerTokenMatches('Bearer abc1234', 'abc123')).toBe(false);
    expect(bearerTokenMatches('Bearer undefined', undefined)).toBe(false);
    expect(bearerTokenMatches('Bearer ', '')).toBe(false);
    expect(bearerTokenMatches(undefined, 'abc123')).toBe(false);
  });
});

// ── 2. repository scan ──────────────────────────────────────────────────────

const SCOPE_DIRS = ['pages/api/cron', 'pages/api/internal'];
const SCOPE_FILES = [
  'pages/api/observability/metrics.ts',
  'pages/api/platform/history/run.ts',
  'pages/api/opportunities/refresh-slots.ts',
  'backend/workers/healthServer.ts',
];

function listScope(): string[] {
  const out: string[] = [];
  for (const d of SCOPE_DIRS) {
    for (const f of fs.readdirSync(path.join(REPO_ROOT, d))) {
      if (f.endsWith('.ts')) out.push(`${d}/${f}`);
    }
  }
  return [...out, ...SCOPE_FILES];
}

/** Blank comments so prose like "x-cron-secret !== secret" in docs cannot match. */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

const SECRET_IDENT = '(?:secret|cronSecret|expected|METRICS_SECRET|process\\.env\\.[A-Z0-9_]*(?:SECRET|TOKEN)|config\\.[A-Z0-9_]*(?:SECRET|TOKEN))';
const TIMING_UNSAFE = [
  new RegExp(`(?:===|!==)\\s*\`Bearer \\$\\{`),
  new RegExp(`(?:===|!==)\\s*bearerAuthorization\\(`),
  new RegExp(`(?:===|!==)\\s*${SECRET_IDENT}\\b`),
  new RegExp(`(?<!typeof\\s)\\b${SECRET_IDENT}\\s*(?:===|!==)(?!\\s*(?:undefined|null|'string'))`),
];

/**
 * In-scope files that do NOT authenticate with a header-equality secret: they
 * verify an HMAC over the body (verifyWebhookSignature / the replay-ingress
 * service, already constant-time) or rely on a session primitive.
 */
const HELPER_EXEMPT = new Set([
  'pages/api/internal/cms-reconciliation-webhook.ts',
  'pages/api/internal/lead-webhook-handoff.ts',
  'pages/api/internal/revenue-webhook-handoff.ts',
  'pages/api/internal/replay-ingress.ts',
  'pages/api/internal/render-ops.ts',
]);

describe('no in-scope endpoint compares a machine secret with === / !==', () => {
  const files = listScope();

  it('the scope is non-trivial (guards against a silently empty scan)', () => {
    expect(files.length).toBeGreaterThanOrEqual(35);
  });

  it.each(files)('%s', (rel) => {
    const code = stripComments(fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8'));
    const offending = code
      .split('\n')
      .filter((line) => TIMING_UNSAFE.some((re) => re.test(line)));
    expect(offending).toEqual([]);
    if (!HELPER_EXEMPT.has(rel)) {
      // Every endpoint that authenticates with a shared header secret must
      // make that decision through the constant-time helper.
      expect(code).toMatch(/security\/constantTimeEqual['"]/);
    }
  });
});

// ── 3. behaviour + the decision goes through the helper ─────────────────────

jest.mock('../../security/constantTimeEqual', () => {
  const actual = jest.requireActual('../../security/constantTimeEqual');
  return {
    constantTimeEqual: jest.fn(actual.constantTimeEqual),
    bearerTokenMatches: jest.fn(actual.bearerTokenMatches),
  };
});

// eslint-disable-next-line @typescript-eslint/no-var-requires
const helper = require('../../security/constantTimeEqual') as {
  constantTimeEqual: jest.Mock;
  bearerTokenMatches: jest.Mock;
};

type Res = { statusCode: number; body: unknown; status(n: number): Res; json(b: unknown): Res; end(): Res; send(b: unknown): Res; setHeader(): Res };
function mockRes(): Res {
  const res: Res = {
    statusCode: 0,
    body: undefined,
    status(n) { res.statusCode = n; return res; },
    json(b) { res.body = b; return res; },
    end() { return res; },
    send(b) { res.body = b; return res; },
    setHeader() { return res; },
  };
  return res;
}

describe('worker health server /metrics', () => {
  let server: http.Server;
  let port: number;
  const OLD = process.env.OBSERVABILITY_EXPORT_TOKEN;

  beforeAll(async () => {
    process.env.OBSERVABILITY_EXPORT_TOKEN = 'worker-metrics-token-1';
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { startHealthServer } = require('../../workers/healthServer');
    server = startHealthServer(0);
    await new Promise<void>((resolve) => server.on('listening', () => resolve()));
    port = (server.address() as { port: number }).port;
  });
  afterAll(() => {
    server.close();
    if (OLD === undefined) delete process.env.OBSERVABILITY_EXPORT_TOKEN;
    else process.env.OBSERVABILITY_EXPORT_TOKEN = OLD;
  });
  beforeEach(() => helper.constantTimeEqual.mockClear());

  const call = (headers: Record<string, string>) =>
    fetch(`http://127.0.0.1:${port}/metrics`, { headers });

  it('accepts the right token through the constant-time helper', async () => {
    const r = await call({ authorization: 'Bearer worker-metrics-token-1' });
    expect(r.status).toBe(200);
    await r.text();
    expect(helper.constantTimeEqual).toHaveBeenCalledWith('worker-metrics-token-1', 'worker-metrics-token-1');
  });

  it('refuses a near-miss and an absent token', async () => {
    expect((await call({ authorization: 'Bearer worker-metrics-token-2' })).status).toBe(401);
    expect((await call({})).status).toBe(401);
    expect(helper.constantTimeEqual).toHaveBeenCalled();
  });
});

describe('/api/observability/metrics', () => {
  const OLD = process.env.OBSERVABILITY_EXPORT_TOKEN;
  afterEach(() => {
    if (OLD === undefined) delete process.env.OBSERVABILITY_EXPORT_TOKEN;
    else process.env.OBSERVABILITY_EXPORT_TOKEN = OLD;
    helper.constantTimeEqual.mockClear();
  });
  const load = () => {
    let handler: (req: unknown, res: unknown) => Promise<unknown> = async () => undefined;
    jest.isolateModules(() => {
      jest.doMock('../../../lib/platform/routeFactory', () => ({ createApiRoute: (h: unknown) => h }));
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      handler = require('../../../pages/api/observability/metrics').default;
    });
    return handler;
  };

  it('is dark (404) when the token is unset', async () => {
    delete process.env.OBSERVABILITY_EXPORT_TOKEN;
    const res = mockRes();
    await load()({ method: 'GET', headers: { authorization: 'Bearer x' } }, res);
    expect(res.statusCode).toBe(404);
  });

  it('401 on a wrong token, 200 on the right one — decided by the helper', async () => {
    process.env.OBSERVABILITY_EXPORT_TOKEN = 'obs-token-123';
    const handler = load();
    const bad = mockRes();
    await handler({ method: 'GET', headers: { 'x-metrics-secret': 'obs-token-124' } }, bad);
    expect(bad.statusCode).toBe(401);
    const good = mockRes();
    await handler({ method: 'GET', headers: { authorization: 'Bearer obs-token-123' } }, good);
    expect(good.statusCode).toBe(200);
    expect(helper.constantTimeEqual).toHaveBeenCalledWith('obs-token-123', 'obs-token-123');
  });
});

describe('/api/platform/history/run', () => {
  const OLD = process.env.PLATFORM_HISTORY_RUN_SECRET;
  const runManualSnapshot = jest.fn().mockResolvedValue({ ok: true });
  afterEach(() => {
    if (OLD === undefined) delete process.env.PLATFORM_HISTORY_RUN_SECRET;
    else process.env.PLATFORM_HISTORY_RUN_SECRET = OLD;
    runManualSnapshot.mockClear();
    helper.constantTimeEqual.mockClear();
  });
  const load = () => {
    let handler: (req: unknown, res: unknown) => Promise<unknown> = async () => undefined;
    jest.isolateModules(() => {
      jest.doMock('../../../lib/platform/routeFactory', () => ({ createApiRoute: (h: unknown) => h }));
      jest.doMock('../../../backend/services/platformIntelligence/history/platformSnapshotScheduler', () => ({ runManualSnapshot }));
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      handler = require('../../../pages/api/platform/history/run').default;
    });
    return handler;
  };
  const req = (headers: Record<string, unknown>) => ({ method: 'POST', headers, body: { company_id: 'c1' } });

  it('refuses every caller when the secret is unset (no undefined === undefined bypass)', async () => {
    delete process.env.PLATFORM_HISTORY_RUN_SECRET;
    const res = mockRes();
    await load()(req({}), res);
    expect(res.statusCode).toBe(401);
    expect(runManualSnapshot).not.toHaveBeenCalled();
  });

  it('refuses a wrong / array-valued key and runs with the right one via the helper', async () => {
    process.env.PLATFORM_HISTORY_RUN_SECRET = 'history-run-key-9';
    const handler = load();
    for (const bad of ['history-run-key-8', ['history-run-key-9'], '']) {
      const res = mockRes();
      await handler(req({ 'x-platform-run-key': bad }), res);
      expect(res.statusCode).toBe(401);
    }
    expect(runManualSnapshot).not.toHaveBeenCalled();
    const ok = mockRes();
    await handler(req({ 'x-platform-run-key': 'history-run-key-9' }), ok);
    expect(ok.statusCode).toBe(200);
    expect(runManualSnapshot).toHaveBeenCalledWith('c1');
    expect(helper.constantTimeEqual).toHaveBeenCalledWith('history-run-key-9', 'history-run-key-9');
  });
});

describe('/api/cron/recover-stale-reports (x-cron-secret OR raw/Bearer authorization)', () => {
  const recoverStaleGeneratingReports = jest.fn().mockResolvedValue({ recovered: 0 });
  afterEach(() => { recoverStaleGeneratingReports.mockClear(); helper.constantTimeEqual.mockClear(); });
  const load = (secret: string | undefined) => {
    let handler: (req: unknown, res: unknown) => Promise<unknown> = async () => undefined;
    jest.isolateModules(() => {
      jest.doMock('../../../lib/platform/routeFactory', () => ({ createApiRoute: (h: unknown) => h }));
      jest.doMock('@/config', () => ({ config: { INTERNAL_METRICS_SECRET: secret } }));
      jest.doMock('@/backend/services/reportCardService', () => ({
        recoverStaleGeneratingReports,
        REPORT_GENERATION_TIMEOUT_MINUTES: 15,
      }));
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      handler = require('../../../pages/api/cron/recover-stale-reports').default;
    });
    return handler;
  };
  const call = async (handler: (req: unknown, res: unknown) => Promise<unknown>, headers: Record<string, unknown>) => {
    const res = mockRes();
    await handler({ method: 'POST', headers, query: {} }, res);
    return res.statusCode;
  };

  it('keeps every accepted shape and refuses the rest', async () => {
    const handler = load('stale-secret-1');
    expect(await call(handler, { 'x-cron-secret': 'stale-secret-1' })).not.toBe(401);
    expect(await call(handler, { authorization: 'Bearer stale-secret-1' })).not.toBe(401);
    expect(await call(handler, { authorization: 'stale-secret-1' })).not.toBe(401);
    expect(await call(handler, { 'x-cron-secret': 'stale-secret-2' })).toBe(401);
    expect(await call(handler, { authorization: 'Bearer stale-secret' })).toBe(401);
    expect(await call(handler, {})).toBe(401);
    expect(helper.constantTimeEqual).toHaveBeenCalled();
  });

  it('refuses everything when the secret is unset', async () => {
    expect(await call(load(undefined), { 'x-cron-secret': 'undefined' })).toBe(401);
    expect(recoverStaleGeneratingReports).not.toHaveBeenCalled();
  });
});
