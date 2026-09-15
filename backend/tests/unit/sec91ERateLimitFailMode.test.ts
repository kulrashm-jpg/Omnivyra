/**
 * STEP 3AH-91 SEC-E2 — explicit, per-limit behaviour when Redis is unavailable.
 *
 * Before: every limit fell back to a per-process in-memory bucket capped at 50
 * requests per window, whatever the configured limit — a 3/hour email-link
 * limit became 50/hour per instance during a Redis outage or quota exhaustion.
 *
 * After: security-sensitive limits (`sensitive: true` on LOGIN / OTP /
 * EMAIL_LINK / ONBOARDING / INVITE, inherited by every `{ ...LOGIN_LIMIT }` or
 * `{ ...EMAIL_LINK_LIMIT }` derived config) enforce their OWN budget in the
 * fallback ('strict'), and fail closed when the operator sets
 * RATE_LIMIT_SENSITIVE_ON_REDIS_FAILURE=closed. Non-sensitive limits keep the
 * historical generous fallback. A config may also pin `onRedisFailure`.
 *
 * No Redis: the standalone client is a stub whose MULTI/EXEC rejects (outage)
 * or resolves with a scripted count (healthy).
 */
const mockExec = jest.fn();
jest.mock('../../queue/standaloneRedisClient', () => ({
  getInstrumentedStandaloneRedisClient: () => ({
    multi: () => {
      const p: any = {};
      for (const m of ['zremrangebyscore', 'zcard', 'zadd', 'expire']) p[m] = () => p;
      p.exec = () => mockExec();
      return p;
    },
  }),
}));
jest.mock('../../services/adminRuntimeConfig', () => ({
  getRateLimitAdminConfig: async () => undefined,
  getRateLimitOverride: () => null,
}));
jest.mock('../../../lib/auth/anomalyDetector', () => ({ recordAnomalyEvent: jest.fn() }));
jest.mock('../../../lib/anomaly/detectionEngine', () => ({ detectAnomaly: jest.fn(async () => undefined) }));
jest.mock('../../observability', () => ({ recordRawCounter: jest.fn() }));
const mockWarn = jest.fn();
jest.mock('../../services/logger', () => ({ logger: { warn: (...a: unknown[]) => mockWarn(...a), info: jest.fn(), error: jest.fn() } }));

import {
  checkRateLimit,
  resolveRedisFailureMode,
  LOGIN_LIMIT,
  EMAIL_LINK_LIMIT,
  OTP_SEND_LIMIT,
  OTP_VERIFY_LIMIT,
  ONBOARDING_COMPLETE_LIMIT,
  ONBOARDING_UID_LIMIT,
  INVITE_UID_LIMIT,
  DOMAIN_RESOLUTION_LIMIT,
  __resetRateLimitFallbackForTest,
  type RateLimitConfig,
} from '../../../lib/auth/rateLimit';

const FLAG = 'RATE_LIMIT_SENSITIVE_ON_REDIS_FAILURE';
let prior: string | undefined;
let seq = 0;
const uniqueId = () => `203.0.113.${++seq}`;

async function allowedCount(id: string, config: RateLimitConfig, attempts: number): Promise<number> {
  let allowed = 0;
  for (let i = 0; i < attempts; i++) {
    if ((await checkRateLimit(id, config)).allowed) allowed++;
  }
  return allowed;
}

beforeEach(() => {
  prior = process.env[FLAG];
  delete process.env[FLAG];
  mockExec.mockReset();
  mockExec.mockRejectedValue(new Error('ERR max requests limit exceeded'));
  mockWarn.mockReset();
  __resetRateLimitFallbackForTest();
});
afterEach(() => {
  if (prior === undefined) delete process.env[FLAG]; else process.env[FLAG] = prior;
});

describe('sensitivity is explicit on every auth limit and inherited by derived configs', () => {
  it.each([
    ['LOGIN_LIMIT', LOGIN_LIMIT],
    ['OTP_SEND_LIMIT', OTP_SEND_LIMIT],
    ['OTP_VERIFY_LIMIT', OTP_VERIFY_LIMIT],
    ['EMAIL_LINK_LIMIT', EMAIL_LINK_LIMIT],
    ['ONBOARDING_COMPLETE_LIMIT', ONBOARDING_COMPLETE_LIMIT],
    ['ONBOARDING_UID_LIMIT', ONBOARDING_UID_LIMIT],
    ['INVITE_UID_LIMIT', INVITE_UID_LIMIT],
  ])('%s is sensitive', (_n, cfg) => {
    expect(cfg.sensitive).toBe(true);
    expect(resolveRedisFailureMode(cfg)).toBe('strict');
  });
  it('a route config spread from EMAIL_LINK_LIMIT (reset/magic-link/signup) inherits it', () => {
    const reset = { ...EMAIL_LINK_LIMIT, keyPrefix: 'rl:auth:reset', limit: 5, windowSecs: 3600 };
    expect(resolveRedisFailureMode(reset)).toBe('strict');
  });
  it('non-sensitive limits keep the historical fallback', () => {
    expect(resolveRedisFailureMode(DOMAIN_RESOLUTION_LIMIT)).toBe('fallback');
    expect(resolveRedisFailureMode({ keyPrefix: 'genmaster:user:min', limit: 30, windowSecs: 60 })).toBe('fallback');
  });
  it('an explicit per-config mode wins', () => {
    expect(resolveRedisFailureMode({ keyPrefix: 'x', limit: 1, windowSecs: 60, onRedisFailure: 'closed' })).toBe('closed');
    expect(resolveRedisFailureMode({ ...LOGIN_LIMIT, onRedisFailure: 'fallback' })).toBe('fallback');
  });
});

describe('Redis unavailable — sensitive limits enforce their own budget (default)', () => {
  it('password-reset style limit (5/hour) allows exactly 5, not 50', async () => {
    const reset = { ...EMAIL_LINK_LIMIT, keyPrefix: 'rl:auth:reset', limit: 5, windowSecs: 3600 };
    expect(await allowedCount(uniqueId(), reset, 12)).toBe(5);
  });
  it('LOGIN_LIMIT allows exactly 10 per window', async () => {
    expect(await allowedCount(uniqueId(), LOGIN_LIMIT, 20)).toBe(10);
  });
  it('the result is marked as a Redis bypass so callers/metrics can tell', async () => {
    const r = await checkRateLimit(uniqueId(), EMAIL_LINK_LIMIT);
    expect(r.bypassed).toBe(true);
    expect(r.degradedMode).toBe('strict');
  });
  it('a null EXEC (aborted transaction) is treated the same way', async () => {
    mockExec.mockResolvedValue(null);
    expect(await allowedCount(uniqueId(), { ...EMAIL_LINK_LIMIT, limit: 2 }, 5)).toBe(2);
  });
  it('non-sensitive limits are unchanged: generous 50/window fallback', async () => {
    expect(await allowedCount(uniqueId(), { keyPrefix: 'rl:misc', limit: 5, windowSecs: 60 }, 60)).toBe(50);
  });
});

describe('Redis unavailable — operator fail-closed mode', () => {
  beforeEach(() => { process.env[FLAG] = 'closed'; });
  it('every sensitive request is refused', async () => {
    const r = await checkRateLimit(uniqueId(), LOGIN_LIMIT);
    expect(r.allowed).toBe(false);
    expect(r.degradedMode).toBe('closed');
    expect(mockWarn).toHaveBeenCalledWith('RATE_LIMIT_FAIL_CLOSED', expect.objectContaining({ prefix: 'rl:login' }));
  });
  it('non-sensitive requests still use the fallback', async () => {
    expect((await checkRateLimit(uniqueId(), DOMAIN_RESOLUTION_LIMIT)).allowed).toBe(true);
  });
  it('an unknown flag value never weakens a sensitive limit (stays strict)', async () => {
    process.env[FLAG] = 'off';
    expect(resolveRedisFailureMode(LOGIN_LIMIT)).toBe('strict');
  });
});

describe('Redis healthy — behaviour unchanged', () => {
  it('uses the Redis count and never touches the fallback', async () => {
    mockExec.mockResolvedValue([[null, 0], [null, 3], [null, 1], [null, 1]]);
    const r = await checkRateLimit(uniqueId(), LOGIN_LIMIT);
    expect(r).toMatchObject({ allowed: true, bypassed: false, remaining: 6 });
    mockExec.mockResolvedValue([[null, 0], [null, 10], [null, 1], [null, 1]]);
    expect((await checkRateLimit(uniqueId(), LOGIN_LIMIT)).allowed).toBe(false);
  });
});
