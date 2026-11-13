/**
 * Owner ruling (e1 2026-11-13; binding points from 05 / e9): when the rate limiter's Redis/Upstash is unreachable or
 * over quota, SIGNUP fails CLOSED while LOGIN keeps its own degraded mode, and the owner is alerted at most once per
 * 30-minute window CROSS-INSTANCE (DB marker, no Redis), with a hard hourly cap and a send timeout.
 */
export {};
type Row = Record<string, any>;
const mockMarkers: Row[] = [];
let mockMarkersDown = false;
jest.mock('../../queue/standaloneRedisClient', () => ({
  getInstrumentedStandaloneRedisClient: () => {
    const fail = () => { throw new Error('ECONNREFUSED redis'); };
    return { multi: fail, zremrangebyscore: fail, zcard: fail };
  },
}));
jest.mock('../../services/adminRuntimeConfig', () => ({ getRateLimitAdminConfig: async () => ({}), getRateLimitOverride: () => null }));
jest.mock('../../../lib/auth/anomalyDetector', () => ({ recordAnomalyEvent: jest.fn() }));
jest.mock('../../services/authMetrics', () => ({ incrementAuthMetric: jest.fn() }));
jest.mock('../../services/logger', () => ({ logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() } }));
jest.mock('../../db/supabaseClient', () => ({
  supabase: {
    from: (table: string) => {
      if (table !== 'ops_alert_markers') throw new Error(`unexpected table ${table}`);
      const tests: Array<(r: Row) => boolean> = [];
      let op = 'select'; let payload: Row = {};
      const b: any = {
        select: () => b,
        eq: (c: string, v: unknown) => { tests.push((r) => r[c] === v); return b; },
        gt: (c: string, v: string) => { tests.push((r) => String(r[c]) > v); return b; },
        insert: (p: Row) => { op = 'insert'; payload = p; return b; },
        then: (ok: any, ko: any) => {
          if (mockMarkersDown) return Promise.resolve({ data: null, error: { message: 'db down' } }).then(ok, ko);
          if (op === 'insert') {
            if (mockMarkers.some((r) => r.alert_kind === payload.alert_kind && r.bucket === payload.bucket)) {
              return Promise.resolve({ data: null, error: { code: '23505', message: 'duplicate' } }).then(ok, ko);
            }
            mockMarkers.push({ ...payload });
            return Promise.resolve({ data: null, error: null }).then(ok, ko);
          }
          return Promise.resolve({ data: mockMarkers.filter((r) => tests.every((t) => t(r))), error: null }).then(ok, ko);
        },
      };
      return b;
    },
  },
}));
/* eslint-disable @typescript-eslint/no-var-requires */
const { checkRateLimit, LOGIN_LIMIT, EMAIL_LINK_LIMIT, __resetRateLimitFallbackForTest } = require('../../../lib/auth/rateLimit');
const ops = require('../../services/opsAlertService');
/* eslint-enable @typescript-eslint/no-var-requires */

beforeEach(() => {
  mockMarkers.length = 0; mockMarkersDown = false;
  ops.__resetOpsAlertStateForTest();
  if (__resetRateLimitFallbackForTest) __resetRateLimitFallbackForTest();
});

describe('limiter mode is pinned PER CALL SITE (never the global sensitive-mode env)', () => {
  it('Redis down: a LOGIN-style limit still ALLOWS (its own degraded mode) - login is unaffected', async () => {
    const r = await checkRateLimit('1.2.3.4', { ...LOGIN_LIMIT, keyPrefix: 'rl:test:login' });
    expect(r).toMatchObject({ allowed: true, bypassed: true });
    expect(r.degradedMode).not.toBe('closed');
  });
  it("Redis down: the SIGNUP config (onRedisFailure:'closed') refuses and reports bypassed", async () => {
    const r = await checkRateLimit('1.2.3.4', { ...EMAIL_LINK_LIMIT, keyPrefix: 'rl:auth:signup', limit: 5, windowSecs: 3600, onRedisFailure: 'closed' });
    expect(r).toMatchObject({ allowed: false, bypassed: true, degradedMode: 'closed' });
  });
});

describe('alert dedupe: DB-backed, cross-instance, capped, timed out', () => {
  const T0 = Date.parse('2026-11-13T10:00:00.000Z');
  it('many attempts across "instances" in one 30-minute window -> exactly ONE email', async () => {
    const send = jest.fn(async () => undefined);
    for (let i = 0; i < 6; i++) {
      ops.__resetOpsAlertStateForTest(); // a fresh instance each time: in-process state cannot be what dedupes
      await ops.notifySignupLimiterUnavailable('/api/auth/signup', 'per-ip limiter degraded', { now: () => T0 + i * 1000, send });
    }
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][0]).toBe('kuldeep@omnivyra.com');
  });
  it('a new 30-minute window sends again; the hourly cap (2) stops a flapping outage', async () => {
    const send = jest.fn(async () => undefined);
    const W = ops.SIGNUP_LIMITER_ALERT_WINDOW_MS;
    await ops.notifySignupLimiterUnavailable('/x', 'r', { now: () => T0, send });
    await ops.notifySignupLimiterUnavailable('/x', 'r', { now: () => T0 + W, send });
    await ops.notifySignupLimiterUnavailable('/x', 'r', { now: () => T0 + W + 60_000, send });
    expect(send).toHaveBeenCalledTimes(2);
    // a third bucket inside the same rolling hour is capped
    await ops.notifySignupLimiterUnavailable('/x', 'r', { now: () => T0 + 2 * W - 1, send });
    expect(send).toHaveBeenCalledTimes(2);
  });
  it('marker table unreachable -> falls back to ONE per instance per window (fewer emails, never zero)', async () => {
    mockMarkersDown = true;
    const send = jest.fn(async () => undefined);
    for (let i = 0; i < 4; i++) await ops.notifySignupLimiterUnavailable('/x', 'r', { now: () => T0 + i, send });
    expect(send).toHaveBeenCalledTimes(1);
  });
  it('a hung mail provider is cut off by the send timeout (the caller never waits on it)', async () => {
    jest.useFakeTimers();
    const send = jest.fn(() => new Promise<void>(() => { /* never resolves */ }));
    const p = ops.notifySignupLimiterUnavailable('/x', 'r', { now: () => T0, send });
    await jest.advanceTimersByTimeAsync(ops.SEND_TIMEOUT_MS + 1);
    await expect(p).resolves.toBe('failed');
    jest.useRealTimers();
  });
  it('the email carries time + reason only (no user data); the copy constant is the one owner-visible string', async () => {
    const send = jest.fn(async () => undefined);
    await ops.notifySignupLimiterUnavailable('/api/auth/signup', 'per-ip limiter degraded (closed)', { now: () => T0, send });
    const [, subject, detail] = send.mock.calls[0] as unknown as [string, string, string];
    expect(subject).toBe('Signup paused: rate limiter unavailable');
    expect(detail).toContain('2026-11-13T10:00:00.000Z');
    expect(detail).not.toMatch(/@/);
    expect(ops.SIGNUP_BUSY_BODY).toEqual({ error: ops.SIGNUP_BUSY_MESSAGE, code: 'SIGNUP_TEMPORARILY_UNAVAILABLE' });
  });
});

describe('pre-authentication alert path (05 review: never silent, never a DB write)', () => {
  const T0 = Date.parse('2026-11-13T10:00:00.000Z');
  it('sends via the in-process window WITHOUT touching the DB marker; one email per instance per window', async () => {
    const send = jest.fn(async () => undefined);
    for (let i = 0; i < 5; i++) await ops.notifySignupLimiterUnavailablePreAuth('/api/onboarding/revalidate-signup', 'per-ip limiter degraded', { now: () => T0 + i, send });
    expect(send).toHaveBeenCalledTimes(1);
    expect(mockMarkers).toEqual([]); // no write before auth
  });
  it('the log line still fires on every occurrence even when the email is suppressed', async () => {
    const { logger } = require('../../services/logger');
    (logger.error as jest.Mock).mockClear();
    const send = jest.fn(async () => undefined);
    for (let i = 0; i < 3; i++) await ops.notifySignupLimiterUnavailablePreAuth('/x', 'r', { now: () => T0, send });
    expect((logger.error as jest.Mock).mock.calls.filter((c: unknown[]) => c[0] === 'auth.signup_limiter_unavailable')).toHaveLength(3);
  });
});
