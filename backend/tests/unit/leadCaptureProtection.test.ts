/**
 * INT-001 Phase 0 (P0-A) — characterization of the capture abuse-protection layer.
 *
 * Pins CURRENT behaviour of evaluateCaptureProtection exactly:
 * flag gating, check ordering (bot → captcha → replay → rate), dark CAPTCHA,
 * Retry-After propagation, and the fail-open guarantee. No production change.
 */

const checkInMemoryRateLimit = jest.fn();
const isLikelyBot = jest.fn();
jest.mock('../../services/trackingRateLimitService', () => ({
  checkInMemoryRateLimit: (...a: unknown[]) => checkInMemoryRateLimit(...a),
  isLikelyBot: (...a: unknown[]) => isLikelyBot(...a),
}));

const safeFetch = jest.fn();
jest.mock('../../../lib/security/safeFetch', () => ({
  safeFetch: (...a: unknown[]) => safeFetch(...a),
}));

// Force the in-memory fallback path (no Redis in the characterization env).
jest.mock('../../../lib/redis/canonicalClient', () => ({
  redisConfigured: () => false,
  getStandaloneRedis: jest.fn(),
}));

import { evaluateCaptureProtection } from '../../services/leadCaptureProtection';

const BASE = { ip: '1.2.3.4', userAgent: 'Mozilla/5.0', email: 'a@b.com' };

const ENV_KEYS = [
  'LEAD_CAPTURE_PROTECTION_ENABLED',
  'LEAD_CAPTURE_CAPTCHA_SECRET',
] as const;
const savedEnv: Record<string, string | undefined> = {};

beforeEach(() => {
  jest.clearAllMocks();
  for (const k of ENV_KEYS) { savedEnv[k] = process.env[k]; delete process.env[k]; }
  isLikelyBot.mockReturnValue(false);
  checkInMemoryRateLimit.mockReturnValue({ allowed: true, retryAfterMs: 0 });
});
afterEach(() => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
});

describe('P0-A — capture protection characterization', () => {
  test("flag off ('false' or '0') → ALLOW without running any check", async () => {
    for (const v of ['false', '0']) {
      process.env.LEAD_CAPTURE_PROTECTION_ENABLED = v;
      const d = await evaluateCaptureProtection({ ...BASE, userAgent: 'Googlebot' });
      expect(d).toEqual({ allowed: true });
    }
    expect(isLikelyBot).not.toHaveBeenCalled();
    expect(checkInMemoryRateLimit).not.toHaveBeenCalled();
  });

  test('bot UA → 403 bot_detected, and NO later check runs (ordering)', async () => {
    isLikelyBot.mockReturnValue(true);
    const d = await evaluateCaptureProtection({ ...BASE, nonce: 'n-1' });
    expect(d).toEqual({ allowed: false, reason: 'bot_detected', httpStatus: 403 });
    expect(safeFetch).not.toHaveBeenCalled();
    expect(checkInMemoryRateLimit).not.toHaveBeenCalled(); // neither nonce nor rate ran
  });

  test('CAPTCHA dark (no secret): token ignored, no verification call, capture allowed', async () => {
    const d = await evaluateCaptureProtection({ ...BASE, captchaToken: 'tok' });
    expect(d).toEqual({ allowed: true });
    expect(safeFetch).not.toHaveBeenCalled();
  });

  test('CAPTCHA armed + missing token → 403 captcha_failed WITHOUT calling the verifier', async () => {
    process.env.LEAD_CAPTURE_CAPTCHA_SECRET = 's3cret';
    const d = await evaluateCaptureProtection({ ...BASE, captchaToken: null });
    expect(d).toEqual({ allowed: false, reason: 'captcha_failed', httpStatus: 403 });
    expect(safeFetch).not.toHaveBeenCalled();
  });

  test('CAPTCHA armed + verifier success → allowed (falls through to rate limit)', async () => {
    process.env.LEAD_CAPTURE_CAPTCHA_SECRET = 's3cret';
    safeFetch.mockResolvedValue({ ok: true, json: async () => ({ success: true }) });
    const d = await evaluateCaptureProtection({ ...BASE, captchaToken: 'tok' });
    expect(d).toEqual({ allowed: true });
    expect(safeFetch).toHaveBeenCalledTimes(1);
    expect(checkInMemoryRateLimit).toHaveBeenCalledTimes(1); // rate check still ran
  });

  test('CAPTCHA armed + verifier non-OK / unsuccessful / throwing → 403 captcha_failed', async () => {
    process.env.LEAD_CAPTURE_CAPTCHA_SECRET = 's3cret';
    const scenarios = [
      () => safeFetch.mockResolvedValueOnce({ ok: false, json: async () => ({}) }),
      () => safeFetch.mockResolvedValueOnce({ ok: true, json: async () => ({ success: false }) }),
      () => safeFetch.mockRejectedValueOnce(new Error('network')),
    ];
    for (const arm of scenarios) {
      arm();
      const d = await evaluateCaptureProtection({ ...BASE, captchaToken: 'tok' });
      expect(d).toEqual({ allowed: false, reason: 'captcha_failed', httpStatus: 403 });
    }
  });

  test('nonce: first claim allowed, replay → 409 replay_detected', async () => {
    // In-memory fallback claims the nonce with limit=1 in the replay window.
    checkInMemoryRateLimit
      .mockReturnValueOnce({ allowed: true, retryAfterMs: 0 })   // nonce claim #1 (fresh)
      .mockReturnValueOnce({ allowed: true, retryAfterMs: 0 })   // rate check for call #1
      .mockReturnValueOnce({ allowed: false, retryAfterMs: 1000 }); // nonce claim #2 (replay)
    const first = await evaluateCaptureProtection({ ...BASE, nonce: 'sub-1' });
    expect(first).toEqual({ allowed: true });
    const second = await evaluateCaptureProtection({ ...BASE, nonce: 'sub-1' });
    expect(second).toEqual({ allowed: false, reason: 'replay_detected', httpStatus: 409 });
    // Nonce keys are namespaced separately from the rate-limit keys.
    expect(String(checkInMemoryRateLimit.mock.calls[0][0])).toBe('lcap:nonce:sub-1');
    expect(String(checkInMemoryRateLimit.mock.calls[1][0])).toBe('lcap:1.2.3.4');
  });

  test('rate limited → 429 rate_limited with retryAfterMs propagated', async () => {
    checkInMemoryRateLimit.mockReturnValue({ allowed: false, retryAfterMs: 42_000 });
    const d = await evaluateCaptureProtection(BASE);
    expect(d).toEqual({ allowed: false, reason: 'rate_limited', httpStatus: 429, retryAfterMs: 42_000 });
  });

  test('rate-limit key: ip → email → literal anon (in that order)', async () => {
    await evaluateCaptureProtection({ ip: null, userAgent: 'ua', email: 'x@y.z' });
    expect(String(checkInMemoryRateLimit.mock.calls[0][0])).toBe('lcap:x@y.z');
    await evaluateCaptureProtection({ ip: null, userAgent: 'ua', email: null });
    expect(String(checkInMemoryRateLimit.mock.calls[1][0])).toBe('lcap:anon');
  });

  test('fail-open: an unexpected error inside protection → ALLOW', async () => {
    isLikelyBot.mockImplementation(() => { throw new Error('boom'); });
    const d = await evaluateCaptureProtection(BASE);
    expect(d).toEqual({ allowed: true });
  });
});
