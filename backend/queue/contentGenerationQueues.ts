/**
 * CONTENT GENERATION QUEUE CONFIGURATION
 *
 * Defines queue behavior per content type:
 * - Concurrency (how many workers per queue)
 * - Priority (higher priority queues execute first)
 * - Rate limiting (per-tenant max requests)
 * - Backoff strategy (retry behavior)
 * - Resource allocation (CPU-bound vs I/O-bound)
 *
 * Queue-per-type ensures fair multi-tenant delivery:
 * Free user's posts won't starve enterprise user's blogs
 */

import { Queue, Worker } from 'bullmq';
import { getConnectionConfig, getQueuePrefix } from './bullmqClient';
import { observeQueueEvents } from '../observability/queueObservability';
import { runWithJobTraceContext } from '../observability/traceKit';
import { deadLetterOnExhaustion } from './deadLetterOnExhaustion';

// ─────────────────────────────────────────────────────────────────────────────
// QUEUE CONFIGURATION
// ─────────────────────────────────────────────────────────────────────────────

export interface QueueConfig {
  concurrency: number; // How many jobs to process in parallel
  priority: number; // Execution priority (higher = sooner)
  limiter?: {
    max: number; // Max concurrent ops
    duration: number; // Per this many milliseconds
  };
  defaultBackoff?: {
    type: 'exponential' | 'fixed';
    delay: number;
  };
  attempts?: number;
  removeOnComplete?: boolean | { age: number };
  removeOnFail?: boolean | { age: number };
}

export const CONTENT_QUEUE_CONFIG: Record<string, QueueConfig> = {
  // Blog: narrative-heavy, slow, medium volume
  'content-blog': {
    concurrency: 2,
    priority: 5,
    limiter: { max: 5, duration: 1000 },
    defaultBackoff: { type: 'exponential', delay: 2000 },
    attempts: 2,
    removeOnComplete: { age: 3600 }, // 1 hour
    removeOnFail: { age: 604800 }, // 7 days for debugging
  },

  // Post: fast turn, high volume, lower priority than blog
  'content-post': {
    concurrency: 3,
    priority: 7,
    limiter: { max: 10, duration: 1000 },
    defaultBackoff: { type: 'exponential', delay: 1000 },
    attempts: 2,
    removeOnComplete: { age: 3600 },
    removeOnFail: { age: 604800 },
  },

  // WhitePaper: research-heavy, slow, rare
  'content-whitepaper': {
    concurrency: 1,
    priority: 3,
    limiter: { max: 2, duration: 1000 },
    defaultBackoff: { type: 'exponential', delay: 5000 },
    attempts: 2,
    removeOnComplete: { age: 3600 },
    removeOnFail: { age: 604800 },
  },

  // Story: creative, medium speed
  'content-story': {
    concurrency: 2,
    priority: 6,
    limiter: { max: 5, duration: 1000 },
    defaultBackoff: { type: 'exponential', delay: 2000 },
    attempts: 2,
    removeOnComplete: { age: 3600 },
    removeOnFail: { age: 604800 },
  },

  // Newsletter: medium speed
  'content-newsletter': {
    concurrency: 2,
    priority: 6,
    limiter: { max: 5, duration: 1000 },
    defaultBackoff: { type: 'exponential', delay: 2000 },
    attempts: 2,
    removeOnComplete: { age: 3600 },
    removeOnFail: { age: 604800 },
  },

  // Engagement: TIME-CRITICAL, high volume, highest priority
  // Users expect instant/near-instant responses to comments
  'content-engagement': {
    concurrency: 4,
    priority: 9,
    limiter: { max: 20, duration: 1000 },
    defaultBackoff: { type: 'exponential', delay: 500 },
    attempts: 2,
    removeOnComplete: { age: 1800 }, // 30 min (fast cleanup)
    removeOnFail: { age: 604800 },
  },

  // Refinement: quick improvement ops, fast execution
  'content-refinement': {
    concurrency: 2,
    priority: 8,
    limiter: { max: 10, duration: 1000 },
    defaultBackoff: { type: 'exponential', delay: 1000 },
    attempts: 1,
    removeOnComplete: { age: 1800 },
    removeOnFail: { age: 604800 },
  },

  // ─── BOLT CONTENT JOBS QUEUE ────────────────────────────────────────────
  // Processes one topic group per job (master + variants + schedule inserts).
  // Priority 1-5 based on content type; blog/article run first.
  // Separate from text content queues — BOLT jobs don't go through unified engine.

  'bolt-content-jobs': {
    concurrency: 3,           // 3 topic groups in parallel (safe for Claude rate limits)
    priority: 2,              // High priority — user is waiting for calendar to populate
    limiter: { max: 6, duration: 1000 },
    defaultBackoff: { type: 'exponential', delay: 3000 },
    attempts: 3,
    removeOnComplete: { age: 86400 }, // keep 24h for progress polling
    removeOnFail:     { age: 604800 }, // 7 days for debugging
  },

  // ─── CREATOR CONTENT QUEUES ─────────────────────────────────────────────

  // Video Script: high complexity, requires rich context, medium volume
  'creator-video': {
    concurrency: 1, // Complex generation, low concurrency
    priority: 4,
    limiter: { max: 3, duration: 1000 },
    defaultBackoff: { type: 'exponential', delay: 3000 },
    attempts: 2,
    removeOnComplete: { age: 3600 },
    removeOnFail: { age: 604800 },
  },

  // Carousel: moderate complexity, good for batch ops
  'creator-carousel': {
    concurrency: 2,
    priority: 5,
    limiter: { max: 5, duration: 1000 },
    defaultBackoff: { type: 'exponential', delay: 2000 },
    attempts: 2,
    removeOnComplete: { age: 3600 },
    removeOnFail: { age: 604800 },
  },

  // Story: creative narrative, fast turn-around
  'creator-story': {
    concurrency: 2,
    priority: 6,
    limiter: { max: 5, duration: 1000 },
    defaultBackoff: { type: 'exponential', delay: 2000 },
    attempts: 2,
    removeOnComplete: { age: 3600 },
    removeOnFail: { age: 604800 },
  },

  // ─── WHATSAPP BROADCAST QUEUE ────────────────────────────────────────────
  'whatsapp-broadcast': {
    concurrency: 2,
    priority: 6,
    defaultBackoff: { type: 'exponential', delay: 5000 },
    attempts: 3,
    removeOnComplete: { age: 86400 },
    removeOnFail: { age: 604800 },
  },

  // ─── WHATSAPP WEBHOOK EVENT QUEUE ────────────────────────────────────────
  // Processes raw Meta webhook payloads async — ack in <10ms, process later.
  // jobId = sha256(rawBody) provides replay dedup at queue insertion.
  'whatsapp-webhook': {
    concurrency: 3,
    priority: 8,
    defaultBackoff: { type: 'exponential', delay: 2000 },
    attempts: 5,
    removeOnComplete: { age: 86400 },
    removeOnFail: { age: 604800 },
  },

  // ─── ANALYTICS INGESTION QUEUE ───────────────────────────────────────────
  // Two job types:
  //   'daily-growth'  — triggered by cron at 02:00 UTC
  //   'post-polls'    — triggered after publish (15-min + 24-h delayed)
  'analytics-ingestion': {
    concurrency: 1,          // sequential — avoids API rate limit bursts
    priority: 2,
    defaultBackoff: { type: 'exponential', delay: 10000 },
    attempts: 3,
    removeOnComplete: { age: 86400 },
    removeOnFail: { age: 604800 },
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// QUEUE FACTORY & INITIALIZATION
// ─────────────────────────────────────────────────────────────────────────────

const queues = new Map<string, Queue>();

const LEGACY_QUEUE_NAME_ALIASES: Record<string, string> = {
  'content:blog': 'content-blog',
  'content:post': 'content-post',
  'content:whitepaper': 'content-whitepaper',
  'content:story': 'content-story',
  'content:newsletter': 'content-newsletter',
  'content:engagement': 'content-engagement',
  'content:refinement': 'content-refinement',
};

export function normalizeContentQueueName(queueName: string): string {
  if (!queueName) return queueName;

  if (LEGACY_QUEUE_NAME_ALIASES[queueName]) {
    return LEGACY_QUEUE_NAME_ALIASES[queueName];
  }

  return queueName;
}

export function getContentQueue(queueName: string): Queue {
  const normalizedQueueName = normalizeContentQueueName(queueName);

  if (!queues.has(normalizedQueueName)) {
    const queue = new Queue(normalizedQueueName, {
      connection: getConnectionConfig(),
      prefix: getQueuePrefix(),
      defaultJobOptions: {
        attempts: CONTENT_QUEUE_CONFIG[normalizedQueueName]?.attempts || 2,
        backoff: CONTENT_QUEUE_CONFIG[normalizedQueueName]?.defaultBackoff || {
          type: 'exponential',
          delay: 2000,
        },
        removeOnComplete: CONTENT_QUEUE_CONFIG[normalizedQueueName]?.removeOnComplete,
        removeOnFail: CONTENT_QUEUE_CONFIG[normalizedQueueName]?.removeOnFail,
      },
    });

    queues.set(normalizedQueueName, queue);
  }

  return queues.get(normalizedQueueName)!;
}

/**
 * Initialize all content generation queues with backpressure protection.
 *
 * NOTE: BullMQ v5 Queue does not emit 'before:add', 'active', 'completed', or
 * 'failed' events.  Those are Worker-level events.  Backpressure and rate
 * limiting must be enforced at the call site (before calling queue.add).
 */
export async function initializeContentQueues(): Promise<void> {
  console.info('[contentGenerationQueues][initialize] Starting content queue initialization');

  for (const [queueName, config] of Object.entries(CONTENT_QUEUE_CONFIG)) {
    getContentQueue(queueName);

    console.info('[contentGenerationQueues][initialized]', {
      queueName,
      concurrency: config.concurrency,
      priority: config.priority,
    });
  }

  console.info('[contentGenerationQueues][initialize] All queues initialized');
}

/**
 * Create workers for each queue with proper concurrency
 */
export async function startContentWorkers(processor: (job: any) => Promise<any>): Promise<void> {
  console.info('[contentGenerationQueues][workers] Starting workers');

  for (const [queueName, config] of Object.entries(CONTENT_QUEUE_CONFIG)) {
    const worker = new Worker(queueName, (job) => runWithJobTraceContext(job, () => processor(job)), {
      connection: getConnectionConfig(),
      prefix: getQueuePrefix(),
      concurrency: config.concurrency,
      // Reduce idle Redis polling to match the tuned core pool (getWorker in
      // bullmqClient.ts). Job pickup stays event-driven; only the idle blocking
      // wait and the stall-detection scan cadence change.
      drainDelay: 300,
      stalledInterval: 1_800_000,
    });

    observeQueueEvents(worker); // HARDEN-001A: queue/worker metrics (fail-safe)

    worker.on('completed', (job) => {
      console.info('[contentGenerationQueues][worker-completed]', {
        queueName,
        jobId: job.id,
        processingTime: (job.finishedOn ?? 0) - (job.processedOn ?? 0),
      });
    });

    worker.on('failed', (job, error) => {
      console.error('[contentGenerationQueues][worker-failed]', {
        queueName,
        jobId: job?.id,
        error: String(error),
      });
      deadLetterOnExhaustion(queueName, job, error);
    });

    console.info('[contentGenerationQueues][worker-started]', {
      queueName,
      concurrency: config.concurrency,
    });
  }
}

/**
 * Start creator content workers
 * Processes video scripts, carousels, and visual stories with separate processor
 */
export async function startCreatorContentWorkers(processor: (job: any) => Promise<any>): Promise<void> {
  console.info('[contentGenerationQueues][creator-workers] Starting creator content workers');

  const creatorQueueNames = ['creator-video', 'creator-carousel', 'creator-story'];

  for (const queueName of creatorQueueNames) {
    const config = CONTENT_QUEUE_CONFIG[queueName];
    if (!config) {
      console.warn(`[contentGenerationQueues] No config found for ${queueName}`);
      continue;
    }

    const worker = new Worker(queueName, (job) => runWithJobTraceContext(job, () => processor(job)), {
      connection: getConnectionConfig(),
      prefix: getQueuePrefix(),
      concurrency: config.concurrency,
      // Reduce idle Redis polling to match the tuned core pool (getWorker in
      // bullmqClient.ts). Job pickup stays event-driven; only the idle blocking
      // wait and the stall-detection scan cadence change.
      drainDelay: 300,
      stalledInterval: 1_800_000,
    });

    observeQueueEvents(worker); // HARDEN-001A: queue/worker metrics (fail-safe)

    worker.on('completed', (job) => {
      console.info('[contentGenerationQueues][creator-worker-completed]', {
        queueName,
        jobId: job.id,
        processingTime: (job.finishedOn ?? 0) - (job.processedOn ?? 0),
      });
    });

    worker.on('failed', (job, error) => {
      console.error('[contentGenerationQueues][creator-worker-failed]', {
        queueName,
        jobId: job?.id,
        error: String(error),
      });
      deadLetterOnExhaustion(queueName, job, error);
    });

    console.info('[contentGenerationQueues][creator-worker-started]', {
      queueName,
      concurrency: config.concurrency,
    });
  }
}

/**
 * Start the BOLT content job worker.
 * One worker processes one topic group at a time (master + variants + inserts).
 * Concurrency=3 means up to 3 topic groups run in parallel per server instance.
 */
export async function startBoltContentWorkers(processor: (job: any) => Promise<any>): Promise<void> {
  const config = CONTENT_QUEUE_CONFIG['bolt-content-jobs']!;
  const worker = new Worker('bolt-content-jobs', (job) => runWithJobTraceContext(job, () => processor(job)), {
    connection: getConnectionConfig(),
    prefix: getQueuePrefix(),
    concurrency: config.concurrency,
    // Reduce idle Redis polling to match the tuned core pool (getWorker in
    // bullmqClient.ts). Job pickup stays event-driven; only the idle blocking
    // wait and the stall-detection scan cadence change.
    drainDelay: 300,
    stalledInterval: 1_800_000,
  });

  observeQueueEvents(worker); // HARDEN-001A: queue/worker metrics (fail-safe)

  worker.on('completed', (job) => {
    console.info('[bolt-content-worker][completed]', {
      jobId: job.id,
      processingTime: (job.finishedOn ?? 0) - (job.processedOn ?? 0),
    });
  });

  worker.on('failed', (job, error) => {
    console.error('[bolt-content-worker][failed]', { jobId: job?.id, error: String(error) });
    deadLetterOnExhaustion('bolt-content-jobs', job, error);
  });

  console.info('[bolt-content-worker] started, concurrency=', config.concurrency);
}

/**
 * Start the WhatsApp broadcast worker.
 * Processes wa-broadcast-batch jobs — calls processBatch() from whatsappBroadcastService.
 */
export async function startWhatsAppBroadcastWorker(processor: (job: any) => Promise<any>): Promise<void> {
  const config = CONTENT_QUEUE_CONFIG['whatsapp-broadcast']!;
  const worker = new Worker('whatsapp-broadcast', (job) => runWithJobTraceContext(job, () => processor(job)), {
    connection: getConnectionConfig(),
    prefix: getQueuePrefix(),
    concurrency: config.concurrency,
    // Reduce idle Redis polling to match the tuned core pool (getWorker in
    // bullmqClient.ts). Job pickup stays event-driven; only the idle blocking
    // wait and the stall-detection scan cadence change.
    drainDelay: 300,
    stalledInterval: 1_800_000,
  });

  observeQueueEvents(worker); // HARDEN-001A: queue/worker metrics (fail-safe)

  worker.on('completed', (job) => {
    console.info('[wa-broadcast-worker][completed]', {
      jobId: job.id,
      processingTime: (job.finishedOn ?? 0) - (job.processedOn ?? 0),
    });
  });

  worker.on('failed', (job, error) => {
    console.error('[wa-broadcast-worker][failed]', { jobId: job?.id, error: String(error) });
    deadLetterOnExhaustion('whatsapp-broadcast', job, error);
  });

  console.info('[wa-broadcast-worker] started, concurrency=', config.concurrency);
}

export async function startWhatsAppWebhookWorker(processor: (job: any) => Promise<any>): Promise<void> {
  const config = CONTENT_QUEUE_CONFIG['whatsapp-webhook']!;
  const worker = new Worker('whatsapp-webhook', (job) => runWithJobTraceContext(job, () => processor(job)), {
    connection: getConnectionConfig(),
    prefix: getQueuePrefix(),
    concurrency: config.concurrency,
    // Reduce idle Redis polling to match the tuned core pool (getWorker in
    // bullmqClient.ts). Job pickup stays event-driven; only the idle blocking
    // wait and the stall-detection scan cadence change.
    drainDelay: 300,
    stalledInterval: 1_800_000,
  });
  observeQueueEvents(worker); // HARDEN-001A: queue/worker metrics (fail-safe)
  worker.on('completed', (job) => {
    console.info('[wa-webhook-worker][completed]', { jobId: job.id });
  });
  worker.on('failed', (job, error) => {
    console.error('[wa-webhook-worker][failed]', { jobId: job?.id, error: String(error) });
    deadLetterOnExhaustion('whatsapp-webhook', job, error);
  });
  console.info('[wa-webhook-worker] started, concurrency=', config.concurrency);
}

export async function startAnalyticsIngestionWorker(processor: (job: any) => Promise<any>): Promise<void> {
  // TEMP diagnostic — sentinel file
  const _diagFs = await import('fs');
  const _diagPath = await import('path');
  const _diag = (stage: string, extra?: Record<string, unknown>): void => {
    try {
      const line = JSON.stringify({ ts: new Date().toISOString(), stage, ...extra }) + '\n';
      _diagFs.appendFileSync(_diagPath.join(process.cwd(), '.worker-bootstrap.log'), line);
    } catch { /* never throw */ }
  };
  _diag('startAnalyticsIngestionWorker:entered');
  const config = CONTENT_QUEUE_CONFIG['analytics-ingestion']!;
  let worker: Worker;
  try {
    worker = new Worker('analytics-ingestion', (job) => runWithJobTraceContext(job, () => processor(job)), {
      connection: getConnectionConfig(),
      prefix: getQueuePrefix(),
      concurrency: config.concurrency,
      // Reduce idle Redis polling to match the tuned core pool (getWorker in
      // bullmqClient.ts). Job pickup stays event-driven; only the idle blocking
      // wait and the stall-detection scan cadence change.
      drainDelay: 300,
      stalledInterval: 1_800_000,
    });
    _diag('startAnalyticsIngestionWorker:worker-constructed', { concurrency: config.concurrency });
  } catch (e) {
    _diag('startAnalyticsIngestionWorker:constructor-THREW', { error: e instanceof Error ? e.message : String(e) });
    throw e;
  }
  // The BullMQ Worker emits 'ready' once its Redis connection is ready;
  // 'active' fires on every job claim. If we see neither, the worker
  // never subscribed.
  observeQueueEvents(worker); // HARDEN-001A: queue/worker metrics (fail-safe)
  worker.on('ready', () => _diag('analytics-ingestion-worker:ready'));
  worker.on('error', (err) => _diag('analytics-ingestion-worker:error', { error: err instanceof Error ? err.message : String(err) }));
  worker.on('closed', () => _diag('analytics-ingestion-worker:closed'));
  worker.on('active', (job) => _diag('analytics-ingestion-worker:active', { jobId: job.id, name: job.name }));
  worker.on('completed', (job) => {
    _diag('analytics-ingestion-worker:completed', { jobId: job.id, name: job.name });
    console.info('[analytics-ingestion-worker][completed]', { jobId: job.id });
  });
  worker.on('failed', (job, error) => {
    _diag('analytics-ingestion-worker:failed', { jobId: job?.id, error: String(error).slice(0, 200) });
    console.error('[analytics-ingestion-worker][failed]', { jobId: job?.id, error: String(error) });
    deadLetterOnExhaustion('analytics-ingestion', job, error);
  });
  console.info('[analytics-ingestion-worker] started, concurrency=', config.concurrency);
  _diag('startAnalyticsIngestionWorker:event-handlers-registered');
}

// ─────────────────────────────────────────────────────────────────────────────
// RATE LIMITING & TENANT CONTROLS
// ─────────────────────────────────────────────────────────────────────────────

const RATE_LIMITS: Record<string, Record<string, Record<string, number>>> = {
  free: {
    blog: { daily: 2 },
    post: { daily: 5 },
    whitepaper: { daily: 0 },
    story: { daily: 2 },
    newsletter: { daily: 1 },
    engagement_response: { daily: 0 }, // Metered by credits
  },
  pro: {
    blog: { daily: 20 },
    post: { daily: 50 },
    whitepaper: { daily: 5 },
    story: { daily: 10 },
    newsletter: { daily: 5 },
    engagement_response: { daily: 0 }, // Metered by credits
  },
  enterprise: {
    blog: { daily: Infinity },
    post: { daily: Infinity },
    whitepaper: { daily: Infinity },
    story: { daily: Infinity },
    newsletter: { daily: Infinity },
    engagement_response: { daily: 0 }, // Metered by credits
  },
};

async function getTenantPlan(_company_id: string): Promise<string> {
  // TODO: Query actual tenant plan from DB
  return 'pro';
}

export async function checkRateLimitForTenant(company_id: string, content_type: string): Promise<boolean> {
  const plan = await getTenantPlan(company_id);
  const limits = RATE_LIMITS[plan] || RATE_LIMITS.free;
  const dailyLimit = limits[content_type]?.daily;

  if (dailyLimit === Infinity) {
    return true; // Enterprise or unlimited
  }

  if (dailyLimit === 0) {
    return false; // Not available on this plan
  }

  // TODO: implement proper daily usage tracking against Redis
  return true;
}

export async function checkBackpressure(queueName: string, company_id?: string): Promise<void> {
  const queue = getContentQueue(queueName);
  const count = await queue.count();

  if (count > 2000) {
    throw new Error(
      `[Queue too deep for ${queueName}] Currently ${count} jobs waiting. Try again in 1 minute.`
    );
  }

  if (company_id && count > 500) {
    const plan = await getTenantPlan(company_id);
    if (plan !== 'enterprise' && Math.random() < 0.1) {
      throw new Error(
        `[Queue near capacity] System is busy. Your request is queued but may take longer. Try again soon.`
      );
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// EXPORTS
// ─────────────────────────────────────────────────────────────────────────────

export { getContentQueue as getQueue };
