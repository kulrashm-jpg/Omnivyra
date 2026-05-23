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
 *
 * Entry: node --require ts-node/register/transpile-only backend/workers/main.ts
 * Health: GET http://localhost:8080/health
 *
 * Required env vars (validated at startup):
 *   REDIS_URL, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, OPENAI_API_KEY
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
import { processPublishJob }         from '../queue/jobProcessors/publishProcessor';
import { processEngagementPollingJob } from '../queue/jobProcessors/engagementPollingProcessor';
import { processBoltJob }            from '../queue/jobProcessors/boltProcessor';
import { getIntelligencePollingWorker } from './intelligencePollingWorker';
import { processCampaignPlanningJob } from '../queue/jobProcessors/campaignPlanningProcessor';
import { runLeadThreadRecomputeWorker } from './leadThreadRecomputeWorker';
import { runConversationMemoryWorker }  from './conversationMemoryWorker';
import { runCacheWarmup }            from '../services/cacheWarmup';
import { startAutoScalingMonitor }   from '../services/autoScalingSignal';
import { getMetricsSnapshot }        from '../services/metricsCollector';
import { createCreatorRenderWorker, recoverOrphanedCreatorRenderJobs } from '../services/creatorRenderDurableQueue';
import { processCreatorRenderJob } from '../services/creatorRenderWorkerProcessor';
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
const boltWorker        = getWorker('bolt-execution', processBoltJob, { concurrency: boltConcurrency });
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
  async () => { await runLeadThreadRecomputeWorker(); },
  { connection: getSharedRedisClient(), prefix: getQueuePrefix(), concurrency: 1, drainDelay: 300, stalledInterval: 1_800_000 },
);
leadThreadRecomputeWorker.on('failed', (job, err) =>
  console.error('[lead-thread-recompute] job failed', { jobId: job?.id, error: err.message }));
leadThreadRecomputeWorker.on('error', (err) =>
  console.error('[lead-thread-recompute] worker error:', err));
instrumentWorker(leadThreadRecomputeWorker);

const conversationMemoryRebuildWorker = new Worker(
  'conversation-memory-rebuild',
  async () => { await runConversationMemoryWorker(); },
  { connection: getSharedRedisClient(), prefix: getQueuePrefix(), concurrency: 1, drainDelay: 300, stalledInterval: 1_800_000 },
);
conversationMemoryRebuildWorker.on('failed', (job, err) =>
  console.error('[conversation-memory-rebuild] job failed', { jobId: job?.id, error: err.message }));
conversationMemoryRebuildWorker.on('error', (err) =>
  console.error('[conversation-memory-rebuild] worker error:', err));
instrumentWorker(conversationMemoryRebuildWorker);

// Engine worker (LEAD + MARKET_PULSE) — uses shared Redis config
const engineWorker = new Worker(
  'engine-jobs',
  async (job) => {
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
  },
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

// Campaign planning worker (ai-heavy queue)
const campaignWorker = new Worker<CampaignPlanningJobPayload>(
  'ai-heavy',
  async (job) => {
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
    if (job.name !== 'campaign-planning') return; // other job types skip
    // Heavy-job slot acquired AFTER the skip check so skipped jobs never
    // hold a slot. Shared cap across ai-heavy + creator-render.
    await withHeavyJobSlot(() => processCampaignPlanningJob(job));
  },
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
campaignWorker.on('failed', (job, err) =>
  console.error('[campaign-worker] failed', { jobId: job?.id, error: err.message }));
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

  // Pre-warm template cache (zero GPT cost, improves first-job latency)
  await runCacheWarmup().catch((err) =>
    console.warn('[main] cache warmup failed (non-fatal):', err?.message));

  // Scheduler — runs the 10-min social-account token refresh (X tokens
  // expire in 2h) plus all other cron cycles. Co-located in the worker
  // process so a single Railway service (Dockerfile.worker CMD = main.js)
  // covers both queues AND scheduled refresh. Non-fatal: a scheduler
  // failure must not stop queue workers from running.
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

  // Autoscaling monitor — fires signal when queue depth > 500 or latency > 10s
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
             'lead-thread-recompute', 'conversation-memory-rebuild', 'creator-render'],
    boltConcurrency,
    pid: process.pid,
  });

  // ── Graceful shutdown ───────────────────────────────────────────────────────

  const shutdown = async (signal: string) => {
    console.info(`[main] ${signal} received — shutting down gracefully`);
    stopMonitor();
    clearInterval(orphanRecoveryTimer);
    await Promise.allSettled([
      publishWorker.close(),
      boltWorker.close(),
      engagementWorker.close(),
      intelligenceWorker.close(),
      engineWorker.close(),
      campaignWorker.close(),
      creatorRenderWorker.close(),
      leadThreadRecomputeWorker.close(),
      conversationMemoryRebuildWorker.close(),
    ]);
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
