/**
 * BEHAVIORAL worker-topology gate.
 *
 * Runs the shared-consumer registration exactly as the bootstraps do
 * (registerSharedConsumers — backend/workers/main.ts passes bootstrap 'prod',
 * backend/queue/startWorkers.ts passes 'dev') against a mocked BullMQ, records
 * every consumer that is constructed, then drives each captured processor with
 * a job to find which job processor it actually reaches.
 *
 * This replaces string-literal evidence, which could not see that
 * startContentWorkers looped over every CONTENT_QUEUE_CONFIG entry and so put a
 * second, generic consumer on the creator-*, whatsapp-* and analytics-ingestion
 * queues (and a consumer on the superseded bolt-content-jobs). In production
 * that generic consumer won jobs and failed them, and exhausted jobs were lost.
 */

type ConstructedConsumer = { queue: string; processor: (job: unknown) => unknown };
const mockConstructed: ConstructedConsumer[] = [];

jest.mock('bullmq', () => {
  class Worker {
    constructor(name: string, processor: (job: unknown) => unknown) {
      mockConstructed.push({ queue: name, processor });
    }
    on() { return this; }
    async close() { /* no-op */ }
  }
  class Queue {
    name: string;
    constructor(name: string) { this.name = name; }
    on() { return this; }
    async add() { return { id: 'mock' }; }
  }
  class QueueEvents {
    on() { return this; }
    async close() { /* no-op */ }
  }
  return { Worker, Queue, QueueEvents };
});

jest.mock('../../queue/bullmqClient', () => ({
  getConnectionConfig: () => ({}),
  getRedisConfig: () => ({}),
  getRedisConnection: () => ({}),
  getQueuePrefix: () => 'bull',
  getWorker: (name: string, processor: (job: unknown) => unknown) => {
    const { Worker } = jest.requireMock('bullmq');
    return new Worker(name, processor);
  },
}));
jest.mock('../../observability/queueObservability', () => ({ observeQueueEvents: jest.fn() }));
jest.mock('../../observability/traceKit', () => ({
  runWithJobTraceContext: (_job: unknown, fn: () => unknown) => fn(),
}));

// Every job processor a shared consumer can reach, each tagged with its family.
const mockReached: string[] = [];
const mockProcessor = (family: string) => jest.fn(async () => { mockReached.push(family); });
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
jest.mock('../../queue/jobProcessors/asyncRefinementProcessor', () => ({
  processAsyncRefinementJob: mockProcessor('planner-refinement'),
}));
jest.mock('../../services/listeningExecutionService', () => ({
  processListeningExecution: mockProcessor('listening-executions'),
}));
jest.mock('../../services/asyncSemanticRuntimeService', () => ({
  processSemanticPartition: mockProcessor('semantic-indexing'),
}));
jest.mock('../../services/replayCoordinationService', () => ({
  processReplayPartition: mockProcessor('replay-partition'),
}));
jest.mock('../../workers/automationTaskWorker', () => ({
  runAutomationTaskJob: mockProcessor('automation-tasks'),
  automationTaskConcurrency: () => 1,
}));

import { registerSharedConsumers } from '../../queue/workerTopology';
import { startContentWorkers } from '../../queue/contentGenerationQueues';
import {
  QUEUE_TOPOLOGY,
  sharedConsumedQueues,
  neverConsumedQueues,
  genericContentQueueNames,
  queuesOwnedBy,
} from '../../queue/workerTopologyManifest';

const GENERIC_QUEUES = [
  'content-blog',
  'content-post',
  'content-whitepaper',
  'content-story',
  'content-newsletter',
  'content-engagement',
  'content-refinement',
];

const DEDICATED_QUEUES: Record<string, string> = {
  'creator-video': 'creator-content',
  'creator-carousel': 'creator-content',
  'creator-story': 'creator-content',
  'whatsapp-broadcast': 'whatsapp-broadcast',
  'whatsapp-webhook': 'whatsapp-webhook',
  'analytics-ingestion': 'analytics-ingestion',
};

/** Queue → families actually reached by the consumers constructed on it. */
async function reachedFamiliesByQueue(): Promise<Map<string, string[]>> {
  const byQueue = new Map<string, string[]>();
  for (const consumer of mockConstructed) {
    mockReached.length = 0;
    // Carries every id the getWorker-based wrappers require, so none short-circuits.
    await consumer.processor({
      id: 'topology-probe',
      queueName: consumer.queue,
      data: { executionId: 'probe', partitionId: 'probe' },
    });
    expect(mockReached).toHaveLength(1); // one consumer reaches exactly one processor
    byQueue.set(consumer.queue, [...(byQueue.get(consumer.queue) ?? []), mockReached[0]]);
  }
  return byQueue;
}

describe('worker topology — manifest ownership', () => {
  it('every shared queue declares exactly one owning consumer family', () => {
    for (const entry of sharedConsumedQueues()) {
      expect(entry.consumer).toBeDefined();
    }
    for (const entry of QUEUE_TOPOLOGY.filter((q) => q.consumedVia !== 'shared')) {
      expect(entry.consumer).toBeUndefined();
    }
  });

  it('the generic content family owns exactly the seven content-* queues', () => {
    expect([...genericContentQueueNames()].sort()).toEqual([...GENERIC_QUEUES].sort());
  });

  it('each dedicated queue is owned by its dedicated family, never the generic one', () => {
    for (const [queue, family] of Object.entries(DEDICATED_QUEUES)) {
      const entry = QUEUE_TOPOLOGY.find((q) => q.queue === queue);
      expect(entry?.consumedVia).toBe('shared');
      expect(entry?.consumer).toBe(family);
    }
    expect(queuesOwnedBy('creator-content').sort()).toEqual(['creator-carousel', 'creator-story', 'creator-video']);
  });

  it('bolt-content-jobs stays unowned and never consumed', () => {
    const entry = QUEUE_TOPOLOGY.find((q) => q.queue === 'bolt-content-jobs');
    expect(entry?.consumedVia).toBe('none');
    expect(entry?.consumer).toBeUndefined();
  });
});

describe.each(['prod', 'dev'] as const)('worker topology — registerSharedConsumers(%s) behaviour', (bootstrap) => {
  let byQueue: Map<string, string[]>;

  beforeAll(async () => {
    mockConstructed.length = 0;
    const handles = await registerSharedConsumers({ bootstrap });
    expect(handles.failures).toEqual([]);
    byQueue = await reachedFamiliesByQueue();
  });

  it.each(GENERIC_QUEUES)('generic queue %s has exactly one consumer: the generic processor', (queue) => {
    expect(byQueue.get(queue)).toEqual(['generic-content']);
  });

  it.each(Object.entries(DEDICATED_QUEUES))(
    'dedicated queue %s has zero generic consumers and exactly one %s consumer',
    (queue, family) => {
      const families = byQueue.get(queue) ?? [];
      expect(families.filter((f) => f === 'generic-content')).toHaveLength(0);
      expect(families).toEqual([family]);
    },
  );

  it('bolt-content-jobs has zero consumers', () => {
    expect(byQueue.get('bolt-content-jobs')).toBeUndefined();
  });

  it.each(neverConsumedQueues().map((q) => q.queue))('never-consumed queue %s has zero consumers', (queue) => {
    expect(byQueue.get(queue)).toBeUndefined();
  });

  it('every shared queue gets exactly one consumer, of the family the manifest names', () => {
    for (const entry of sharedConsumedQueues()) {
      expect({ queue: entry.queue, families: byQueue.get(entry.queue) }).toEqual({
        queue: entry.queue,
        families: [entry.consumer],
      });
    }
  });

  it('no consumer is constructed for a queue outside the manifest shared set', () => {
    const shared = new Set(sharedConsumedQueues().map((q) => q.queue));
    for (const queue of byQueue.keys()) expect(shared.has(queue)).toBe(true);
    expect(mockConstructed).toHaveLength(shared.size);
  });
});

describe('startContentWorkers — the generic authority on its own', () => {
  it('constructs consumers for the seven content-* queues and nothing else', async () => {
    mockConstructed.length = 0;
    await startContentWorkers(async () => undefined);
    expect(mockConstructed.map((c) => c.queue).sort()).toEqual([...GENERIC_QUEUES].sort());
  });
});
