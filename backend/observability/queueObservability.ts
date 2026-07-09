/**
 * HARDEN-001A — queue/worker instrumentation.
 *
 * Attaches observability-only listeners to BullMQ workers (completion, failure,
 * retry, dead-letter, stalled/timeout) and samples queue depth. Additive and
 * FAIL-SAFE: it only reads job timestamps that BullMQ already records and never
 * changes worker/queue behavior, concurrency, or config.
 *
 * Wired centrally via queueInstrumentation.instrumentWorker/instrumentQueue
 * (which every factory calls) plus the few raw `new Worker(...)` sites.
 */
import { recordQueueJob, recordWorker, recordQueueDepth, recordRawCounter } from './metrics';
import { domainEnabled, observabilityConfig } from './config';

interface MinimalJob {
  finishedOn?: number; processedOn?: number; timestamp?: number;
  attemptsMade?: number; opts?: { attempts?: number };
}
interface MinimalWorker { name?: string; on: (ev: string, cb: (...a: unknown[]) => void) => unknown }
interface MinimalQueue { name?: string; getJobCounts?: () => Promise<Record<string, number>> }

function recordFromJob(queue: string, job: MinimalJob | undefined, ok: boolean): void {
  try {
    const processingMs = job?.processedOn && job?.finishedOn ? job.finishedOn - job.processedOn : undefined;
    const waitMs = job?.timestamp && job?.processedOn ? job.processedOn - job.timestamp : undefined;
    recordQueueJob({ queue, ok, processingMs, waitMs });
    if (typeof processingMs === 'number') recordWorker({ job: queue, durationMs: processingMs, ok });
    if (!ok) {
      const isLast = (job?.attemptsMade ?? 0) >= (job?.opts?.attempts ?? 1);
      recordRawCounter(isLast ? 'queue.job.dead_letter' : 'queue.job.retry', 1, { queue });
    }
  } catch { /* fail-safe */ }
}

const attached = new WeakSet<object>();

/** Attach observability listeners to a worker. Idempotent per worker instance. */
export function observeQueueEvents(worker: MinimalWorker): void {
  try {
    if (!domainEnabled('queue') || !worker || typeof worker.on !== 'function') return;
    if (attached.has(worker as object)) return;
    attached.add(worker as object);
    const name = worker.name || 'unknown';
    worker.on('completed', (job: unknown) => recordFromJob(name, job as MinimalJob, true));
    worker.on('failed', (job: unknown) => recordFromJob(name, job as MinimalJob, false));
    worker.on('stalled', () => { try { recordRawCounter('queue.job.stalled', 1, { queue: name }); } catch { /* fail-safe */ } });
  } catch { /* fail-safe */ }
}

const depthQueues = new Set<MinimalQueue>();

/** Register a queue so the depth sampler polls its counts. */
export function registerQueueForDepth(queue: MinimalQueue): void {
  try {
    if (!domainEnabled('queue') || !queue || typeof queue.getJobCounts !== 'function') return;
    if (depthQueues.size >= 200) return; // hard bound
    depthQueues.add(queue);
  } catch { /* fail-safe */ }
}

let depthStarted = false;

/** Start periodic queue-depth sampling (worker process only). Unref'd + fail-safe. */
export function startQueueDepthSampler(): void {
  try {
    if (depthStarted || !domainEnabled('queue')) return;
    const intervalMs = observabilityConfig.systemSampleMs || 15000;
    if (intervalMs <= 0) return;
    depthStarted = true;
    const timer = setInterval(() => {
      for (const q of depthQueues) {
        try {
          Promise.resolve(q.getJobCounts?.())
            .then((counts) => {
              if (!counts) return;
              const backlog = (counts.waiting ?? 0) + (counts.delayed ?? 0) + (counts.prioritized ?? 0);
              recordQueueDepth(q.name || 'unknown', backlog);
            })
            .catch(() => { /* fail-safe */ });
        } catch { /* fail-safe */ }
      }
    }, intervalMs);
    if (typeof timer.unref === 'function') timer.unref();
  } catch { /* fail-safe */ }
}
