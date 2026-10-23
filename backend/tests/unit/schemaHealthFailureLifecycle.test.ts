/**
 * OD-9 — getSchemaHealth's FAILURE lifecycle, and the schema-health route.
 *
 * WHAT WAS WRONG, and why it is the same defect as OD-8. `probeSchema` is
 * internally contained: it catches and returns a degraded result. The logging
 * AFTER it was not, and `cached = result` came after that logging. So a throw
 * from `console.error` or from `logger.error`/`logger.info` rejected the
 * single-flight IIFE, `cached` stayed null, and `inFlight` retained the REJECTED
 * promise — which the `if (!inFlight)` guard then handed to every later caller
 * for the lifetime of the process.
 *
 * `pages/api/health/schema.ts` awaits it with no try/catch and its documented
 * contract is 200/ok or 503/degraded, so one transient logging failure turned
 * that endpoint into a permanent 500. Callers arriving via `bootAuthSubsystem`
 * were already shielded by the catch added for OD-8; this route was not.
 *
 * WHY A SEPARATE SUITE from authSubsystemBoot.test.ts: that suite drives the
 * REAL probe through a mocked Supabase chain and asserts the healthy and
 * schema-drift paths. Driving the probe into a LOGGING failure requires the
 * logger to throw, which would change what that suite is testing.
 *
 * RETRY POLICY IS NOT UNDER TEST because it is unchanged: a degraded result is
 * cached exactly as `probeSchema`'s own degraded result always has been, so
 * there is still at most one probe per process. The tests below assert that
 * absence of retry rather than introducing one.
 */
const loggerInfo = jest.fn();
const loggerWarn = jest.fn();
const loggerError = jest.fn();
jest.mock('../../services/logger', () => ({
  logger: {
    info: (...a: unknown[]) => loggerInfo(...a),
    warn: (...a: unknown[]) => loggerWarn(...a),
    error: (...a: unknown[]) => loggerError(...a),
    debug: jest.fn(),
  },
}));

const supabaseFrom = jest.fn();
jest.mock('../../db/supabaseClient', () => ({
  supabase: { from: (...args: unknown[]) => supabaseFrom(...args) },
}));

import type { NextApiRequest, NextApiResponse } from 'next';
import {
  getSchemaHealth,
  resetSchemaHealthCache,
  REQUIRED_LIFECYCLE_COLUMNS,
} from '../../security/startup/schemaHealthCheck';

/* eslint-disable @typescript-eslint/no-var-requires */
const schemaRoute = require('../../../pages/api/health/schema').default;
/* eslint-enable @typescript-eslint/no-var-requires */

/** The information_schema chain probeSchema walks. */
function infoSchema(rows: Array<{ table_name: string; column_name: string }>) {
  const chain: any = {
    select: jest.fn(() => chain),
    eq:     jest.fn(() => chain),
    in:     jest.fn().mockResolvedValue({ data: rows, error: null }),
  };
  return chain;
}
const ALL_PRESENT = () =>
  REQUIRED_LIFECYCLE_COLUMNS.map((c) => ({ table_name: c.table, column_name: c.column }));
/** Everything present except the first required column. */
const ONE_MISSING = () => ALL_PRESENT().slice(1);

function resDouble() {
  const out: { status: number | null; body: unknown; headers: Record<string, string> } = {
    status: null, body: undefined, headers: {},
  };
  const res = {
    status(code: number) { out.status = code; return res; },
    json(payload: unknown) { out.body = payload; return res; },
    end() { return res; },
    setHeader(k: string, v: string) { out.headers[k] = v; return res; },
    getHeader(k: string) { return out.headers[k]; },
    get headersSent() { return false; },
  } as unknown as NextApiResponse;
  return { res, out };
}
const getReq = () => ({ method: 'GET', headers: {}, query: {}, cookies: {} }) as unknown as NextApiRequest;

beforeEach(() => {
  jest.clearAllMocks();
  resetSchemaHealthCache();
  // NODE_ENV is 'test' under jest, so probeSchema's non-production
  // console.error branch is live for the drift path. Silence it by default;
  // individual tests re-point it when the console itself is the failure.
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => {
  jest.restoreAllMocks();
});

describe('getSchemaHealth — success and single-flight (unchanged behaviour)', () => {
  it('a healthy probe caches its result and does not probe twice', async () => {
    supabaseFrom.mockReturnValueOnce(infoSchema(ALL_PRESENT()));
    const first = await getSchemaHealth();
    expect(first.ok).toBe(true);
    expect(first.missing).toEqual([]);

    const second = await getSchemaHealth();
    expect(second).toBe(first);
    expect(supabaseFrom).toHaveBeenCalledTimes(1);
    expect(loggerInfo).toHaveBeenCalledWith('schema_health_check_ok', expect.any(Object));
  });

  it('CONCURRENT first callers share ONE probe', async () => {
    let release: (v: unknown) => void = () => undefined;
    const chain: any = {
      select: jest.fn(() => chain),
      eq:     jest.fn(() => chain),
      in:     jest.fn(() => new Promise((r) => { release = r; })),
    };
    supabaseFrom.mockReturnValueOnce(chain);

    const all = Promise.all([getSchemaHealth(), getSchemaHealth(), getSchemaHealth()]);
    release({ data: ALL_PRESENT(), error: null });
    const [a, b, c] = await all;

    expect(a).toBe(b);
    expect(b).toBe(c);
    expect(supabaseFrom).toHaveBeenCalledTimes(1);
  });

  it('a DRIFTED schema reports the missing column and is cached', async () => {
    supabaseFrom.mockReturnValueOnce(infoSchema(ONE_MISSING()));
    const r = await getSchemaHealth();
    expect(r.ok).toBe(false);
    expect(r.missing).toHaveLength(1);
    expect(r.missing[0].table).toBe(REQUIRED_LIFECYCLE_COLUMNS[0].table);
    expect(r.missing[0].column).toBe(REQUIRED_LIFECYCLE_COLUMNS[0].column);
    expect(loggerError).toHaveBeenCalledWith('schema_health_check_failed', expect.any(Object));
  });
});

describe('getSchemaHealth — FAILURE lifecycle (OD-9)', () => {
  it('a SYNCHRONOUS logger failure on the healthy path returns the REAL result, not a degraded one', async () => {
    // Previously this REJECTED and poisoned inFlight. The probe genuinely
    // succeeded, so fabricating a degraded result would be a worse answer.
    supabaseFrom.mockReturnValueOnce(infoSchema(ALL_PRESENT()));
    loggerInfo.mockImplementation(() => { throw new Error('console is gone'); });

    const r = await getSchemaHealth();
    expect(r.ok).toBe(true);
    expect(r.missing).toEqual([]);
  });

  it('a SYNCHRONOUS logger failure on the drift path returns the REAL drift result', async () => {
    supabaseFrom.mockReturnValueOnce(infoSchema(ONE_MISSING()));
    loggerError.mockImplementation(() => { throw new Error('console is gone'); });

    const r = await getSchemaHealth();
    expect(r.ok).toBe(false);
    expect(r.missing).toHaveLength(1);
  });

  it('a failure BEFORE any result is published resolves to the degraded shape', async () => {
    // probeSchema's own catch calls logger.error('schema_health_check_threw');
    // when the logger is what is broken, that catch re-throws and nothing has
    // been published yet. This is the path that used to poison inFlight.
    supabaseFrom.mockImplementation(() => { throw new Error('client exploded'); });
    loggerError.mockImplementation(() => { throw new Error('console is gone'); });

    const r = await getSchemaHealth();
    expect(r.ok).toBe(false);
    // the conservative answer: every required column reported missing
    expect(r.missing).toHaveLength(REQUIRED_LIFECYCLE_COLUMNS.length);
    expect(typeof r.checkedAt).toBe('string');
  });

  it('THE POISON: later callers get the SAME result and the probe is NOT re-run', async () => {
    supabaseFrom.mockImplementation(() => { throw new Error('client exploded'); });
    loggerError.mockImplementation(() => { throw new Error('console is gone'); });

    const first = await getSchemaHealth();
    const second = await getSchemaHealth();
    const third = await getSchemaHealth();

    expect(second).toBe(first);
    expect(third).toBe(first);
    // NO RETRY — the policy is unchanged, matching how probeSchema's own
    // degraded result has always been cached.
    expect(supabaseFrom).toHaveBeenCalledTimes(1);
  });

  it('NO UNHANDLED REJECTION even when nothing awaits the probe', async () => {
    const seen: unknown[] = [];
    const onUnhandled = (e: unknown) => seen.push(e);
    process.on('unhandledRejection', onUnhandled);
    try {
      supabaseFrom.mockImplementation(() => { throw new Error('client exploded'); });
      loggerError.mockImplementation(() => { throw new Error('console is gone'); });
      void getSchemaHealth();
      await new Promise((r) => setTimeout(r, 10));
      expect(seen).toEqual([]);
    } finally {
      process.off('unhandledRejection', onUnhandled);
    }
  });
});

describe('getSchemaHealth — reset versus in-flight work', () => {
  it('RESET does not let a stale in-flight probe publish into the fresh state', async () => {
    let release: (v: unknown) => void = () => undefined;
    const slow: any = {
      select: jest.fn(() => slow),
      eq:     jest.fn(() => slow),
      in:     jest.fn(() => new Promise((r) => { release = r; })),
    };
    supabaseFrom.mockReturnValueOnce(slow);

    const stale = getSchemaHealth();        // generation 0, still in flight
    resetSchemaHealthCache();                // advances the generation
    release({ data: ONE_MISSING(), error: null });
    const staleResult = await stale;
    expect(staleResult.ok).toBe(false);      // the stale attempt still resolves

    // …but it must NOT have published. A fresh probe decides the cached value.
    supabaseFrom.mockReturnValueOnce(infoSchema(ALL_PRESENT()));
    const fresh = await getSchemaHealth();
    expect(fresh.ok).toBe(true);
    expect(fresh).not.toBe(staleResult);
    // two probes ran in total: the stale one and the fresh one
    expect(supabaseFrom).toHaveBeenCalledTimes(2);
  });

  it('reset clears the cache so a later call re-probes', async () => {
    supabaseFrom.mockReturnValueOnce(infoSchema(ALL_PRESENT()));
    await getSchemaHealth();
    expect(supabaseFrom).toHaveBeenCalledTimes(1);
    resetSchemaHealthCache();
    supabaseFrom.mockReturnValueOnce(infoSchema(ALL_PRESENT()));
    await getSchemaHealth();
    expect(supabaseFrom).toHaveBeenCalledTimes(2);
  });
});

describe('the schema-health route keeps its documented 200/503 contract', () => {
  it('200 ok when the schema is healthy', async () => {
    supabaseFrom.mockReturnValueOnce(infoSchema(ALL_PRESENT()));
    const { res, out } = resDouble();
    await schemaRoute(getReq(), res);
    expect(out.status).toBe(200);
    expect((out.body as Record<string, unknown>).status).toBe('ok');
  });

  it('503 degraded on schema drift, listing what is missing', async () => {
    supabaseFrom.mockReturnValueOnce(infoSchema(ONE_MISSING()));
    const { res, out } = resDouble();
    await schemaRoute(getReq(), res);
    expect(out.status).toBe(503);
    const body = out.body as Record<string, unknown>;
    expect(body.status).toBe('degraded');
    expect(body.missing).toHaveLength(1);
  });

  it('503 degraded — NOT 500 — when the probe itself cannot complete', async () => {
    // The user-visible consequence of OD-9. The route awaits getSchemaHealth()
    // with no try/catch, so a rejected promise produced a 500, and because the
    // rejection was cached it did so for every later request.
    supabaseFrom.mockImplementation(() => { throw new Error('client exploded'); });
    loggerError.mockImplementation(() => { throw new Error('console is gone'); });

    const { res, out } = resDouble();
    await schemaRoute(getReq(), res);

    expect(out.status).toBe(503);
    const body = out.body as Record<string, unknown>;
    expect(body.status).toBe('degraded');
    expect(body.missing).toHaveLength(REQUIRED_LIFECYCLE_COLUMNS.length);
  });

  it('a SECOND request after an unavailable probe is still 503, never 500', async () => {
    supabaseFrom.mockImplementation(() => { throw new Error('client exploded'); });
    loggerError.mockImplementation(() => { throw new Error('console is gone'); });

    const a = resDouble(); await schemaRoute(getReq(), a.res);
    const b = resDouble(); await schemaRoute(getReq(), b.res);

    expect(a.out.status).toBe(503);
    expect(b.out.status).toBe(503);
  });

  it('405 for a non-GET method (unchanged)', async () => {
    const { res, out } = resDouble();
    await schemaRoute({ ...getReq(), method: 'POST' } as unknown as NextApiRequest, res);
    expect(out.status).toBe(405);
  });
});
