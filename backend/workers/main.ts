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

import { validateWorkerEnv } from '../utils/validateEnv';
import { startHealthServer }  from './healthServer';

// Start health server immediately — before anything else so Railway healthchecks
// always get a response even if Redis/workers fail to initialise.
startHealthServer(parseInt(process.env.PORT ?? '8080', 10));

// Fail fast if any required env var is missing
validateWorkerEnv();

import os from 'os';
import { Worker }                    from 'bullmq';
import { getRedisConfig, getWorker, closeConnections } from '../queue/bullmqClient';
import { processPublishJob }         from '../queue/jobProcessors/publishProcessor';
import { processEngagementPollingJob } from '../queue/jobProcessors/engagementPollingProcessor';
import { processBoltJob }            from '../queue/jobProcessors/boltProcessor';
import { getIntelligencePollingWorker } from './intelligencePollingWorker';
import { processCampaignPlanningJob } from '../queue/jobProcessors/campaignPlanningProcessor';
import { runCacheWarmup }            from '../services/cacheWarmup';
import { startAutoScalingMonitor }   from '../services/autoScalingSignal';
import { getMetricsSnapshot }        from '../services/metricsCollector';
import type { CampaignPlanningJobPayload } from '../queue/jobProcessors/campaignPlanningProcessor';

// ── Worker instances ──────────────────────────────────────────────────────────

const redisConfig       = getRedisConfig();
const boltConcurrency   = Math.min(4, Math.max(1, os.cpus().length));

const publishWorker     = getWorker('publish', processPublishJob);
const boltWorker        = getWorker('bolt-execution', processBoltJob, { concurrency: boltConcurrency });
const engagementWorker  = getWorker('engagement-polling', async () => {
  await processEngagementPollingJob();
});
const intelligenceWorker = getIntelligencePollingWorker();

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
  { connection: redisConfig },
);
engineWorker.on('error', (err) => console.error('[engine-worker] error:', err));

// Campaign planning worker (ai-heavy queue)
const campaignWorker = new Worker<CampaignPlanningJobPayload>(
  'ai-heavy',
  async (job) => {
    if (job.name !== 'campaign-planning') return; // other job types skip
    await processCampaignPlanningJob(job);
  },
  {
    connection:  redisConfig,
    concurrency: 3,
    limiter:     { max: 5, duration: 1_000 },
  },
);
campaignWorker.on('completed', (job) =>
  console.info('[campaign-worker] completed', { jobId: job.id }));
campaignWorker.on('failed', (job, err) =>
  console.error('[campaign-worker] failed', { jobId: job?.id, error: err.message }));
campaignWorker.on('error', (err) => console.error('[campaign-worker] error:', err));

// ── Startup ───────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  // Pre-warm template cache (zero GPT cost, improves first-job latency)
  await runCacheWarmup().catch((err) =>
    console.warn('[main] cache warmup failed (non-fatal):', err?.message));

  // Autoscaling monitor — fires signal when queue depth > 500 or latency > 10s
  let _cachedLatency = 0;
  setInterval(async () => {
    try { _cachedLatency = (await getMetricsSnapshot()).avgLatencyMs; } catch { /* ignore */ }
  }, 30_000);
  const stopMonitor = startAutoScalingMonitor(30_000, () => _cachedLatency);

  console.info('[main] all workers running', {
    queues: ['publish', 'bolt-execution', 'engagement-polling',
             'intelligence-polling', 'ai-heavy', 'engine-jobs'],
    boltConcurrency,
    pid: process.pid,
  });

  // ── Graceful shutdown ───────────────────────────────────────────────────────

  const shutdown = async (signal: string) => {
    console.info(`[main] ${signal} received — shutting down gracefully`);
    stopMonitor();
    await Promise.allSettled([
      publishWorker.close(),
      boltWorker.close(),
      engagementWorker.close(),
      intelligenceWorker.close(),
      engineWorker.close(),
      campaignWorker.close(),
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
