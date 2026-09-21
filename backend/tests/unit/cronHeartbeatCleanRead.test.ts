/**
 * 3AH-173 — a CLEAN heartbeat registry read is now positively observable.
 *
 * The heartbeat's duplicate line (3AH-169) only fires when peers exist, so a
 * clean rollout left nothing to see: silence could not prove a read happened.
 * The heartbeat now logs, for its first CLEAN_READ_LOG_LIMIT (3) clean reads:
 *
 *   [cron] HEARTBEAT REGISTRY READ: clean (this instance: <id>) [source=heartbeat]
 *
 * `updateInstanceSet()` returns `[]` both for "read, no peers" AND for
 * "read skipped" (no Redis / deregistered). These tests pin that the clean line
 * appears only when a read really ran, and that registry behaviour is unchanged.
 */
export {};

class EventRedis {
  zset = new Map<string, number>();
  log: string[] = [];
  reads = 0;
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
    this.reads++;
    this.log.push('READ');
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
const CLEAN = `[cron] HEARTBEAT REGISTRY READ: clean (this instance: ${ID}) [source=heartbeat]`;
const DUP = 'DUPLICATE INSTANCES DETECTED';
const flush = async (n = 10) => { for (let i = 0; i < n; i++) await new Promise((r) => setImmediate(r)); };

let info: jest.SpyInstance;
let warn: jest.SpyInstance;
let instr: any;

beforeEach(() => {
  jest.useFakeTimers({ doNotFake: ['nextTick', 'queueMicrotask', 'setImmediate'] });
  R = new EventRedis();
  info = jest.spyOn(console, 'info').mockImplementation((m: unknown) => { R?.log.push(`INFO:${String(m)}`); });
  warn = jest.spyOn(console, 'warn').mockImplementation((m: unknown) => { R?.log.push(`WARN:${String(m)}`); });
});

afterEach(() => {
  instr?.shutdown();
  instr = null;
  info.mockRestore();
  warn.mockRestore();
  jest.useRealTimers();
  R = null;
});

const cleanLines = () => info.mock.calls.map((c) => String(c[0])).filter((m) => m.includes('HEARTBEAT REGISTRY READ'));
const dupLines = () => warn.mock.calls.map((c) => String(c[0])).filter((m) => m.includes(DUP));
const beat = async () => { jest.advanceTimersByTime(HEARTBEAT_MS); await flush(); };

describe('3AH-173 — clean heartbeat registry read signal', () => {
  it('1+3. a clean heartbeat read emits the exact line, naming this instance', async () => {
    instr = new CronInstrumentation(ID);
    await beat();
    expect(cleanLines()).toEqual([CLEAN]);
  });

  it('2. a heartbeat that finds a peer keeps the duplicate warning and emits NO clean line', async () => {
    R!.zset.set('predecessor:1', Date.now());
    instr = new CronInstrumentation(ID);
    await beat();
    expect(dupLines()).toEqual([
      `[cron] ⚠️  DUPLICATE INSTANCES DETECTED: predecessor:1 (this instance: ${ID}) [source=heartbeat]`,
    ]);
    expect(cleanLines()).toEqual([]);
  });

  it('4. the clean line is emitted only after the write AND the read completed', async () => {
    instr = new CronInstrumentation(ID);
    await beat();
    const log = R!.log;
    expect(log.indexOf(`ZADD:${ID}`)).toBeGreaterThanOrEqual(0);
    expect(log.indexOf('READ')).toBeGreaterThan(log.indexOf(`ZADD:${ID}`));
    expect(log.indexOf(`INFO:${CLEAN}`)).toBeGreaterThan(log.indexOf('READ'));
  });

  it('5. registry contents are unchanged by the signal', async () => {
    R!.zset.set('long-gone:1', Date.now() - 16 * 60_000);
    instr = new CronInstrumentation(ID);
    await beat();
    expect([...R!.zset.keys()]).toEqual([ID]);
    expect(R!.log.filter((e) => !e.startsWith('INFO:'))).toEqual([`ZADD:${ID}`, 'PRUNE:long-gone:1', 'READ']);
  });

  it('6+7. serialization intact: a parked heartbeat write completes before the ZREM', async () => {
    instr = new CronInstrumentation(ID);
    R!.hold();
    jest.advanceTimersByTime(HEARTBEAT_MS);
    await flush();
    const d = instr.deregister();
    await flush();
    expect(R!.log.some((e) => e.startsWith('ZREM'))).toBe(false);
    R!.let();
    await flush();
    expect(await d).toBe(true);
    expect(R!.log.filter((e) => /^(ZADD|ZREM):/.test(e))).toEqual([`ZADD:${ID}`, `ZREM:${ID}`]);
  });

  it('8. a read SKIPPED by the deregistration latch never produces a clean line', async () => {
    instr = new CronInstrumentation(ID);
    // Heartbeat #1 parks mid-write; heartbeat #2 queues behind it; then deregister.
    R!.hold();
    jest.advanceTimersByTime(HEARTBEAT_MS);
    await flush();
    jest.advanceTimersByTime(HEARTBEAT_MS);
    await flush();
    const d = instr.deregister();
    R!.let();
    await flush();
    expect(await d).toBe(true);
    await beat();
    // #1 read before the latch, #2 was refused by it; nothing after deregistration is "clean".
    expect(R!.reads).toBe(1);
    expect(cleanLines()).toEqual([]);
  });

  it('   a heartbeat after deregistration performs no registry op and emits nothing', async () => {
    instr = new CronInstrumentation(ID);
    expect(await instr.deregister()).toBe(true);
    const before = R!.log.length;
    await beat(); await beat();
    expect(R!.log.slice(before)).toEqual([]);
    expect(cleanLines()).toEqual([]);
  });

  it('   a read aborted by shutdown() (Redis handle nulled mid-op) emits nothing', async () => {
    instr = new CronInstrumentation(ID);
    R!.hold();
    jest.advanceTimersByTime(HEARTBEAT_MS);
    await flush();
    instr.shutdown();
    R!.let();
    await flush();
    expect(cleanLines()).toEqual([]);
  });

  it('9. a throwing logger breaks neither the timer, the registry, nor deregistration', async () => {
    const unhandled: unknown[] = [];
    const onUnhandled = (e: unknown) => unhandled.push(e);
    process.on('unhandledRejection', onUnhandled);
    try {
      // Only the clean-read line throws. (A globally throwing console.info also
      // fails deregister()'s own success log — pre-existing on main, not this change.)
      info.mockImplementation((m: unknown) => {
        if (String(m).includes('HEARTBEAT REGISTRY READ')) throw new Error('logger down');
        R?.log.push(`INFO:${String(m)}`);
      });
      instr = new CronInstrumentation(ID);
      await beat(); await beat();
      expect(R!.log.filter((e) => e === `ZADD:${ID}`)).toHaveLength(2);
      expect(await instr.deregister()).toBe(true);
      expect(R!.zset.has(ID)).toBe(false);
      await flush();
      expect(unhandled).toEqual([]);
    } finally {
      process.off('unhandledRejection', onUnhandled);
    }
  });

  it('10. the clean line stops after 3; duplicate warnings are not capped', async () => {
    instr = new CronInstrumentation(ID);
    for (let i = 0; i < 6; i++) await beat();
    expect(cleanLines()).toHaveLength(3);
    expect(R!.reads).toBe(6); // the heartbeat itself keeps running
    R!.zset.set('late-peer:1', Date.now());
    await beat();
    expect(dupLines()).toHaveLength(1);
    expect(cleanLines()).toHaveLength(3);
  });

  it('   duplicate reads do not consume the clean-read budget', async () => {
    R!.zset.set('predecessor:1', Date.now());
    instr = new CronInstrumentation(ID);
    await beat(); await beat();
    R!.zset.delete('predecessor:1');
    for (let i = 0; i < 4; i++) await beat();
    expect(dupLines()).toHaveLength(2);
    expect(cleanLines()).toHaveLength(3);
  });

  it('11. the cycle path is byte-identical and never emits the clean line', async () => {
    R!.zset.set('peer:2', Date.now());
    instr = new CronInstrumentation(ID);
    instr.cycleStart();
    instr.cycleEnd([]);
    await flush();
    expect(dupLines()).toEqual([`[cron] ⚠️  DUPLICATE INSTANCES DETECTED: peer:2 (this instance: ${ID})`]);
    R!.zset.delete('peer:2');
    instr.cycleStart();
    instr.cycleEnd([]);
    await flush();
    expect(cleanLines()).toEqual([]);
  });

  it('12. exactly ONE registry read per heartbeat — no second reader', async () => {
    instr = new CronInstrumentation(ID);
    await beat();
    expect(R!.reads).toBe(1);
    await beat(); await beat();
    expect(R!.reads).toBe(3);
  });
});
