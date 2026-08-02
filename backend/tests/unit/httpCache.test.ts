/**
 * OPT-002 — canonical HTTP cache policy helper (lib/platform/httpCache.ts).
 *
 * Byte-exact header assertions: these strings ARE the policy. Any change here
 * must go through the cache policy matrix (docs/performance/HTTP-CACHE-POLICY.md).
 */
import {
  CACHE_TTL,
  setPrivateCache,
  setPrivateNoStore,
  setNeverCache,
  setPublicSwr,
} from '../../../lib/platform/httpCache';
import { createMockRes } from '../utils';

describe('CACHE_TTL tiers', () => {
  test('the three canonical tiers are frozen at 30 / 60 / 300', () => {
    expect(CACHE_TTL).toEqual({ NEAR_LIVE: 30, STANDARD: 60, STABLE: 300 });
  });
});

describe('setPrivateCache (P3)', () => {
  test.each([
    [CACHE_TTL.NEAR_LIVE, 'private, max-age=30'],
    [CACHE_TTL.STANDARD, 'private, max-age=60'],
    [CACHE_TTL.STABLE, 'private, max-age=300'],
  ])('TTL %d emits exact Cache-Control and Vary', (ttl, expected) => {
    const res = createMockRes();
    setPrivateCache(res, ttl as 30 | 60 | 300);
    expect(res.setHeader).toHaveBeenCalledWith('Cache-Control', expected);
    expect(res.setHeader).toHaveBeenCalledWith('Vary', 'Authorization, Cookie');
    expect(res.setHeader).toHaveBeenCalledTimes(2);
  });

  test('never emits public or s-maxage for any tier', () => {
    for (const ttl of Object.values(CACHE_TTL)) {
      const res = createMockRes();
      setPrivateCache(res, ttl);
      for (const [name, value] of (res.setHeader as jest.Mock).mock.calls) {
        if (name === 'Cache-Control') {
          expect(value).not.toMatch(/public/);
          expect(value).not.toMatch(/s-maxage/);
          expect(value).toMatch(/^private, /);
        }
      }
    }
  });
});

describe('setPrivateNoStore (P4)', () => {
  test('emits exactly private, no-store and nothing else', () => {
    const res = createMockRes();
    setPrivateNoStore(res);
    expect(res.setHeader).toHaveBeenCalledWith('Cache-Control', 'private, no-store');
    expect(res.setHeader).toHaveBeenCalledTimes(1);
  });
});

describe('setNeverCache (P5)', () => {
  test('emits no-store, no-cache, must-revalidate plus legacy Pragma', () => {
    const res = createMockRes();
    setNeverCache(res);
    expect(res.setHeader).toHaveBeenCalledWith(
      'Cache-Control',
      'no-store, no-cache, must-revalidate',
    );
    expect(res.setHeader).toHaveBeenCalledWith('Pragma', 'no-cache');
    expect(res.setHeader).toHaveBeenCalledTimes(2);
  });
});

describe('setPublicSwr (P2)', () => {
  test('defaults: s-maxage=300, stale-while-revalidate=600', () => {
    const res = createMockRes();
    setPublicSwr(res);
    expect(res.setHeader).toHaveBeenCalledWith(
      'Cache-Control',
      'public, s-maxage=300, stale-while-revalidate=600',
    );
    expect(res.setHeader).toHaveBeenCalledTimes(1);
  });

  test('never emits Vary (public responses are principal-free by contract)', () => {
    const res = createMockRes();
    setPublicSwr(res, 60, 120);
    expect(res.setHeader).toHaveBeenCalledWith(
      'Cache-Control',
      'public, s-maxage=60, stale-while-revalidate=120',
    );
    const varyCalls = (res.setHeader as jest.Mock).mock.calls.filter(([n]) => n === 'Vary');
    expect(varyCalls).toHaveLength(0);
  });
});
