/**
 * Closure-014 (D) — the admin write rate limit, end to end through the REAL
 * requireAdminRateLimit + checkRateLimit sliding window, against an in-memory
 * sorted-set store that executes the same MULTI (zremrangebyscore → zcard →
 * zadd → expire) atomically per key. Covers normal use, threshold, burst,
 * concurrent requests, isolation between client IPs and between route
 * prefixes, the 429 contract (code + Retry-After), and the `sensitive` strict
 * mode while Redis is down. No Redis server.
 */
let mockRedisDown = false;
const mockZ = new Map<string, number[]>();
jest.mock('../../queue/standaloneRedisClient', () => ({
  getInstrumentedStandaloneRedisClient: () => ({
    multi: () => {
      const ops: Array<() => [null, unknown]> = [];
      const p: Record<string, unknown> = {};
      p.zremrangebyscore = (key: string, _min: string, max: number) => { ops.push(() => { const s = (mockZ.get(key) ?? []).filter((x) => x > max); mockZ.set(key, s); return [null, 0]; }); return p; };
      p.zcard = (key: string) => { ops.push(() => [null, (mockZ.get(key) ?? []).length]); return p; };
      p.zadd = (key: string, score: number) => { ops.push(() => { mockZ.set(key, [...(mockZ.get(key) ?? []), score]); return [null, 1]; }); return p; };
      p.expire = () => { ops.push(() => [null, 1]); return p; };
      // Atomic: all queued ops run synchronously inside exec (as MULTI does).
      p.exec = async () => { if (mockRedisDown) throw new Error('ECONNREFUSED'); return ops.map((op) => op()); };
      return p;
    },
  }),
}));
jest.mock('../../services/adminRuntimeConfig', () => ({ getRateLimitAdminConfig: async () => undefined, getRateLimitOverride: () => null }));
jest.mock('../../../lib/auth/anomalyDetector', () => ({ recordAnomalyEvent: jest.fn() }));
jest.mock('../../../lib/anomaly/detectionEngine', () => ({ detectAnomaly: jest.fn(async () => undefined) }));
jest.mock('../../observability', () => ({ recordRawCounter: jest.fn() }));
jest.mock('../../services/logger', () => ({ logger: { warn: jest.fn(), info: jest.fn(), error: jest.fn(), debug: jest.fn() } }));

import { requireAdminRateLimit } from '../../services/requestAccessService';
import { __resetRateLimitFallbackForTest } from '../../../lib/auth/rateLimit';

function req(ip: string) {
  return { headers: {}, socket: { remoteAddress: ip }, method: 'POST', url: '/api/x' } as never;
}
function res() {
  const r = { statusCode: 200, body: undefined as unknown, headers: {} as Record<string, string> };
  return Object.assign(r, {
    status(c: number) { r.statusCode = c; return this; },
    json(b: unknown) { r.body = b; return this; },
    setHeader(k: string, v: string) { r.headers[k.toLowerCase()] = v; return this; },
  });
}
async function hit(ip: string, prefix: string, limit: number, sensitive = false) {
  const r = res();
  const ok = await requireAdminRateLimit(req(ip), r as never, prefix, limit, 60, sensitive ? { sensitive: true } : {});
  return { ok, r };
}

beforeEach(() => { mockZ.clear(); mockRedisDown = false; __resetRateLimitFallbackForTest(); delete process.env.VERCEL; delete process.env.TRUSTED_PROXY_HOPS; });

describe('requireAdminRateLimit (real sliding window)', () => {
  it('normal usage below the limit is never refused', async () => {
    for (let i = 0; i < 9; i++) expect((await hit('198.51.100.1', 'rl:t:normal', 10)).ok).toBe(true);
  });

  it('threshold: exactly `limit` requests pass in the window; the next is 429 with code + Retry-After', async () => {
    const results = [];
    for (let i = 0; i < 6; i++) results.push(await hit('198.51.100.2', 'rl:t:threshold', 5));
    expect(results.slice(0, 5).every((x) => x.ok)).toBe(true);
    const blocked = results[5];
    expect(blocked.ok).toBe(false);
    expect(blocked.r.statusCode).toBe(429);
    expect(blocked.r.body).toEqual({ error: 'Too many requests. Try again later.', code: 'RATE_LIMITED' });
    const retry = Number(blocked.r.headers['retry-after']);
    expect(retry).toBeGreaterThanOrEqual(1);
    expect(retry).toBeLessThanOrEqual(61);
  });

  it('burst: refused requests keep the window full (hammering does not reopen it)', async () => {
    for (let i = 0; i < 40; i++) await hit('198.51.100.3', 'rl:t:burst', 10);
    expect((await hit('198.51.100.3', 'rl:t:burst', 10)).ok).toBe(false);
  });

  it('concurrent requests: exactly `limit` succeed out of a parallel burst', async () => {
    const all = await Promise.all(Array.from({ length: 25 }, () => hit('198.51.100.4', 'rl:t:concurrent', 7)));
    expect(all.filter((x) => x.ok)).toHaveLength(7);
    expect(all.filter((x) => !x.ok).every((x) => x.r.statusCode === 429)).toBe(true);
  });

  it('isolation: another client IP has its own budget', async () => {
    for (let i = 0; i < 3; i++) await hit('198.51.100.5', 'rl:t:iso', 3);
    expect((await hit('198.51.100.5', 'rl:t:iso', 3)).ok).toBe(false);
    expect((await hit('198.51.100.6', 'rl:t:iso', 3)).ok).toBe(true);
  });

  it('isolation: different route prefixes do not share a bucket', async () => {
    for (let i = 0; i < 2; i++) await hit('198.51.100.7', 'rl:t:routeA', 2);
    expect((await hit('198.51.100.7', 'rl:t:routeA', 2)).ok).toBe(false);
    expect((await hit('198.51.100.7', 'rl:t:routeB', 2)).ok).toBe(true);
  });

  it('Redis down: a NON-sensitive limit keeps the historical generous fallback (50/window)', async () => {
    mockRedisDown = true;
    const all = [];
    for (let i = 0; i < 12; i++) all.push(await hit('198.51.100.8', 'rl:t:down-generous', 5));
    expect(all.filter((x) => x.ok).length).toBe(12);
  });

  it('Redis down: a SENSITIVE limit holds its OWN budget in-process (strict), never 50', async () => {
    mockRedisDown = true;
    const all = [];
    for (let i = 0; i < 12; i++) all.push(await hit('198.51.100.9', 'rl:t:down-strict', 5, true));
    expect(all.filter((x) => x.ok).length).toBe(5);
    expect(all[11].r.statusCode).toBe(429);
  });
});
