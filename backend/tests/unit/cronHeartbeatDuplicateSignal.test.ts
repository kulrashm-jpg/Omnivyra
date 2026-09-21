/**
 * 3AH-169 — the heartbeat now REPORTS the duplicate state it already computes.
 *
 * Production ticks the cron cycle every 30 min while the registry window is
 * 15 min, so the cycle path's duplicate warning can't catch an entry re-added
 * after a rollout: the next cycle runs after that entry has aged out. The
 * heartbeat (every 5 min) already read the registry but discarded the result.
 * It now logs the same line, tagged `[source=heartbeat]`.
 *
 * Observational only: the tests pin that the registry operations, their
 * serialization, deregistration ordering and the cycle-path message are all
 * unchanged.
 */

export {};

class EventRedis {
  zset = new Map<string, number>();
  log: string[] = [];
  private release: (() => void) | null = null;
  private holdNext = false;
  hold() { this.holdNext = true; }
  let() { const r = this.release; this.release = null; r?.(); }
  pipeline(): any {
    const ops: Array<() => void> = [];
    const p: any = {
      zadd: (_k: string, s: number, m: string) => { ops.push(() => { this.zset.set(m, s); this.log.push(`ZADD:${m}`); }); return p; },
      zremrangebyscore: (_k: string, _a: string, max: number) => {
        ops.push(() => { for (const [m, s] of [...this.zset]) if (s <= max) { this.zset.delete(m); this.log.push(`PRUNE:${m}`); } });
        return p;
      },
      expire: () => p, set: () => p, lpush: () => p, ltrim: () => p,
      exec: async () => {
        if (this.holdNext) { this.holdNext = false; await new Promise<void>((r) => { this.release = r; }); }
        ops.forEach((o) => o());
        return [];
      },
    };
    return p;
  }
  async zrangebyscore(_k: string, min: number) {
    return [...this.zset].filter(([, s]) => s >= min).sort((a, b) => a[1] - b[1]).map(([m]) => m);
  }
  zrem(_k: string, m: string): Promise<number> {
    this.log.push(`ZREM:${m}`);
    return Promise.resolve(this.zset.delete(m) ? 1 : 0);
  }
}

let R: EventRedis | null = null;
jest.mock('../../queue/standaloneRedisClient', () => ({
  getInstrumentedStandaloneRedisClient: () => { if (!R) throw new Error('no redis'); return R; },
}));
const { CronInstrumentation } = require('../../utils/cronInstrumentation');

const ID = 'incoming-host:1';
const HEARTBEAT_MS = 5 * 60_000;
const TTL_MS = 15 * 60_000;
const DUP = 'DUPLICATE INSTANCES DETECTED';
const flush = async (n = 10) => { for (let i = 0; i < n; i++) await new Promise((r) => setImmediate(r)); };

let warn: jest.SpyInstance;
let instr: any;

beforeEach(() => {
  jest.useFakeTimers({ doNotFake: ['nextTick', 'queueMicrotask', 'setImmediate'] });
  R = new EventRedis();
  // Record warnings INTO the Redis event log so ordering is observable.
  warn = jest.spyOn(console, 'warn').mockImplementation((msg: unknown) => { R?.log.push(`WARN:${String(msg)}`); });
});

afterEach(() => {
  instr?.shutdown();
  instr = null;
  warn.mockRestore();
  jest.useRealTimers();
  R = null;
});

const dupWarnings = () => warn.mock.calls.map((c) => String(c[0])).filter((m) => m.includes(DUP));
const beat = async () => { jest.advanceTimersByTime(HEARTBEAT_MS); await flush(); };

describe('3AH-169 — heartbeat duplicate signal', () => {
  it('1. a live peer seen by the heartbeat emits exactly one deterministic line', async () => {
    R!.zset.set('stale-predecessor:1', Date.now());
    instr = new CronInstrumentation(ID);
    await beat();
    expect(dupWarnings()).toEqual([
      '[cron] ⚠️  DUPLICATE INSTANCES DETECTED: stale-predecessor:1 (this instance: incoming-host:1) [source=heartbeat]',
    ]);
  });

  it('2. no peer → no duplicate line (and none on repeated heartbeats)', async () => {
    instr = new CronInstrumentation(ID);
    await beat(); await beat(); await beat();
    expect(dupWarnings()).toEqual([]);
    expect(R!.log.filter((e) => e === `ZADD:${ID}`)).toHaveLength(3); // the heartbeats did run
  });

  it('3. several peers → ONE consolidated line naming each, in registry order', async () => {
    const now = Date.now();
    R!.zset.set('peer-a:1', now - 2_000);
    R!.zset.set('peer-b:1', now - 1_000);
    instr = new CronInstrumentation(ID);
    await beat();
    expect(dupWarnings()).toEqual([
      '[cron] ⚠️  DUPLICATE INSTANCES DETECTED: peer-a:1, peer-b:1 (this instance: incoming-host:1) [source=heartbeat]',
    ]);
  });

  it('   entries older than the registry window are pruned, not reported (duplicate semantics unchanged)', async () => {
    R!.zset.set('long-gone:1', Date.now() - TTL_MS - 60_000);
    instr = new CronInstrumentation(ID);
    await beat();
    expect(dupWarnings()).toEqual([]);
    expect(R!.log).toContain('PRUNE:long-gone:1');
  });

  it('4. the cycle-path duplicate line is byte-identical to before (no source tag)', async () => {
    R!.zset.set('peer:2', Date.now());
    instr = new CronInstrumentation(ID);
    instr.cycleStart();
    instr.cycleEnd([]);
    await flush();
    expect(dupWarnings()).toEqual([
      '[cron] ⚠️  DUPLICATE INSTANCES DETECTED: peer:2 (this instance: incoming-host:1)',
    ]);
  });

  it('5. logging observes the finished registry write — it does not change it', async () => {
    R!.zset.set('peer:2', Date.now());
    instr = new CronInstrumentation(ID);
    await beat();
    // ZADD + prune happened, THEN the warning: the log line reads a completed result.
    const zadd = R!.log.indexOf(`ZADD:${ID}`);
    const line = R!.log.findIndex((e) => e.startsWith('WARN:') && e.includes(DUP));
    expect(zadd).toBeGreaterThanOrEqual(0);
    expect(line).toBeGreaterThan(zadd);
    expect([...R!.zset.keys()].sort()).toEqual(['incoming-host:1', 'peer:2']);
  });

  it('6. a throwing logger cannot break the heartbeat or the registry', async () => {
    const unhandled: unknown[] = [];
    const onUnhandled = (e: unknown) => unhandled.push(e);
    process.on('unhandledRejection', onUnhandled);
    try {
      warn.mockImplementation(() => { throw new Error('logger down'); });
      R!.zset.set('peer:2', Date.now());
      instr = new CronInstrumentation(ID);
      await beat();
      await beat();
      // Both heartbeats still wrote; the timer survived the throwing logger.
      expect(R!.log.filter((e) => e === `ZADD:${ID}`)).toHaveLength(2);
      expect(R!.zset.has(ID)).toBe(true);
      expect(await instr.deregister()).toBe(true);
      expect(R!.zset.has(ID)).toBe(false);
      await flush();
      expect(unhandled).toEqual([]);
    } finally {
      process.off('unhandledRejection', onUnhandled);
    }
  });

  it('7. serialization intact: a parked heartbeat write still completes BEFORE the ZREM', async () => {
    R!.zset.set('peer:2', Date.now());
    instr = new CronInstrumentation(ID);
    R!.hold();
    jest.advanceTimersByTime(HEARTBEAT_MS);
    await flush();
    const d = instr.deregister();
    await flush();
    expect(R!.log.some((e) => e.startsWith('ZREM'))).toBe(false); // ZREM queued behind the parked op
    R!.let();
    await flush();
    expect(await d).toBe(true);
    const ops = R!.log.filter((e) => /^(ZADD|ZREM):incoming/.test(e));
    expect(ops).toEqual([`ZADD:${ID}`, `ZREM:${ID}`]);
    expect(R!.zset.has(ID)).toBe(false);
  });

  it('8. after deregistration the heartbeat neither writes nor reports', async () => {
    R!.zset.set('peer:2', Date.now());
    instr = new CronInstrumentation(ID);
    expect(await instr.deregister()).toBe(true);
    const before = R!.log.length;
    await beat(); await beat();
    expect(R!.log.slice(before)).toEqual([]); // no ZADD, no warning
    expect(R!.zset.has(ID)).toBe(false);
  });
});
