/**
 * OD-8 — bootAuthSubsystem's FAILURE lifecycle, and the two health routes that
 * depend on it.
 *
 * WHAT WAS WRONG. `bootAuthSubsystem` ran two operations that are not
 * internally contained — `getSchemaHealth()` (whose wrapper logs before
 * caching) and `emitBootFingerprint()` (synchronous, and it logs at
 * bootFingerprint.ts:126 BEFORE assigning its cache at :137). Either could
 * reject the single-flight IIFE. `cachedReadiness` was assigned inside that
 * IIFE, so it stayed null while `bootInFlight` retained the REJECTED promise,
 * and the `if (!bootInFlight)` guard then handed that same rejection to every
 * later caller for the lifetime of the process. One transient failure
 * permanently broke `/api/health/readiness`, whose documented contract is
 * 200/ready or 503/degraded — it would answer 500 instead, forever.
 *
 * That contradicted the module's own documented guarantee: "Never throws —
 * every failure mode is converted into a degraded readiness state with a
 * structured log", with `ready` documented as covering "an unrecoverable boot
 * failure (rare)" and `bootedAt` as "when the boot completed (or last failed)".
 * These tests assert that documented contract, which is why no new policy had
 * to be invented to write them.
 *
 * WHY THIS IS A SEPARATE SUITE from authSubsystemBoot.test.ts: that suite
 * exercises the REAL schema probe and fingerprint and asserts the happy and
 * degraded-schema paths. Driving boot into a rejection requires those two
 * modules to be mocked, which would change what that suite is testing.
 *
 * NO COVERAGE EXISTED for either health route before this file — the only
 * pre-existing "health/metrics" test targets pages/api/system/health/metrics,
 * a different route.
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

const schemaHealthMock = jest.fn();
jest.mock('../../security/startup/schemaHealthCheck', () => ({
  __esModule: true,
  getSchemaHealth: (...a: unknown[]) => schemaHealthMock(...a),
  resetSchemaHealthCache: jest.fn(),
  REQUIRED_LIFECYCLE_COLUMNS: [],
}));

const fingerprintMock = jest.fn();
jest.mock('../../security/startup/bootFingerprint', () => ({
  __esModule: true,
  emitBootFingerprint: (...a: unknown[]) => fingerprintMock(...a),
  resetBootFingerprint: jest.fn(),
  AUTH_CONTRACT_VERSION: '2.B.2-test',
}));

jest.mock('../../services/authMetrics', () => ({
  __esModule: true,
  snapshotAuthMetrics: () => ({ takenAt: 'T', cardinalityCapped: false, counters: {} }),
}));

import type { NextApiRequest, NextApiResponse } from 'next';
import {
  bootAuthSubsystem,
  getAuthReadiness,
  resetAuthSubsystemBoot,
} from '../../security/startup/authSubsystemBoot';

/* eslint-disable @typescript-eslint/no-var-requires */
const readinessRoute = require('../../../pages/api/health/readiness').default;
const metricsRoute = require('../../../pages/api/health/metrics').default;
/* eslint-enable @typescript-eslint/no-var-requires */

const OK_SCHEMA = { ok: true, missing: [], checkedAt: '2026-01-01T00:00:00.000Z-long-enough' };
const OK_FINGERPRINT = {
  fingerprint: 'abcdef0123456789abcdef0123456789',
  authContractVersion: '2.B.2-test',
  schemaManifestHash: null,
  nodeVersion: 'v20.0.0',
  nodeEnv: 'test',
  deploymentId: null,
  vercelEnv: null,
  railwayEnv: null,
  emittedAt: '2026-01-01T00:00:00.000Z',
};

/** Minimal res double — these routes need no auth and no database. */
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
  resetAuthSubsystemBoot();
  schemaHealthMock.mockReset();
  fingerprintMock.mockReset();
  loggerInfo.mockReset();
  loggerWarn.mockReset();
  loggerError.mockReset();
  schemaHealthMock.mockResolvedValue(OK_SCHEMA);
  fingerprintMock.mockReturnValue(OK_FINGERPRINT);
});

describe('bootAuthSubsystem — success and single-flight (unchanged behaviour)', () => {
  it('a successful boot caches the snapshot and does not probe twice', async () => {
    const first = await bootAuthSubsystem();
    expect(first.ready).toBe(true);
    expect(first.schemaHealthy).toBe(true);
    expect(first.fingerprint.fingerprint).toBe(OK_FINGERPRINT.fingerprint);

    // the CACHE, asserted as state rather than as "it was called"
    expect(getAuthReadiness()).toBe(first);
    const second = await bootAuthSubsystem();
    expect(second).toBe(first);
    expect(schemaHealthMock).toHaveBeenCalledTimes(1);
    expect(fingerprintMock).toHaveBeenCalledTimes(1);
  });

  it('CONCURRENT first callers share ONE initialization', async () => {
    let release: (v: unknown) => void = () => undefined;
    schemaHealthMock.mockImplementation(() => new Promise((r) => { release = r; }));

    const all = Promise.all([bootAuthSubsystem(), bootAuthSubsystem(), bootAuthSubsystem()]);
    release(OK_SCHEMA);
    const [a, b, c] = await all;

    expect(a).toBe(b);
    expect(b).toBe(c);
    expect(schemaHealthMock).toHaveBeenCalledTimes(1);
  });

  it('a DEGRADED schema still resolves, with ready false and a reason', async () => {
    schemaHealthMock.mockResolvedValue({
      ok: false,
      missing: [{ table: 'users', column: 'status', migration: 'm', consumer: 'c' }],
      checkedAt: 'now-and-long-enough-to-be-a-hint',
    });

    const r = await bootAuthSubsystem();
    expect(r.ready).toBe(false);
    expect(r.schemaHealthy).toBe(false);
    expect(r.reasons).toEqual(['schema_missing_columns:users.status']);
    expect(loggerError).toHaveBeenCalledWith('auth_subsystem_degraded', expect.anything());
  });
});

describe('bootAuthSubsystem — FAILURE lifecycle (OD-8)', () => {
  it('an ASYNCHRONOUS rejection resolves to a degraded snapshot, not a rejection', async () => {
    schemaHealthMock.mockRejectedValue(new Error('probe exploded'));

    // Previously this REJECTED. The contract says it never throws.
    const r = await bootAuthSubsystem();
    expect(r.ready).toBe(false);
    expect(r.schemaHealthy).toBe(false);
    expect(r.reasons).toEqual(['boot_failed:probe exploded']);
    expect(r.schema.ok).toBe(false);
    // no fabricated drift detail — the probe never completed
    expect(r.schema.missing).toEqual([]);
    expect(loggerError).toHaveBeenCalledWith('auth_subsystem_boot_failed', {
      contract: '2.B.2-test',
      message: 'probe exploded',
    });
  });

  it('a SYNCHRONOUS throw from emitBootFingerprint resolves to a degraded snapshot', async () => {
    // The specific operation Phase 77 could not conclusively assess. It is
    // synchronous and logs before caching, so a logger failure propagates out.
    fingerprintMock.mockImplementation(() => { throw new Error('fingerprint exploded'); });

    const r = await bootAuthSubsystem();
    expect(r.ready).toBe(false);
    expect(r.reasons).toEqual(['boot_failed:fingerprint exploded']);
    // the fallback fingerprint literal, since the real one could not be built
    expect(r.fingerprint.fingerprint).toBe('');
    expect(r.fingerprint.authContractVersion).toBe('2.B.2-test');
  });

  it('a non-Error thrown value is still represented, not lost', async () => {
    fingerprintMock.mockImplementation(() => { throw 'a bare string'; });
    const r = await bootAuthSubsystem();
    expect(r.reasons).toEqual(['boot_failed:a bare string']);
  });

  it('THE POISON: a later caller after failure gets the SAME degraded snapshot, and boot is not re-run', async () => {
    // This is the defect's core. Before the fix, `bootInFlight` held a rejected
    // promise and every later caller received that same rejection forever.
    schemaHealthMock.mockRejectedValue(new Error('probe exploded'));

    const first = await bootAuthSubsystem();
    const second = await bootAuthSubsystem();

    expect(second).toBe(first);
    expect(getAuthReadiness()).toBe(first);
    // NO RETRY — "runs at most once per process" is the documented contract and
    // this change does not introduce retry. Retry policy is an owner decision.
    expect(schemaHealthMock).toHaveBeenCalledTimes(1);
    // and the failure was logged exactly once, not once per caller
    expect(loggerError.mock.calls.filter((c) => c[0] === 'auth_subsystem_boot_failed')).toHaveLength(1);
  });

  it('a failure in the LOGGING after the snapshot was built returns the REAL snapshot', async () => {
    // Specific guarantee of the fix: a log failure is not a boot failure, so a
    // genuinely successful boot must not be rewritten into a degraded one.
    loggerInfo.mockImplementation(() => { throw new Error('console is gone'); });

    const r = await bootAuthSubsystem();
    expect(r.ready).toBe(true);
    expect(r.schemaHealthy).toBe(true);
    expect(r.reasons).toEqual([]);
    expect(r.fingerprint.fingerprint).toBe(OK_FINGERPRINT.fingerprint);
    expect(getAuthReadiness()).toBe(r);
  });

  it('a failure in the DEGRADED log path does not re-poison the promise', async () => {
    // If the logger itself is what broke, the handler must still settle.
    schemaHealthMock.mockRejectedValue(new Error('probe exploded'));
    loggerError.mockImplementation(() => { throw new Error('console is gone'); });

    const r = await bootAuthSubsystem();
    expect(r.ready).toBe(false);
    expect(r.reasons).toEqual(['boot_failed:probe exploded']);
  });

  it('NO UNHANDLED REJECTION even when nothing awaits the boot', async () => {
    const seen: unknown[] = [];
    const onUnhandled = (e: unknown) => seen.push(e);
    process.on('unhandledRejection', onUnhandled);
    try {
      schemaHealthMock.mockRejectedValue(new Error('probe exploded'));
      // deliberately NOT awaited at first — the old shape left a rejected
      // promise sitting in module state with no handler attached
      void bootAuthSubsystem();
      await new Promise((r) => setTimeout(r, 10));
      expect(seen).toEqual([]);
    } finally {
      process.off('unhandledRejection', onUnhandled);
    }
  });
});

describe('bootAuthSubsystem — reset versus in-flight work', () => {
  it('RESET does not let a stale in-flight boot publish into the fresh state', async () => {
    let release: (v: unknown) => void = () => undefined;
    schemaHealthMock.mockImplementationOnce(() => new Promise((r) => { release = r; }));

    const stale = bootAuthSubsystem();          // generation 0, still in flight
    resetAuthSubsystemBoot();                    // advances the generation
    expect(getAuthReadiness()).toBeNull();

    release(OK_SCHEMA);                          // the stale attempt now completes
    await stale;

    // The stale completion must NOT have been published.
    expect(getAuthReadiness()).toBeNull();

    // A fresh boot then works and is the one that publishes.
    schemaHealthMock.mockResolvedValue({ ...OK_SCHEMA, checkedAt: 'fresh-checked-at-long-enough' });
    const fresh = await bootAuthSubsystem();
    expect(getAuthReadiness()).toBe(fresh);
    expect(fresh.schema.checkedAt).toBe('fresh-checked-at-long-enough');
  });

  it('reset clears the cache so a later boot re-runs', async () => {
    await bootAuthSubsystem();
    expect(schemaHealthMock).toHaveBeenCalledTimes(1);
    resetAuthSubsystemBoot();
    expect(getAuthReadiness()).toBeNull();
    await bootAuthSubsystem();
    expect(schemaHealthMock).toHaveBeenCalledTimes(2);
  });
});

describe('the health routes after a boot failure — their contracts differ, deliberately', () => {
  it('READINESS answers 503 degraded, NOT 500, and carries the structured body', async () => {
    // The user-visible consequence of OD-8: readiness.ts awaits boot with no
    // try/catch (readiness.ts:34), so a rejected boot produced a 500 — and,
    // because the rejection was cached, it did so for every later request.
    schemaHealthMock.mockRejectedValue(new Error('probe exploded'));

    const { res, out } = resDouble();
    await readinessRoute(getReq(), res);

    expect(out.status).toBe(503);
    const body = out.body as Record<string, unknown>;
    expect(body.status).toBe('degraded');
    expect(body.schemaHealthy).toBe(false);
    expect(body.reasons).toEqual(['boot_failed:probe exploded']);
    expect(body.readinessVersion).toBe(1);
    expect((body.schema as Record<string, unknown>).ok).toBe(false);
  });

  it('READINESS answers 200 ready on a healthy boot (contract preserved)', async () => {
    const { res, out } = resDouble();
    await readinessRoute(getReq(), res);
    expect(out.status).toBe(200);
    expect((out.body as Record<string, unknown>).status).toBe('ready');
  });

  it('METRICS stays 200 after a boot failure — it is a diagnostic surface', async () => {
    // Intentionally a DIFFERENT contract from readiness: metrics must remain
    // available for diagnosis when initialization is incomplete.
    schemaHealthMock.mockRejectedValue(new Error('probe exploded'));

    const { res, out } = resDouble();
    await metricsRoute(getReq(), res);

    expect(out.status).toBe(200);
    const body = out.body as Record<string, unknown>;
    // the degraded snapshot still carries a fingerprint object, so the route
    // reports its (empty) fingerprint rather than crashing
    expect(body).toHaveProperty('fingerprint');
    expect(body).toHaveProperty('counters');
  });

  it('METRICS reports the fingerprint on a healthy boot (contract preserved)', async () => {
    const { res, out } = resDouble();
    await metricsRoute(getReq(), res);
    expect(out.status).toBe(200);
    expect((out.body as Record<string, unknown>).fingerprint).toBe(OK_FINGERPRINT.fingerprint);
    expect((out.body as Record<string, unknown>).authContractVersion).toBe('2.B.2-test');
  });
});
