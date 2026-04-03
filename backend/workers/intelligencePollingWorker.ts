/**
 * Intelligence Polling Worker
 * Processes jobs from the intelligence-polling queue: fetch from external API, store signals, update usage/health.
 */

import { Worker, Job } from 'bullmq';
import { ingestSignals } from '../services/intelligenceIngestionModule';
import type { IntelligencePollingJobPayload } from '../queue/intelligencePollingQueue';
import { config } from '@/config';

const REDIS_URL = config.REDIS_URL;
const REDIS_HOST = config.REDIS_HOST;
const REDIS_PORT = config.REDIS_PORT;
const REDIS_PASSWORD = config.REDIS_PASSWORD;

function getConnection() {
  if (REDIS_URL && REDIS_URL.includes('://')) {
    const parsed = new URL(REDIS_URL);
    const needsTls = parsed.hostname.includes('upstash.io');
    return {
      host: parsed.hostname || 'localhost',
      port: parseInt(parsed.port || '6379', 10),
      password: parsed.password || undefined,
      ...(needsTls ? { tls: {} } : {}),
      enableReadyCheck: false,
      maxRetriesPerRequest: null,
    };
  }
  return { host: REDIS_HOST, port: REDIS_PORT, password: REDIS_PASSWORD };
}

const QUEUE_NAME = 'intelligence-polling';

function log(
  event: 'poll_started' | 'poll_completed' | 'poll_failed',
  data: {
    apiSourceId: string;
    duration_ms?: number;
    signals_inserted?: number;
    error?: string;
    [k: string]: unknown;
  }
) {
  console.log(JSON.stringify({ event, ...data }));
}

/**
 * Process one intelligence polling job.
 */
async function processIntelligencePollingJob(job: Job<IntelligencePollingJobPayload>): Promise<void> {
  const { apiSourceId, companyId, purpose } = job.data;
  const start = Date.now();

  console.log('[intelligence] processing polling job', job.data);
  log('poll_started', { apiSourceId, companyId: companyId ?? null, purpose: purpose ?? null });

  try {
    const result = await ingestSignals(apiSourceId, companyId ?? null, purpose);
    const durationMs = Date.now() - start;

    log('poll_completed', {
      apiSourceId,
      companyId: companyId ?? null,
      duration_ms: durationMs,
      signals_inserted: result.signals_inserted,
      signals_skipped: result.signals_skipped,
      ...(result.company_signals_inserted !== undefined && { company_signals_inserted: result.company_signals_inserted }),
      ...(result.skipped_reason && { skipped: result.skipped_reason }),
    });
  } catch (err: unknown) {
    const durationMs = Date.now() - start;
    const message = (err as Error)?.message ?? String(err);
    log('poll_failed', {
      apiSourceId,
      duration_ms: durationMs,
      error: message,
    });
    if (message.includes('not found') || message.includes('inactive')) {
      return;
    }
    throw err;
  }
}

/**
 * Create and return the intelligence polling worker.
 * Retry: 3 attempts, exponential backoff. Does not crash on job errors; BullMQ handles retries.
 */
export function getIntelligencePollingWorker(): Worker {
  const worker = new Worker<IntelligencePollingJobPayload>(
    QUEUE_NAME,
    async (job) => {
      await processIntelligencePollingJob(job);
    },
    {
      connection: getConnection(),
      concurrency: 2,
      limiter: {
        max: 10,
        duration: 60_000,
      },
      drainDelay: 300,
      stalledInterval: 1_800_000,
    }
  );

  worker.on('completed', (job) => {
    console.log(`[intelligence-polling] job ${job.id} completed`);
  });

  worker.on('failed', (job, err) => {
    console.error(`[intelligence-polling] job ${job?.id} failed`, err?.message ?? err);
  });

  worker.on('error', (err) => {
    console.error('[intelligence-polling] worker error', err);
  });

  return worker;
}
