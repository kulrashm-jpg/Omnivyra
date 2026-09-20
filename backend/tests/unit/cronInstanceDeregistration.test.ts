/**
 * STEP 3AH-142 Lane A — cron self-deregistration.
 *
 * ROOT CAUSE (confirmed at 2a01185f):
 *   backend/utils/cronInstrumentation.ts had no self-deregistration anywhere.
 *   shutdown() (was :282-290) cleared the heartbeat timer and nulled the Redis
 *   handle; the only zrem* in the file was the zremrangebyscore PRUNE inside
 *   updateInstanceSet() (was ~:262), never a ZREM of self. A gracefully stopped
 *   instance therefore stayed in `omnivyra:cron:instances` until TTL pruning,
 *   and duplicate detection — which only asks "is any member scored newer than
 *   now − INSTANCE_TTL_MS?" — could not distinguish a predecessor that exited
 *   seconds ago from a genuinely live second scheduler.
 *
 *   INSTANCE_TTL_MS (15 min) numerically EQUALS the default CRON_INTERVAL_MS
 *   (cron.ts :152, CRON_INTERVAL_SECONDS ?? 900), which is why the co-located
 *   worker warned exactly once. That equality is coincidence: Dockerfile.cron
 *   sets CRON_INTERVAL_SECONDS=60, so the standalone cron service would warn
 *   every 60 s for 15 minutes after every rollout.
 *
 * THE FIX, and what these tests hold it to:
 *   - deregister() issues a real ZREM of self, bounded and unref'd, never
 *     throws, and returns false rather than claiming success.
 *   - a `deregistered` latch stops any later heartbeat or in-flight cycle from
 *     re-adding the instance.
 *   - cron.ts awaits deregister() immediately BEFORE shutdown(), which nulls
 *     the Redis handle.
 *   - the detector is NOT muted: a genuinely live second instance is still
 *     reported. That is the critical regression guard.
 *
 * The FakeRedis harness is the one introduced by the 3AH-137 characterization
 * commit (c44e8dfb, cherry-picked onto this branch), extended here with
 * injectable zrem failure/hang behaviour.
 */
import fs from 'fs';
import path from 'path';

const REPO = path.resolve(__dirname, '../../..');
const read = (rel: string) => fs.readFileSync(path.join(REPO, rel), 'utf8');
/** Strip block and line comments so prose can never satisfy a code assertion. */
const strip = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

/** 15 minutes — INSTANCE_TTL_MS in cronInstrumentation.ts. */
const INSTANCE_TTL_MS = 15 * 60 * 1_000;
/** 5 minutes — HEARTBEAT_MS in cronInstrumentation.ts. */
const HEARTBEAT_MS = 5 * 60_000;
/** 2 seconds — DEREGISTER_TIMEOUT_MS in cronInstrumentation.ts. */
const DEREGISTER_TIMEOUT_MS = 2_000;
const INSTANCE_KEY = 'omnivyra:cron:instances';

class FakeRedis {
  zset = new Map<string, number>();
  kv = new Map<string, string>();
  zremCalls: Array<[string, string]> = [];
  /** null = behave normally; otherwise the ZREM rejects or never settles. */
  zremMode: 'ok' | 'reject' | 'hang' = 'ok';

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

  zrem(key: string, member: string): Promise<number> {
    this.zremCalls.push([key, member]);
    if (this.zremMode === 'reject') return Promise.reject(new Error('READONLY replica'));
    if (this.zremMode === 'hang') return new Promise<number>(() => { /* never settles */ });
    return Promise.resolve(this.zset.delete(member) ? 1 : 0);
  }

  async set(k: string, v: string): Promise<'OK'> { this.kv.set(k, v); return 'OK'; }
}

let mockRedis: FakeRedis | null;
jest.mock('../../queue/standaloneRedisClient', () => ({
  getInstrumentedStandaloneRedisClient: () => {
    if (!mockRedis) throw new Error('redis unavailable');
    return mockRedis;
  },
}));

import { CronInstrumentation } from '../../utils/cronInstrumentation';

const T0 = new Date('2026-09-20T09:00:00Z').getTime();
const OLD = 'container-old:1';
const NEW = 'container-new:1';

/** Drain the microtask queue so the fire-and-forget persistAsync() settles. */
async function flush(): Promise<void> {
  for (let i = 0; i < 30; i++) await Promise.resolve();
}

function duplicateWarnings(warn: jest.SpyInstance): string[] {
  return warn.mock.calls
    .map((args) => String(args[0]))
    .filter((line) => line.includes('DUPLICATE INSTANCES DETECTED'));
}

describe('3AH-142 — cron instance self-deregistration (runtime)', () => {
  let warn: jest.SpyInstance;
  let info: jest.SpyInstance;
  let log: jest.SpyInstance;
  const created: CronInstrumentation[] = [];

  beforeEach(() => {
    mockRedis = new FakeRedis();
    warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    info = jest.spyOn(console, 'info').mockImplementation(() => {});
    log = jest.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    for (const instance of created.splice(0)) instance.shutdown();
    warn.mockRestore();
    info.mockRestore();
    log.mockRestore();
    jest.useRealTimers();
  });

  function newInstance(id: string): CronInstrumentation {
    const instance = new CronInstrumentation(id);
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

  // ── 1. Successful self-deregistration ───────────────────────────────────────

  it('deregister() ZREMs this instance from the registry and reports success', async () => {
    const instance = newInstance(OLD);
    await cycleAt(instance, T0);
    expect(mockRedis!.zset.has(OLD)).toBe(true);

    await expect(instance.deregister()).resolves.toBe(true);

    expect(mockRedis!.zremCalls).toEqual([[INSTANCE_KEY, OLD]]);
    expect(mockRedis!.zset.has(OLD)).toBe(false);
    expect(String(info.mock.calls.at(-1)?.[0])).toContain('deregistered (graceful shutdown');
  });

  // ── 2. THE REGRESSION GUARD — the detector is not muted ─────────────────────

  it('CRITICAL: a genuinely LIVE second instance is still detected as a duplicate', async () => {
    // Two schedulers running concurrently. Neither has deregistered.
    const live = newInstance(OLD);
    await cycleAt(live, T0);

    const second = newInstance(NEW);
    await cycleAt(second, T0 + 1_000);

    const warnings = duplicateWarnings(warn);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain(OLD);
    expect(warnings[0]).toContain(NEW);
    // Both are still registered — the fix removes only instances that say so.
    expect(mockRedis!.zset.has(OLD)).toBe(true);
    expect(mockRedis!.zset.has(NEW)).toBe(true);
  });

  it('CRITICAL: a live peer is still detected even after THIS instance deregisters', async () => {
    const peer = newInstance(OLD);
    await cycleAt(peer, T0);

    const second = newInstance(NEW);
    await cycleAt(second, T0 + 1_000);
    warn.mockClear();

    // The *observer* leaving must not blind a later observer to the live peer.
    await second.deregister();
    const third = newInstance('container-third:1');
    await cycleAt(third, T0 + 2_000);

    const warnings = duplicateWarnings(warn);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain(OLD);
    expect(warnings[0]).not.toContain(NEW);
  });

  // ── 3. The defect itself: a gracefully stopped predecessor ──────────────────

  it('a predecessor that shut down gracefully no longer reads as a duplicate', async () => {
    const predecessor = newInstance(OLD);
    await cycleAt(predecessor, T0);
    await predecessor.deregister();
    predecessor.shutdown();
    warn.mockClear();

    const successor = newInstance(NEW);
    await cycleAt(successor, T0 + 60_000);

    expect(duplicateWarnings(warn)).toEqual([]);
    expect(successor.buildReport().duplicateInstances).toEqual([]);
  });

  it('an ABNORMALLY terminated predecessor is still reported (TTL, unchanged)', async () => {
    // No deregister() — the process was SIGKILLed. Pre-fix behaviour is kept
    // deliberately: a crash must never be recorded as a clean exit.
    mockRedis!.zset.set(OLD, T0 - 60_000);

    const successor = newInstance(NEW);
    await cycleAt(successor, T0);

    expect(duplicateWarnings(warn)).toHaveLength(1);
    expect(duplicateWarnings(warn)[0]).toContain(OLD);
  });

  it('the stale entry still ages out at the INSTANCE_TTL_MS boundary', async () => {
    mockRedis!.zset.set(OLD, T0);
    const successor = newInstance(NEW);
    await cycleAt(successor, T0 + INSTANCE_TTL_MS);
    expect(duplicateWarnings(warn)).toEqual([]);
    expect(mockRedis!.zset.has(OLD)).toBe(false);
  });

  // ── 4. The latch ────────────────────────────────────────────────────────────

  it('the heartbeat cannot re-add the instance after deregistration', async () => {
    jest.useFakeTimers({ now: T0 });
    const instance = new CronInstrumentation(OLD);
    created.push(instance);

    jest.advanceTimersByTime(HEARTBEAT_MS);
    await flush();
    expect(mockRedis!.zset.has(OLD)).toBe(true);

    await instance.deregister();
    expect(mockRedis!.zset.has(OLD)).toBe(false);

    // Several more heartbeat windows go by.
    jest.advanceTimersByTime(HEARTBEAT_MS * 3);
    await flush();

    expect(mockRedis!.zset.has(OLD)).toBe(false);
  });

  it('a cycle that lands after deregistration cannot re-add the instance either', async () => {
    const instance = newInstance(OLD);
    await cycleAt(instance, T0);
    await instance.deregister();

    await cycleAt(instance, T0 + 1_000);

    expect(mockRedis!.zset.has(OLD)).toBe(false);
    expect(duplicateWarnings(warn)).toEqual([]);
  });

  // ── 5. Failure is bounded and non-fatal ─────────────────────────────────────

  it('a rejecting ZREM returns false, warns honestly, and does not throw', async () => {
    const instance = newInstance(OLD);
    await cycleAt(instance, T0);
    mockRedis!.zremMode = 'reject';

    await expect(instance.deregister()).resolves.toBe(false);

    const failures = warn.mock.calls
      .map((args) => String(args[0]))
      .filter((line) => line.includes('deregistration failed'));
    expect(failures).toHaveLength(1);
    expect(failures[0]).toContain('entry expires via TTL');
    // The entry is left behind, exactly as in the pre-fix world.
    expect(mockRedis!.zset.has(OLD)).toBe(true);
    // The latch still holds: a half-failed shutdown must not keep heartbeating.
    expect(mockRedis!.zremCalls).toHaveLength(1);
  });

  it('a hanging ZREM is bounded by DEREGISTER_TIMEOUT_MS and resolves false', async () => {
    const instance = newInstance(OLD);
    await cycleAt(instance, T0);
    mockRedis!.zremMode = 'hang';

    jest.useFakeTimers();
    const pending = instance.deregister();
    // Nothing has settled before the budget elapses.
    await Promise.resolve();
    jest.advanceTimersByTime(DEREGISTER_TIMEOUT_MS);

    await expect(pending).resolves.toBe(false);
    const failures = warn.mock.calls
      .map((args) => `${args[0]} ${args[1]}`)
      .filter((line) => line.includes('deregistration failed'));
    expect(failures).toHaveLength(1);
    expect(failures[0]).toContain(`timed out after ${DEREGISTER_TIMEOUT_MS}ms`);
  });

  // ── 6. Redis unavailable ────────────────────────────────────────────────────

  it('an instance constructed with no Redis client deregisters to false, not a throw', async () => {
    mockRedis = null;
    const instance = new CronInstrumentation(OLD);
    created.push(instance);

    await expect(instance.deregister()).resolves.toBe(false);
    expect(String(warn.mock.calls.at(-1)?.[0])).toContain('no Redis client');
    // And the normal shutdown path after it is still a no-throw.
    expect(() => instance.shutdown()).not.toThrow();
  });

  it('deregister() after shutdown() (wrong order) is safe but reports false', async () => {
    const instance = newInstance(OLD);
    await cycleAt(instance, T0);
    instance.shutdown();           // nulls the Redis handle …

    await expect(instance.deregister()).resolves.toBe(false);
    expect(mockRedis!.zremCalls).toEqual([]);   // … so no ZREM is possible.
    // This is exactly why cron.ts must deregister BEFORE shutdown().
  });

  // ── Identity injection ──────────────────────────────────────────────────────

  it('instanceId defaults to the process identity and is only overridden explicitly', () => {
    const def = new CronInstrumentation();
    created.push(def);
    expect(def.instanceId).toMatch(/^.+:\d+$/);
    expect(def.instanceId).toContain(`:${process.pid}`);
    expect(newInstance(OLD).instanceId).toBe(OLD);
  });
});

describe('3AH-142 — shutdown wiring and SEC-C6 ownership (source contract)', () => {
  const cronSrc = read('backend/scheduler/cron.ts');
  const cron = strip(cronSrc);
  const main = strip(read('backend/workers/main.ts'));
  const instr = strip(read('backend/utils/cronInstrumentation.ts'));
  const shutdownStart = cron.indexOf('const shutdown = async (signal: string) =>');
  const shutdownBody = cron.slice(shutdownStart, cron.indexOf("process.on('SIGTERM'", shutdownStart));

  // ── 9. Shutdown ordering ────────────────────────────────────────────────────

  it('cron.ts awaits deregister() BEFORE shutdown() nulls the Redis handle', () => {
    expect(shutdownStart).toBeGreaterThan(-1);
    const deregisterAt = shutdownBody.indexOf('await cronInstr.deregister();');
    const shutdownAt = shutdownBody.indexOf('cronInstr.shutdown();');
    expect(deregisterAt).toBeGreaterThan(-1);
    expect(shutdownAt).toBeGreaterThan(-1);
    expect(deregisterAt).toBeLessThan(shutdownAt);
  });

  it('deregister() is the ONLY ZREM of self, and shutdown() still issues none', () => {
    const shutdownMethod = instr.slice(instr.indexOf('  shutdown(): void {'));
    expect(shutdownMethod).not.toMatch(/\bzrem\b/);
    const deregisterMethod = instr.slice(
      instr.indexOf('  async deregister(): Promise<boolean> {'),
      instr.indexOf('  shutdown(): void {'),
    );
    expect(deregisterMethod).toContain('this.redis.zrem(INSTANCE_KEY, this.instanceId)');
  });

  it('the ZREM is bounded and its timer is unref\'d so it cannot hold the process open', () => {
    expect(instr).toContain('const DEREGISTER_TIMEOUT_MS = 2_000;');
    const deregisterMethod = instr.slice(instr.indexOf('  async deregister(): Promise<boolean> {'));
    expect(deregisterMethod).toContain('DEREGISTER_TIMEOUT_MS');
    expect(deregisterMethod).toContain('if (timer.unref) timer.unref();');
    expect(deregisterMethod).toContain('Promise.race');
    // 2 s sits inside the drain budget: ≤15 s drain + three 3 s post-drain
    // steps, under a 25 s hard-exit backstop.
    expect(DEREGISTER_TIMEOUT_MS).toBeLessThan(3_000);
  });

  // ── 10. SEC-C6 signal ownership ─────────────────────────────────────────────

  it('SEC-C6 holds: the scheduler exits only when it owns shutdown', () => {
    expect(cron).toMatch(/async function startCron\(\s*opts:\s*\{\s*hostOwnsShutdown\?:\s*boolean\s*\}\s*=\s*\{\}\s*\)/);
    const exits = [...shutdownBody.matchAll(/process\.exit\(/g)].map((m) => m.index as number);
    expect(exits.length).toBeGreaterThan(0);
    for (const at of exits) {
      expect(shutdownBody.slice(Math.max(0, at - 160), at)).toMatch(/if\s*\(\s*!opts\.hostOwnsShutdown\s*\)/);
    }
  });

  // ── 8. Embedded cron ────────────────────────────────────────────────────────

  it('the worker still hosts the scheduler with hostOwnsShutdown: true', () => {
    expect(main).toMatch(/startCron\(\{\s*hostOwnsShutdown:\s*true\s*\}\)/);
  });

  // ── 7. Standalone cron ──────────────────────────────────────────────────────

  it('standalone cron.ts keeps the default (it owns its own exit)', () => {
    expect(cron).toMatch(/if \(require\.main === module\) \{\s*startCron\(\)\.catch/);
    expect(read('instrumentation.node.ts')).toMatch(/startCron\(\)\.catch/);
  });

  // ── 11. No duplicate signal owner ───────────────────────────────────────────

  it('cron registers exactly one SIGTERM and one SIGINT handler, and main owns the exit', () => {
    expect([...cron.matchAll(/process\.on\('SIGTERM'/g)]).toHaveLength(1);
    expect([...cron.matchAll(/process\.on\('SIGINT'/g)]).toHaveLength(1);
    expect([...main.matchAll(/process\.on\('SIGTERM'/g)]).toHaveLength(1);
    expect([...main.matchAll(/process\.on\('SIGINT'/g)]).toHaveLength(1);
    expect(main).toContain('const onSignal = once(shutdown);');
  });

  it('SEC-C6 is not inverted: no startEmbeddedCron / cronOwnsProcessSignals', () => {
    for (const src of [cronSrc, read('backend/workers/main.ts')]) {
      expect(src).not.toContain('startEmbeddedCron');
      expect(src).not.toContain('cronOwnsProcessSignals');
    }
  });

  it('no startup grace window was introduced as a substitute for deregistration', () => {
    // 977e8aed used a 3-minute STARTUP_GRACE_MS. 3 min < the 15-minute TTL, so
    // a CRASHED predecessor still warns — it defers the false positive instead
    // of removing it. Deliberately not adopted.
    expect(read('backend/utils/cronInstrumentation.ts')).not.toContain('STARTUP_GRACE_MS');
  });

  // ── 12. Worker shutdown handle set is untouched ─────────────────────────────

  it('cron was NOT added to shutdownConsumers — the handle set stays queue-only', () => {
    const consumers = main.slice(
      main.indexOf('const shutdownConsumers = (): ShutdownConsumer[] => ['),
      main.indexOf('const shutdown = async (signal: string) =>'),
    );
    expect(consumers.length).toBeGreaterThan(0);
    expect(consumers).not.toMatch(/cron/i);
    expect(main).not.toContain('cronInstr');
    // The 25 s hard-exit backstop and the capped post-drain steps are unchanged.
    expect(main).toContain('}, drainDeadlineMs + 10_000);');
    expect(main).toContain("closeWithin('connection close', POST_DRAIN_STEP_TIMEOUT_MS");
  });
});
