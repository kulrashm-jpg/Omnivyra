/**
 * Railway worker entrypoint (backend/workers/main.ts) — shutdown lifecycle,
 * BEHAVIOURAL.
 *
 * The real main.ts module is loaded with every collaborator replaced by a
 * controllable fake: BullMQ workers whose close() resolves when the test says
 * so, a Redis ping the test releases, a shared-consumer registrar the test
 * resolves, and a scheduler whose stop the test controls. process.on and
 * process.exit are intercepted, so the captured SIGTERM handler is the one the
 * entrypoint really installs. Timers (drain deadline, backstop, the
 * publishing_jobs poll) are jest fake timers; nothing sleeps.
 *
 * What is pinned:
 *   • the signal handlers exist BEFORE the first Worker is constructed;
 *   • a signal during boot drains what exists and stops boot from starting more;
 *   • an active publish job is waited for (within the deadline);
 *   • the scheduler stop (in-flight cycle) is awaited within the same deadline;
 *   • repeated signals run ONE shutdown;
 *   • a drain that times out still runs every capped teardown step, reports
 *     honestly, and exits exactly once;
 *   • no new work is started after shutdown begins.
 */

// A module, not a global script: the entrypoint is loaded with require() inside
// jest.isolateModules, so this file has no top-level import of its own.
export {};

type Deferred<T = void> = { promise: Promise<T>; resolve: (v: T) => void };
function deferred<T = void>(): Deferred<T> {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((res) => { resolve = res; });
  return { promise, resolve };
}

type FakeWorker = { name: string; on: jest.Mock; close: jest.Mock };

const mockH = {
  events: [] as string[],
  workers: new Map<string, FakeWorker>(),
  /** Per-queue close behaviour; default resolves immediately. */
  closeFor: new Map<string, () => Promise<void>>(),
  ping: (): Promise<unknown> => Promise.resolve('PONG'),
  register: (): Promise<unknown> => Promise.resolve({ workers: [], closeQueues: async () => {}, failures: [] }),
  startCron: (): Promise<void> => Promise.resolve(),
  stopCron: (_ms: number): Promise<unknown> => Promise.resolve('idle'),
  warmup: (): Promise<void> => Promise.resolve(),
  /** Called when the entrypoint starts the baseline loop (a boot step with no await of its own). */
  onBaselineStart: (): void => {},
  heldLocks: [] as Array<{ runId: string; token: string }>,
  handlers: new Map<string, Array<(...a: unknown[]) => void>>(),
  makeWorker(name: string): FakeWorker {
    mockH.events.push(`worker:${name}`);
    const w: FakeWorker = {
      name,
      on: jest.fn(),
      close: jest.fn(() => {
        mockH.events.push(`close:${name}`);
        const behaviour = mockH.closeFor.get(name);
        return behaviour ? behaviour() : Promise.resolve();
      }),
    };
    mockH.workers.set(name, w);
    return w;
  },
};

jest.mock('@/config', () => ({ config: { REDIS_URL: 'redis://127.0.0.1:59998' } }));
jest.mock('../../utils/validateEnv', () => ({ validateWorkerEnv: jest.fn() }));
jest.mock('../../workers/healthServer', () => ({ startHealthServer: jest.fn(), setCronStatus: jest.fn() }));
jest.mock('../../queue/queueNamespace', () => ({ assertQueueConsumerRuntimeAllowed: jest.fn() }));
jest.mock('bullmq', () => ({
  Worker: class {
    constructor(name: string) { return mockH.makeWorker(name); }
  },
}));
jest.mock('../../queue/bullmqClient', () => ({
  getWorker: (name: string) => mockH.makeWorker(name),
  closeConnections: jest.fn(async () => { mockH.events.push('closeConnections'); }),
  getSharedRedisClient: () => ({ ping: () => mockH.ping() }),
  withHeavyJobSlot: jest.fn(),
  getQueuePrefix: () => 'test',
}));
jest.mock('../../queue/queueInstrumentation', () => ({ instrumentWorker: jest.fn() }));
jest.mock('../../queue/deadLetterOnExhaustion', () => ({ deadLetterOnExhaustion: jest.fn() }));
jest.mock('../../queue/leadQueueHardening', () => ({ attachLeadJobFailureHandler: jest.fn() }));
jest.mock('../../queue/jobProcessors/publishProcessor', () => ({ processPublishJob: jest.fn() }));
jest.mock('../../queue/jobProcessors/engagementPollingProcessor', () => ({ processEngagementPollingJob: jest.fn() }));
jest.mock('../../queue/jobProcessors/boltProcessor', () => ({ processBoltJob: jest.fn() }));
jest.mock('../../queue/jobProcessors/campaignPlanningProcessor', () => ({ processCampaignPlanningJob: jest.fn() }));
jest.mock('../../queue/jobProcessors/jobTenantBinding', () => ({ assertJobCampaignBinding: jest.fn() }));
jest.mock('../../services/boltExecutionRecovery', () => ({
  BOLT_STALLED_INTERVAL_MS: 60_000,
  attachBoltRunReconciliation: jest.fn(),
  releaseBoltRunClaimOnShutdown: jest.fn(async (runId: string) => {
    mockH.events.push(`releaseBoltClaim:${runId}`);
    return { ok: true };
  }),
}));
jest.mock('../../services/boltExecutionLock', () => ({ getHeldRunLocks: () => mockH.heldLocks }));
jest.mock('../../workers/intelligencePollingWorker', () => ({
  getIntelligencePollingWorker: () => mockH.makeWorker('intelligence-polling'),
}));
jest.mock('../../workers/leadThreadRecomputeWorker', () => ({ runLeadThreadRecomputeWorker: jest.fn() }));
jest.mock('../../workers/conversationMemoryWorker', () => ({ runConversationMemoryWorker: jest.fn() }));
jest.mock('../../services/cacheWarmup', () => ({
  runCacheWarmup: jest.fn(() => { mockH.events.push('runCacheWarmup'); return mockH.warmup(); }),
}));
jest.mock('../../services/autoScalingSignal', () => ({
  startAutoScalingMonitor: jest.fn(() => () => { mockH.events.push('stop:autoscaling monitor'); }),
}));
jest.mock('../../services/metricsCollector', () => ({ getMetricsSnapshot: jest.fn(async () => ({ avgLatencyMs: 0 })) }));
jest.mock('../../services/publishingJobService', () => ({
  runPublishingWorker: jest.fn(async () => {
    mockH.events.push('runPublishingWorker');
    return { published: 0, retrying: 0, failed: 0, deadLettered: 0, claimed: 0 };
  }),
}));
jest.mock('../../services/creatorRenderDurableQueue', () => ({
  createCreatorRenderWorker: () => mockH.makeWorker('creator-render'),
  recoverOrphanedCreatorRenderJobs: jest.fn(async () => undefined),
}));
jest.mock('../../services/creatorRenderWorkerProcessor', () => ({ processCreatorRenderJob: jest.fn() }));
jest.mock('../../queue/workerTopology', () => ({
  registerSharedConsumers: jest.fn(() => { mockH.events.push('registerSharedConsumers'); return mockH.register(); }),
}));
jest.mock('../../observability/traceKit', () => ({ runWithJobTraceContext: jest.fn() }));
jest.mock('../../../lib/platform/concurrency', () => ({ definePool: () => ({ run: jest.fn() }) }));
jest.mock('../../../lib/platform/rollout', () => ({
  defineRolloutFlag: (f: unknown) => f,
  resolveRolloutSync: () => ({ mode: 'off' }),
}));
jest.mock('../../workers/renderParityPreflight', () => ({
  runRenderParityPreflight: jest.fn(async () => { mockH.events.push('runRenderParityPreflight'); return {}; }),
  logPreflightReport: jest.fn(),
}));
jest.mock('../../scheduler/cron', () => ({
  startCron: jest.fn(() => { mockH.events.push('startCron'); return mockH.startCron(); }),
  stopCron: jest.fn((ms: number) => { mockH.events.push(`stopCron:${ms}`); return mockH.stopCron(ms); }),
}));
jest.mock('../../observability/baseline', () => ({
  startBaselineCaptureLoop: () => {
    mockH.events.push('baseline loop started');
    mockH.onBaselineStart();
    return () => { mockH.events.push('stop:baseline loop'); };
  },
}));
jest.mock('../../../observability/runtime/structuredTelemetry', () => ({ emitStructuredEvent: jest.fn() }));

const INLINE_WORKERS = [
  'publish', 'bolt-execution', 'engagement-polling', 'intelligence-polling', 'engine-jobs',
  'ai-heavy', 'creator-render', 'lead-thread-recompute', 'conversation-memory-rebuild',
];

let exitSpy: jest.SpyInstance;
let warnSpy: jest.SpyInstance;
let infoSpy: jest.SpyInstance;

/** Loads a FRESH copy of the entrypoint (module-load side effects included). */
function loadMain(): void {
  jest.isolateModules(() => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require('../../workers/main');
  });
}
const signal = (name: 'SIGTERM' | 'SIGINT') => {
  for (const handler of mockH.handlers.get(name) ?? []) handler(name);
};
/** Let queued promise callbacks run (fake timers do not fake setImmediate/nextTick). */
const settle = async (rounds = 10) => {
  for (let i = 0; i < rounds; i++) await new Promise<void>((r) => setImmediate(r));
};
const exits = () => exitSpy.mock.calls.map((c) => c[0]);
const closeCount = (name: string) => mockH.events.filter((e) => e === `close:${name}`).length;
async function bootFully(): Promise<void> {
  loadMain();
  await settle();
}

beforeEach(() => {
  jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] });
  process.env.WORKER_DRAIN_TIMEOUT_MS = '1000';
  delete process.env.CRON_SERVICE_MODE;
  mockH.events = [];
  mockH.workers.clear();
  mockH.closeFor.clear();
  mockH.handlers.clear();
  mockH.heldLocks = [];
  mockH.ping = () => Promise.resolve('PONG');
  mockH.register = () => Promise.resolve({ workers: [], closeQueues: async () => {}, failures: [] });
  mockH.startCron = () => Promise.resolve();
  mockH.stopCron = () => Promise.resolve('idle');
  mockH.warmup = () => Promise.resolve();
  mockH.onBaselineStart = () => {};
  jest.spyOn(process, 'on').mockImplementation(((event: string, handler: (...a: unknown[]) => void) => {
    mockH.events.push(`on:${event}`);
    const list = mockH.handlers.get(event) ?? [];
    list.push(handler);
    mockH.handlers.set(event, list);
    return process;
  }) as unknown as typeof process.on);
  exitSpy = jest.spyOn(process, 'exit').mockImplementation(((code?: number) => {
    mockH.events.push(`exit:${code}`);
  }) as unknown as typeof process.exit);
  warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
  infoSpy = jest.spyOn(console, 'info').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
  jest.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(() => {
  jest.clearAllTimers();
  jest.useRealTimers();
  jest.restoreAllMocks();
  delete process.env.WORKER_DRAIN_TIMEOUT_MS;
});

describe('shutdown coordination is installed before any work can start', () => {
  it('SIGTERM and SIGINT handlers are registered BEFORE the first Worker is constructed', async () => {
    await bootFully();
    const firstWorker = mockH.events.findIndex((e) => e.startsWith('worker:'));
    expect(firstWorker).toBeGreaterThan(-1);
    expect(mockH.events.indexOf('on:SIGTERM')).toBeGreaterThan(-1);
    expect(mockH.events.indexOf('on:SIGTERM')).toBeLessThan(firstWorker);
    expect(mockH.events.indexOf('on:SIGINT')).toBeLessThan(firstWorker);
    expect(mockH.handlers.get('SIGTERM')).toHaveLength(1);
    // Positive control for the "boot starts nothing further" assertions below:
    // an uninterrupted boot DOES record every one of these events.
    for (const e of ['runRenderParityPreflight', 'runCacheWarmup', 'registerSharedConsumers', 'startCron', 'runPublishingWorker']) {
      expect(mockH.events).toContain(e);
    }
  });
});

describe('SIGTERM during worker startup', () => {
  it('drains the workers that exist, exits once, and boot starts nothing further', async () => {
    const ping = deferred<unknown>();
    mockH.ping = () => ping.promise;           // boot is stuck in the Redis preflight
    loadMain();
    await settle();

    signal('SIGTERM');
    await settle();
    expect(exits()).toEqual([0]);
    for (const name of INLINE_WORKERS) expect(closeCount(name)).toBe(1);
    expect(mockH.events).toContain('stopCron:1000');

    // Boot resumes after the signal: it must not register consumers, start
    // the scheduler, or start the publishing_jobs poll.
    ping.resolve('PONG');
    await settle();
    // (Asserted through the mocks' own event log: inside jest.isolateModules
    // the entrypoint gets its OWN mock instances, so jest.requireMock here
    // would inspect a different, never-called copy.)
    expect(mockH.events).not.toContain('registerSharedConsumers');
    expect(mockH.events).not.toContain('startCron');
    expect(mockH.events).not.toContain('runPublishingWorker');
    expect(exits()).toEqual([0]);
    // Boot stops at the FIRST check after the preflight: no parity probe and
    // no cache warmup run after shutdown began.
    expect(mockH.events).not.toContain('runRenderParityPreflight');
    expect(mockH.events).not.toContain('runCacheWarmup');
  });

  it('a signal during the cache warmup: no shared consumers, no scheduler, no poll', async () => {
    const warmup = deferred();
    mockH.warmup = () => warmup.promise;
    loadMain();
    await settle();
    expect(mockH.events).toContain('runCacheWarmup');

    signal('SIGTERM');
    await settle();
    warmup.resolve();
    await settle();
    expect(exits()).toEqual([0]);
    expect(mockH.events).not.toContain('registerSharedConsumers');
    expect(mockH.events).not.toContain('startCron');
    expect(mockH.events).not.toContain('runPublishingWorker');
  });

  it('a signal as the baseline loop starts: that loop is stopped and nothing after it starts', async () => {
    mockH.onBaselineStart = () => signal('SIGTERM');
    loadMain();
    await settle();
    expect(exits()).toEqual([0]);
    expect(mockH.events).toContain('stop:baseline loop');
    expect(mockH.events).not.toContain('runPublishingWorker');
    expect(mockH.events.filter((e) => e === 'stop:autoscaling monitor')).toHaveLength(0);
  });

  it('shared consumers that finish registering AFTER the signal are closed at once, with their producer queues', async () => {
    const registration = deferred<unknown>();
    mockH.register = () => registration.promise;
    loadMain();
    await settle();

    signal('SIGTERM');
    await settle();
    expect(exits()).toEqual([0]);

    const late = mockH.makeWorker('content-blog');
    const closeQueues = jest.fn(async () => { mockH.events.push('closeQueues:late'); });
    registration.resolve({ workers: [late], closeQueues, failures: [] });
    await settle();
    expect(late.close).toHaveBeenCalledTimes(1);
    expect(closeQueues).toHaveBeenCalledTimes(1);
    expect(mockH.events).not.toContain('startCron');
  });
});

describe('SIGTERM after boot', () => {
  it('waits for an ACTIVE publish job (worker.close) before exiting, within the deadline', async () => {
    await bootFully();
    const publishJob = deferred();
    mockH.closeFor.set('publish', () => publishJob.promise);

    signal('SIGTERM');
    await settle();
    await jest.advanceTimersByTimeAsync(900);
    expect(exits()).toEqual([]);              // still draining the publish job

    publishJob.resolve();
    await settle();
    expect(exits()).toEqual([0]);
    expect(infoSpy.mock.calls.map((c) => String(c[0]))).toContainEqual(
      expect.stringContaining('shutdown complete'),
    );
  });

  it('waits for the scheduler stop (an in-flight cron cycle) under the same deadline', async () => {
    await bootFully();
    const cycle = deferred<unknown>();
    mockH.stopCron = () => cycle.promise;

    signal('SIGTERM');
    await settle();
    await jest.advanceTimersByTimeAsync(500);
    expect(exits()).toEqual([]);
    expect(mockH.events).toContain('stopCron:1000'); // the drain deadline, not unbounded

    cycle.resolve('drained');
    await settle();
    expect(exits()).toEqual([0]);
    expect(warnSpy.mock.calls.map((c) => String(c[0]))).not.toContainEqual(
      expect.stringContaining('WITHOUT a clean drain'),
    );
  });

  it('a cron cycle still running at the deadline is reported, and shutdown still completes', async () => {
    await bootFully();
    mockH.stopCron = () => new Promise(() => { /* never settles */ });

    signal('SIGTERM');
    await settle();
    await jest.advanceTimersByTimeAsync(1_000);
    await settle();
    expect(exits()).toEqual([0]);
    const report = warnSpy.mock.calls.find((c) => String(c[0]).includes('WITHOUT a clean drain'));
    expect(report?.[1]).toMatchObject({ scheduler: 'timeout' });
  });

  it('a cron cycle the scheduler reports as still running is never logged as a clean shutdown', async () => {
    await bootFully();
    mockH.stopCron = () => Promise.resolve('timeout'); // stopCron returned in time, but its cycle did not finish

    signal('SIGTERM');
    await settle();
    expect(exits()).toEqual([0]);
    const report = warnSpy.mock.calls.find((c) => String(c[0]).includes('WITHOUT a clean drain'));
    expect(report?.[1]).toMatchObject({ scheduler: 'closed', schedulerCycle: 'timeout' });
    expect(infoSpy.mock.calls.map((c) => String(c[0]))).not.toContainEqual(expect.stringContaining('shutdown complete'));
  });

  it('a stuck consumer: the drain gives up at the deadline, EVERY capped teardown step still runs, one exit', async () => {
    await bootFully();
    mockH.heldLocks = [{ runId: 'run-1', token: 't' }];
    mockH.closeFor.set('bolt-execution', () => new Promise(() => { /* a multi-minute BOLT run */ }));

    signal('SIGTERM');
    await settle();
    await jest.advanceTimersByTimeAsync(1_000);
    await settle();

    expect(mockH.events).toContain('releaseBoltClaim:run-1');
    expect(mockH.events).toContain('closeConnections');
    expect(exits()).toEqual([0]);
    const report = warnSpy.mock.calls.find((c) => String(c[0]).includes('WITHOUT a clean drain'));
    expect(report?.[1]).toMatchObject({ pending: ['bolt-execution'] });
    // Teardown order: claim release before the connections are closed, exit last.
    expect(mockH.events.indexOf('releaseBoltClaim:run-1')).toBeLessThan(mockH.events.indexOf('closeConnections'));
    expect(mockH.events.indexOf('closeConnections')).toBeLessThan(mockH.events.indexOf('exit:0'));

    // The hard-exit backstop was cleared: no second exit later.
    await jest.advanceTimersByTimeAsync(60_000);
    expect(exits()).toEqual([0]);
  });

  it('repeated SIGTERM / SIGINT run ONE shutdown: each consumer closed once, one exit', async () => {
    await bootFully();
    const publishJob = deferred();
    mockH.closeFor.set('publish', () => publishJob.promise);

    signal('SIGTERM');
    signal('SIGTERM');
    signal('SIGINT');
    await settle();
    publishJob.resolve();
    await settle();

    for (const name of INLINE_WORKERS) expect(closeCount(name)).toBe(1);
    expect(mockH.events.filter((e) => e.startsWith('stopCron:'))).toHaveLength(1);
    expect(exits()).toEqual([0]);
  });

  it('no new work after shutdown begins: producers stop BEFORE the drain, and the publishing_jobs poll never runs again', async () => {
    await bootFully();
    const polls = () => mockH.events.filter((e) => e === 'runPublishingWorker').length;
    const before = polls();
    expect(before).toBeGreaterThan(0); // the poll really started during boot (non-vacuous)
    const publishJob = deferred();
    mockH.closeFor.set('publish', () => publishJob.promise);

    signal('SIGTERM');
    await settle();
    const firstClose = mockH.events.findIndex((e) => e.startsWith('close:'));
    expect(mockH.events.indexOf('stop:autoscaling monitor')).toBeGreaterThan(-1);
    expect(mockH.events.indexOf('stop:autoscaling monitor')).toBeLessThan(firstClose);
    expect(mockH.events.indexOf('stop:baseline loop')).toBeLessThan(firstClose);

    // The 30 s poll would have fired several times in this window.
    await jest.advanceTimersByTimeAsync(900);
    publishJob.resolve();
    await settle();
    await jest.advanceTimersByTimeAsync(120_000);
    expect(polls()).toBe(before);
  });
});
