/**
 * PARITY GATE — worker topology parity (dev ↔ prod). F-07 / W1-3 edition.
 *
 * The incident class: a queue is consumed on localhost (dev:full →
 * startWorkers.ts) but NOT by the production worker (main.ts), so prod jobs
 * sit in `waiting` forever — invisible until the feature is used. Creator
 * content was one instance; the W1-3 audit found seven more families
 * (content-*, planner-refinement, listening/semantic/replay).
 *
 * The manifest now lives in SOURCE (backend/queue/workerTopologyManifest.ts —
 * pure data, importable here without side effects) and shared consumers are
 * registered by ONE module (workerTopology.ts) called from BOTH bootstraps.
 * This gate asserts:
 *   1. both bootstraps invoke registerSharedConsumers(),
 *   2. every `consumedVia:'shared'` queue is registered by the shared module
 *      (via mapped evidence tokens — same string-literal technique as before),
 *   3. every `consumedVia:'inline'` queue appears in the bootstrap(s) that
 *      the manifest declares consume it,
 *   4. `consumedVia:'none'` queues are never registered anywhere,
 *   5. REMOVED infrastructure stays removed (orphan files do not return).
 *
 * Wiring or unwiring ANY consumer requires updating the manifest in the same
 * change — that is the contract.
 */
import fs from 'fs';
import path from 'path';
import {
  QUEUE_TOPOLOGY,
  sharedConsumedQueues,
  neverConsumedQueues,
} from '../../queue/workerTopologyManifest';

const ROOT = path.join(__dirname, '..', '..');
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const exists = (rel: string) => fs.existsSync(path.join(ROOT, rel));

const mainTs = read('workers/main.ts');
const startWorkersTs = read('queue/startWorkers.ts');
const topologyTs = read('queue/workerTopology.ts');
const contentQueuesTs = read('queue/contentGenerationQueues.ts');

const hasLiteral = (src: string, queue: string): boolean =>
  src.includes(`'${queue}'`) || src.includes(`"${queue}"`);

/**
 * Inline-consumption evidence in a bootstrap: the queue-name literal, or the
 * shared factory call for queues whose literal lives in the factory module
 * (intelligence-polling → getIntelligencePollingWorker, creator-render →
 * createCreatorRenderWorker).
 */
function bootstrapConsumes(src: string, queue: string): boolean {
  if (hasLiteral(src, queue)) return true;
  if (queue === 'intelligence-polling') {
    return src.includes('getIntelligencePollingWorker(')
      && hasLiteral(read('workers/intelligencePollingWorker.ts'), queue);
  }
  if (queue === 'creator-render') {
    return src.includes('createCreatorRenderWorker(')
      && hasLiteral(read('services/creatorRenderDurableQueue.ts'), queue);
  }
  return false;
}

/**
 * Evidence that the SHARED registrar actually covers a queue. Registration
 * goes through helper authorities, so per-queue evidence is either a queue
 * literal or the authority call in workerTopology.ts plus the queue literal
 * in the authority's module (contentGenerationQueues.ts).
 */
function sharedRegistrarCovers(queue: string): boolean {
  if (hasLiteral(topologyTs, queue)) return true; // e.g. 'planner-refinement'
  if (queue.startsWith('content-')) {
    return topologyTs.includes('startContentWorkers(') && hasLiteral(contentQueuesTs, queue);
  }
  if (queue.startsWith('creator-')) {
    return topologyTs.includes('startCreatorContentWorkers(') && hasLiteral(contentQueuesTs, queue);
  }
  if (queue === 'whatsapp-broadcast') {
    return topologyTs.includes('startWhatsAppBroadcastWorker(') && hasLiteral(contentQueuesTs, queue);
  }
  if (queue === 'whatsapp-webhook') {
    return topologyTs.includes('startWhatsAppWebhookWorker(') && hasLiteral(contentQueuesTs, queue);
  }
  if (queue === 'analytics-ingestion') {
    return topologyTs.includes('startAnalyticsIngestionWorker(') && hasLiteral(contentQueuesTs, queue);
  }
  if (queue === 'listening-executions') {
    return topologyTs.includes('LISTENING_EXECUTION_QUEUE_NAME')
      && hasLiteral(read('queue/listeningExecutionQueue.ts'), queue);
  }
  if (queue === 'semantic-indexing') {
    return topologyTs.includes('SEMANTIC_PARTITION_QUEUE_NAME')
      && hasLiteral(read('types/semanticIndexingPartition.ts'), queue);
  }
  if (queue === 'replay-partition') {
    return topologyTs.includes('REPLAY_PARTITION_QUEUE_NAME')
      && hasLiteral(read('types/replayPartition.ts'), queue);
  }
  return false;
}

describe('worker topology parity (manifest ↔ bootstraps)', () => {
  it('manifest queue names are unique and fully classified', () => {
    const names = QUEUE_TOPOLOGY.map((q) => q.queue);
    expect(new Set(names).size).toBe(names.length);
    for (const q of QUEUE_TOPOLOGY) {
      expect(['inline', 'shared', 'none']).toContain(q.consumedVia);
      expect(['OK', 'DORMANT', 'SUPERSEDED', 'REMOVED']).toContain(q.status);
    }
  });

  it('BOTH bootstraps register shared consumers through the ONE topology module', () => {
    expect(mainTs).toContain("registerSharedConsumers({ bootstrap: 'prod'");
    expect(startWorkersTs).toContain("registerSharedConsumers({ bootstrap: 'dev'");
  });

  it.each(sharedConsumedQueues())(
    'shared registrar covers "$queue" (consumedVia:shared)',
    ({ queue }) => {
      expect(sharedRegistrarCovers(queue)).toBe(true);
    },
  );

  it.each(QUEUE_TOPOLOGY.filter((q) => q.consumedVia === 'inline' && q.prodConsumed))(
    'prod bootstrap consumes inline queue "$queue"',
    ({ queue }) => {
      expect(bootstrapConsumes(mainTs, queue)).toBe(true);
    },
  );

  it.each(QUEUE_TOPOLOGY.filter((q) => q.consumedVia === 'inline' && q.devConsumed))(
    'dev bootstrap consumes inline queue "$queue"',
    ({ queue }) => {
      expect(bootstrapConsumes(startWorkersTs, queue)).toBe(true);
    },
  );

  it.each(neverConsumedQueues())(
    '"$queue" is consumed by NEITHER bootstrap (status: $status)',
    ({ queue }) => {
      // Registration evidence would be the literal in a bootstrap or the
      // shared registrar. (Manifest/doc references live elsewhere.)
      expect(hasLiteral(topologyTs, queue)).toBe(false);
      expect(hasLiteral(mainTs, queue)).toBe(false);
      expect(hasLiteral(startWorkersTs, queue)).toBe(false);
    },
  );

  it('bolt-content-jobs stays SUPERSEDED — startBoltContentWorkers wired nowhere', () => {
    expect(mainTs).not.toContain('startBoltContentWorkers');
    expect(startWorkersTs).not.toContain('startBoltContentWorkers');
    expect(topologyTs).not.toContain('startBoltContentWorkers');
  });

  it('W1-4 removed orphan infrastructure stays removed', () => {
    // lead-jobs: no producer, no consumer; module-level Redis connection at
    // import time. Deleted in W1-4 — must not return without a manifest change.
    expect(exists('queue/leadQueue.ts')).toBe(false);
    expect(exists('workers/leadWorker.ts')).toBe(false);
    // Legacy duplicate engine-jobs worker (untuned, double-consume risk).
    expect(exists('queue/worker.ts')).toBe(false);
    const removed = QUEUE_TOPOLOGY.filter((q) => q.status === 'REMOVED').map((q) => q.queue);
    expect(removed).toContain('lead-jobs');
  });
});
