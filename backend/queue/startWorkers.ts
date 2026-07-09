/**
 * Unified Worker Bootstrap
 *
 * Starts publish, engagement-polling, bolt-execution, and intelligence-polling workers.
 * Can be run standalone (npm run start:workers) or auto-started via instrumentation.
 *
 * BOLT worker concurrency: min(4, cpu_cores) to prevent overload on smaller machines.
 */

import os from 'os';
import * as _diag_fs3 from 'fs';
import * as _diag_path3 from 'path';
// TEMP diagnostic — same sentinel file as instrumentation hook.
function _diag(stage: string, extra?: Record<string, unknown>): void {
  try {
    const line = JSON.stringify({ ts: new Date().toISOString(), stage, ...extra }) + '\n';
    _diag_fs3.appendFileSync(_diag_path3.join(process.cwd(), '.worker-bootstrap.log'), line);
  } catch { /* never throw from diagnostics */ }
}
_diag('startWorkers.ts:module-loaded');
import {
  getWorker,
  getUsageProtectionReady,
  verifyRedisReadyForBackgroundRuntime,
  withHeavyJobSlot,
} from './bullmqClient';
import { createCreatorRenderWorker } from '../services/creatorRenderDurableQueue';
import { processCreatorRenderJob } from '../services/creatorRenderWorkerProcessor';
import { processPublishJob } from './jobProcessors/publishProcessor';
import { processEngagementPollingJob } from './jobProcessors/engagementPollingProcessor';
import { processBoltJob } from './jobProcessors/boltProcessor';
import { processContentGenerationJob } from './jobProcessors/contentGenerationProcessor';
import { processCreatorContentJob } from './jobProcessors/creatorContentProcessor';
import { processWhatsAppBroadcastJob } from './jobProcessors/whatsappBroadcastProcessor';
import { processWhatsAppWebhookJob } from './jobProcessors/whatsappWebhookProcessor';
import { processAnalyticsIngestionJob } from './jobProcessors/analyticsIngestionProcessor';
import { getIntelligencePollingWorker } from '../workers/intelligencePollingWorker';
import { initializeContentQueues, startContentWorkers, startCreatorContentWorkers, startWhatsAppBroadcastWorker, startWhatsAppWebhookWorker, startAnalyticsIngestionWorker } from './contentGenerationQueues';

let publishWorker: ReturnType<typeof getWorker>;
let boltWorker: ReturnType<typeof getWorker>;
let engagementWorker: ReturnType<typeof getWorker>;
let engineWorker: ReturnType<typeof getWorker>;
let intelligencePollingWorker: ReturnType<typeof getIntelligencePollingWorker>;
let listeningExecutionWorker: ReturnType<typeof getWorker>;
let semanticIndexingWorker: ReturnType<typeof getWorker>;
let replayPartitionWorker: ReturnType<typeof getWorker>;
let creatorRenderWorker: ReturnType<typeof createCreatorRenderWorker> | null = null;
// Async planner refinement worker. Started AFTER usage protection is ready
// so its first job sees the same gating as inline planner calls. Graceful
// drain on shutdown — `worker.close()` waits for in-flight refinements to
// complete before exiting so we never half-write a refined plan.
let refinementWorker: ReturnType<typeof getWorker> | null = null;

const shutdown = async () => {
  await publishWorker?.close?.();
  await engagementWorker?.close?.();
  await boltWorker?.close?.();
  await engineWorker?.close?.();
  await intelligencePollingWorker?.close?.();
  await listeningExecutionWorker?.close?.();
  await semanticIndexingWorker?.close?.();
  await replayPartitionWorker?.close?.();
  if (creatorRenderWorker) {
    try { await creatorRenderWorker.close(); } catch { /* best-effort */ }
  }
  // Refinement worker close MUST be awaited last so other queues drain first
  // (their failure paths can enqueue refinement jobs). close() with no args
  // performs graceful drain — waits for active jobs, refuses new ones.
  if (refinementWorker) {
    try {
      await refinementWorker.close();
    } catch (err) {
      console.warn('[planner-refinement] worker close failed:', (err as Error)?.message);
    }
  }
  process.exit(0);
};

/**
 * Start all background workers. Call during server bootstrap.
 */
export async function startWorkers(): Promise<void> {
  _diag('startWorkers:entered');

  // HARDEN-001: begin sampling system resources (CPU/memory/event-loop lag) on
  // the long-lived worker process. Fail-safe + unref'd; no-op when disabled.
  try {
    const { startSystemSampler } = await import('../observability/system');
    startSystemSampler();
  } catch { /* fail-safe — never block worker boot on instrumentation */ }

  // ── Phase 17: thread-runtime persistence boot wiring ──
  // Workers run as a separate process (spawned by scripts/start-all.js), so
  // the bootstrap helper must be invoked here too. Idempotent in-process.
  // Memory mode = no-op; supabase mode runs a connectivity smoke test and
  // HARD-FAILS (process.exit) if registration fails — no silent downgrade.
  try {
    const { bootstrapThreadRuntimeExecutionStore } = await import(
      '../services/orchestration/persistence/bootstrapExecutionStore'
    );
    await bootstrapThreadRuntimeExecutionStore({ processKind: 'worker' });
    _diag('startWorkers:thread-runtime-persistence-ok');
  } catch (err) {
    // Supabase mode invokes fatal handler (process.exit) and never returns.
    // Memory mode never throws. Any unexpected error reaching here logs
    // but doesn't crash worker boot.
    _diag('startWorkers:thread-runtime-persistence-error', { error: err instanceof Error ? err.message : String(err) });
    console.error('[thread-runtime.persistence] worker boot register error:', (err as Error)?.message ?? err);
  }

  // ── Phase 22A: distributed runtime wiring (worker process) ──
  // Env-gated via ENABLE_DURABLE_DISTRIBUTED_RUNTIME=1 inside the helper.
  // When enabled, the activation governor runs FIRST and hard-fails on
  // unmet preconditions — no silent downgrade. This is the worker
  // process, so the runtime poll loop + heartbeat + replay sweep + compactor
  // all run here. Step builders are intentionally no-op (the BullMQ-based
  // workers below handle the actual job processing); the distributed
  // runtime layer is for queue/lease coordination across instances.
  try {
    const { wireDistributedRuntime } = await import(
      '../services/orchestration/distributed/bootWireDistributedRuntime'
    );
    await wireDistributedRuntime({ processKind: 'worker' });
    _diag('startWorkers:distributed-runtime-wired');
  } catch (err) {
    _diag('startWorkers:distributed-runtime-wire-error', {
      error: err instanceof Error ? err.message : String(err),
    });
    if (err instanceof Error && err.name === 'DistributedRuntimeActivationError') {
      // Activation governor refused — let the supervisor restart.
      throw err;
    }
    console.error('[distributed-runtime] worker wire error:', (err as Error)?.message ?? err);
  }

  const redisReady = await verifyRedisReadyForBackgroundRuntime('workers');
  if (!redisReady) {
    _diag('startWorkers:redis-unavailable-skipping-bullmq-workers');
    console.warn('[workers] Redis-backed workers skipped because Redis is unavailable.');
    return;
  }

  // ── Enterprise governance — boot wiring ──
  // Subscribes notification delivery (if NOTIFY_ENABLED=true) and runs
  // warm-start restoration (if WARM_START_ENABLED=true AND
  // REDIS_ENABLED=true). Both are idempotent + feature-flag-gated +
  // best-effort. Failures NEVER block worker boot.
  try {
    const { startNotificationDelivery } = await import(
      '../services/creator/enterpriseGovernanceNotificationDelivery'
    );
    startNotificationDelivery();
    _diag('startWorkers:enterprise-governance-notify-subscribed');
  } catch (err) {
    _diag('startWorkers:enterprise-governance-notify-error', {
      error: err instanceof Error ? err.message : String(err),
    });
    console.warn('[enterprise-governance] notify subscribe error:', (err as Error)?.message ?? err);
  }
  try {
    const { restoreReviewRecordsFromRedis } = await import(
      '../services/creator/enterpriseGovernanceWarmStart'
    );
    // Fire-and-forget — warm-start runs async; worker boot proceeds.
    void restoreReviewRecordsFromRedis().then((result) => {
      _diag('startWorkers:enterprise-governance-warm-start-complete', {
        restored: result.recordsRestored, skipped: result.recordsSkippedDuplicate,
      });
    }).catch(() => {});
  } catch (err) {
    _diag('startWorkers:enterprise-governance-warm-start-error', {
      error: err instanceof Error ? err.message : String(err),
    });
  }

  const boltConcurrency = Math.min(4, Math.max(1, os.cpus().length));

  // BUG#21 fix: await first usage-protection poll before registering workers.
  // This ensures _level is known and protection is enforced from job #1.
  try { await getUsageProtectionReady(); _diag('startWorkers:after-getUsageProtectionReady'); }
  catch (e) { _diag('startWorkers:getUsageProtectionReady-THREW', { error: e instanceof Error ? e.message : String(e) }); throw e; }

  // Initialize content generation queues (pre-flight checks, rate limiting, backpressure)
  try { await initializeContentQueues(); _diag('startWorkers:after-initializeContentQueues'); }
  catch (e) { _diag('startWorkers:initializeContentQueues-THREW', { error: e instanceof Error ? e.message : String(e) }); throw e; }

  // Start content generation workers (unified processor for all text content types)
  try { await startContentWorkers(processContentGenerationJob); _diag('startWorkers:after-startContentWorkers'); }
  catch (e) { _diag('startWorkers:startContentWorkers-THREW', { error: e instanceof Error ? e.message : String(e) }); throw e; }

  // Start creator content workers (video, carousel, story)
  try { await startCreatorContentWorkers(processCreatorContentJob); _diag('startWorkers:after-startCreatorContentWorkers'); }
  catch (e) { _diag('startWorkers:startCreatorContentWorkers-THREW', { error: e instanceof Error ? e.message : String(e) }); throw e; }

  // NOTE: bolt-content-jobs worker intentionally NOT registered. Per
  // PROD-QUEUE-CONTRACT-AUDIT it is SUPERSEDED — the producer queueBoltContentJobs
  // is gated on options.run_id and NO caller passes run_id (boltPipelineService
  // omits it for the inline path; both campaign API endpoints omit it), so the
  // queue is never enqueued in dev OR prod. Removing the dev consumer aligns
  // local↔prod topology (prod never registered it either). The inline
  // processBlockSchedule path handles structured scheduling.

  // Start WhatsApp broadcast workers (batched sends, tier-aware chunking)
  try { await startWhatsAppBroadcastWorker(processWhatsAppBroadcastJob); _diag('startWorkers:after-startWhatsAppBroadcastWorker'); }
  catch (e) { _diag('startWorkers:startWhatsAppBroadcastWorker-THREW', { error: e instanceof Error ? e.message : String(e) }); throw e; }

  // Start WhatsApp webhook event workers (async processing of Meta webhook payloads)
  try { await startWhatsAppWebhookWorker(processWhatsAppWebhookJob); _diag('startWorkers:after-startWhatsAppWebhookWorker'); }
  catch (e) { _diag('startWorkers:startWhatsAppWebhookWorker-THREW', { error: e instanceof Error ? e.message : String(e) }); throw e; }

  // Start analytics ingestion worker (daily growth + post-metric polls)
  try { await startAnalyticsIngestionWorker(processAnalyticsIngestionJob); _diag('startWorkers:after-startAnalyticsIngestionWorker'); }
  catch (e) { _diag('startWorkers:startAnalyticsIngestionWorker-THREW', { error: e instanceof Error ? e.message : String(e) }); throw e; }

  publishWorker = getWorker('publish', processPublishJob);
  boltWorker = getWorker('bolt-execution', processBoltJob, { concurrency: boltConcurrency });

  // ── PLANNER REFINEMENT WORKER ────────────────────────────────────────────
  // Async refinement is the off-path pass that polishes the alignment-recovered
  // plan after the synchronous planner returned the base. Concurrency is
  // intentionally low — refinement is a single LLM call and we don't want to
  // amplify cost. Stalled jobs are recovered by BullMQ's lock-renewal
  // mechanism (default 30s; we set a 60s lock duration to comfortably cover
  // the gateway provider timeout).
  //
  // Gated by ASYNC_REFINEMENT_ENABLED; when false we still attach the worker
  // (so any in-queue jobs from a prior enabled period drain), but the enqueue
  // side won't add new ones.
  try {
    const { processAsyncRefinementJob } =
      await import('./jobProcessors/asyncRefinementProcessor');
    const refinementConcurrency = Math.max(1, Number(process.env.PLANNER_REFINEMENT_CONCURRENCY || 2));
    // getWorker only exposes `concurrency`; BullMQ defaults for lockDuration
    // (30s) and stalledInterval (30s) are adequate for refinement, which is
    // a single sub-30s LLM call. Stalled-job recovery uses BullMQ's built-in
    // mechanism — if a worker dies mid-job, the lock expires and BullMQ
    // marks it stalled for retry.
    refinementWorker = getWorker(
      'planner-refinement',
      async (job) => {
        await processAsyncRefinementJob(job as any);
      },
      { concurrency: refinementConcurrency },
    );
    refinementWorker.on('error', (err) => {
      console.error('[planner-refinement] worker error:', err?.message ?? err);
    });
    refinementWorker.on('failed', (job, err) => {
      console.warn('[planner-refinement] job failed:', {
        job_id: job?.id,
        attempts: job?.attemptsMade,
        error: err?.message,
      });
    });
    refinementWorker.on('stalled', (jobId) => {
      console.warn('[planner-refinement] job stalled, will retry:', { job_id: jobId });
    });
    _diag('startWorkers:planner-refinement-registered', { concurrency: refinementConcurrency });
  } catch (err) {
    _diag('startWorkers:planner-refinement-register-error', {
      error: err instanceof Error ? err.message : String(err),
    });
    console.warn(
      '[planner-refinement] worker registration skipped:',
      (err as Error)?.message ?? err,
    );
  }

  // ── DISTRIBUTED PLANNER EVENT PROPAGATION ────────────────────────────────
  // Env-gated via DISTRIBUTED_EVENTS_ENABLED. When enabled, this worker
  // process publishes propagatable planner events (plan_created /
  // alignment_completed / refinement_completed / salvage_applied /
  // overload_mode_activated) to a Redis Pub/Sub channel and subscribes for
  // events from other instances. When disabled or Redis is unavailable, the
  // local event bus continues to work — only cross-instance visibility is lost.
  try {
    const { startDistributedPlannerEvents } =
      await import('../services/plannerEventBusDistributed');
    await startDistributedPlannerEvents();
    _diag('startWorkers:distributed-events-started');
  } catch (err) {
    _diag('startWorkers:distributed-events-error', {
      error: err instanceof Error ? err.message : String(err),
    });
    console.warn(
      '[planner-events] distributed propagation start skipped:',
      (err as Error)?.message ?? err,
    );
  }

  // ── REDIS STREAMS EVENT DURABILITY ──────────────────────────────────────
  // Env-gated via PLANNER_EVENT_STREAMS_ENABLED. When enabled, propagatable
  // planner events are ALSO published to durable Redis Streams (in addition
  // to Pub/Sub) so consumers that need at-least-once delivery + replay can
  // attach. The local in-process bus continues to fire first.
  try {
    const { startEventStreamConsumers } =
      await import('../services/plannerEventStreams');
    await startEventStreamConsumers('planner-default');
    _diag('startWorkers:event-streams-started');
  } catch (err) {
    _diag('startWorkers:event-streams-error', {
      error: err instanceof Error ? err.message : String(err),
    });
    console.warn(
      '[planner-streams] consumer start skipped:',
      (err as Error)?.message ?? err,
    );
  }

  // ── DISTRIBUTED OVERLOAD COORDINATOR ────────────────────────────────────
  // Env-gated via DISTRIBUTED_OVERLOAD_ENABLED. Publishes this instance's
  // pressure score every PUBLISH_INTERVAL_MS (default 5s) and reads the
  // cluster-wide mode (cached 2s). Hysteresis prevents flapping between
  // modes during borderline load.
  try {
    const { startOverloadCoordinator } =
      await import('../services/distributedOverloadCoordinator');
    startOverloadCoordinator();
    _diag('startWorkers:overload-coordinator-started');
  } catch (err) {
    _diag('startWorkers:overload-coordinator-error', {
      error: err instanceof Error ? err.message : String(err),
    });
    console.warn(
      '[planner-overload] coordinator start skipped:',
      (err as Error)?.message ?? err,
    );
  }

  // ── ROLLOUT ORCHESTRATOR SYNC + CANARY HEALTH GATES ────────────────────
  // Sync loop reads the operator's desired mode from Redis and updates
  // process.env.PLANNER_ROLLOUT_MODE every 5s. Health gates run every 60s
  // during in_canary status and auto-rollback on threshold breach.
  try {
    const { startPlannerRolloutSync } =
      await import('../services/plannerRolloutMode');
    startPlannerRolloutSync();
    _diag('startWorkers:planner-rollout-sync-started');
  } catch (err) {
    _diag('startWorkers:planner-rollout-sync-error', {
      error: err instanceof Error ? err.message : String(err),
    });
    console.warn(
      '[planner-rollout] sync start skipped:',
      (err as Error)?.message ?? err,
    );
  }
  try {
    const { startCanaryHealthGates } =
      await import('../services/plannerCanaryHealthGates');
    startCanaryHealthGates();
    _diag('startWorkers:canary-gates-started');
  } catch (err) {
    _diag('startWorkers:canary-gates-error', {
      error: err instanceof Error ? err.message : String(err),
    });
    console.warn(
      '[planner-canary] gates start skipped:',
      (err as Error)?.message ?? err,
    );
  }

  // ── TELEMETRY + TRACING EXPORTER BOOTSTRAP ──────────────────────────────
  // Inspects env and wires the active sinks (dogstatsd / OTLP HTTP metrics
  // / OTLP HTTP traces / Prometheus pull). Any unset env leaves that sink
  // disabled. When no metric sink is configured, the fallback log exporter
  // remains active so dashboards backed by log-based metrics keep working.
  // The composer starts the periodic 10s snapshot loop itself.
  try {
    const { bootstrapPlannerExporters } =
      await import('../services/plannerExporters');
    const result = bootstrapPlannerExporters();
    _diag('startWorkers:telemetry-exporters-bootstrapped', { ...result });
  } catch (err) {
    _diag('startWorkers:telemetry-exporters-error', {
      error: err instanceof Error ? err.message : String(err),
    });
    console.warn(
      '[planner-exporters] bootstrap skipped:',
      (err as Error)?.message ?? err,
    );
  }

  // ── REALTIME TRANSPORT (env-gated) ──────────────────────────────────────
  // PLANNER_REALTIME_TRANSPORT_ENABLED=true → wires SSE/WS fanout via
  // Redis pub/sub. When disabled, SSE keeps using the legacy direct-bus
  // path in pages/api/bolt/progress-stream.ts.
  try {
    const { start: startRealtime } =
      await import('../services/plannerRealtimeTransport');
    startRealtime();
    _diag('startWorkers:realtime-transport-started');
  } catch (err) {
    _diag('startWorkers:realtime-transport-error', {
      error: err instanceof Error ? err.message : String(err),
    });
    console.warn(
      '[planner-realtime] transport start skipped:',
      (err as Error)?.message ?? err,
    );
  }

  engagementWorker = getWorker(
    'engagement-polling',
    async () => {
      await processEngagementPollingJob();
    }
  );
  engineWorker = getWorker('engine-jobs', async (job) => {
    const { type, jobId } = job.data as { type?: string; jobId?: string };
    if (!jobId) return;

    if (type === 'LEAD') {
      const { processLeadJobV1 } = await import('../services/leadJobProcessor');
      await processLeadJobV1(jobId);
      return;
    }

    if (type === 'MARKET_PULSE') {
      const { processMarketPulseJobV1 } = await import('../services/marketPulseJobProcessor');
      await processMarketPulseJobV1(jobId);
    }
  }, { concurrency: 2 });

  // Phase 0 — structured failure metadata for LEAD jobs. Emits one log line
  // per attempt; on final attempt the metadata can be picked up by a future
  // DLQ producer. No DLQ producer yet (Phase 0 ships the foundation only),
  // and MARKET_PULSE failures retain their existing logging.
  try {
    const { buildLeadJobFailureMetadata } = await import('./leadQueueHardening');
    const { recordLeadJobFailure } = await import('./leadQueueObservability');
    engineWorker.on('failed', (job, err) => {
      if (!job) return;
      const data = job.data as { type?: string } | undefined;
      if (data?.type !== 'LEAD') return;
      const meta = buildLeadJobFailureMetadata({
        jobId: String(job.id ?? 'unknown'),
        jobName: job.name,
        attemptsMade: job.attemptsMade,
        attemptsAllowed: job.opts?.attempts ?? 1,
        failedReason: err?.message ?? 'unknown',
        stack: err?.stack ?? null,
        data: job.data,
      });
      const { category } = recordLeadJobFailure({
        jobId: String(job.id ?? 'unknown'),
        reason: err?.message ?? null,
      });
      console.warn(
        '[lead-job-failed]',
        JSON.stringify({ category, ...meta }),
      );
    });
  } catch (e) {
    _diag('startWorkers:lead-failed-handler-attach-failed', {
      error: e instanceof Error ? e.message : String(e),
    });
  }
  intelligencePollingWorker = getIntelligencePollingWorker();

  // Phase 3 — listening-executions worker. Bounded; one execution per source
  // at a time per the DB UNIQUE partial index. Concurrency 2 across the org
  // pool keeps a single rogue source from starving others.
  try {
    const { LISTENING_EXECUTION_QUEUE_NAME } = await import('./listeningExecutionQueue');
    const { processListeningExecution } = await import('../services/listeningExecutionService');
    listeningExecutionWorker = getWorker(
      LISTENING_EXECUTION_QUEUE_NAME,
      async (job) => {
        const data = job.data as { executionId?: string } | undefined;
        if (!data?.executionId) return;
        await processListeningExecution(data.executionId);
      },
      { concurrency: 2 },
    );
    console.log('[workers] listening-executions worker started');
  } catch (e) {
    _diag('startWorkers:listeningExecutionWorker-attach-failed', {
      error: e instanceof Error ? e.message : String(e),
    });
  }

  // Phase 9 — semantic indexing partition worker. Bounded concurrency so a
  // single large job cannot starve the rest of the system; per-partition
  // jobId is deterministic so re-enqueue is idempotent.
  try {
    const { SEMANTIC_PARTITION_QUEUE_NAME } = await import('./semanticIndexingQueue');
    const { processSemanticPartition } = await import('../services/asyncSemanticRuntimeService');
    semanticIndexingWorker = getWorker(
      SEMANTIC_PARTITION_QUEUE_NAME,
      async (job) => {
        const data = job.data as { partitionId?: string } | undefined;
        if (!data?.partitionId) return;
        await processSemanticPartition(data.partitionId);
      },
      { concurrency: 2 },
    );
    console.log('[workers] semantic-indexing worker started');
  } catch (e) {
    _diag('startWorkers:semanticIndexingWorker-attach-failed', {
      error: e instanceof Error ? e.message : String(e),
    });
  }

  // Phase 9 — replay partition worker. Same bounded-concurrency model;
  // partitions hold their own checkpoints so failures are recoverable.
  try {
    const { REPLAY_PARTITION_QUEUE_NAME } = await import('./replayPartitionQueue');
    const { processReplayPartition } = await import('../services/replayCoordinationService');
    replayPartitionWorker = getWorker(
      REPLAY_PARTITION_QUEUE_NAME,
      async (job) => {
        const data = job.data as { partitionId?: string } | undefined;
        if (!data?.partitionId) return;
        await processReplayPartition(data.partitionId);
      },
      { concurrency: 2 },
    );
    console.log('[workers] replay-partition worker started');
  } catch (e) {
    _diag('startWorkers:replayPartitionWorker-attach-failed', {
      error: e instanceof Error ? e.message : String(e),
    });
  }

  // ── CREATOR-RENDER DURABLE WORKER ───────────────────────────────────────
  // Carousel / infographic / pdf / slider rendering goes through the
  // `creator-render` BullMQ queue (creatorRenderDurableQueue.ts). Without
  // a worker bound to that queue, jobs sit in `queued` forever and the
  // UI shows a "no worker is consuming it" diagnostic. `npm run dev:full`
  // used to skip this registration; production used `backend/workers/main.ts`
  // which DID register it — leaving dev silently broken. This wires the
  // same worker into the unified dev bootstrap so carousel renders actually
  // complete locally.
  try {
    const { getQueuePrefix } = await import('./bullmqClient');
    const prefix = getQueuePrefix();
    creatorRenderWorker = createCreatorRenderWorker((job) =>
      withHeavyJobSlot(() => processCreatorRenderJob(job)),
    );
    creatorRenderWorker.on('failed', (job, err) =>
      console.error('[creator-render-worker] failed', {
        jobId: job?.id,
        error: err?.message ?? String(err),
      }));
    creatorRenderWorker.on('error', (err) =>
      console.error('[creator-render-worker] error:', err?.message ?? err));
    creatorRenderWorker.on('active', (job) =>
      console.log('[creator-render-worker] active', { jobId: job?.id, name: job?.name }));
    creatorRenderWorker.on('completed', (job) => {
      console.log('[creator-render-worker] completed', { jobId: job?.id });
      // HARDEN-001: queue job timing (processing + wait), fail-safe.
      try {
        void import('../observability/metrics').then(({ recordQueueJob }) => {
          const ts = (job as unknown as { processedOn?: number; finishedOn?: number; timestamp?: number }) || {};
          recordQueueJob({
            queue: 'creator-render',
            ok: true,
            processingMs: ts.processedOn && ts.finishedOn ? ts.finishedOn - ts.processedOn : undefined,
            waitMs: ts.timestamp && ts.processedOn ? ts.processedOn - ts.timestamp : undefined,
          });
        }).catch(() => {});
      } catch { /* fail-safe */ }
    });
    creatorRenderWorker.on('failed', (job) => {
      try {
        void import('../observability/metrics').then(({ recordQueueJob }) => {
          recordQueueJob({ queue: 'creator-render', ok: false });
        }).catch(() => {});
      } catch { /* fail-safe */ }
    });
    // Explicit boot diagnostic — prints queue name + prefix so when the
    // UI says "no worker consuming" you can verify from the boot logs
    // whether the worker IS up AND on the matching prefix.
    console.log(`[workers] creator-render worker started (queue="creator-render", prefix="${prefix ?? '<default>'}")`);
    _diag('startWorkers:creator-render-registered', { prefix });
  } catch (err) {
    _diag('startWorkers:creator-render-register-error', {
      error: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
    // LOUD failure — was previously console.warn which is easy to miss
    // in a verbose boot log. Use console.error + full stack so it surfaces.
    console.error(
      '[creator-render-worker] REGISTRATION FAILED — slide rendering will not work:',
      err instanceof Error ? `${err.message}\n${err.stack}` : err,
    );
  }

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  console.log('[workers] analytics ingestion worker started');
  console.log('[startup] workers initialized');
  console.log('[workers] publish worker started');
  console.log('[workers] engagement polling worker started');
  console.log('[workers] bolt-execution worker started');
  console.log('[workers] engine-jobs worker started');
  console.log('[workers] intelligence polling worker started');
  console.log('[workers] content generation workers started (blog, post, whitepaper, story, engagement)');
}

// Standalone: run when file is executed directly
if (typeof require !== 'undefined' && require.main === module) {
  startWorkers().catch((err) => {
    console.error('Failed to start workers:', err);
    process.exit(1);
  });
}
