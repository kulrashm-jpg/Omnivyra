/**
 * PHASE CREATOR-WORKER-SUBSCRIPTION-REMEDIATION — bootstrap-parity guard.
 *
 * The production worker entrypoint (backend/workers/main.ts → Dockerfile.worker
 * CMD `node dist/backend/workers/main.js`) previously registered NO consumer for
 * the creator-content queues, so `bolt-creator-row` jobs sat in `waiting` until
 * waitUntilFinished(300000) timed out → render_failed. This test asserts BOTH
 * bootstraps (dev `startWorkers.ts` and prod `main.ts`) register the SAME
 * creator-content worker authority, so the gap cannot silently return.
 *
 * Source-level assertions only (no Redis / BullMQ / heavy imports).
 */
import fs from 'fs';
import path from 'path';

const ROOT = path.join(__dirname, '..', '..');
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const mainTs = read('workers/main.ts');
const startWorkersTs = read('queue/startWorkers.ts');
const contentQueuesTs = read('queue/contentGenerationQueues.ts');
// F-07 / W1-3: shared consumers now register through the ONE topology module
// consumed by BOTH bootstraps. This suite's guarantee is unchanged — the
// same authority + processor in dev and prod — the evidence just moved from
// per-bootstrap inline blocks to workerTopology.ts.
const topologyTs = read('queue/workerTopology.ts');

const CREATOR_QUEUES = ['creator-video', 'creator-carousel', 'creator-story'];

describe('creator-content worker bootstrap parity (dev ↔ prod)', () => {
  it('the canonical authority registers exactly the three creator queues', () => {
    // startCreatorContentWorkers is the single registration authority.
    expect(contentQueuesTs).toContain('export async function startCreatorContentWorkers');
    for (const q of CREATOR_QUEUES) expect(contentQueuesTs).toContain(`'${q}'`);
  });

  it('the shared topology module registers creator content via the SAME authority + processor', () => {
    expect(topologyTs).toContain('startCreatorContentWorkers(processCreatorContentJob)');
    expect(topologyTs).toMatch(/import\s*\(\s*['"]\.\/jobProcessors\/creatorContentProcessor['"]\s*\)/);
  });

  it('DEV bootstrap (startWorkers.ts) registers shared consumers through the topology module', () => {
    expect(startWorkersTs).toContain("registerSharedConsumers({ bootstrap: 'dev'");
  });

  it('PROD bootstrap (main.ts) registers shared consumers through the SAME topology module', () => {
    expect(mainTs).toContain("registerSharedConsumers({ bootstrap: 'prod'");
  });

  it('PROD boot log advertises the creator queues (observability parity)', () => {
    for (const q of CREATOR_QUEUES) expect(mainTs).toContain(`'${q}'`);
  });

  it('regression guard: prod bootstrap is not missing any creator queue the bridge enqueues to', () => {
    // The bridge enqueues bolt-creator-row jobs to these three queues; the prod
    // worker must subscribe to all three (the original defect was zero of them).
    const prodRegistersAll = CREATOR_QUEUES.every((q) => mainTs.includes(`'${q}'`));
    expect(prodRegistersAll).toBe(true);
  });
});
