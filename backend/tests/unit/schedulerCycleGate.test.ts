/**
 * Scheduler cycle gate — shutdown-safe lifecycle of ONE scheduler cycle.
 *
 * Behavioural, deterministic: cycles are controlled promises; the only timer is
 * the stop() bound, driven with fake timers. The lock-policy cases run the
 * REAL CronGuard over a fake Redis client, so the fail-open / fail-closed
 * decision is the production one, not a stand-in.
 */
import { EventEmitter } from 'events';
import { createCycleGate, DEFAULT_CYCLE_STOP_BOUND_MS } from '../../scheduler/schedulerCycleGate';

type FakeClient = EventEmitter & { status: string; set: jest.Mock; get: jest.Mock; eval: jest.Mock };
let client: FakeClient | null = null;
function makeClient(status: string): FakeClient {
  const c = new EventEmitter() as FakeClient;
  c.status = status;
  c.set = jest.fn();
  c.get = jest.fn().mockResolvedValue(null);
  c.eval = jest.fn().mockResolvedValue(1);
  return c;
}
jest.mock('../../queue/standaloneRedisClient', () => ({
  getInstrumentedStandaloneRedisClient: () => client,
  getSharedStandaloneRedisClient: () => client,
  isSharedStandaloneRedisAvailable: () => client?.status === 'ready',
}));
// eslint-disable-next-line import/first
import { CronGuard } from '../../utils/cronGuard';

function deferred<T = void>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

const logs: Array<{ event: string; detail?: Record<string, unknown> }> = [];
const log = (event: string, detail?: Record<string, unknown>) => { logs.push({ event, detail }); };
const flush = () => new Promise<void>((r) => setImmediate(r));

const OLD_FAIL_CLOSED = process.env.CRON_LOCK_FAIL_CLOSED;
beforeEach(() => {
  logs.length = 0;
  client = null;
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
  jest.spyOn(console, 'info').mockImplementation(() => {});
});
afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
  if (OLD_FAIL_CLOSED === undefined) delete process.env.CRON_LOCK_FAIL_CLOSED;
  else process.env.CRON_LOCK_FAIL_CLOSED = OLD_FAIL_CLOSED;
});

describe('cycle lock lifecycle', () => {
  it('a cycle that runs acquires once and releases once', async () => {
    const acquire = jest.fn(async () => true);
    const release = jest.fn(async () => undefined);
    const body = jest.fn(async () => undefined);
    const gate = createCycleGate({ acquire, release, log });
    await expect(gate.run(body)).resolves.toBe('ran');
    expect(acquire).toHaveBeenCalledTimes(1);
    expect(body).toHaveBeenCalledTimes(1);
    expect(release).toHaveBeenCalledTimes(1);
    expect(gate.isCycleInFlight()).toBe(false);
  });

  it('a cycle that THROWS still releases the lock (finally), and the error still reaches the caller', async () => {
    const release = jest.fn(async () => undefined);
    const gate = createCycleGate({ acquire: async () => true, release, log });
    await expect(gate.run(async () => { throw new Error('token refresh exploded'); }))
      .rejects.toThrow('token refresh exploded');
    expect(release).toHaveBeenCalledTimes(1);
    expect(gate.isCycleInFlight()).toBe(false);
    // …and the next cycle is not blocked by a stale in-flight marker.
    await expect(gate.run(async () => undefined)).resolves.toBe('ran');
  });

  it('a lock held elsewhere skips the cycle and never releases a lock it does not hold', async () => {
    const release = jest.fn(async () => undefined);
    const body = jest.fn(async () => undefined);
    const gate = createCycleGate({ acquire: async () => false, release, log });
    await expect(gate.run(body)).resolves.toBe('skipped_lock_held');
    expect(body).not.toHaveBeenCalled();
    expect(release).not.toHaveBeenCalled();
  });

  it('an acquisition that THROWS skips the cycle explicitly (no body, no release) and says so', async () => {
    const release = jest.fn(async () => undefined);
    const body = jest.fn(async () => undefined);
    const gate = createCycleGate({ acquire: async () => { throw new Error('ECONNRESET'); }, release, log });
    await expect(gate.run(body)).resolves.toBe('skipped_lock_error');
    expect(body).not.toHaveBeenCalled();
    expect(release).not.toHaveBeenCalled();
    expect(logs).toEqual([{ event: 'cycle_skipped_lock_error', detail: { error: 'ECONNRESET' } }]);
  });

  it('a release that fails is reported, never thrown — the TTL is the fallback', async () => {
    const gate = createCycleGate({
      acquire: async () => true,
      release: async () => { throw new Error('redis gone'); },
      log,
    });
    await expect(gate.run(async () => undefined)).resolves.toBe('ran');
    expect(logs).toEqual([{
      event: 'cycle_lock_release_failed',
      detail: { error: 'redis gone', fallback: 'lock expires via TTL' },
    }]);
  });

  it('the same process never overlaps itself, even if the cross-instance lock would allow it', async () => {
    const first = deferred();
    const body = jest.fn(() => first.promise);
    const gate = createCycleGate({ acquire: async () => true, release: async () => undefined, log });
    const running = gate.run(body);
    await flush();
    await expect(gate.run(body)).resolves.toBe('skipped_in_flight');
    expect(body).toHaveBeenCalledTimes(1);
    first.resolve();
    await expect(running).resolves.toBe('ran');
  });
});

describe('shutdown coordination', () => {
  it('stop() with nothing in flight is immediate, and no cycle starts afterwards (no acquire, no body)', async () => {
    const acquire = jest.fn(async () => true);
    const body = jest.fn(async () => undefined);
    const gate = createCycleGate({ acquire, release: async () => undefined, log });
    await expect(gate.stop(1_000)).resolves.toBe('idle');
    expect(gate.isStopping()).toBe(true);
    await expect(gate.run(body)).resolves.toBe('skipped_stopping');
    expect(acquire).not.toHaveBeenCalled();
    expect(body).not.toHaveBeenCalled();
  });

  it('stop() waits for the in-flight cycle (e.g. the boot cycle) and the lock is released before it resolves', async () => {
    const cycle = deferred();
    const release = jest.fn(async () => undefined);
    const gate = createCycleGate({ acquire: async () => true, release, log });
    const running = gate.run(() => cycle.promise);
    await flush();

    let stopped: string | null = null;
    const stopping = gate.stop(10_000).then((r) => { stopped = r; });
    await flush();
    expect(stopped).toBeNull();               // still waiting for the cycle
    expect(release).not.toHaveBeenCalled();

    // A new cycle requested DURING the drain never starts.
    await expect(gate.run(async () => undefined)).resolves.toBe('skipped_stopping');

    cycle.resolve();
    await stopping;
    await running;
    expect(stopped).toBe('drained');
    expect(release).toHaveBeenCalledTimes(1);
  });

  it('stop() is bounded: a cycle still running at the bound is reported, not awaited forever', async () => {
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] });
    const release = jest.fn(async () => undefined);
    const gate = createCycleGate({ acquire: async () => true, release, log });
    void gate.run(() => new Promise<void>(() => { /* never settles */ }));
    await flush();

    const stopping = gate.stop(5_000);
    await jest.advanceTimersByTimeAsync(4_999);
    let settled = false;
    void stopping.then(() => { settled = true; });
    await flush();
    expect(settled).toBe(false);
    await jest.advanceTimersByTimeAsync(1);
    await expect(stopping).resolves.toBe('timeout');
    expect(logs).toContainEqual({ event: 'cycle_still_running_at_stop_bound', detail: { boundMs: 5_000 } });
    // The lock was NOT released by stop(): the cycle still owns it (TTL fallback).
    expect(release).not.toHaveBeenCalled();
  });

  it('a shutdown that lands while the lock is being acquired: the cycle does not start and the lock is handed back', async () => {
    const lock = deferred<boolean>();
    const release = jest.fn(async () => undefined);
    const body = jest.fn(async () => undefined);
    const gate = createCycleGate({ acquire: () => lock.promise, release, log });
    const running = gate.run(body);
    await flush();
    const stopping = gate.stop(10_000);
    lock.resolve(true);
    await expect(running).resolves.toBe('skipped_stopping');
    await expect(stopping).resolves.toBe('drained');
    expect(body).not.toHaveBeenCalled();
    expect(release).toHaveBeenCalledTimes(1);
  });

  it('the standalone stop bound is documented as 15 s', () => {
    expect(DEFAULT_CYCLE_STOP_BOUND_MS).toBe(15_000);
  });
});

describe('lock acquisition under the CronGuard policy (real CronGuard, fake Redis)', () => {
  const gateFor = (guard: CronGuard, release = jest.fn(async () => undefined)) => ({
    release,
    gate: createCycleGate({ acquire: () => guard.tryAcquireLock('inst-1'), release, log }),
  });

  it('Redis UNAVAILABLE, default (fail-open, single-replica policy): the cycle runs, loudly', async () => {
    client = makeClient('end');
    const { gate } = gateFor(new CronGuard());
    const body = jest.fn(async () => undefined);
    await expect(gate.run(body)).resolves.toBe('ran');
    expect(body).toHaveBeenCalledTimes(1);
    expect(String((console.warn as jest.Mock).mock.calls[0]?.[0])).toContain('cron_lock_fail_open');
  });

  it('Redis UNAVAILABLE with CRON_LOCK_FAIL_CLOSED=1: the cycle is skipped and nothing is released', async () => {
    process.env.CRON_LOCK_FAIL_CLOSED = '1';
    client = makeClient('end');
    const { gate, release } = gateFor(new CronGuard());
    const body = jest.fn(async () => undefined);
    await expect(gate.run(body)).resolves.toBe('skipped_lock_held');
    expect(body).not.toHaveBeenCalled();
    expect(release).not.toHaveBeenCalled();
    expect(String((console.error as jest.Mock).mock.calls[0]?.[0])).toContain('cron_lock_fail_closed');
  });

  it('Redis ready and the lock free: acquired, run, and released through the guard (compare-and-delete)', async () => {
    client = makeClient('ready');
    client.set.mockResolvedValueOnce('OK');
    const guard = new CronGuard();
    const gate = createCycleGate({
      acquire: () => guard.tryAcquireLock('inst-1'),
      release: () => guard.releaseLock('inst-1'),
      log,
    });
    await expect(gate.run(async () => { throw new Error('cycle failed'); })).rejects.toThrow('cycle failed');
    // Released even though the cycle threw.
    expect(client.eval).toHaveBeenCalledTimes(1);
    expect(client.eval.mock.calls[0].slice(1)).toEqual([1, 'omnivyra:cron:lock', 'inst-1']);
  });
});

/*
 * cron.ts cannot be executed under jest (startCron runs a full scheduler cycle
 * against real services — see cronScheduleContractCharacterization.test.ts), so
 * its WIRING to the gate is pinned on source. The gate's behaviour is pinned
 * above.
 */
describe('cron.ts wiring (source contract)', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { readFileSync } = require('fs') as typeof import('fs');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { join } = require('path') as typeof import('path');
  const raw = readFileSync(join(__dirname, '../../scheduler/cron.ts'), 'utf8');
  const src = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
  const startCron = src.slice(src.indexOf('async function startCron('), src.indexOf('async function stopCron('));

  it('every scheduler cycle goes through the gate; the lock is never released fire-and-forget', () => {
    expect(src).toContain('const result = await cycleGate.run(() => runSchedulerCycleBody(opts));');
    expect(src).not.toMatch(/void cronGuard\.releaseLock/);
    expect(src).toMatch(/release: \(\) => cronGuard\.releaseLock\(cronInstr\.instanceId\)/);
  });

  it('startCron defines (and, standalone, registers) its shutdown BEFORE its first await', () => {
    const firstAwait = startCron.indexOf('await ');
    const shutdownDef = startCron.indexOf('const shutdown = async (signal: string) =>');
    const registration = startCron.indexOf("process.on('SIGTERM'");
    expect(shutdownDef).toBeGreaterThan(-1);
    // The shutdown body awaits internally; the first await OUTSIDE it is boot.
    const bootFirstAwait = startCron.indexOf('await verifyRedisReadyForBackgroundRuntime');
    expect(shutdownDef).toBeLessThan(bootFirstAwait);
    expect(registration).toBeLessThan(bootFirstAwait);
    expect(firstAwait).toBeGreaterThan(shutdownDef);
  });

  it('a host that owns shutdown gets NO scheduler signal handlers (no concurrent double teardown)', () => {
    expect(startCron).toMatch(/if \(!opts\.hostOwnsShutdown\) \{\s*process\.on\('SIGINT'[\s\S]{0,80}process\.on\('SIGTERM'/);
  });

  it('shutdown waits (bounded) for the in-flight cycle before tearing clients down, and is single-flight', () => {
    const body = startCron.slice(startCron.indexOf('const shutdown = async (signal: string) =>'));
    expect(body).toContain('if (shutdownInFlight) return shutdownInFlight;');
    const stopAt = body.indexOf('lastCycleStop = await cycleGate.stop(cycleStopBoundMs);');
    expect(stopAt).toBeGreaterThan(-1);
    expect(stopAt).toBeLessThan(body.indexOf('cronGuard.shutdown();'));
    expect(stopAt).toBeLessThan(body.indexOf('await cronInstr.deregister();'));
  });

  it('boot re-checks shutdown before startup work and before arming any timer', () => {
    const checks = [...startCron.matchAll(/if \(cycleGate\.isStopping\(\)\) \{/g)].map((m) => m.index as number);
    expect(checks).toHaveLength(2);
    expect(checks[0]).toBeLessThan(startCron.indexOf('enqueueIntelligencePolling()'));
    expect(checks[1]).toBeGreaterThan(startCron.indexOf('await runSchedulerCycle();'));
    expect(checks[1]).toBeLessThan(startCron.indexOf('cronInterval = setInterval('));
    expect(checks[1]).toBeLessThan(startCron.search(/^\s*scheduleWorker\(/m));
  });

  it('a recurring worker that finishes after shutdown does not re-arm its timer', () => {
    const fn = src.slice(src.indexOf('function scheduleWorker('), src.indexOf('async function startCron('));
    expect(fn).toMatch(/const tick = \(\) => \{\s*if \(cycleGate\.isStopping\(\)\) return;/);
  });

  it('stopCron is exported for the host and passes the host deadline as the cycle bound', () => {
    expect(src).toMatch(/export \{ startCron, runSchedulerCycle, stopCron \};/);
    const stop = src.slice(src.indexOf('async function stopCron('));
    expect(stop).toContain('cycleStopBoundMs = cycleBoundMs;');
    expect(stop).toContain("await registeredShutdown('host-stop');");
  });
});
