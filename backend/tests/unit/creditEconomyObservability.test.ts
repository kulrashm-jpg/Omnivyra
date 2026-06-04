/**
 * Phase 11C — durable credit-economy observability.
 *
 * Proves the layer (a) holds NO process-local state — every signal round-trips
 * through the (fake) Redis store, so it survives instance turnover; (b) is
 * replay-safe — a settlement observation with a repeated dedupeKey is counted
 * once; (c) aggregates the full rollout-question set from durable rollups alone.
 */

// A minimal in-memory Redis implementing only what the module uses. A SINGLE
// instance is shared across record + read calls — this IS the durability model
// (the store is external; "restart" clears process memory, not Redis).
function num(v: unknown): number { const n = Number(v); return Number.isFinite(n) ? n : 0; }
function makeFakeRedis() {
  const hashes  = new Map<string, Map<string, string>>();
  const zsets   = new Map<string, Map<string, number>>();
  const strings = new Map<string, string>();
  const h = (k: string) => { let m = hashes.get(k); if (!m) { m = new Map(); hashes.set(k, m); } return m; };
  const z = (k: string) => { let m = zsets.get(k);  if (!m) { m = new Map(); zsets.set(k, m); }  return m; };
  const inc = (k: string, f: string, n: number) => h(k).set(f, String(num(h(k).get(f)) + n));
  return {
    pipeline() {
      const ops: Array<() => void> = [];
      const p: any = {
        hincrby(k: string, f: string, n: number)      { ops.push(() => inc(k, f, Number(n))); return p; },
        hincrbyfloat(k: string, f: string, n: number) { ops.push(() => inc(k, f, Number(n))); return p; },
        hset(k: string, f: string, v: string)         { ops.push(() => h(k).set(f, String(v))); return p; },
        expire()                                       { return p; },
        zadd(k: string, score: number, member: string){ ops.push(() => z(k).set(member, Number(score))); return p; },
        async exec()                                   { ops.forEach((o) => o()); return []; },
      };
      return p;
    },
    async set(k: string, v: string, _ex: string, _ttl: number, nx?: string) {
      if (nx === 'NX' && strings.has(k)) return null;
      strings.set(k, v); return 'OK';
    },
    async zrangebyscore(k: string, min: number, max: number) {
      return Array.from(z(k).entries())
        .filter(([, s]) => s >= Number(min) && s <= Number(max))
        .sort((a, b) => a[1] - b[1]).map(([m]) => m);
    },
    async hgetall(k: string) {
      const m = hashes.get(k); if (!m) return {};
      return Object.fromEntries(m.entries());
    },
  };
}

let fake = makeFakeRedis();
jest.mock('../../../lib/redis/client', () => ({ getSharedRedisConnection: async () => fake }));

import {
  recordShadowObservation,
  recordSettlementObservation,
  recordAdmissionObservation,
  readCreditEconomyObservability,
} from '../../services/billing/creditEconomyObservability';

beforeEach(() => { fake = makeFakeRedis(); });

describe('creditEconomyObservability — durable shadow telemetry', () => {
  it('aggregates would-block rate, average shortfall, most-blocked & most-expensive from Redis', async () => {
    await recordShadowObservation({ activity: 'reply',         wouldBlock: false, shortfall: 0,  maximumCredits: 5 });
    await recordShadowObservation({ activity: 'deep_research', wouldBlock: true,  shortfall: 10, maximumCredits: 50 });
    await recordShadowObservation({ activity: 'deep_research', wouldBlock: true,  shortfall: 20, maximumCredits: 50 });

    const r = await readCreditEconomyObservability({ windowDays: 14 });
    expect(r.totalEvaluations).toBe(3);
    expect(r.wouldAllow).toBe(1);
    expect(r.wouldBlock).toBe(2);
    expect(r.wouldBlockRate).toBeCloseTo(2 / 3, 6);
    expect(r.averageShortfall).toBe(15);                // (10 + 20) / 2
    expect(r.mostBlockedActivities[0]).toEqual({ activity: 'deep_research', wouldBlock: 2, evaluations: 2 });
    expect(r.mostExpensiveActivities[0]).toEqual({ activity: 'deep_research', maximumCredits: 50 });
  });
});

describe('creditEconomyObservability — durable settlement telemetry', () => {
  it('captures entry/exposure/actual/underfunded/variance and is replay-safe', async () => {
    await recordSettlementObservation({
      activity: 'content_generation', entryConsumed: 5, exposureReserved: 55,
      exposureReleased: 50, actualConsumed: 10, underfunded: false, settlementVariance: 50, dedupeKey: 'k1',
    });
    // Replay with the SAME dedupeKey — must NOT double count.
    await recordSettlementObservation({
      activity: 'content_generation', entryConsumed: 5, exposureReserved: 55,
      exposureReleased: 50, actualConsumed: 10, underfunded: false, settlementVariance: 50, dedupeKey: 'k1',
    });
    await recordSettlementObservation({ activity: 'deep_research', actualConsumed: 100, underfunded: true, dedupeKey: 'k2' });
    await recordSettlementObservation({ activity: 'creator', exposureReleased: 55, abandoned: true, dedupeKey: 'job:abandon' });

    const r = await readCreditEconomyObservability({ windowDays: 14 });
    expect(r.totalEntryConsumed).toBe(5);          // replay did not add a second 5
    expect(r.totalExposureReserved).toBe(55);
    expect(r.totalExposureReleased).toBe(105);     // 50 + 55 (abandon)
    expect(r.totalActualConsumed).toBe(110);       // 10 + 100
    expect(r.totalUnderfundedEvents).toBe(1);
    expect(r.totalAbandoned).toBe(1);
    expect(r.averageSettlementVariance).toBe(50);
  });
});

describe('creditEconomyObservability — durable admission telemetry (Phase 11D)', () => {
  it('captures allowed/blocked/required/effective/shortfall, block-rate, most-blocked; replay-safe', async () => {
    await recordAdmissionObservation({ activity: 'reply',         allowed: true,  requiredCredits: 5,  effectiveCredits: 50, shortfall: 0,  dedupeKey: 'a1' });
    await recordAdmissionObservation({ activity: 'deep_research', allowed: false, requiredCredits: 50, effectiveCredits: 10, shortfall: 40, dedupeKey: 'a2' });
    // Replay a2 — must not double count.
    await recordAdmissionObservation({ activity: 'deep_research', allowed: false, requiredCredits: 50, effectiveCredits: 10, shortfall: 40, dedupeKey: 'a2' });

    const r = await readCreditEconomyObservability({ windowDays: 14 });
    expect(r.admissionEvaluations).toBe(2);   // a2 replay ignored
    expect(r.admissionAllowed).toBe(1);
    expect(r.admissionBlocked).toBe(1);
    expect(r.admissionBlockRate).toBeCloseTo(0.5, 6);
    expect(r.averageAdmissionShortfall).toBe(40);
    expect(r.mostAdmissionBlockedActivities[0]).toEqual({ activity: 'deep_research', blocked: 1 });
  });
});

describe('creditEconomyObservability — resilience', () => {
  it('read returns a zeroed report when there is no data (no throw)', async () => {
    const r = await readCreditEconomyObservability({ windowDays: 7 });
    expect(r.totalEvaluations).toBe(0);
    expect(r.wouldBlockRate).toBe(0);
    expect(r.mostBlockedActivities).toEqual([]);
  });

  it('recorders never throw when Redis is unavailable', async () => {
    fake = { pipeline: () => { throw new Error('redis down'); } } as any;
    await expect(recordShadowObservation({ activity: 'x', wouldBlock: true, shortfall: 1, maximumCredits: 2 })).resolves.toBeUndefined();
    await expect(recordSettlementObservation({ activity: 'x', entryConsumed: 1, dedupeKey: 'z' })).resolves.toBeUndefined();
  });
});
