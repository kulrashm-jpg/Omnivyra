/**
 * WS-1 (STEP 3AH-132) — every registered shared consumer is closable, and the
 * closable set IS the corrected topology.
 *
 * Before this change registerSharedConsumers returned only the five
 * getWorker-based handles. The six contentGenerationQueues-backed families
 * (content-queues-init, content-workers, creator-content-workers,
 * whatsapp-broadcast-worker, whatsapp-webhook-worker, analytics-ingestion-worker)
 * called `await start…()` and discarded the result, because those functions
 * returned `Promise<void>` — so 13 live consumers and ~14 producer `Queue`
 * objects had no close path and survived every SIGTERM.
 *
 * The count here is 18 = one handle per `consumedVia: 'shared'` queue in
 * workerTopologyManifest.ts (7 generic content + 3 creator + whatsapp-broadcast
 * + whatsapp-webhook + analytics-ingestion + 5 getWorker-based). The earlier,
 * unmerged WS-1 candidate (977e8aed) asserted 25, which counted the DEFECTIVE
 * topology: a generic consumer duplicated onto every dedicated queue plus one on
 * the superseded bolt-content-jobs. That number is not reproduced here.
 *
 * Runs the REAL registerSharedConsumers + contentGenerationQueues against a
 * fake bullmq: no Redis, no jobs, no processors.
 */
import fs from 'fs';
import path from 'path';

type FakeHandle = { kind: 'worker' | 'queue'; name: string; close: jest.Mock; on: jest.Mock };
const mockHandles: FakeHandle[] = [];
const makeHandle = (kind: 'worker' | 'queue', name: string): FakeHandle => {
  const handle: FakeHandle = { kind, name, close: jest.fn(async () => undefined), on: jest.fn(() => handle) };
  mockHandles.push(handle);
  return handle;
};

jest.mock('bullmq', () => ({
  Worker: function Worker(this: unknown, name: string) { return makeHandle('worker', name); },
  Queue: function Queue(this: unknown, name: string) { return makeHandle('queue', name); },
  QueueEvents: function QueueEvents(this: unknown, name: string) { return makeHandle('queue', name); },
}));
jest.mock('../../queue/bullmqClient', () => ({
  getConnectionConfig: () => ({}),
  getQueuePrefix: () => 'test',
  getWorker: (name: string) => makeHandle('worker', name),
}));
jest.mock('../../observability/queueObservability', () => ({ observeQueueEvents: () => undefined }));
jest.mock('../../observability/traceKit', () => ({ runWithJobTraceContext: () => undefined }));
jest.mock('../../queue/deadLetterOnExhaustion', () => ({ deadLetterOnExhaustion: () => undefined }));
jest.mock('../../queue/jobProcessors/contentGenerationProcessor', () => ({ processContentGenerationJob: () => undefined }));
jest.mock('../../queue/jobProcessors/creatorContentProcessor', () => ({ processCreatorContentJob: () => undefined }));
jest.mock('../../queue/jobProcessors/whatsappBroadcastProcessor', () => ({ processWhatsAppBroadcastJob: () => undefined }));
jest.mock('../../queue/jobProcessors/whatsappWebhookProcessor', () => ({ processWhatsAppWebhookJob: () => undefined }));
jest.mock('../../queue/jobProcessors/analyticsIngestionProcessor', () => ({ processAnalyticsIngestionJob: () => undefined }));
jest.mock('../../queue/jobProcessors/asyncRefinementProcessor', () => ({ processAsyncRefinementJob: () => undefined }));
jest.mock('../../queue/listeningExecutionQueue', () => ({ LISTENING_EXECUTION_QUEUE_NAME: 'listening-executions' }));
jest.mock('../../services/listeningExecutionService', () => ({ processListeningExecution: () => undefined }));
jest.mock('../../queue/semanticIndexingQueue', () => ({ SEMANTIC_PARTITION_QUEUE_NAME: 'semantic-indexing' }));
jest.mock('../../services/asyncSemanticRuntimeService', () => ({ processSemanticPartition: () => undefined }));
jest.mock('../../queue/replayPartitionQueue', () => ({ REPLAY_PARTITION_QUEUE_NAME: 'replay-partition' }));
jest.mock('../../services/replayCoordinationService', () => ({ processReplayPartition: () => undefined }));
jest.mock('../../workers/automationTaskWorker', () => ({
  runAutomationTaskJob: () => undefined,
  automationTaskConcurrency: () => 1,
}));

import {
  registerSharedConsumers,
  auditSharedHandleCoverage,
  type SharedConsumerHandles,
} from '../../queue/workerTopology';
import { CONTENT_QUEUE_CONFIG, getContentQueue } from '../../queue/contentGenerationQueues';
import {
  neverConsumedQueues,
  queuesOwnedBy,
  sharedConsumedQueues,
} from '../../queue/workerTopologyManifest';

/** The corrected topology: 7 + 3 + 1 + 1 + 1 + 5. NOT the defective 25. */
const EXPECTED_SHARED_CONSUMERS = 18;
const OLD_DEFECTIVE_HANDLE_COUNT = 25;

const count = (names: string[], name: string) => names.filter((n) => n === name).length;

describe.each(['prod', 'dev'] as const)('shared consumer shutdown handles (%s bootstrap)', (bootstrap) => {
  let handles: SharedConsumerHandles;
  let workerNames: string[];

  beforeEach(async () => {
    mockHandles.length = 0;
    // startAnalyticsIngestionWorker's diagnostic sentinel must not write into the repo.
    jest.spyOn(fs, 'appendFileSync').mockImplementation(() => undefined);
    jest.spyOn(console, 'info').mockImplementation(() => {});
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
    handles = await registerSharedConsumers({ bootstrap });
    workerNames = handles.workers.map((w) => w.name);
  });

  afterEach(async () => {
    await handles.closeQueues(); // resets the module-level queue map between tests
    jest.restoreAllMocks();
  });

  it('registers every family without failure', () => {
    expect(handles.failures).toEqual([]);
  });

  // INVARIANT 1 — every registered worker has a shutdown handle.
  it('EVERY Worker constructed during registration comes back as a handle', () => {
    const constructed = mockHandles.filter((h) => h.kind === 'worker');
    expect(constructed.length).toBe(EXPECTED_SHARED_CONSUMERS);
    expect(handles.workers).toHaveLength(constructed.length);
    expect(new Set(handles.workers as unknown as FakeHandle[])).toEqual(new Set(constructed));
  });

  // INVARIANT 3 — the count reflects the CORRECTED topology.
  it('the handle set is exactly the manifest shared set — one per queue, 18 not 25', () => {
    const expected = sharedConsumedQueues().map((q) => q.queue);
    expect(expected).toHaveLength(EXPECTED_SHARED_CONSUMERS);
    expect([...workerNames].sort()).toEqual([...expected].sort());
    expect(handles.workers).not.toHaveLength(OLD_DEFECTIVE_HANDLE_COUNT);
  });

  // INVARIANT 2 — no duplicate handles for duplicate consumers.
  it('no queue has two handles (the defect duplicated the generic consumer onto dedicated queues)', () => {
    expect(new Set(workerNames).size).toBe(workerNames.length);
    for (const queue of [...queuesOwnedBy('creator-content'), 'whatsapp-broadcast',
      'whatsapp-webhook', 'analytics-ingestion']) {
      expect(count(workerNames, queue)).toBe(1);
    }
  });

  it('the six previously-unclosed families are represented', () => {
    for (const queue of queuesOwnedBy('generic-content')) expect(count(workerNames, queue)).toBe(1);
    for (const queue of queuesOwnedBy('creator-content')) expect(count(workerNames, queue)).toBe(1);
    for (const queue of ['whatsapp-broadcast', 'whatsapp-webhook', 'analytics-ingestion']) {
      expect(count(workerNames, queue)).toBe(1);
    }
    // …and the five that always were.
    for (const queue of ['planner-refinement', 'listening-executions', 'semantic-indexing',
      'replay-partition', 'automation-tasks']) {
      expect(count(workerNames, queue)).toBe(1);
    }
  });

  // INVARIANT 4 — shutdown needs no superseded queue.
  it.each(neverConsumedQueues().map((q) => q.queue))('never-consumed queue %s has NO shutdown handle', (queue) => {
    expect(workerNames).not.toContain(queue);
  });

  it('auditSharedHandleCoverage reports full coverage with no gap, duplicate or stray', () => {
    const coverage = auditSharedHandleCoverage(handles);
    expect(coverage.missing).toEqual([]);
    expect(coverage.duplicated).toEqual([]);
    expect(coverage.unexpected).toEqual([]);
    expect(coverage.registered).toHaveLength(coverage.expected.length);
  });

  it('closing the handle set closes every constructed Worker exactly once', async () => {
    await Promise.all(handles.workers.map((w) => w.close()));
    for (const h of mockHandles.filter((x) => x.kind === 'worker')) {
      expect(h.close).toHaveBeenCalledTimes(1);
    }
  });

  it('closeQueues() closes every producer Queue and drops it, so a late caller gets a fresh one', async () => {
    const producers = mockHandles.filter((h) => h.kind === 'queue');
    expect(producers.map((q) => q.name).sort()).toEqual(Object.keys(CONTENT_QUEUE_CONFIG).sort());

    getContentQueue('content:blog'); // legacy alias → already-open handle, no new Queue
    expect(mockHandles.filter((h) => h.kind === 'queue')).toHaveLength(producers.length);

    await handles.closeQueues();
    for (const q of producers) expect(q.close).toHaveBeenCalledTimes(1);

    const fresh = getContentQueue('content-blog') as unknown as FakeHandle;
    expect(producers).not.toContain(fresh);
    expect(fresh.close).not.toHaveBeenCalled();
  });
});

describe('auditSharedHandleCoverage detects a drifted handle set', () => {
  const base = (workers: Array<{ name: string }>): SharedConsumerHandles =>
    ({ workers: workers as never, closeQueues: async () => undefined, failures: [] });

  it('names a shared queue whose consumer handed back no handle', () => {
    const all = sharedConsumedQueues().map((q) => ({ name: q.queue }));
    const coverage = auditSharedHandleCoverage(base(all.filter((w) => w.name !== 'analytics-ingestion')));
    expect(coverage.missing).toEqual(['analytics-ingestion']);
  });

  it('names a queue that came back twice', () => {
    const all = sharedConsumedQueues().map((q) => ({ name: q.queue }));
    const coverage = auditSharedHandleCoverage(base([...all, { name: 'creator-video' }]));
    expect(coverage.duplicated).toEqual(['creator-video']);
  });

  it('names a handle for a queue the manifest does not declare shared', () => {
    const all = sharedConsumedQueues().map((q) => ({ name: q.queue }));
    const coverage = auditSharedHandleCoverage(base([...all, { name: 'bolt-content-jobs' }]));
    expect(coverage.unexpected).toEqual(['bolt-content-jobs']);
  });
});

describe('bootstrap wiring — both hosts drain the authoritative set', () => {
  const ROOT = path.join(__dirname, '..', '..');
  const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
  const mainTs = read('workers/main.ts');
  const startWorkersTs = read('queue/startWorkers.ts');
  const topologyTs = read('queue/workerTopology.ts');
  const queuesTs = read('queue/contentGenerationQueues.ts');

  it('the registrar collects handles in ONE place, so a family cannot register without returning one', () => {
    // family() is the only collector; no registration pushes directly.
    expect(topologyTs).toContain('handles.workers.push(...(Array.isArray(registered) ? registered : [registered]))');
    expect(topologyTs.match(/handles\.workers\.push/g)).toHaveLength(1);
  });

  it('the six contentGenerationQueues starters hand their Workers back', () => {
    expect(queuesTs).toContain('export async function startContentWorkers(processor: (job: any) => Promise<any>): Promise<Worker[]>');
    expect(queuesTs).toContain('export async function startCreatorContentWorkers(processor: (job: any) => Promise<any>): Promise<Worker[]>');
    expect(queuesTs).toContain('export async function startWhatsAppBroadcastWorker(processor: (job: any) => Promise<any>): Promise<Worker>');
    expect(queuesTs).toContain('export async function startWhatsAppWebhookWorker(processor: (job: any) => Promise<any>): Promise<Worker>');
    expect(queuesTs).toContain('export async function startAnalyticsIngestionWorker(processor: (job: any) => Promise<any>): Promise<Worker>');
    expect(queuesTs).toContain('export async function closeContentQueues(): Promise<void>');
  });

  it('PROD drains the spread of sharedConsumers.workers — never a hand-written queue list', () => {
    expect(mainTs).toContain('...sharedConsumers.workers.map((w) => ({ name: w.name, close: () => w.close() }))');
    expect(mainTs).toContain('const outcome = await drainConsumers(consumers, drainDeadlineMs);');
    expect(mainTs).toContain('sharedConsumers.closeQueues');
  });

  it('DEV closes every shared consumer handle and the producer queues too', () => {
    expect(startWorkersTs).toContain('for (const worker of sharedConsumers?.workers ?? [])');
    expect(startWorkersTs).toContain('sharedConsumers.closeQueues');
  });

  // INVARIANT 5 — the 25 s hard-exit backstop survives.
  it('the hard-exit backstop is still armed at drainDeadlineMs + 10_000', () => {
    expect(mainTs).toMatch(/const hardExit = setTimeout\(/);
    expect(mainTs).toContain('}, drainDeadlineMs + 10_000);');
    expect(mainTs).toContain('const drainDeadlineMs = resolveDrainDeadlineMs(process.env.WORKER_DRAIN_TIMEOUT_MS);');
  });

  // INVARIANT 7 — every post-drain step is capped, so the sequence finishes
  // inside the grace window instead of riding the backstop.
  it('all three post-drain steps run under the shared 3 s cap', () => {
    const capped = [...mainTs.matchAll(/closeWithin\('([^']+)', POST_DRAIN_STEP_TIMEOUT_MS/g)].map((m) => m[1]);
    expect(capped).toEqual(['BOLT claim release', 'producer queue close', 'connection close']);
    expect(mainTs).toContain('await closeConnections();');
  });

  // INVARIANT 6 — SEC-C6 cron ownership survives.
  it('the co-located scheduler is still started with hostOwnsShutdown: true', () => {
    expect(mainTs).toMatch(/startCron\(\{\s*hostOwnsShutdown:\s*true\s*\}\)/);
  });

  // INVARIANT 8 — deterministic signal handling.
  it('SIGTERM and SIGINT both go through the single-shot guard', () => {
    expect(mainTs).toContain('const onSignal = once(shutdown);');
    expect(mainTs).toContain("process.on('SIGTERM', () => { void onSignal('SIGTERM'); });");
    expect(mainTs).toContain("process.on('SIGINT',  () => { void onSignal('SIGINT'); });");
  });

  // INVARIANT 9 — no process.exit added to normal operation.
  it('every process.exit in the worker entrypoint is a startup abort or the shutdown exit', () => {
    // Comments mention process.exit() when documenting SEC-C6; strip them first.
    const code = mainTs.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
    const shutdownStart = code.indexOf('const shutdown = async (signal: string) =>');
    expect(shutdownStart).toBeGreaterThan(-1);
    const shutdownEnd = code.indexOf('const onSignal = once(shutdown);');
    const mainTsCode = code;
    const exits = [...code.matchAll(/process\.exit\(/g)].map((m) => m.index as number);
    // Two inside shutdown (hard-exit backstop + the final exit) and two startup
    // aborts (Redis preflight, main() rejection). Nothing else.
    const insideShutdown = exits.filter((i) => i > shutdownStart && i < shutdownEnd);
    expect(insideShutdown).toHaveLength(2);
    expect(exits).toHaveLength(4);
    for (const at of exits.filter((i) => i < shutdownStart || i > shutdownEnd)) {
      expect(mainTsCode.slice(at, at + 16)).toContain('process.exit(1)');
    }
  });

  it('the shutdown module itself never exits the process', () => {
    expect(read('workers/workerShutdown.ts')).not.toContain('process.exit');
  });
});
