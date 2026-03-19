/**
 * Campaign Planning Worker — v2 Pipeline
 *
 * Processes 'campaign-planning' jobs from the ai-heavy BullMQ queue.
 *
 * Run: npm run worker:campaign-planning
 * Requires: REDIS_URL, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, OPENAI_API_KEY
 *
 * Scaling:
 *   - concurrency: 3 (AI-heavy ops — limited by OpenAI rate limits)
 *   - Add workers horizontally on Railway when queue depth > 500 (autoscale signal)
 */

import { Worker } from 'bullmq';
import { getRedisConfig } from '../queue/bullmqClient';
import { processCampaignPlanningJob } from '../queue/jobProcessors/campaignPlanningProcessor';
import { runCacheWarmup } from '../services/cacheWarmup';
import { startAutoScalingMonitor } from '../services/autoScalingSignal';
import { getMetricsSnapshot } from '../services/metricsCollector';
import type { CampaignPlanningJobPayload } from '../queue/jobProcessors/campaignPlanningProcessor';

const redisConfig = getRedisConfig();

// ── Worker ────────────────────────────────────────────────────────────────────

const worker = new Worker<CampaignPlanningJobPayload>(
  'ai-heavy',
  async (job) => {
    // Only process campaign-planning jobs from the shared ai-heavy queue
    if (job.name !== 'campaign-planning') {
      console.info('[campaign-worker] skipping non-campaign job', job.name);
      return;
    }
    await processCampaignPlanningJob(job);
  },
  {
    connection:  redisConfig,
    concurrency: 3,    // 3 parallel campaign plans max
    limiter: {
      max:      5,     // max 5 jobs per second (OpenAI rate limit buffer)
      duration: 1000,
    },
  },
);

worker.on('completed', (job) => {
  console.info('[campaign-worker] completed', { jobId: job.id, name: job.name });
});

worker.on('failed', (job, err) => {
  console.error('[campaign-worker] failed', { jobId: job?.id, error: err.message });
});

worker.on('error', (err) => {
  console.error('[campaign-worker] worker error:', err);
});

// ── Startup ───────────────────────────────────────────────────────────────────

async function start() {
  console.info('[campaign-worker] starting...');

  // Pre-warm common template cache (zero GPT cost)
  await runCacheWarmup();

  // Start autoscaling monitor (fires webhook when queue > 500)
  let _cachedLatency = 0;
  // Refresh latency sample every 30s in background (non-blocking)
  setInterval(async () => {
    try { _cachedLatency = (await getMetricsSnapshot()).avgLatencyMs; } catch { /* ignore */ }
  }, 30_000);

  const stopMonitor = startAutoScalingMonitor(30_000, () => _cachedLatency);

  // Graceful shutdown
  const shutdown = async (signal: string) => {
    console.info(`[campaign-worker] ${signal} received — shutting down`);
    stopMonitor();
    await worker.close();
    process.exit(0);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT',  () => shutdown('SIGINT'));

  console.info('[campaign-worker] ready — processing ai-heavy:campaign-planning jobs');
}

start().catch((err) => {
  console.error('[campaign-worker] startup error:', err);
  process.exit(1);
});
