/**
 * OPS-C — the Redis usage REQUESTS axis must not be driven by a counter
 * discontinuity.
 *
 * Production 2026-10-30 (worker 3a38f8fc, evidence/railway-3a38f8fc-polls.log):
 * the UTC-day baseline sat ~14.4M below total_commands_processed while the
 * counter rose ~1,000 per 5-minute poll; requestsPct read 287.9% → 289.8% and
 * the level stayed "critical" all day, blocking every non-critical queue.
 *
 * Drives the REAL poll() against a fake Redis (INFO + the usage keys). No
 * network. Each test loads a fresh copy of the module (module-level state).
 */

export {};

// writeAdminAlert writes <cwd>/.redis-usage-alert.json — never from tests.
jest.mock('fs', () => {
  const actual = jest.requireActual('fs');
  return {
    ...actual,
    writeFileSync: (p: unknown, ...rest: unknown[]) =>
      (String(p).endsWith('.redis-usage-alert.json') ? undefined : actual.writeFileSync(p, ...rest)),
  };
});

type Fake = {
  status: string;
  counter: number;
  usedMemory: number;
  store: Map<string, string>;
  info: () => Promise<string>;
  get: (k: string) => Promise<string | null>;
  set: (k: string, v: string, ...a: unknown[]) => Promise<'OK' | null>;
  getset: (k: string, v: string) => Promise<string | null>;
  incrby: (k: string, n: number) => Promise<number>;
  incr: (k: string) => Promise<number>;
  del: (k: string) => Promise<number>;
  expire: (k: string, s: number) => Promise<number>;
};

function fakeRedis(counter: number): Fake {
  const store = new Map<string, string>();
  const f: Fake = {
    status: 'ready',
    counter,
    usedMemory: 1_000_000,
    store,
    info: async () => `# Memory\r\nused_memory:${f.usedMemory}\r\nmaxmemory:0\r\n# Stats\r\ntotal_commands_processed:${f.counter}\r\n`,
    get: async (k) => (store.has(k) ? store.get(k)! : null),
    set: async (k, v, ...a) => {
      if (a.includes('NX') && store.has(k)) return null;
      store.set(k, v);
      return 'OK';
    },
    getset: async (k, v) => { const p = store.has(k) ? store.get(k)! : null; store.set(k, v); return p; },
    incrby: async (k, n) => { const v = Number(store.get(k) ?? '0') + n; store.set(k, String(v)); return v; },
    incr: async (k) => { const v = Number(store.get(k) ?? '0') + 1; store.set(k, String(v)); return v; },
    del: async (k) => (store.delete(k) ? 1 : 0),
    expire: async () => 1,
  };
  return f;
}

type Mod = typeof import('../../../lib/redis/usageProtection');
function loadFresh(): Mod {
  let m!: Mod;
  jest.isolateModules(() => { m = require('../../../lib/redis/usageProtection'); });
  return m;
}

const T0 = Date.parse('2026-10-30T14:07:10.000Z');
const FIVE_MIN = 5 * 60_000;
const today = '2026-10-30';

let warnSpy: jest.SpyInstance;
let logSpy: jest.SpyInstance;
let errSpy: jest.SpyInstance;
let stderrSpy: jest.SpyInstance;
const savedLimit = process.env.UPSTASH_DAILY_REQUEST_LIMIT;

beforeEach(() => {
  jest.useFakeTimers({ now: T0, doNotFake: ['setTimeout', 'setInterval', 'nextTick', 'setImmediate', 'queueMicrotask'] });
  warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined);
  errSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
  stderrSpy = jest.spyOn(process.stderr, 'write').mockImplementation(() => true);
  delete process.env.UPSTASH_DAILY_REQUEST_LIMIT;
});
afterEach(() => {
  jest.useRealTimers();
  warnSpy.mockRestore(); logSpy.mockRestore(); errSpy.mockRestore(); stderrSpy.mockRestore();
  if (savedLimit === undefined) delete process.env.UPSTASH_DAILY_REQUEST_LIMIT; else process.env.UPSTASH_DAILY_REQUEST_LIMIT = savedLimit;
});

async function pollAt(m: Mod, r: Fake, at: number) {
  jest.setSystemTime(at);
  await m.poll(() => r as never);
}

function resetEvents(): Array<Record<string, unknown>> {
  return warnSpy.mock.calls
    .map((c) => { try { return JSON.parse(String(c[0])); } catch { return null; } })
    .filter((e): e is Record<string, unknown> => !!e && e.event === 'redis_usage_baseline_reset');
}

describe('production pattern: baseline 14.4M behind, steady +1k per poll', () => {
  it('first process of the day: is NOT critical (old code: 287.9% critical)', async () => {
    const m = loadFresh();
    const r = fakeRedis(100_000_000);
    r.store.set(`omnivyra:usage:baseline:${today}`, String(100_000_000 - 14_400_000));
    for (let i = 0; i < 12; i++) {
      await pollAt(m, r, T0 + i * FIVE_MIN);
      r.counter += 1_000;
    }
    const s = m.getUsageStatus();
    expect(m.getUsageLevel()).toBe('normal');
    expect(s.requests.dailyUsed).toBe(11_000);
    expect(s.requests.usagePct).toBeLessThan(1);
  });

  it('a 14.4M jump inside one interval is clamped (not counted whole) and logged as a baseline reset', async () => {
    const m = loadFresh();
    const r = fakeRedis(100_000_000);
    await pollAt(m, r, T0);
    r.counter += 1_000;
    await pollAt(m, r, T0 + FIVE_MIN);
    r.counter += 14_400_000;                     // discontinuity
    await pollAt(m, r, T0 + 2 * FIVE_MIN);
    r.counter += 1_000;
    await pollAt(m, r, T0 + 3 * FIVE_MIN);
    expect(m.getUsageLevel()).toBe('normal');
    // Review M-2: the implausible interval contributes its clamped share,
    // 2,000/s × 300 s = 600,000 (was 0 in 28c9e41e).
    expect(m.getUsageStatus().requests.dailyUsed).toBe(2_000 + 600_000);
    const ev = resetEvents();
    expect(ev).toHaveLength(1);
    expect(ev[0]).toMatchObject({ level: 'WARN', reason: 'implausible_rate', delta: 14_400_000, elapsed_s: 300 });
  });
});

describe('genuine high rate still escalates', () => {
  it('a plausible sustained rate that crosses 95% of the limit goes critical', async () => {
    process.env.UPSTASH_DAILY_REQUEST_LIMIT = '100000';
    const m = loadFresh();
    const r = fakeRedis(5_000_000);
    await pollAt(m, r, T0);
    const levels: string[] = [];
    for (let i = 1; i <= 3; i++) {
      r.counter += 33_000;                       // 110 commands/s — plausible
      await pollAt(m, r, T0 + i * FIVE_MIN);
      levels.push(m.getUsageLevel());
    }
    expect(levels).toEqual(['normal', 'warning', 'critical']);
    expect(m.getUsageStatus().requests.dailyUsed).toBe(99_000);
    expect(resetEvents()).toHaveLength(0);
  });

  it('usage carries across processes through the shared accumulator', async () => {
    process.env.UPSTASH_DAILY_REQUEST_LIMIT = '100000';
    const r = fakeRedis(5_000_000);
    const a = loadFresh();
    await pollAt(a, r, T0);
    r.counter += 60_000;
    await pollAt(a, r, T0 + FIVE_MIN);
    const b = loadFresh();                       // redeploy: new process
    r.counter += 36_000;
    await pollAt(b, r, T0 + 2 * FIVE_MIN);
    expect(b.getUsageStatus().requests.dailyUsed).toBe(96_000);
    expect(b.getUsageLevel()).toBe('critical');
  });
});

describe('counter reset / backwards', () => {
  it('re-bases on a counter that went backwards and keeps counting from the new value', async () => {
    const m = loadFresh();
    const r = fakeRedis(50_000_000);
    await pollAt(m, r, T0);
    r.counter += 2_000;
    await pollAt(m, r, T0 + FIVE_MIN);
    r.counter = 1_000;                           // reset / failover / other node
    await pollAt(m, r, T0 + 2 * FIVE_MIN);
    r.counter += 500;
    await pollAt(m, r, T0 + 3 * FIVE_MIN);
    expect(m.getUsageStatus().requests.dailyUsed).toBe(2_500);
    const ev = resetEvents();
    expect(ev).toHaveLength(1);
    expect(ev[0]).toMatchObject({ reason: 'counter_backwards' });
    expect(Number(ev[0].delta)).toBeLessThan(0);
    expect(m.getUsageLevel()).toBe('normal');
  });
});

describe('evaluateCounterDelta', () => {
  it('classifies each case', () => {
    const m = loadFresh();
    const base = { now: T0, maxPerSec: 10_000 };
    expect(m.evaluateCounterDelta({ ...base, prevTotal: null, prevTs: null, cur: 5 })).toEqual({ accept: false, reason: 'no_previous', delta: 0 });
    expect(m.evaluateCounterDelta({ ...base, prevTotal: 10, prevTs: T0 - 1000, cur: 5 })).toMatchObject({ accept: false, reason: 'counter_backwards' });
    expect(m.evaluateCounterDelta({ ...base, prevTotal: 0, prevTs: T0 - 1000, cur: 10_000 })).toEqual({ accept: true, delta: 10_000 });
    expect(m.evaluateCounterDelta({ ...base, prevTotal: 0, prevTs: T0 - 1000, cur: 10_001 })).toMatchObject({ accept: false, reason: 'implausible_rate' });
  });
});

function anomalyEvents(): Array<Record<string, unknown>> {
  return warnSpy.mock.calls
    .map((c) => { try { return JSON.parse(String(c[0])); } catch { return null; } })
    .filter((e): e is Record<string, unknown> => !!e && e.event === 'redis_usage_anomaly_persistent');
}

describe('review M-2: clamp instead of discard', () => {
  it('a sustained genuine 12k/s runaway reaches critical within 8 polls (40 min)', async () => {
    const m = loadFresh();
    const r = fakeRedis(10_000_000);
    await pollAt(m, r, T0);
    const levels: string[] = [];
    for (let i = 1; i <= 8; i++) {
      r.counter += 12_000 * 300;                 // 3.6M per 5 minutes
      await pollAt(m, r, T0 + i * FIVE_MIN);
      levels.push(m.getUsageLevel());
    }
    expect(levels[levels.length - 1]).toBe('critical');
    expect(levels.indexOf('critical') + 1).toBeLessThanOrEqual(8);
    // The anomaly streak surfaces it long before: warning from the 3rd poll.
    expect(levels[2]).toBe('warning');
    expect(levels.slice(0, 2)).toEqual(['normal', 'normal']);
    expect(m.getUsageStatus().requests.dailyUsed).toBe(8 * 600_000);
  });

  it('a single 14.4M jump followed by steady +1k/poll stays below critical (default 5M limit)', async () => {
    const m = loadFresh();
    const r = fakeRedis(100_000_000);
    await pollAt(m, r, T0);
    r.counter += 14_400_000;
    await pollAt(m, r, T0 + FIVE_MIN);
    for (let i = 2; i < 14; i++) {
      r.counter += 1_000;
      await pollAt(m, r, T0 + i * FIVE_MIN);
      expect(m.getUsageLevel()).not.toBe('critical');
    }
    const s = m.getUsageStatus();
    expect(s.requests.dailyUsed).toBe(600_000 + 12_000);
    expect(s.requests.usagePct).toBeLessThan(95);
    expect(m.getUsageLevel()).toBe('normal');
    expect(anomalyEvents()).toHaveLength(0);
  });

  it('3 consecutive implausible intervals raise the level to warning and emit redis_usage_anomaly_persistent; a plausible interval ends it', async () => {
    const m = loadFresh();
    const r = fakeRedis(1_000_000);
    await pollAt(m, r, T0);
    const levels: string[] = [];
    for (let i = 1; i <= 3; i++) {
      r.counter += 1_000_000;                    // 3,333/s > 2,000/s, credited 600k each
      await pollAt(m, r, T0 + i * FIVE_MIN);
      levels.push(m.getUsageLevel());
    }
    // 1.8M of 5M = 36%: the percentage alone says normal.
    expect(m.getUsageStatus().requests.usagePct).toBe(36);
    expect(levels).toEqual(['normal', 'normal', 'warning']);
    const ev = anomalyEvents();
    expect(ev).toHaveLength(1);
    expect(ev[0]).toMatchObject({ consecutive_implausible_polls: 3, effective_level: 'warning' });
    r.counter += 1_000;
    await pollAt(m, r, T0 + 4 * FIVE_MIN);
    expect(m.getUsageLevel()).toBe('normal');
  });
});
