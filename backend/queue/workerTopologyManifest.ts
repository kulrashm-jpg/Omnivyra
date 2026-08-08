/**
 * F-07 — Worker topology manifest (Foundation Batch B).
 *
 * SINGLE SOURCE OF TRUTH for every BullMQ queue in the platform: who produces
 * it, which bootstrap consumes it, and HOW it is registered. Promoted out of
 * workerTopologyParity.test.ts (where it covered 14 queues) and extended to
 * the full topology after the W1-3 audit verified every producer.
 *
 * PURE DATA — no imports, no side effects. Safe to import from tests, CI
 * gates, ops tooling, and both bootstraps.
 *
 * consumedVia:
 *   'inline' — constructed directly in the bootstrap file(s) (worker options
 *              differ per bootstrap for historical reasons; divergences are
 *              documented per entry and MUST NOT be silently unified).
 *   'shared' — registered by registerSharedConsumers() (workerTopology.ts) in
 *              BOTH bootstraps. This is the default for all new queues.
 *   'none'   — no consumer anywhere, by explicit decision (status explains).
 *
 * Change protocol: wiring or removing any consumer REQUIRES updating this
 * manifest in the same change — the parity test fails otherwise.
 */

export type QueueStatus =
  | 'OK'               // consumed where declared; topology verified
  | 'DORMANT'          // no producer and no consumer; kept for depth-readers
  | 'SUPERSEDED'       // replaced by another path; must never gain a consumer
  | 'REMOVED';         // deleted infrastructure (kept for audit trail)

export interface QueueTopologyEntry {
  queue: string;
  /** Verified producer evidence (file/route), or the absence finding. */
  enqueuedBy: string;
  prodConsumed: boolean;
  devConsumed: boolean;
  consumedVia: 'inline' | 'shared' | 'none';
  status: QueueStatus;
  note?: string;
}

export const QUEUE_TOPOLOGY: QueueTopologyEntry[] = [
  // ── Core workers — inline in both bootstraps (options differ; documented) ──
  { queue: 'publish', enqueuedBy: 'publishing pipeline (schedulerService enqueue + BullMQ delay)', prodConsumed: true, devConsumed: true, consumedVia: 'inline', status: 'OK' },
  { queue: 'bolt-execution', enqueuedBy: 'boltPipelineService', prodConsumed: true, devConsumed: true, consumedVia: 'inline', status: 'OK' },
  { queue: 'engagement-polling', enqueuedBy: 'schedulerService enqueueEngagementPolling', prodConsumed: true, devConsumed: true, consumedVia: 'inline', status: 'OK', note: 'DIVERGENCE (pre-existing, preserved): prod concurrency 1, dev getWorker default 5. Unification deferred to W3 (B-23).' },
  { queue: 'engine-jobs', enqueuedBy: 'lead/market-pulse enqueue (jobQueue.addBulk)', prodConsumed: true, devConsumed: true, consumedVia: 'inline', status: 'OK', note: 'DIVERGENCE (pre-existing, preserved): prod new Worker (env concurrency, drainDelay 300); dev getWorker (concurrency 2, 10/1s limiter).' },
  { queue: 'intelligence-polling', enqueuedBy: 'cron enqueueIntelligencePolling', prodConsumed: true, devConsumed: true, consumedVia: 'inline', status: 'OK', note: 'both bootstraps use the shared getIntelligencePollingWorker() factory' },
  { queue: 'creator-render', enqueuedBy: 'creatorRenderDurableQueue (runCreatorAssetGenerationRuntime)', prodConsumed: true, devConsumed: true, consumedVia: 'inline', status: 'OK', note: 'both use createCreatorRenderWorker + withHeavyJobSlot' },
  { queue: 'ai-heavy', enqueuedBy: 'campaign planning enqueue (plan-v2 / boltProcessor)', prodConsumed: true, devConsumed: false, consumedVia: 'inline', status: 'OK', note: 'prod-only inline worker; dev campaign-planning v2 requires the prod-style worker (known dev limitation, out of W1 scope)' },
  { queue: 'lead-thread-recompute', enqueuedBy: 'DB-insert trigger + cron safety-net drain', prodConsumed: true, devConsumed: false, consumedVia: 'inline', status: 'OK', note: 'event-driven; prod-only by design (cron co-located with prod worker)' },
  { queue: 'conversation-memory-rebuild', enqueuedBy: 'DB-insert trigger + cron safety-net drain', prodConsumed: true, devConsumed: false, consumedVia: 'inline', status: 'OK', note: 'event-driven; prod-only by design' },

  // ── Shared consumers — registerSharedConsumers() in BOTH bootstraps (W1-3) ──
  { queue: 'content-blog', enqueuedBy: 'pages/api/blogs/generate.ts (legacy no-mode path, getContentQueue)', prodConsumed: true, devConsumed: true, consumedVia: 'shared', status: 'OK', note: 'W1-3 gap closure: was dev-only; prod enqueues sat in waiting forever (B-02)' },
  { queue: 'content-post', enqueuedBy: 'contentGenerationQueues CONTENT_TYPE map (unified generation paths)', prodConsumed: true, devConsumed: true, consumedVia: 'shared', status: 'OK', note: 'W1-3 gap closure (B-02)' },
  { queue: 'content-whitepaper', enqueuedBy: 'contentGenerationQueues CONTENT_TYPE map', prodConsumed: true, devConsumed: true, consumedVia: 'shared', status: 'OK', note: 'W1-3 gap closure (B-02)' },
  { queue: 'content-story', enqueuedBy: 'contentGenerationQueues CONTENT_TYPE map', prodConsumed: true, devConsumed: true, consumedVia: 'shared', status: 'OK', note: 'W1-3 gap closure (B-02)' },
  { queue: 'content-newsletter', enqueuedBy: 'contentGenerationQueues CONTENT_TYPE map', prodConsumed: true, devConsumed: true, consumedVia: 'shared', status: 'OK', note: 'W1-3 gap closure (B-02)' },
  { queue: 'content-engagement', enqueuedBy: 'contentGenerationQueues CONTENT_TYPE map (time-critical replies)', prodConsumed: true, devConsumed: true, consumedVia: 'shared', status: 'OK', note: 'W1-3 gap closure (B-02)' },
  { queue: 'content-refinement', enqueuedBy: 'contentGenerationQueues CONTENT_TYPE map', prodConsumed: true, devConsumed: true, consumedVia: 'shared', status: 'OK', note: 'W1-3 gap closure (B-02)' },
  { queue: 'creator-video', enqueuedBy: 'boltCreatorQueueBridge', prodConsumed: true, devConsumed: true, consumedVia: 'shared', status: 'OK' },
  { queue: 'creator-carousel', enqueuedBy: 'boltCreatorQueueBridge', prodConsumed: true, devConsumed: true, consumedVia: 'shared', status: 'OK' },
  { queue: 'creator-story', enqueuedBy: 'boltCreatorQueueBridge', prodConsumed: true, devConsumed: true, consumedVia: 'shared', status: 'OK' },
  { queue: 'whatsapp-broadcast', enqueuedBy: 'whatsappBroadcastService.ts:202,358', prodConsumed: true, devConsumed: true, consumedVia: 'shared', status: 'OK' },
  { queue: 'whatsapp-webhook', enqueuedBy: 'pages/api/whatsapp/webhook', prodConsumed: true, devConsumed: true, consumedVia: 'shared', status: 'OK' },
  { queue: 'analytics-ingestion', enqueuedBy: 'pages/api/cron/analytics-ingestion (vercel.json daily cron)', prodConsumed: true, devConsumed: true, consumedVia: 'shared', status: 'OK' },
  { queue: 'planner-refinement', enqueuedBy: 'campaignAiOrchestrator (gated ASYNC_REFINEMENT_ENABLED; plannerRolloutMode can flip live)', prodConsumed: true, devConsumed: true, consumedVia: 'shared', status: 'OK', note: 'W1-3 gap closure: consumer attaches even while the enqueue flag is off so queued jobs from an enabled period drain (dev-documented semantics)' },
  { queue: 'listening-executions', enqueuedBy: 'listeningExecutionService enqueue', prodConsumed: true, devConsumed: true, consumedVia: 'shared', status: 'OK', note: 'W1-3 gap closure (B-02)' },
  { queue: 'automation-tasks', enqueuedBy: 'NONE — WS-6C Phase 2 declares the queue only; the orchestrator enqueue lands in a later phase', prodConsumed: false, devConsumed: false, consumedVia: 'none', status: 'DORMANT', note: 'WS-6C Phase 2. Infrastructure only: no producer, no consumer, Automation execution impossible. Gated by AUTOMATION_RUNTIME_ENABLED (WS-6C1, default OFF). Wiring the WS-6D processor/worker REQUIRES flipping consumedVia and status in the same change.' },
  { queue: 'semantic-indexing', enqueuedBy: 'asyncSemanticRuntimeService enqueue', prodConsumed: true, devConsumed: true, consumedVia: 'shared', status: 'OK', note: 'W1-3 gap closure (B-02)' },
  { queue: 'replay-partition', enqueuedBy: 'replayCoordinationService enqueue', prodConsumed: true, devConsumed: true, consumedVia: 'shared', status: 'OK', note: 'W1-3 gap closure (B-02)' },

  // ── Deliberate non-consumption ──────────────────────────────────────────────
  { queue: 'posting', enqueuedBy: 'NO PRODUCER — intentExecutionService QUEUE_BY_PRIORITY maps to it but is dead code (defined, never referenced)', prodConsumed: false, devConsumed: false, consumedVia: 'none', status: 'DORMANT', note: 'W1-4 verified: no enqueue anywhere. Queue object kept ONLY because autoScalingSignal + /api/internal/metrics read its depth. Wire a consumer or delete the readers before ever producing to it.' },
  { queue: 'bolt-content-jobs', enqueuedBy: 'structuredPlanScheduler.ts (run_id-gated; never enqueued)', prodConsumed: false, devConsumed: false, consumedVia: 'none', status: 'SUPERSEDED', note: 'inline processBlockSchedule is the live path; must NOT be wired into any bootstrap' },
  { queue: 'lead-jobs', enqueuedBy: 'NO PRODUCER (verified W1-4) — live lead enqueues go to engine-jobs via jobQueue', prodConsumed: false, devConsumed: false, consumedVia: 'none', status: 'REMOVED', note: 'W1-4: leadQueue.ts + leadWorker.ts deleted (orphan; module-level Redis connection at import). lead-jobs-dlq retained lazily in leadQueueHardening; it is a SINK (producer-only, no consumer) fed by the engine-jobs failed handler in startWorkers.ts once a LEAD job exhausts its attempts.' },
];

/** Queues the shared registrar must consume in BOTH bootstraps. */
export function sharedConsumedQueues(): QueueTopologyEntry[] {
  return QUEUE_TOPOLOGY.filter((q) => q.consumedVia === 'shared');
}

/** Queues that must never have a consumer registered anywhere. */
export function neverConsumedQueues(): QueueTopologyEntry[] {
  return QUEUE_TOPOLOGY.filter((q) => q.consumedVia === 'none');
}
