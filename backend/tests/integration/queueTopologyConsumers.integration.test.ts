/**
 * Queue topology — live Redis integration.
 *
 * SKIPPED unless QUEUE_TOPOLOGY_INTEGRATION_REDIS_URL points at a disposable,
 * LOCAL Redis and REDIS_URL is set to the same value (the app config reads
 * REDIS_URL at load). Example:
 *
 *   docker run -d --rm --name qtopo-it-redis -p 127.0.0.1:6391:6379 redis:7-alpine
 *   QUEUE_TOPOLOGY_INTEGRATION_REDIS_URL=redis://127.0.0.1:6391 \
 *   REDIS_URL=redis://127.0.0.1:6391 \
 *     npx jest backend/tests/integration/queueTopologyConsumers.integration.test.ts
 *
 * Registers the real shared consumers on real BullMQ, enqueues jobs onto every
 * dedicated queue and two generic ones, and asserts that each job is handled
 * exactly once, by its owning processor — the generic processor never takes a
 * dedicated job — and that bolt-content-jobs has no consumer at all.
 */

const INTEGRATION_URL = process.env.QUEUE_TOPOLOGY_INTEGRATION_REDIS_URL;
const describeIntegration = INTEGRATION_URL ? describe : describe.skip;

type ClosableWorker = { close: () => Promise<void> };
const mockTrackedWorkers: ClosableWorker[] = [];
jest.mock('bullmq', () => {
  const actual: typeof import('bullmq') = jest.requireActual('bullmq');
  class TrackedWorker extends actual.Worker {
    constructor(...args: ConstructorParameters<typeof actual.Worker>) {
      super(...args);
      mockTrackedWorkers.push(this as unknown as ClosableWorker);
    }
  }
  return { ...actual, Worker: TrackedWorker };
});

type Handled = { family: string; queue: string; jobId: string };
const mockHandled: Handled[] = [];
const mockProcessor = (family: string) =>
  jest.fn(async (job: { queueName: string; id: string }) => {
    mockHandled.push({ family, queue: job.queueName, jobId: String(job.id) });
  });
jest.mock('../../queue/jobProcessors/contentGenerationProcessor', () => ({
  processContentGenerationJob: mockProcessor('generic-content'),
}));
jest.mock('../../queue/jobProcessors/creatorContentProcessor', () => ({
  processCreatorContentJob: mockProcessor('creator-content'),
}));
jest.mock('../../queue/jobProcessors/whatsappBroadcastProcessor', () => ({
  processWhatsAppBroadcastJob: mockProcessor('whatsapp-broadcast'),
}));
jest.mock('../../queue/jobProcessors/whatsappWebhookProcessor', () => ({
  processWhatsAppWebhookJob: mockProcessor('whatsapp-webhook'),
}));
jest.mock('../../queue/jobProcessors/analyticsIngestionProcessor', () => ({
  processAnalyticsIngestionJob: mockProcessor('analytics-ingestion'),
}));
jest.mock('../../queue/jobProcessors/asyncRefinementProcessor', () => ({ processAsyncRefinementJob: jest.fn() }));
jest.mock('../../services/listeningExecutionService', () => ({ processListeningExecution: jest.fn() }));
jest.mock('../../services/asyncSemanticRuntimeService', () => ({ processSemanticPartition: jest.fn() }));
jest.mock('../../services/replayCoordinationService', () => ({ processReplayPartition: jest.fn() }));
jest.mock('../../workers/automationTaskWorker', () => ({ runAutomationTaskJob: jest.fn(), automationTaskConcurrency: () => 1 }));

import type { Queue } from 'bullmq';

const EXPECTED: Record<string, string> = {
  'creator-video': 'creator-content',
  'creator-carousel': 'creator-content',
  'creator-story': 'creator-content',
  'whatsapp-broadcast': 'whatsapp-broadcast',
  'whatsapp-webhook': 'whatsapp-webhook',
  'analytics-ingestion': 'analytics-ingestion',
  'content-post': 'generic-content',
  'content-engagement': 'generic-content',
};
const JOBS_PER_QUEUE = 12;
const QUEUES_UNDER_TEST = [...Object.keys(EXPECTED), 'bolt-content-jobs'];

async function waitFor(predicate: () => Promise<boolean>, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`condition not met within ${timeoutMs}ms`);
}

describeIntegration('queue topology — live Redis', () => {
  let getContentQueue: (name: string) => Queue;
  const extraQueues: Queue[] = [];

  beforeAll(async () => {
    const host = new URL(INTEGRATION_URL!).hostname;
    if (!['127.0.0.1', 'localhost', '::1'].includes(host)) {
      throw new Error(`refusing to run against non-local Redis host '${host}'`);
    }
    if (process.env.REDIS_URL !== INTEGRATION_URL) {
      throw new Error('REDIS_URL must equal QUEUE_TOPOLOGY_INTEGRATION_REDIS_URL (the app config reads REDIS_URL)');
    }

    ({ getContentQueue } = await import('../../queue/contentGenerationQueues'));
    for (const name of QUEUES_UNDER_TEST) {
      await getContentQueue(name).obliterate({ force: true });
    }
    // Queues created at import by the shared registrar's modules — closed in afterAll.
    extraQueues.push(
      (await import('../../queue/listeningExecutionQueue')).listeningExecutionQueue,
      (await import('../../queue/semanticIndexingQueue')).semanticIndexingQueue,
      (await import('../../queue/replayPartitionQueue')).replayPartitionQueue,
    );

    const { registerSharedConsumers } = await import('../../queue/workerTopology');
    const handles = await registerSharedConsumers({ bootstrap: 'prod' });
    expect(handles.failures).toEqual([]);
  }, 60_000);

  afterAll(async () => {
    await Promise.allSettled(mockTrackedWorkers.map((w) => w.close()));
    if (getContentQueue) {
      for (const name of QUEUES_UNDER_TEST) {
        const queue = getContentQueue(name);
        await queue.obliterate({ force: true }).catch(() => undefined);
        await queue.close();
      }
    }
    await Promise.allSettled(extraQueues.map((q) => q.close()));
  }, 60_000);

  it('every job is handled exactly once, by the processor that owns its queue', async () => {
    for (const queue of Object.keys(EXPECTED)) {
      const q = getContentQueue(queue);
      for (let i = 0; i < JOBS_PER_QUEUE; i++) {
        // Job name = queue name, as the real producers do (e.g. creatorContentAdapter).
        await q.add(queue, { company_id: 'c-1', i }, { jobId: `${queue}-probe-${i}` });
      }
    }

    await waitFor(async () => mockHandled.length >= JOBS_PER_QUEUE * Object.keys(EXPECTED).length, 45_000);
    // Let any second (duplicate) consumer have a chance to show up.
    await new Promise((resolve) => setTimeout(resolve, 1_000));

    for (const [queue, family] of Object.entries(EXPECTED)) {
      const handled = mockHandled.filter((h) => h.queue === queue);
      expect(handled).toHaveLength(JOBS_PER_QUEUE);
      expect(new Set(handled.map((h) => h.jobId)).size).toBe(JOBS_PER_QUEUE);
      expect(new Set(handled.map((h) => h.family))).toEqual(new Set([family]));
    }
    const genericTookDedicated = mockHandled.filter((h) => h.family === 'generic-content' && !h.queue.startsWith('content-'));
    expect(genericTookDedicated).toEqual([]);
  }, 60_000);

  it('bolt-content-jobs has no consumer: its jobs stay waiting', async () => {
    const q = getContentQueue('bolt-content-jobs');
    await q.add('topology-probe', { company_id: 'c-1' }, { jobId: 'bolt-probe-1' });
    await q.add('topology-probe', { company_id: 'c-1' }, { jobId: 'bolt-probe-2' });
    await new Promise((resolve) => setTimeout(resolve, 3_000));
    const counts = await q.getJobCounts('waiting', 'active', 'completed', 'failed');
    expect(counts).toMatchObject({ waiting: 2, active: 0, completed: 0, failed: 0 });
    expect(mockHandled.filter((h) => h.queue === 'bolt-content-jobs')).toEqual([]);
  }, 30_000);
});
