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
 *   2. every `consumedVia:'inline'` queue appears in the bootstrap(s) that
 *      the manifest declares consume it,
 *   3. `consumedVia:'none'` queues are never registered anywhere,
 *   4. REMOVED infrastructure stays removed (orphan files do not return).
 *
 * What the SHARED registrar actually consumes — one consumer per shared queue,
 * of the owning family, and nothing on dedicated or never-consumed queues — is
 * asserted BEHAVIOURALLY in workerTopologyConsumers.test.ts. The string-literal
 * evidence that used to live here could not see startContentWorkers looping
 * over every CONTENT_QUEUE_CONFIG entry, which is how a generic consumer ended
 * up on the dedicated creator/whatsapp/analytics queues.
 *
 * Wiring or unwiring ANY consumer requires updating the manifest in the same
 * change — that is the contract.
 */
import fs from 'fs';
import path from 'path';
import {
  QUEUE_TOPOLOGY,
  neverConsumedQueues,
} from '../../queue/workerTopologyManifest';

const ROOT = path.join(__dirname, '..', '..');
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const exists = (rel: string) => fs.existsSync(path.join(ROOT, rel));

const mainTs = read('workers/main.ts');
const startWorkersTs = read('queue/startWorkers.ts');
const topologyTs = read('queue/workerTopology.ts');

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
      // Registration evidence would be the literal in a bootstrap or the shared
      // registrar. (Manifest/doc references live elsewhere.) That no shared
      // consumer is CONSTRUCTED for these queues is asserted behaviourally in
      // workerTopologyConsumers.test.ts.
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
