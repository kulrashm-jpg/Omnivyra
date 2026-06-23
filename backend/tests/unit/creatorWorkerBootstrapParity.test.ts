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

const CREATOR_QUEUES = ['creator-video', 'creator-carousel', 'creator-story'];

describe('creator-content worker bootstrap parity (dev ↔ prod)', () => {
  it('the canonical authority registers exactly the three creator queues', () => {
    // startCreatorContentWorkers is the single registration authority.
    expect(contentQueuesTs).toContain('export async function startCreatorContentWorkers');
    for (const q of CREATOR_QUEUES) expect(contentQueuesTs).toContain(`'${q}'`);
  });

  it('DEV bootstrap (startWorkers.ts) registers the creator-content workers', () => {
    expect(startWorkersTs).toContain('startCreatorContentWorkers(processCreatorContentJob)');
  });

  it('PROD bootstrap (main.ts) registers the creator-content workers via the SAME authority', () => {
    // Imports the same authority + processor (no second implementation).
    expect(mainTs).toMatch(/import\s*\{\s*startCreatorContentWorkers\s*\}\s*from\s*['"]\.\.\/queue\/contentGenerationQueues['"]/);
    expect(mainTs).toMatch(/import\s*\{\s*processCreatorContentJob\s*\}\s*from\s*['"]\.\.\/queue\/jobProcessors\/creatorContentProcessor['"]/);
    // And calls it.
    expect(mainTs).toContain('startCreatorContentWorkers(processCreatorContentJob)');
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
