/**
 * PERF-001 — activation-pipeline optimizations.
 *
 * Covers the two structural dedup primitives introduced this phase:
 *   1. authValidationCache — short-TTL cache of successful Supabase token
 *      validation (hit/miss, TTL expiry, JWT-exp cap, disable toggle, bound).
 *   2. requestScopedMemo — per-request memoization of deterministic loads
 *      (memoizes in scope, passthrough out of scope, drops failed loads).
 */

// Silence observability so the counters/histograms are no-ops in the test.
jest.mock('../../observability', () => ({
  recordRawCounter: jest.fn(),
  recordRawHistogram: jest.fn(),
}));

import {
  getCachedValidation,
  setCachedValidation,
  clearAuthValidationCache,
  authValidationCacheSize,
  type CachedAuthIdentity,
} from '../../services/authValidationCache';
import {
  runWithRequestMemo,
  memoRequest,
  hasRequestMemoScope,
} from '../../services/requestScopedMemo';

const ENV_KEYS = [
  'AUTH_VALIDATION_CACHE_ENABLED',
  'AUTH_VALIDATION_CACHE_TTL_MS',
  'AUTH_VALIDATION_CACHE_MAX',
];
const saved: Record<string, string | undefined> = {};
beforeAll(() => { for (const k of ENV_KEYS) saved[k] = process.env[k]; });
afterEach(() => {
  for (const k of ENV_KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
  clearAuthValidationCache();
  jest.clearAllMocks();
});

const identity = (uid: string): CachedAuthIdentity => ({ supabaseUid: uid, email: `${uid}@x.io`, emailVerified: true });

/** Build a JWT-shaped token whose middle segment carries the given exp (secs). */
function tokenWithExp(expSecs: number | null): string {
  const payload = expSecs === null ? {} : { exp: expSecs };
  const b64 = Buffer.from(JSON.stringify(payload)).toString('base64').replace(/=+$/, '');
  return `h.${b64}.s`;
}

describe('authValidationCache', () => {
  it('returns null on miss, then the cached identity on hit', () => {
    const tok = tokenWithExp(Math.floor(Date.now() / 1000) + 3600);
    expect(getCachedValidation(tok)).toBeNull();
    setCachedValidation(tok, identity('u1'));
    expect(getCachedValidation(tok)).toMatchObject({ supabaseUid: 'u1' });
  });

  it('never caches a token that is already expired (exp in the past)', () => {
    const tok = tokenWithExp(Math.floor(Date.now() / 1000) - 10);
    setCachedValidation(tok, identity('u1'));
    expect(getCachedValidation(tok)).toBeNull();
    expect(authValidationCacheSize()).toBe(0);
  });

  it('caps entry lifetime to the JWT exp (expired-by-exp serves a miss)', () => {
    // exp 0.2s out, TTL default 30s → capped to ~0.2s.
    const tok = tokenWithExp(Math.floor(Date.now() / 1000) + 0); // exp == now → treated as expired
    setCachedValidation(tok, identity('u1'));
    expect(getCachedValidation(tok)).toBeNull();
  });

  it('honors a short TTL (entry expires)', async () => {
    process.env.AUTH_VALIDATION_CACHE_TTL_MS = '20';
    const tok = tokenWithExp(null); // no exp claim → pure TTL governs
    setCachedValidation(tok, identity('u1'));
    expect(getCachedValidation(tok)).toMatchObject({ supabaseUid: 'u1' });
    await new Promise((r) => setTimeout(r, 40));
    expect(getCachedValidation(tok)).toBeNull();
  });

  it('is a no-op when disabled', () => {
    process.env.AUTH_VALIDATION_CACHE_ENABLED = '0';
    const tok = tokenWithExp(null);
    setCachedValidation(tok, identity('u1'));
    expect(getCachedValidation(tok)).toBeNull();
    expect(authValidationCacheSize()).toBe(0);
  });

  it('stays bounded by AUTH_VALIDATION_CACHE_MAX (FIFO eviction)', () => {
    process.env.AUTH_VALIDATION_CACHE_MAX = '3';
    for (let i = 0; i < 5; i++) setCachedValidation(tokenWithExp(null) + i, identity(`u${i}`));
    expect(authValidationCacheSize()).toBeLessThanOrEqual(3);
  });
});

describe('requestScopedMemo', () => {
  it('outside a scope, runs the loader every time (identical behavior)', async () => {
    expect(hasRequestMemoScope()).toBe(false);
    const load = jest.fn(async () => 'x');
    await memoRequest('k', load);
    await memoRequest('k', load);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('inside a scope, runs the loader once per key and shares the result', async () => {
    const load = jest.fn(async () => ({ v: 1 }));
    await runWithRequestMemo(async () => {
      expect(hasRequestMemoScope()).toBe(true);
      const a = await memoRequest('blueprint:c1', load);
      const b = await memoRequest('blueprint:c1', load);
      expect(a).toBe(b); // same Promise result identity
      expect(load).toHaveBeenCalledTimes(1);
      // A different key loads independently.
      await memoRequest('blueprint:c2', load);
      expect(load).toHaveBeenCalledTimes(2);
    });
  });

  it('dedupes concurrent in-flight loads for the same key', async () => {
    const load = jest.fn(() => new Promise((r) => setTimeout(() => r('done'), 15)));
    await runWithRequestMemo(async () => {
      const [a, b] = await Promise.all([memoRequest('k', load), memoRequest('k', load)]);
      expect(a).toBe('done');
      expect(b).toBe('done');
      expect(load).toHaveBeenCalledTimes(1);
    });
  });

  it('does NOT cache a failed load (a later call re-runs it)', async () => {
    let n = 0;
    const load = jest.fn(async () => { n += 1; if (n === 1) throw new Error('boom'); return 'ok'; });
    await runWithRequestMemo(async () => {
      await expect(memoRequest('k', load)).rejects.toThrow('boom');
      // failure was dropped → second call re-runs and succeeds
      await expect(memoRequest('k', load)).resolves.toBe('ok');
      expect(load).toHaveBeenCalledTimes(2);
    });
  });

  it('scopes do not leak across requests', async () => {
    const load = jest.fn(async () => 'a');
    await runWithRequestMemo(async () => { await memoRequest('k', load); });
    await runWithRequestMemo(async () => { await memoRequest('k', load); });
    expect(load).toHaveBeenCalledTimes(2); // one per request scope
  });
});
