/**
 * PARITY GATE — worker topology parity (dev ↔ prod).
 *
 * The original incident class: a queue is consumed on localhost (dev:full →
 * startWorkers.ts) but NOT by the production worker (main.ts → Dockerfile.worker
 * CMD), so jobs are produced in prod and never processed — invisible until the
 * feature is used. The creator-content queues were one instance; an audit found
 * four more (whatsapp-*, analytics-ingestion, bolt-content-jobs).
 *
 * This manifest is the SINGLE SOURCE OF TRUTH for which queues the production
 * worker must consume. The test asserts main.ts matches the manifest exactly:
 *   - prodConsumed:true  → main.ts MUST register it (a consumer cannot silently vanish).
 *   - prodConsumed:false → main.ts MUST NOT register it (so wiring a consumer
 *     trips this test and forces a conscious manifest update + sign-off).
 *
 * KNOWN GAPS are pinned as status:'PENDING_REVIEW' (owner deciding which features
 * are live in prod). They are tracked, not silently tolerated. When one is wired
 * into main.ts, flip prodConsumed→true and status→'OK' in the same change.
 *
 * Source-level assertions only (no Redis / BullMQ imports). Detection = exact
 * queue-name string literal presence in main.ts, which is reliable (regex
 * enumeration of `new Worker` forms is NOT — do not use it here).
 */
import fs from 'fs';
import path from 'path';

const ROOT = path.join(__dirname, '..', '..');
const mainTs = fs.readFileSync(path.join(ROOT, 'workers', 'main.ts'), 'utf8');

type Status = 'OK' | 'PENDING_REVIEW' | 'SUPERSEDED';

interface QueueTopology {
  queue: string;
  /** Where prod code enqueues to it (evidence the queue is real/active). */
  enqueuedBy: string;
  /** Whether the PRODUCTION worker (main.ts) is expected to consume it. */
  prodConsumed: boolean;
  status: Status;
  note?: string;
}

/** Returns true iff main.ts references the queue-name literal. */
function mainConsumes(queue: string): boolean {
  return mainTs.includes(`'${queue}'`) || mainTs.includes(`"${queue}"`);
}

const QUEUE_TOPOLOGY: QueueTopology[] = [
  // ── Verified consumed by the prod worker (regression guard) ──
  { queue: 'publish', enqueuedBy: 'publishing pipeline', prodConsumed: true, status: 'OK' },
  { queue: 'bolt-execution', enqueuedBy: 'boltPipelineService', prodConsumed: true, status: 'OK' },
  { queue: 'engagement-polling', enqueuedBy: 'engagement scheduler', prodConsumed: true, status: 'OK' },
  { queue: 'lead-thread-recompute', enqueuedBy: 'DB-insert trigger', prodConsumed: true, status: 'OK' },
  { queue: 'conversation-memory-rebuild', enqueuedBy: 'DB-insert trigger', prodConsumed: true, status: 'OK' },
  { queue: 'engine-jobs', enqueuedBy: 'lead/market-pulse enqueue', prodConsumed: true, status: 'OK' },
  { queue: 'ai-heavy', enqueuedBy: 'campaign planning enqueue', prodConsumed: true, status: 'OK' },
  { queue: 'creator-video', enqueuedBy: 'boltCreatorQueueBridge', prodConsumed: true, status: 'OK' },
  { queue: 'creator-carousel', enqueuedBy: 'boltCreatorQueueBridge', prodConsumed: true, status: 'OK' },
  { queue: 'creator-story', enqueuedBy: 'boltCreatorQueueBridge', prodConsumed: true, status: 'OK' },

  // ── Resolved by WORKER-TOPOLOGY-PARITY-REMEDIATION (per PROD-QUEUE-CONTRACT-AUDIT) ──
  // REQUIRED_IN_PRODUCTION: enqueued/exposed in prod; now wired into main.ts via
  // the same authority used by dev (startWorkers.ts).
  { queue: 'whatsapp-broadcast', enqueuedBy: 'whatsappBroadcastService.ts:202,358', prodConsumed: true, status: 'OK', note: 'wired into main.ts (remediation)' },
  { queue: 'whatsapp-webhook', enqueuedBy: 'pages/api/whatsapp/webhook', prodConsumed: true, status: 'OK', note: 'wired into main.ts (remediation)' },
  { queue: 'analytics-ingestion', enqueuedBy: 'pages/api/cron/analytics-ingestion (vercel.json daily cron)', prodConsumed: true, status: 'OK', note: 'wired into main.ts (remediation)' },

  // SUPERSEDED: producer queueBoltContentJobs is run_id-gated and NO caller
  // passes run_id → never enqueued in dev OR prod. Consumed by NEITHER bootstrap
  // after remediation (removed from startWorkers.ts). Inline processBlockSchedule
  // is the live scheduling path. Must NOT be wired into main.ts.
  { queue: 'bolt-content-jobs', enqueuedBy: 'structuredPlanScheduler.ts:951 (run_id-gated; never enqueued)', prodConsumed: false, status: 'SUPERSEDED', note: 'removed from dev bootstrap; inline path supersedes it' },
];

describe('worker topology parity (prod main.ts ↔ manifest)', () => {
  it.each(QUEUE_TOPOLOGY.filter((q) => q.prodConsumed))(
    'prod consumes "$queue" (declared prodConsumed:true)',
    ({ queue }) => {
      expect(mainConsumes(queue)).toBe(true);
    },
  );

  it.each(QUEUE_TOPOLOGY.filter((q) => !q.prodConsumed))(
    'prod does NOT consume "$queue" (declared prodConsumed:false)',
    ({ queue }) => {
      // If this fails, someone wired a consumer into main.ts WITHOUT updating
      // the manifest. Update QUEUE_TOPOLOGY (prodConsumed:true, status:'OK').
      expect(mainConsumes(queue)).toBe(false);
    },
  );

  it('all topology gaps resolved — 0 PENDING_REVIEW', () => {
    const pending = QUEUE_TOPOLOGY.filter((q) => q.status === 'PENDING_REVIEW');
    expect(pending.length).toBe(0);
  });

  it('bolt-content-jobs is SUPERSEDED and consumed by NEITHER bootstrap (parity)', () => {
    const entry = QUEUE_TOPOLOGY.find((q) => q.queue === 'bolt-content-jobs');
    expect(entry?.status).toBe('SUPERSEDED');
    expect(entry?.prodConsumed).toBe(false);
    expect(mainConsumes('bolt-content-jobs')).toBe(false);
    const startWorkersTs = fs.readFileSync(path.join(ROOT, 'queue', 'startWorkers.ts'), 'utf8');
    expect(startWorkersTs).not.toContain('startBoltContentWorkers');
  });
});
