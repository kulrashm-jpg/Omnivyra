/**
 * Unified Worker Entry Point — Railway production deployment
 *
 * Starts ALL workers in a single long-running process:
 *   • publish          — social media post publishing
 *   • bolt-execution   — BOLT workflow jobs
 *   • engagement-polling — LinkedIn/Twitter engagement ingestion
 *   • intelligence-polling — external signal ingestion
 *   • ai-heavy:campaign-planning — Campaign Planner v2 pipeline
 *   • engine-jobs      — LEAD + MARKET_PULSE processing
 *   • creator-{video,carousel,story} — BOLT creator asset rendering (bolt-creator-row jobs)
 *
 * Entry: node --require ts-node/register/transpile-only backend/workers/main.ts
 * Health: GET http://localhost:8080/health
 *
 * Required env vars (validated at startup):
 *   REDIS_URL, SUPABASE_URL, SUPABASE_SECRET_KEY, OPENAI_API_KEY
 */

import { config } from '@/config';
import { validateWorkerEnv } from '../utils/validateEnv';
import { startHealthServer, setCronStatus }  from './healthServer';

// Start health server immediately — before anything else so Railway healthchecks
// always get a response even if Redis/workers fail to initialise.
startHealthServer(config.PORT ? parseInt(config.PORT, 10) : undefined);

// Fail fast if any required env var is missing
validateWorkerEnv();

import os from 'os';
import { Worker }                    from 'bullmq';
import { getWorker, closeConnections, getSharedRedisClient, withHeavyJobSlot, getQueuePrefix } from '../queue/bullmqClient';
import { instrumentWorker }          from '../queue/queueInstrumentation';
import { deadLetterOnExhaustion }    from '../queue/deadLetterOnExhaustion';
import { attachLeadJobFailureHandler } from '../queue/leadQueueHardening';
import { processPublishJob }         from '../queue/jobProcessors/publishProcessor';
import { processEngagementPollingJob } from '../queue/jobProcessors/engagementPollingProcessor';
import { processBoltJob }            from '../queue/jobProcessors/boltProcessor';
import {
  BOLT_STALLED_INTERVAL_MS,
  attachBoltRunReconciliation,
  releaseBoltRunClaimOnShutdown,
} from '../services/boltExecutionRecovery';
import { getHeldRunLocks } from '../services/boltExecutionLock';
import { getIntelligencePollingWorker } from './intelligencePollingWorker';
import { processCampaignPlanningJob } from '../queue/jobProcessors/campaignPlanningProcessor';
import { runLeadThreadRecomputeWorker } from './leadThreadRecomputeWorker';
import { runConversationMemoryWorker }  from './conversationMemoryWorker';
import { runCacheWarmup }            from '../services/cacheWarmup';
import { startAutoScalingMonitor }   from '../services/autoScalingSignal';
import { getMetricsSnapshot }        from '../services/metricsCollector';
import { runPublishingWorker }       from '../services/publishingJobService';
import { createCreatorRenderWorker, recoverOrphanedCreatorRenderJobs } from '../services/creatorRenderDurableQueue';
import { processCreatorRenderJob } from '../services/creatorRenderWorkerProcessor';
import { registerSharedConsumers, type SharedConsumerHandles } from '../queue/workerTopology';
import { runWithJobTraceContext } from '../observability/traceKit';
import { definePool } from '../../lib/platform/concurrency';
import { defineRolloutFlag, resolveRolloutSync } from '../../lib/platform/rollout';

/** W3-1: split ai-heavy off the shared CPU semaphore (audit B-20). */
const HEAVY_SLOT_SCOPING_FLAG = defineRolloutFlag({
  key: 'heavy-slot-scoping',
  description: 'W3-1: ai-heavy uses its own slot pool; creator-render keeps the CPU semaphore',
});
/** Same default cap as HEAVY_JOB_CONCURRENCY (3) — no throughput increase. */
const AI_HEAVY_POOL = definePool({ name: 'ai-heavy-slot', defaultLimit: 3, maxLimit: 8 });
import { runRenderParityPreflight, logPreflightReport } from './renderParityPreflight';
import type { CampaignPlanningJobPayload } from '../queue/jobProcessors/campaignPlanningProcessor';
import { startCron } from '../scheduler/cron';

// ── Worker instances ──────────────────────────────────────────────────────────

const boltConcurrency   = (() => {
  // Deterministic, env-overridable. Default preserves prior behavior
  // (min(4, cpus)); BOLT_WORKER_CONCURRENCY (1–16) takes precedence so
  // local and Railway are not subject to host CPU-count variance.
  const o = Number(config.BOLT_WORKER_CONCURRENCY);
  return Number.isInteger(o) && o >= 1 && o <= 16
    ? o
    : Math.min(4, Math.max(1, os.cpus().length));
})();

const publishWorker     = getWorker('publish', processPublishJob);
const boltWorker        = getWorker('bolt-execution', processBoltJob, {
  concurrency: boltConcurrency,
  // bolt-execution ONLY — every other queue keeps the 30-minute default.
  stalledInterval: BOLT_STALLED_INTERVAL_MS,
});
// BullMQ recovers the JOB; only this recovers the bolt_execution_runs ROW.
attachBoltRunReconciliation(boltWorker);
const engagementWorker  = getWorker('engagement-polling', async () => {
  await processEngagementPollingJob();
}, { concurrency: 1 });
const intelligenceWorker = getIntelligencePollingWorker();
const creatorRenderWorker = createCreatorRenderWorker((job) =>
  withHeavyJobSlot(() => processCreatorRenderJob(job)));
creatorRenderWorker.on('failed', (job, err) =>
  console.error('[creator-render-worker] failed', { jobId: job?.id, error: err.message }));
creatorRenderWorker.on('error', (err) =>
  console.error('[creator-render-worker] error:', err));

// Event-driven workers — triggered by DB inserts, NOT polling.
// Use new Worker() directly to avoid the noisy '✅ Job drain completed' log
// from getWorker()'s catch-all completed handler.
const leadThreadRecomputeWorker = new Worker(
  'lead-thread-recompute',
  async (job) => runWithJobTraceContext(job, async () => { await runLeadThreadRecomputeWorker(); }),
  { connection: getSharedRedisClient(), prefix: getQueuePrefix(), concurrency: 1, drainDelay: 300, stalledInterval: 1_800_000 },
);
leadThreadRecomputeWorker.on('failed', (job, err) => {
  console.error('[lead-thread-recompute] job failed', { jobId: job?.id, error: err.message });
  deadLetterOnExhaustion('lead-thread-recompute', job, err);
});
leadThreadRecomputeWorker.on('error', (err) =>
  console.error('[lead-thread-recompute] worker error:', err));
instrumentWorker(leadThreadRecomputeWorker);

const conversationMemoryRebuildWorker = new Worker(
  'conversation-memory-rebuild',
  async (job) => runWithJobTraceContext(job, async () => { await runConversationMemoryWorker(); }),
  { connection: getSharedRedisClient(), prefix: getQueuePrefix(), concurrency: 1, drainDelay: 300, stalledInterval: 1_800_000 },
);
conversationMemoryRebuildWorker.on('failed', (job, err) => {
  console.error('[conversation-memory-rebuild] job failed', { jobId: job?.id, error: err.message });
  deadLetterOnExhaustion('conversation-memory-rebuild', job, err);
});
conversationMemoryRebuildWorker.on('error', (err) =>
  console.error('[conversation-memory-rebuild] worker error:', err));
instrumentWorker(conversationMemoryRebuildWorker);

// Engine worker (LEAD + MARKET_PULSE) — uses shared Redis config
const engineWorker = new Worker(
  'engine-jobs',
  // W0-3: restore enqueuer trace context (additive ALS scoping; fail-safe).
  async (job) => runWithJobTraceContext(job, async () => {
    const { type, jobId } = job.data;
    console.info('[engine-worker] processing', { type, jobId });
    if (type === 'LEAD') {
      const { processLeadJobV1 } = await import('../services/leadJobProcessor');
      await processLeadJobV1(jobId);
    }
    if (type === 'MARKET_PULSE') {
      const { processMarketPulseJobV1 } = await import('../services/marketPulseJobProcessor');
      await processMarketPulseJobV1(jobId);
    }
  }),
  {
    connection: getSharedRedisClient(),
    prefix: getQueuePrefix(),
    // Was implicit BullMQ default (1) → LEAD and MARKET_PULSE were fully
    // serialized. Small bounded value; env-overridable (1–8). No ordering
    // guarantee exists between job types, so >1 is semantically safe.
    concurrency: (() => {
      const o = Number(config.ENGINE_JOBS_CONCURRENCY);
      return Number.isInteger(o) && o >= 1 && o <= 8 ? o : 2;
    })(),
    drainDelay: 300,
    stalledInterval: 1_800_000,
  },
);
engineWorker.on('error', (err) => console.error('[engine-worker] error:', err));
// LEAD failure handling + lead-jobs-dlq republication. Same shared helper the
// dev bootstrap uses — production previously had NO 'failed' handler here, so a
// failed LEAD job produced neither metadata nor a dead letter.
attachLeadJobFailureHandler(engineWorker);
// Durable record for ANY exhausted engine job (LEAD or MARKET_PULSE).
engineWorker.on('failed', (job, err) => deadLetterOnExhaustion('engine-jobs', job, err));

// Campaign planning worker (ai-heavy queue)
const campaignWorker = new Worker<CampaignPlanningJobPayload>(
  'ai-heavy',
  // W0-3: restore enqueuer trace context (plan-v2 stamps via safeEnqueue).
  async (job) => runWithJobTraceContext(job, async () => {
    // Soak-only opt-in branch (additive; gated by WORKER_SOAK_MODE === '1'
    // AND job.data.__soak === true). Exercises the ai-heavy queue runtime,
    // withHeavyJobSlot concurrency cap, async-execution timing, and
    // (optionally) the retry path — WITHOUT OpenAI calls, DB writes, or
    // provider invocations. Dead code when WORKER_SOAK_MODE is unset.
    if (config.WORKER_SOAK_MODE === '1' && (job.data as { __soak?: boolean } | null)?.__soak === true) {
      return await withHeavyJobSlot(async () => {
        const t0 = Date.now();
        // Real async heavy-job slot held for ~600ms — proves the shared
        // HEAVY_JOB_CONCURRENCY cap participates and that BullMQ ack/retry
        // accounting works under the slot. No external work performed.
        await new Promise((r) => setTimeout(r, 600));
        if (config.SOAK_FORCE_THROW === '1') {
          throw new Error('SOAK_FORCE_THROW: deterministic ai-heavy retry-path exercise');
        }
        return { soak: true, lane: 'ai-heavy', heldMs: Date.now() - t0, jobId: String(job.id) };
      });
    }
    // W3-4 (audit B-05): async interactive planner. plan.ts (flag
    // 'async-planner', per-tenant) enqueues the EXACT runCampaignAiPlan args
    // it would have awaited inline; the result lands in the existing
    // aiExecutionResultStore under the job's poll key and the client
    // re-polls plan.ts for it. Billing/credits run INSIDE runCampaignAiPlan
    // on this worker — the same code path as the inline call.
    if (job.name === 'interactive-plan') {
      const { pollKey, companyId, actorUserId, args } = job.data as unknown as {
        pollKey: string; companyId: string; actorUserId: string; args: Record<string, unknown>;
      };
      const { runCampaignAiPlan } = await import('../services/campaignAiOrchestrator');
      // F-14: result persistence via the generalized runway completion.
      const { completeRunwayOperation } = await import('../../lib/platform/runway');
      const run = async () => {
        const result = await runCampaignAiPlan(args as never);
        await completeRunwayOperation({
          pollKey,
          action: 'interactive_plan',
          organizationId: companyId,
          actorUserId,
          module: 'planner',
          payload: result,
        });
      };
      if (resolveRolloutSync(HEAVY_SLOT_SCOPING_FLAG).mode !== 'off') {
        await AI_HEAVY_POOL.run(run);
      } else {
        await withHeavyJobSlot(run);
      }
      return;
    }
    if (job.name !== 'campaign-planning') return; // other job types skip
    // Heavy-job slot acquired AFTER the skip check so skipped jobs never
    // hold a slot.
    //
    // W3-1 (audit B-20): campaign planning is I/O-bound (its 240 s GPT calls
    // hold no CPU) yet it shared the 3-slot CPU semaphore with creator-render
    // — three concurrent campaigns could stall every carousel/PDF render for
    // minutes. Under the 'heavy-slot-scoping' flag, campaign jobs take a slot
    // from their OWN pool (same cap of 3 by default → total ai-heavy
    // throughput unchanged) and creator-render keeps the CPU semaphore to
    // itself. Flag off (default) = shared semaphore exactly as before.
    if (resolveRolloutSync(HEAVY_SLOT_SCOPING_FLAG).mode !== 'off') {
      await AI_HEAVY_POOL.run(() => processCampaignPlanningJob(job));
    } else {
      await withHeavyJobSlot(() => processCampaignPlanningJob(job));
    }
  }),
  {
    connection:     getSharedRedisClient(),
    prefix:         getQueuePrefix(),
    concurrency:    3,
    limiter:        { max: 5, duration: 1_000 },
    drainDelay:     300,
    // Heavy/crash-prone queue: 2-min stalled detection (was 30 min) so an
    // OOM/restart-orphaned campaign job re-runs quickly. Single low-volume
    // worker → Redis poll cost negligible.
    stalledInterval: 120_000,
  },
);
campaignWorker.on('completed', (job) =>
  console.info('[campaign-worker] completed', { jobId: job.id }));
campaignWorker.on('failed', (job, err) => {
  console.error('[campaign-worker] failed', { jobId: job?.id, error: err.message });
  deadLetterOnExhaustion('ai-heavy', job, err);
});
campaignWorker.on('error', (err) => console.error('[campaign-worker] error:', err));

// ── Startup ───────────────────────────────────────────────────────────────────

/**
 * Redis readiness preflight. Forces the shared connection (whose 'connect'
 * handler deterministically runs ensureRedisInfraStarted — instrumentation,
 * usage-protection, metrics — before queues do real work) and verifies
 * connectivity with a bounded PING. A failure exits the process so Railway's
 * ON_FAILURE restart policy retries instead of running a "healthy" worker
 * that silently consumes nothing.
 */
async function ensureRedisReady(): Promise<void> {
  const PING_TIMEOUT_MS = 10_000;
  const client = getSharedRedisClient();
  try {
    await Promise.race([
      client.ping(),
      new Promise((_resolve, reject) =>
        setTimeout(() => reject(new Error(`Redis ping timed out after ${PING_TIMEOUT_MS}ms`)), PING_TIMEOUT_MS)),
    ]);
    console.info('[main] Redis preflight OK');
  } catch (err) {
    console.error('[main] Redis preflight FAILED — exiting for Railway restart:',
      (err as Error)?.message);
    process.exit(1);
  }
}

/**
 * Deployment provenance — logged once at boot so the deployed runtime
 * identity (commit, deploy, environment, Redis target) is immediately
 * visible in Railway logs without any telemetry platform.
 *
 * Also emits a canonical `deployment_integrity_snapshot` event under
 * the structured-telemetry envelope so dashboards can immediately
 * surface the deploy posture. The worker-boot variant has no live
 * schema check (that's the verifier CLI's job, run pre-deploy) — it
 * just reports provenance + the cached runtime view. If schema parity
 * has diverged since deploy, the predeploy snapshot would already
 * have caught it.
 */
function startPublishingJobsLoop(): () => void {
  const workerId = `publishing-jobs-${process.pid}`;
  let running = false;
  // W6-5 (audit B-48): idle backoff. The 30 s DB poll ran 2,880×/day even
  // with zero due work. Under the 'publish-poll-backoff' flag, after 10
  // consecutive zero-claim cycles the loop skips ticks down to an effective
  // 5-minute cadence; ANY claimed work snaps it back to 30 s instantly.
  // The safety net is unchanged: BullMQ-delayed jobs and the cron
  // findDuePostsAndEnqueue path still cover due posts — this poll is the
  // recovery sweep. Flag off (default) = 30 s always, byte-for-byte.
  let idleCycles = 0;
  let skipUntil = 0;

  const runOnce = async () => {
    if (running) return;
    running = true;
    try {
      const result = await runPublishingWorker({ workerId, limit: 5 });
      const processed = result.published + result.retrying + result.failed + result.deadLettered;
      idleCycles = result.claimed > 0 || processed > 0 ? 0 : idleCycles + 1;
      if (result.claimed > 0 || processed > 0) {
        console.info('[publishing-jobs] cycle completed', { workerId, ...result });
      }
    } catch (err) {
      console.error('[publishing-jobs] cycle failed:', err instanceof Error ? err.message : String(err));
    } finally {
      running = false;
    }
  };

  void runOnce();
  const timer = setInterval(() => {
    if (resolveRolloutSync(PUBLISH_POLL_BACKOFF_FLAG).mode !== 'off') {
      const now = Date.now();
      if (now < skipUntil) return;
      if (idleCycles >= 10) skipUntil = now + 5 * 60 * 1000 - 30_000;
    }
    void runOnce();
  }, 30_000);
  return () => clearInterval(timer);
}

/** W6-5 rollout flag — see startPublishingJobsLoop. */
const PUBLISH_POLL_BACKOFF_FLAG = defineRolloutFlag({
  key: 'publish-poll-backoff',
  description: 'W6-5: idle backoff for the 30 s publishing DB poll (audit B-48)',
});

function logBootProvenance(): void {
  const env = process.env;
  let redisHost = 'unknown';
  try {
    redisHost = new URL(config.REDIS_URL || env.REDIS_URL || '').hostname || 'unknown';
  } catch { /* unparseable — leave 'unknown' */ }
  console.info('[provenance] worker boot', {
    marker:        'omnivyra-worker',
    gitSha:        env.RAILWAY_GIT_COMMIT_SHA || 'unknown',
    gitBranch:     env.RAILWAY_GIT_BRANCH || 'unknown',
    deploymentId:  env.RAILWAY_DEPLOYMENT_ID || 'unknown',
    bootAt:        new Date().toISOString(),
    runtimeEnv:    env.RAILWAY_ENVIRONMENT_NAME || env.NODE_ENV || 'unknown',
    redisHost,
    pid:           process.pid,
  });
  // Lazy import — the structured-telemetry helper imports
  // WORKER_PROVENANCE which reads env at first import; this keeps the
  // provenance log usable even in environments where structured
  // telemetry isn't initialised (e.g. minimal test harnesses).
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { emitStructuredEvent } = require('../../observability/runtime/structuredTelemetry') as typeof import('../../observability/runtime/structuredTelemetry');
    emitStructuredEvent(
      'deployment_integrity_snapshot',
      'info',
      { run_id: null, planner_stage: 'worker-boot-integrity-snapshot' },
      {
        // Worker boot doesn't run a live schema check — that's the
        // verifier's responsibility pre-deploy. We emit 'unknown' for
        // schema fields here; dashboards that need a live verdict
        // should consume the verifier's predeploy emission.
        schema_parity: 'unknown',
        ledger_desync_detected: null,
        blocking_missing_columns: null,
        warn_missing_columns: null,
        runtime_env: env.RAILWAY_ENVIRONMENT_NAME || env.NODE_ENV || null,
        redis_host: redisHost,
        boot_marker: 'omnivyra-worker',
      },
    );
  } catch (err) {
    // Telemetry must never break worker boot. Swallow + log.
    console.warn('[provenance] integrity snapshot emit failed (non-fatal):', (err as Error)?.message);
  }
}

async function main(): Promise<void> {
  logBootProvenance();
  // Redis readiness gate — before any queue processing begins
  await ensureRedisReady();

  // Parity preflight — verify this runtime can do what localhost does (render
  // SVG text glyphs = fonts present) and has prod-required env/assets. Logged
  // loudly so a local↔prod divergence (e.g. missing fonts → blank renders) is
  // visible at boot, not discovered via broken output. Non-fatal: the
  // fail-CLOSED enforcement is the predeploy gate; this is runtime visibility.
  await runRenderParityPreflight()
    .then(logPreflightReport)
    .catch((err) => console.error('[parity-preflight] probe errored (non-fatal):', err?.message));

  // Pre-warm template cache (zero GPT cost, improves first-job latency)
  await runCacheWarmup().catch((err) =>
    console.warn('[main] cache warmup failed (non-fatal):', err?.message));

  // F-07 / W1-3 — ALL shared consumers (creator content, whatsapp, analytics,
  // content-* text family, planner-refinement, listening/semantic/replay) are
  // registered through the ONE topology module both bootstraps use. This
  // replaces the per-family remediation blocks (creator + whatsapp + analytics)
  // AND closes the remaining dev-only gaps (B-02): content-* / planner-
  // refinement / listening-executions / semantic-indexing / replay-partition
  // had prod producers but no prod consumer — their jobs sat in `waiting`
  // forever. Per-family non-fatal + loud semantics are preserved inside
  // registerSharedConsumers. Manifest: backend/queue/workerTopologyManifest.ts.
  const sharedConsumers: SharedConsumerHandles = await registerSharedConsumers({ bootstrap: 'prod' });

  // Scheduler — runs the 10-min social-account token refresh (X tokens
  // expire in 2h) plus all other cron cycles. Co-located in the worker
  // process so a single Railway service (Dockerfile.worker CMD = main.js)
  // covers both queues AND scheduled refresh. Non-fatal: a scheduler
  // failure must not stop queue workers from running.
  //
  // W6-2 (audit B-13): CRON_SERVICE_MODE separates scheduling from execution
  // WITHOUT redesigning either:
  //   'colocated'   (default) — exactly today's topology.
  //   'worker-only' — this process runs queues ONLY; a dedicated single-
  //                   replica cron service (Dockerfile.cron → worker:cron →
  //                   cron.ts standalone entry, which already exists) owns
  //                   scheduling. This is the prerequisite for raising
  //                   worker numReplicas: workers scale, cron stays at 1
  //                   (with W6-1 timer leases as the second seatbelt).
  const cronServiceMode = String(process.env.CRON_SERVICE_MODE ?? 'colocated').toLowerCase();
  if (cronServiceMode === 'worker-only') {
    console.info('[main] CRON_SERVICE_MODE=worker-only — scheduler runs in the dedicated cron service');
    setCronStatus('ok', 'external cron service (CRON_SERVICE_MODE=worker-only)');
  } else
  startCron()
    .then(() => {
      // Cron successfully initialized — flip health to ok.
      setCronStatus('ok');
    })
    .catch((err) => {
      // Cron init failure was previously SILENT — workers continued
      // running but token-refresh stopped, posts started failing 2h
      // later with no operator signal. Surface the degraded state in
      // the health endpoint so it's immediately visible without
      // crash-looping the pod (workers themselves are unaffected).
      const reason = (err && (err.message ?? String(err))) || 'unknown';
      setCronStatus('degraded', reason);
      console.error('[main] startCron failed (non-fatal — token refresh/crons will NOT run):', reason);
    });

  // W0-7: optional periodic baseline capture (env-gated, DEFAULT OFF).
  let stopBaselineLoop: () => void = () => {};
  try {
    const { startBaselineCaptureLoop } = await import('../observability/baseline');
    stopBaselineLoop = startBaselineCaptureLoop();
  } catch { /* measurement must never break the worker */ }

  // Autoscaling monitor — fires signal when queue depth > 500 or latency > 10s
  const stopPublishingJobsLoop = startPublishingJobsLoop();

  let _cachedLatency = 0;
  setInterval(async () => {
    try { _cachedLatency = (await getMetricsSnapshot()).avgLatencyMs; } catch { /* ignore */ }
  }, 300_000); // 5 min — was 30s; each call issues redis.info('memory')
  const stopMonitor = startAutoScalingMonitor(300_000, () => _cachedLatency); // 5 min — was 30s; each check queries 4 queues
  const orphanRecoveryTimer = setInterval(() => {
    void recoverOrphanedCreatorRenderJobs().catch((error) => {
      console.warn('[creator-render-worker] orphan recovery failed', {
        message: error instanceof Error ? error.message : String(error),
      });
    });
  }, 10 * 60 * 1000);

  console.info('[main] all workers running', {
    queues: ['publish', 'bolt-execution', 'engagement-polling',
             'intelligence-polling', 'ai-heavy', 'engine-jobs',
             'lead-thread-recompute', 'conversation-memory-rebuild', 'creator-render',
             'creator-video', 'creator-carousel', 'creator-story',
             'content-blog', 'content-post', 'content-whitepaper', 'content-story',
             'content-newsletter', 'content-engagement', 'content-refinement',
             'whatsapp-broadcast', 'whatsapp-webhook', 'analytics-ingestion',
             'planner-refinement', 'listening-executions', 'semantic-indexing',
             'replay-partition', 'publishing_jobs'],
    sharedConsumerFailures: sharedConsumers.failures.map((f) => f.family),
    boltConcurrency,
    pid: process.pid,
  });

  // ── Graceful shutdown ───────────────────────────────────────────────────────

  const shutdown = async (signal: string) => {
    console.info(`[main] ${signal} received — shutting down gracefully`);
    stopMonitor();
    stopPublishingJobsLoop();
    stopBaselineLoop();
    clearInterval(orphanRecoveryTimer);
    // Bounded drain. `worker.close()` waits for in-flight jobs, which is right
    // — but a BOLT run takes minutes and no container grace period is that
    // long, so an unbounded wait guarantees we are SIGKILLed mid-await and the
    // reconciliation below never runs. Capping the wait trades "finish the job"
    // (unachievable) for "record that the job was interrupted" (achievable).
    const drainDeadlineMs = (() => {
      const o = Number(process.env.WORKER_DRAIN_TIMEOUT_MS);
      return Number.isFinite(o) && o >= 1000 && o <= 120_000 ? o : 15_000;
    })();
    const drainDeadline = new Promise<void>((resolve) => {
      const t = setTimeout(resolve, drainDeadlineMs);
      if (typeof t.unref === 'function') t.unref();
    });

    await Promise.race([drainDeadline, Promise.allSettled([
      publishWorker.close(),
      boltWorker.close(),
      engagementWorker.close(),
      intelligenceWorker.close(),
      engineWorker.close(),
      campaignWorker.close(),
      creatorRenderWorker.close(),
      leadThreadRecomputeWorker.close(),
      conversationMemoryRebuildWorker.close(),
      // F-07: getWorker-based shared consumers (planner-refinement, listening,
      // semantic, replay). Content/creator/whatsapp/analytics workers manage
      // their own lifecycle inside contentGenerationQueues (unchanged).
      ...sharedConsumers.workers.map((w) => w.close()),
    ])]);

    // Hand back every BOLT claim this process still holds. Graceful shutdown
    // CANNOT guarantee a multi-minute run completes, so the honest goal is to
    // make the interruption immediately visible instead of leaving the next
    // attempt to wait out the lock TTL. Status is deliberately untouched: the
    // job may still be retried, and declaring it failed here would make
    // executeBoltPipelineRuntime refuse to re-enter.
    const held = getHeldRunLocks();
    if (held.length > 0) {
      console.warn('[main] releasing in-flight BOLT claims', { count: held.length });
      await Promise.allSettled(held.map(async ({ runId, token }) => {
        const result = await releaseBoltRunClaimOnShutdown(runId, token);
        // `strict: false` — narrow by member presence, not by the `ok` flag.
        if ('error' in result) {
          console.error('[main] BOLT claim release failed', { run_id: runId, error: result.error });
        }
      }));
    }

    await closeConnections();
    console.info('[main] shutdown complete');
    process.exit(0);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT',  () => shutdown('SIGINT'));

  // Unhandled rejections — log and keep running (workers are resilient)
  process.on('unhandledRejection', (reason) => {
    console.error('[main] unhandledRejection:', reason);
  });
}

main().catch((err) => {
  console.error('[main] startup error:', err);
  process.exit(1);
});
