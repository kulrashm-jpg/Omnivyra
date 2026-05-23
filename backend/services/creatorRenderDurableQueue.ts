import { Queue, Worker, QueueEvents, type JobsOptions, type Job } from 'bullmq';
import IORedis from 'ioredis';
import { getSharedRedisClient, getQueuePrefix } from '../queue/bullmqClient';
import { createRenderJobId, type RenderJobStatus } from './creatorRenderQueue';
import { recordCreatorRenderMetric } from './creatorRenderObservability';
import { persistCreatorRenderJobState } from './creatorRenderPersistence';
import { config, envIsExplicit } from '@/config';
import { withSanctionedEnvAccess } from '@/lib/config/enforcer';

export type CreatorDurableRenderJobName = 'infographic' | 'carousel' | 'pdf' | 'slider' | 'multi_slide_export';

export type CreatorDurableRenderJobData = {
  idempotencyKey: string;
  renderer: CreatorDurableRenderJobName;
  payload: Record<string, unknown>;
  auditId?: string;
  timeoutMs?: number;
};

export type CreatorDurableRenderStatus = {
  id: string;
  status: RenderJobStatus | 'cancelled' | 'dead_letter';
  progress: number;
  attemptsMade: number;
  failedReason?: string;
  result?: unknown;
};

const QUEUE_NAME = 'creator-render';
const DLQ_NAME = 'creator-render-dead-letter';
let queue: Queue<CreatorDurableRenderJobData> | null = null;
let deadLetterQueue: Queue<CreatorDurableRenderJobData> | null = null;
let queueEvents: QueueEvents | null = null;

function redisUrl(): string | null {
  // Presence-toggled feature gate — durable queue is "configured" iff an
  // operator explicitly set CREATOR_RENDER_REDIS_URL or REDIS_URL. The raw
  // presence check is required here because `config.REDIS_URL` carries a
  // schema default (redis://localhost:6379) that would always flip the gate
  // on. The actual URL value is not used by callers (connection() uses the
  // shared client) — only the null/non-null shape is.
  if (!envIsExplicit('CREATOR_RENDER_REDIS_URL') && !envIsExplicit('REDIS_URL')) {
    return null;
  }
  // Sanctioned read — `redisUrl()` is the canonical presence-gated URL
  // resolver for the creator-render durable queue. Wrapping suppresses the
  // misleading "should use @/config" warning (the @/config value carries a
  // schema default which is exactly what we need to bypass here).
  return withSanctionedEnvAccess(() =>
    process.env.CREATOR_RENDER_REDIS_URL || process.env.REDIS_URL || null,
  );
}

export function isDurableCreatorRenderQueueConfigured(): boolean {
  return Boolean(redisUrl());
}

function connection(): IORedis {
  if (!redisUrl()) throw new Error('CREATOR_RENDER_REDIS_UNCONFIGURED');
  // Centralized: reuse the single hardened shared ioredis client (TLS /
  // rediss:// / connectTimeout / maxRetriesPerRequest:null applied there).
  // BullMQ duplicates it internally for blocking/subscriber roles.
  // NOTE: CREATOR_RENDER_REDIS_URL is no longer honored as a *separate*
  // Redis server — creator-render now shares REDIS_URL with the rest of
  // the worker (the override was unused and was a divergent factory).
  return getSharedRedisClient();
}

export function getCreatorRenderQueue(): Queue<CreatorDurableRenderJobData> {
  if (!queue) queue = new Queue<CreatorDurableRenderJobData>(QUEUE_NAME, { connection: connection(), prefix: getQueuePrefix() });
  return queue;
}

export function getCreatorRenderDeadLetterQueue(): Queue<CreatorDurableRenderJobData> {
  if (!deadLetterQueue) deadLetterQueue = new Queue<CreatorDurableRenderJobData>(DLQ_NAME, { connection: connection(), prefix: getQueuePrefix() });
  return deadLetterQueue;
}

export function getCreatorRenderQueueEvents(): QueueEvents {
  if (!queueEvents) queueEvents = new QueueEvents(QUEUE_NAME, { connection: connection(), prefix: getQueuePrefix() });
  return queueEvents;
}

export function buildCreatorRenderJobOptions(input: {
  idempotencyKey: string;
  timeoutMs?: number;
  maxAttempts?: number;
}): JobsOptions {
  return {
    jobId: createRenderJobId(input.idempotencyKey),
    attempts: input.maxAttempts ?? 3,
    backoff: { type: 'exponential', delay: 5_000 },
    removeOnComplete: { age: 60 * 60 * 24, count: 500 },
    // Was `false` (unbounded failed-job key growth in Redis). Bounded
    // retention keeps recent failures for debugging without leaking keys.
    removeOnFail: { age: 7 * 24 * 60 * 60, count: 1000 },
  };
}

function withRenderTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  onTimeout: () => Promise<void>,
  onAbort?: () => void,
): Promise<T> {
  let timer: NodeJS.Timeout | null = null;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      // Signal cooperative cancellation to the render pipeline.
      try { onAbort?.(); } catch { /* non-fatal */ }
      void onTimeout();
      reject(new Error(`render_job_timeout_${timeoutMs}ms`));
    }, timeoutMs);
  });
  // Detach the losing promise: a post-timeout settle from orphaned native
  // work must not surface as an unhandledRejection or stack onto a retry.
  promise.catch(() => { /* superseded by timeout */ });
  return Promise.race([promise, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

export async function enqueueDurableCreatorRenderJob(input: CreatorDurableRenderJobData & {
  maxAttempts?: number;
}): Promise<CreatorDurableRenderStatus> {
  const started = Date.now();
  const job = await getCreatorRenderQueue().add(input.renderer, input, buildCreatorRenderJobOptions(input));
  await persistCreatorRenderJobState({
    id: String(job.id),
    idempotencyKey: input.idempotencyKey,
    renderer: input.renderer,
    status: 'queued',
    progress: 0,
    attempts: 0,
    maxAttempts: input.maxAttempts ?? 3,
    payload: input.payload,
    auditId: input.auditId ?? null,
    eventType: 'queued',
  });
  recordCreatorRenderMetric({
    name: 'queue_latency_ms',
    value: Date.now() - started,
    auditId: input.auditId,
    tags: { renderer: input.renderer, jobId: job.id },
  });
  return getDurableCreatorRenderJobStatus(String(job.id));
}

export async function getDurableCreatorRenderJobStatus(jobId: string): Promise<CreatorDurableRenderStatus> {
  const job = await getCreatorRenderQueue().getJob(jobId);
  if (!job) {
    const dead = await getCreatorRenderDeadLetterQueue().getJob(jobId);
    if (dead) {
      return { id: jobId, status: 'dead_letter', progress: Number(dead.progress || 0), attemptsMade: dead.attemptsMade, failedReason: dead.failedReason };
    }
    return { id: jobId, status: 'failed', progress: 0, attemptsMade: 0, failedReason: 'render_job_not_found' };
  }
  const state = await job.getState();
  const status: CreatorDurableRenderStatus['status'] =
    state === 'completed' ? 'completed'
      : state === 'failed' ? 'failed'
        : state === 'active' ? 'running'
          : 'queued';
  return {
    id: String(job.id),
    status,
    progress: Number(job.progress || 0),
    attemptsMade: job.attemptsMade,
    failedReason: job.failedReason,
    result: job.returnvalue,
  };
}

export async function cancelDurableCreatorRenderJob(jobId: string): Promise<CreatorDurableRenderStatus> {
  const job = await getCreatorRenderQueue().getJob(jobId);
  if (!job) return { id: jobId, status: 'failed', progress: 0, attemptsMade: 0, failedReason: 'render_job_not_found' };
  await job.remove();
  await persistCreatorRenderJobState({
    id: jobId,
    idempotencyKey: String(job.data.idempotencyKey || jobId),
    renderer: job.data.renderer,
    status: 'cancelled',
    progress: Number(job.progress || 0),
    attempts: job.attemptsMade,
    maxAttempts: job.opts.attempts ?? 3,
    payload: job.data.payload,
    auditId: job.data.auditId ?? null,
    eventType: 'cancelled',
  });
  return { id: jobId, status: 'cancelled', progress: Number(job.progress || 0), attemptsMade: job.attemptsMade };
}

/**
 * Soak-only branch: real Chromium launch with NO persistence, NO storage upload,
 * NO DB writes, NO settlement mutation, NO OpenAI / provider call.
 *
 * Gated by `config.WORKER_SOAK_MODE === '1'` AND `job.data.__soak === true`.
 * When the env flag is unset, this code path is unreachable.
 *
 * `SOAK_FORCE_THROW=1` makes the branch throw after the launch to exercise the
 * BullMQ retry/DLQ path under controlled conditions.
 */
async function runCreatorRenderSoak(job: Job<unknown>): Promise<{ soak: true; chromiumMs: number; jobId: string; forcedThrow: boolean }> {
  const t0 = Date.now();
  const { chromium } = await import('playwright');
  let browser: Awaited<ReturnType<typeof chromium.launch>> | null = null;
  try {
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    await page.goto('about:blank');
    await new Promise((r) => setTimeout(r, 800));
    const chromiumMs = Date.now() - t0;
    if (config.SOAK_FORCE_THROW === '1') {
      throw new Error('SOAK_FORCE_THROW: deterministic retry/DLQ-path exercise');
    }
    return { soak: true, chromiumMs, jobId: String(job.id), forcedThrow: false };
  } finally {
    try { await browser?.close(); } catch { /* best-effort cleanup */ }
  }
}

export function createCreatorRenderWorker(processor: (job: Job<CreatorDurableRenderJobData>) => Promise<unknown>): Worker<CreatorDurableRenderJobData> {
  return new Worker<CreatorDurableRenderJobData>(QUEUE_NAME, async (job) => {
    // Soak-only opt-in branch — double-gated (env flag + per-job marker) so
    // production is dead code when WORKER_SOAK_MODE is unset.
    if (config.WORKER_SOAK_MODE === '1' && (job.data as { __soak?: boolean } | null)?.__soak === true) {
      return runCreatorRenderSoak(job as Job<unknown>);
    }
    const started = Date.now();
    const abortController = new AbortController();
    // Expose a cancellation signal to the render pipeline WITHOUT changing
    // processor signatures (additive; honored where the renderer checks it).
    (job as Job<CreatorDurableRenderJobData> & { signal?: AbortSignal }).signal = abortController.signal;
    try {
      const timeoutMs = Number(job.data.timeoutMs ?? config.CREATOR_RENDER_JOB_TIMEOUT_MS ?? 180_000) || 180_000;
      const result = await withRenderTimeout(processor(job), timeoutMs, async () => {
        recordCreatorRenderMetric({
          name: 'render_timeout',
          auditId: job.data.auditId,
          tags: { renderer: job.data.renderer, jobId: job.id, timeoutMs },
        });
        await persistCreatorRenderJobState({
          id: String(job.id),
          idempotencyKey: job.data.idempotencyKey,
          renderer: job.data.renderer,
          status: 'failed',
          progress: Number(job.progress || 0),
          attempts: job.attemptsMade + 1,
          maxAttempts: job.opts.attempts ?? 3,
          payload: job.data.payload,
          errorMessage: `render_job_timeout_${timeoutMs}ms`,
          auditId: job.data.auditId ?? null,
          eventType: 'timeout',
          eventMetadata: { timeoutMs },
        });
      }, () => abortController.abort());
      recordCreatorRenderMetric({
        name: 'render_duration_ms',
        value: Date.now() - started,
        auditId: job.data.auditId,
        tags: { renderer: job.data.renderer, jobId: job.id },
      });
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      recordCreatorRenderMetric({
        name: message.includes('timeout') ? 'render_timeout' : 'render_failure',
        auditId: job.data.auditId,
        tags: { renderer: job.data.renderer, jobId: job.id, reason: message },
      });
      if (job.attemptsMade + 1 >= (job.opts.attempts ?? 1)) {
        await getCreatorRenderDeadLetterQueue().add(job.name, job.data, { jobId: String(job.id), removeOnComplete: false, removeOnFail: false });
        await persistCreatorRenderJobState({
          id: String(job.id),
          idempotencyKey: job.data.idempotencyKey,
          renderer: job.data.renderer,
          status: 'dead_letter',
          progress: Number(job.progress || 0),
          attempts: job.attemptsMade + 1,
          maxAttempts: job.opts.attempts ?? 3,
          payload: job.data.payload,
          errorMessage: message,
          auditId: job.data.auditId ?? null,
          eventType: 'dead_letter',
        });
      }
      throw error;
    }
  }, {
    connection: connection(),
    concurrency: Number(config.CREATOR_RENDER_WORKER_CONCURRENCY ?? 3) || 3,
    // Explicit conservative stalled detection. creator-render was on the
    // BullMQ default (30s); pinned to 60s — fast crash recovery for this
    // crash-prone (sharp/pdf OOM) queue without increasing Redis poll cost
    // vs the implicit default.
    stalledInterval: 60_000,
  });
}

export async function replayCreatorRenderDeadLetterJob(jobId: string): Promise<CreatorDurableRenderStatus> {
  const deadJob = await getCreatorRenderDeadLetterQueue().getJob(jobId);
  if (!deadJob) return { id: jobId, status: 'failed', progress: 0, attemptsMade: 0, failedReason: 'dead_letter_job_not_found' };
  await deadJob.remove();
  const replayIdempotencyKey = `${deadJob.data.idempotencyKey}:replay:${Date.now()}`;
  const replay = await enqueueDurableCreatorRenderJob({
    ...deadJob.data,
    idempotencyKey: replayIdempotencyKey,
    auditId: deadJob.data.auditId ?? `${jobId}:replay`,
    maxAttempts: deadJob.opts.attempts ?? 3,
  });
  recordCreatorRenderMetric({
    name: 'dlq_replay',
    auditId: deadJob.data.auditId,
    tags: { originalJobId: jobId, replayJobId: replay.id, renderer: deadJob.data.renderer },
  });
  await persistCreatorRenderJobState({
    id: jobId,
    idempotencyKey: deadJob.data.idempotencyKey,
    renderer: deadJob.data.renderer,
    status: 'dead_letter',
    progress: Number(deadJob.progress || 0),
    attempts: deadJob.attemptsMade,
    maxAttempts: deadJob.opts.attempts ?? 3,
    payload: deadJob.data.payload,
    auditId: deadJob.data.auditId ?? null,
    eventType: 'dlq_replayed',
    eventMetadata: { replayJobId: replay.id },
  });
  return replay;
}

export async function reconcileCreatorRenderQueue(input: { staleActiveMs?: number } = {}): Promise<{
  persisted: string[];
  recovered: string[];
}> {
  const renderQueue = getCreatorRenderQueue();
  const jobs = await renderQueue.getJobs(['waiting', 'delayed', 'active', 'failed']);
  const persisted: string[] = [];
  for (const job of jobs) {
    const state = await job.getState();
    const status = state === 'active' ? 'running' : state === 'waiting' || state === 'delayed' ? 'queued' : state;
    await persistCreatorRenderJobState({
      id: String(job.id),
      idempotencyKey: job.data.idempotencyKey,
      renderer: job.data.renderer,
      status,
      progress: Number(job.progress || 0),
      attempts: job.attemptsMade,
      maxAttempts: job.opts.attempts ?? 3,
      payload: job.data.payload,
      errorMessage: job.failedReason ?? null,
      auditId: job.data.auditId ?? null,
      eventType: 'queue_reconciled',
      eventMetadata: { bullmqState: state },
    });
    persisted.push(String(job.id));
  }
  const orphaned = await recoverOrphanedCreatorRenderJobs({ olderThanMs: input.staleActiveMs });
  recordCreatorRenderMetric({
    name: 'queue_reconciliation',
    tags: { persisted: persisted.length, recovered: orphaned.recovered.length },
  });
  return { persisted, recovered: orphaned.recovered };
}

export async function recoverOrphanedCreatorRenderJobs(input: { olderThanMs?: number } = {}): Promise<{ recovered: string[] }> {
  const queueInstance = getCreatorRenderQueue();
  const active = await queueInstance.getJobs(['active']);
  const cutoff = Date.now() - (input.olderThanMs ?? 15 * 60_000);
  const recovered: string[] = [];
  for (const job of active) {
    if ((job.processedOn ?? Date.now()) > cutoff) continue;
    await job.moveToFailed(new Error('orphaned_render_job_recovered'), job.token ?? '0');
    await persistCreatorRenderJobState({
      id: String(job.id),
      idempotencyKey: job.data.idempotencyKey,
      renderer: job.data.renderer,
      status: 'failed',
      progress: Number(job.progress || 0),
      attempts: job.attemptsMade,
      maxAttempts: job.opts.attempts ?? 3,
      payload: job.data.payload,
      errorMessage: 'orphaned_render_job_recovered',
      auditId: job.data.auditId ?? null,
      eventType: 'orphan_recovered',
    });
    recovered.push(String(job.id));
  }
  return { recovered };
}
