/**
 * 3AH-156 — REPRODUCTION of the production cron re-add race.
 *
 * Observed in production (outgoing 4e7d55da -> incoming 3ed2234e):
 *   01:09:22Z  [cron] instance 29bf83117dd1:1 deregistered (graceful shutdown, removed=1)
 *   01:09:41Z  [cron] DUPLICATE INSTANCES DETECTED: 29bf83117dd1:1 (this: 965eb46f5a13:1)
 *
 * The ZREM confirmed removal, yet a different process read the member back ~19s
 * later. The suspected cause is an in-flight persistence operation completing
 * AFTER deregistration and re-ZADDing the instance:
 *
 *   cycleEnd()                -> `void this.persistAsync(record)`   (fire-and-forget)
 *     persistAsync            -> `await this.updateInstanceSet(now)`
 *       updateInstanceSet     -> checks `this.deregistered` ONCE, synchronously
 *                             -> pipeline.zadd(...)
 *                             -> `await pipe.exec()`   <-- yields
 *   ... SIGTERM ...
 *   deregister()              -> deregistered = true; ZREM -> removed=1
 *   ... the paused pipeline resumes -> the ZADD lands -> instance is BACK
 *
 * THE INVARIANT UNDER TEST:
 *   Once deregistration has begun, no in-flight or subsequently resumed
 *   persistence operation may re-register this instance.
 *
 * This test is expected to FAIL against the current implementation. That
 * failure IS the reproduction. No production code is modified here.
 */

const INSTANCE_KEY = 'omnivyra:cron:instances';

/** FakeRedis whose pipeline().exec() can be held open to order the interleave. */
class GatedRedis {
  zset = new Map<string, number>();
  kv = new Map<string, string>();
  zremCalls: string[] = [];
  /** Resolve to let a held pipeline.exec() complete. */
  private gate: (() => void) | null = null;
  gateArmed = false;

  armGate() { this.gateArmed = true; }
  releaseGate() { this.gateArmed = false; const g = this.gate; this.gate = null; g?.(); }

  pipeline(): any {
    const ops: Array<() => void> = [];
    const p: any = {
      zadd: (_k: string, score: number, member: string) => {
        ops.push(() => { this.zset.set(member, score); });
        return p;
      },
      zremrangebyscore: (_k: string, _min: string, max: number) => {
        ops.push(() => { for (const [m, s] of [...this.zset]) if (s <= max) this.zset.delete(m); });
        return p;
      },
      expire: () => p,
      set: (k: string, v: string) => { ops.push(() => { this.kv.set(k, v); }); return p; },
      lpush: () => p,
      ltrim: () => p,
      exec: async () => {
        if (this.gateArmed) {
          await new Promise<void>((resolve) => { this.gate = resolve; });
        }
        ops.forEach((op) => op());
        return [];
      },
    };
    return p;
  }

  async zrangebyscore(_key: string, min: number): Promise<string[]> {
    return [...this.zset].filter(([, s]) => s >= min).map(([m]) => m);
  }

  zrem(_key: string, member: string): Promise<number> {
    this.zremCalls.push(member);
    return Promise.resolve(this.zset.delete(member) ? 1 : 0);
  }

  async set(k: string, v: string): Promise<'OK'> { this.kv.set(k, v); return 'OK'; }
}

let mockRedis: GatedRedis | null = null;
jest.mock('../../queue/standaloneRedisClient', () => ({
  getInstrumentedStandaloneRedisClient: () => {
    if (!mockRedis) throw new Error('redis unavailable');
    return mockRedis;
  },
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { CronInstrumentation } = require('../../utils/cronInstrumentation');

const ID = 'outgoing-host:1';

describe('3AH-156 — deregistration must not be undone by in-flight persistence', () => {
  beforeEach(() => { mockRedis = new GatedRedis(); });
  afterEach(() => { mockRedis = null; });

  it('REPRODUCTION: an in-flight updateInstanceSet re-adds the instance after ZREM', async () => {
    const instr = new CronInstrumentation(ID);

    // A cycle is in flight and has already passed the latch check.
    mockRedis!.armGate();
    instr.cycleStart?.();
    const inFlight = (instr as any).persistAsync({ ts: Date.now(), jobs: [], durationMs: 1 });
    await Promise.resolve(); // let it reach `await pipe.exec()` and park on the gate

    // SIGTERM arrives: deregistration runs to completion.
    const removed = await instr.deregister();
    expect(removed).toBe(true);
    expect(mockRedis!.zremCalls).toContain(ID);
    expect(mockRedis!.zset.has(ID)).toBe(false); // gone at this instant

    // The parked pipeline now lands.
    mockRedis!.releaseGate();
    await inFlight;

    // THE INVARIANT: the instance must NOT be registered again.
    expect(mockRedis!.zset.has(ID)).toBe(false);
  });

  it('CONTROL: with no in-flight operation, deregistration sticks', async () => {
    const instr = new CronInstrumentation(ID);
    await (instr as any).updateInstanceSet(Date.now());
    expect(mockRedis!.zset.has(ID)).toBe(true);

    const removed = await instr.deregister();
    expect(removed).toBe(true);
    expect(mockRedis!.zset.has(ID)).toBe(false);

    // A LATER call is correctly refused by the latch.
    await (instr as any).updateInstanceSet(Date.now());
    expect(mockRedis!.zset.has(ID)).toBe(false);
  });

  it('MODEL: a serialized implementation upholds the invariant', async () => {
    // Models the remediation shape without touching production code: the latch
    // is re-checked after the await, immediately before the write is applied.
    const redis = new GatedRedis();
    let deregistered = false;
    const write = async () => {
      if (deregistered) return;
      const pipe = redis.pipeline();
      pipe.zadd(INSTANCE_KEY, Date.now(), ID);
      await pipe.exec();
      if (deregistered) redis.zset.delete(ID); // re-check AFTER the await
    };
    redis.armGate();
    const inFlight = write();
    await Promise.resolve();
    deregistered = true;
    await redis.zrem(INSTANCE_KEY, ID);
    redis.releaseGate();
    await inFlight;
    expect(redis.zset.has(ID)).toBe(false);
  });
});
