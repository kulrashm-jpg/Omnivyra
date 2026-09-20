/**
 * STEP 3AH-137 Lane A — CHARACTERIZATION of the cron duplicate-instance
 * lifecycle at the T3-certified baseline (backend/utils/cronInstrumentation.ts).
 *
 * These tests change NO production behavior. They PIN the behavior that made a
 * Railway rollout log, exactly once:
 *
 *   [cron] DUPLICATE INSTANCES DETECTED: <old-container>:1 (this instance: <new>:1)
 *
 * The mechanism they pin:
 *   1. `omnivyra:cron:instances` is a 15-minute liveness PROXY, not a live
 *      registry: membership means "wrote a heartbeat within INSTANCE_TTL_MS",
 *      so a predecessor that already exited is indistinguishable from a live
 *      second scheduler for up to 15 minutes.
 *   2. `shutdown()` performs NO deregistration — the outgoing instance leaves
 *      its own entry behind on every graceful SIGTERM.
 *   3. Detection fires only from the per-cycle persist path; the 5-minute
 *      heartbeat refreshes and prunes the set silently.
 *
 * If a future change adds deregistration or a startup grace window, these
 * assertions are expected to be UPDATED deliberately — they are a baseline
 * record, not a design constraint.
 */

/** 15 minutes — INSTANCE_TTL_MS in cronInstrumentation.ts (line 45). */
const INSTANCE_TTL_MS = 15 * 60 * 1_000;
/** 5 minutes — HEARTBEAT_MS in cronInstrumentation.ts (line 46). */
const HEARTBEAT_MS = 5 * 60_000;

class FakeRedis {
  zset = new Map<string, number>();
  kv = new Map<string, string>();
  zremCalls: Array<[string, string]> = [];

  pipeline(): any {
    const ops: Array<() => void> = [];
    const p: any = {
      zadd: (_k: string, score: number, member: string) => {
        ops.push(() => { this.zset.set(member, score); });
        return p;
      },
      zremrangebyscore: (_k: string, _min: string, max: number) => {
        ops.push(() => {
          for (const [m, s] of [...this.zset]) if (s <= max) this.zset.delete(m);
        });
        return p;
      },
      expire: () => p,
      set: (k: string, v: string) => { ops.push(() => { this.kv.set(k, v); }); return p; },
      lpush: () => p,
      ltrim: () => p,
      exec: async () => { ops.forEach((op) => op()); return []; },
    };
    return p;
  }

  async zrangebyscore(_key: string, min: number): Promise<string[]> {
    return [...this.zset].filter(([, score]) => score >= min).map(([member]) => member);
  }

  async zrem(key: string, member: string): Promise<number> {
    this.zremCalls.push([key, member]);
    return this.zset.delete(member) ? 1 : 0;
  }

  async set(k: string, v: string): Promise<'OK'> { this.kv.set(k, v); return 'OK'; }
}

let mockRedis: FakeRedis;
jest.mock('../../queue/standaloneRedisClient', () => ({
  getInstrumentedStandaloneRedisClient: () => mockRedis,
}));

import { CronInstrumentation } from '../../utils/cronInstrumentation';

const T0 = new Date('2026-09-18T09:00:00Z').getTime();
const PEER = 'eafb114825a0:1';

/** Drain the microtask queue so the fire-and-forget persistAsync() settles. */
async function flush(): Promise<void> {
  for (let i = 0; i < 30; i++) await Promise.resolve();
}

function duplicateWarnings(warn: jest.SpyInstance): string[] {
  return warn.mock.calls
    .map((args) => String(args[0]))
    .filter((line) => line.includes('DUPLICATE INSTANCES DETECTED'));
}

describe('3AH-137 Lane A — cron instance registry lifecycle (characterization)', () => {
  let warn: jest.SpyInstance;
  let log: jest.SpyInstance;
  const created: CronInstrumentation[] = [];

  beforeEach(() => {
    mockRedis = new FakeRedis();
    warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    log = jest.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    for (const instance of created.splice(0)) instance.shutdown();
    warn.mockRestore();
    log.mockRestore();
    jest.useRealTimers();
  });

  function newInstance(): CronInstrumentation {
    const instance = new CronInstrumentation();
    created.push(instance);
    return instance;
  }

  async function cycleAt(instance: CronInstrumentation, at: number): Promise<void> {
    const now = jest.spyOn(Date, 'now').mockReturnValue(at);
    try {
      instance.cycleStart();
      instance.cycleEnd([]);
      await flush();
    } finally {
      now.mockRestore();
    }
  }

  it('reports a predecessor that already exited as a DUPLICATE (stale entry, not a live peer)', async () => {
    // The old container heartbeat'd 60 s ago and has since been SIGTERMed.
    mockRedis.zset.set(PEER, T0 - 60_000);

    const instance = newInstance();
    await cycleAt(instance, T0);

    const warnings = duplicateWarnings(warn);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain(PEER);
    expect(warnings[0]).toContain(instance.instanceId);
  });

  it('shutdown() leaves this instance registered — there is NO deregistration path', async () => {
    const instance = newInstance();
    await cycleAt(instance, T0);
    expect(mockRedis.zset.has(instance.instanceId)).toBe(true);

    instance.shutdown();

    expect(mockRedis.zremCalls).toEqual([]);
    expect(mockRedis.zset.get(instance.instanceId)).toBe(T0);
    expect(typeof (instance as unknown as { deregister?: unknown }).deregister)
      .not.toBe('function');
  });

  it('a stale entry is only dropped once it is strictly older than INSTANCE_TTL_MS', async () => {
    mockRedis.zset.set(PEER, T0);

    // 1 ms short of the TTL: still reported.
    const stillInside = newInstance();
    await cycleAt(stillInside, T0 + INSTANCE_TTL_MS - 1);
    expect(duplicateWarnings(warn)).toHaveLength(1);
    expect(mockRedis.zset.has(PEER)).toBe(true);
    warn.mockClear();

    // Exactly at the TTL: zremrangebyscore's inclusive upper bound prunes it
    // and it is not reported. This equality is why the production warning
    // fired once and did not recur: the worker's cron tick (CRON_INTERVAL_MS,
    // default 900_000 ms) has the SAME period as INSTANCE_TTL_MS.
    const atBoundary = newInstance();
    await cycleAt(atBoundary, T0 + INSTANCE_TTL_MS);
    expect(duplicateWarnings(warn)).toHaveLength(0);
    expect(mockRedis.zset.has(PEER)).toBe(false);
  });

  it('the 5-minute heartbeat refreshes/prunes the set but never emits the warning', async () => {
    jest.useFakeTimers({ now: T0 });
    mockRedis.zset.set(PEER, T0 - 60_000);

    const instance = new CronInstrumentation();
    created.push(instance);

    jest.advanceTimersByTime(HEARTBEAT_MS);
    await flush();

    // The heartbeat wrote this instance's entry ...
    expect(mockRedis.zset.has(instance.instanceId)).toBe(true);
    // ... saw the peer (still inside the 15-minute window) ...
    expect(mockRedis.zset.has(PEER)).toBe(true);
    // ... and said nothing. Only the per-cycle persist path warns.
    expect(duplicateWarnings(warn)).toHaveLength(0);
  });
});
