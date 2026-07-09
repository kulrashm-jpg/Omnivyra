/**
 * HARDEN-001 — Public metrics API.
 *
 * The single, reusable surface every part of the app uses to record telemetry.
 * Consistent naming: `<domain>.<subject>.<unit>` (e.g. api.request.duration_ms,
 * db.query.duration_ms, ai.provider.duration_ms). All functions are FAIL-SAFE
 * no-ops when the domain is disabled and never throw.
 */
import { registry, type Labels } from './registry';
import { observabilityConfig, domainEnabled } from './config';
import { logger } from '../services/logger';

// ── Metric names (single source of truth) ──────────────────────────────────────
export const M = {
  api: {
    duration: 'api.request.duration_ms',
    requests: 'api.request.count',
    payloadIn: 'api.request.payload_bytes',
    payloadOut: 'api.response.payload_bytes',
    errors: 'api.request.errors',
    timeouts: 'api.request.timeouts',
  },
  db: {
    duration: 'db.query.duration_ms',
    queries: 'db.query.count',
    rows: 'db.query.rows',
    slow: 'db.query.slow',
    errors: 'db.query.errors',
    perRequest: 'db.query.per_request',
  },
  ai: {
    duration: 'ai.provider.duration_ms',
    calls: 'ai.provider.count',
    tokensIn: 'ai.provider.tokens_in',
    tokensOut: 'ai.provider.tokens_out',
    retries: 'ai.provider.retries',
    errors: 'ai.provider.errors',
    slow: 'ai.provider.slow',
  },
  ext: {
    duration: 'external.request.duration_ms',
    calls: 'external.request.count',
    errors: 'external.request.errors',
    timeouts: 'external.request.timeouts',
  },
  queue: {
    processing: 'queue.job.processing_ms',
    wait: 'queue.job.wait_ms',
    depth: 'queue.depth',
    completed: 'queue.job.completed',
    failed: 'queue.job.failed',
  },
  scheduler: {
    duration: 'scheduler.run.duration_ms',
    runs: 'scheduler.run.count',
    skipped: 'scheduler.run.skipped',
    failures: 'scheduler.run.failures',
    delay: 'scheduler.run.delay_ms',
  },
  worker: {
    duration: 'worker.job.duration_ms',
    jobs: 'worker.job.count',
    failures: 'worker.job.failures',
    timeouts: 'worker.job.timeouts',
    concurrency: 'worker.concurrency',
  },
  cache: {
    hit: 'cache.hit',
    miss: 'cache.miss',
    invalidation: 'cache.invalidation',
  },
  system: {
    rss: 'system.memory.rss_bytes',
    heapUsed: 'system.memory.heap_used_bytes',
    cpuPct: 'system.cpu.percent',
    loopLag: 'system.eventloop.lag_ms',
  },
} as const;

/** Top-N leaderboard names. */
export const BOARD = {
  slowApi: 'top.slow_api',
  slowDb: 'top.slow_db',
  largestPayload: 'top.largest_payload',
  errorApi: 'top.error_api',
  retryApi: 'top.retry_api',
  slowAi: 'top.slow_ai',
  expensiveJob: 'top.expensive_job',
} as const;

// ── Generic timing helpers ──────────────────────────────────────────────────────

/** Monotonic ms since an arbitrary origin; safe everywhere. */
export function now(): number {
  try { return performance.now(); } catch { return Date.now(); }
}

/** Start a timer; returns a fn that yields elapsed ms. */
export function startTimer(): () => number {
  const t0 = now();
  return () => now() - t0;
}

/** Time an async fn and observe into `name`. Re-throws the original error. */
export async function time<T>(name: string, fn: () => Promise<T>, labels?: Labels): Promise<T> {
  const done = startTimer();
  try {
    const out = await fn();
    safeObserve(name, done(), labels);
    return out;
  } catch (err) {
    safeObserve(name, done(), { ...(labels ?? {}), error: true });
    throw err;
  }
}

// ── Fail-safe primitives ────────────────────────────────────────────────────────
function safeObserve(name: string, value: number, labels?: Labels): void {
  if (!observabilityConfig.enabled) return;
  registry.observe(name, value, labels);
}
function safeIncr(name: string, value: number, labels?: Labels): void {
  if (!observabilityConfig.enabled) return;
  registry.incr(name, value, labels);
}

// ── Domain recorders ────────────────────────────────────────────────────────────

export function recordApi(input: {
  route: string; method: string; status: number; durationMs: number;
  reqBytes?: number; resBytes?: number; error?: boolean; timeout?: boolean; retried?: boolean;
}): void {
  if (!domainEnabled('api')) return;
  const labels: Labels = { route: input.route, method: input.method, status: input.status };
  registry.observe(M.api.duration, input.durationMs, { route: input.route, method: input.method });
  registry.incr(M.api.requests, 1, labels);
  if (typeof input.reqBytes === 'number') registry.observe(M.api.payloadIn, input.reqBytes, { route: input.route });
  if (typeof input.resBytes === 'number') {
    registry.observe(M.api.payloadOut, input.resBytes, { route: input.route });
    registry.top(BOARD.largestPayload, input.resBytes, input.route, { method: input.method, status: input.status });
  }
  if (input.error || input.status >= 500) {
    registry.incr(M.api.errors, 1, { route: input.route, status: input.status });
    registry.top(BOARD.errorApi, 1, input.route, { status: input.status });
  }
  if (input.timeout) registry.incr(M.api.timeouts, 1, { route: input.route });
  if (input.retried) registry.top(BOARD.retryApi, 1, input.route, {});
  if (input.durationMs >= observabilityConfig.slowApiMs) {
    registry.top(BOARD.slowApi, input.durationMs, input.route, { method: input.method, status: input.status });
    if (observabilityConfig.logSlow) {
      logger.warn('observability_slow_api', { route: input.route, method: input.method, status: input.status, duration_ms: Math.round(input.durationMs) });
    }
  }
}

export function recordDb(input: { table: string; op: string; durationMs: number; rows?: number; error?: boolean }): void {
  if (!domainEnabled('db')) return;
  registry.observe(M.db.duration, input.durationMs, { table: input.table, op: input.op });
  registry.incr(M.db.queries, 1, { table: input.table, op: input.op });
  if (typeof input.rows === 'number') registry.observe(M.db.rows, input.rows, { table: input.table, op: input.op });
  if (input.error) registry.incr(M.db.errors, 1, { table: input.table, op: input.op });
  if (input.durationMs >= observabilityConfig.slowDbMs) {
    registry.incr(M.db.slow, 1, { table: input.table, op: input.op });
    registry.top(BOARD.slowDb, input.durationMs, `${input.op} ${input.table}`, { rows: input.rows ?? -1 });
    if (observabilityConfig.logSlow) {
      logger.warn('observability_slow_db', { table: input.table, op: input.op, duration_ms: Math.round(input.durationMs), rows: input.rows });
    }
  }
}

export function recordAi(input: {
  provider: string; model: string; durationMs: number;
  tokensIn?: number; tokensOut?: number; retries?: number; error?: boolean; operation?: string;
}): void {
  if (!domainEnabled('ai')) return;
  const labels: Labels = { provider: input.provider, model: input.model };
  registry.observe(M.ai.duration, input.durationMs, labels);
  registry.incr(M.ai.calls, 1, labels);
  if (typeof input.tokensIn === 'number') registry.incr(M.ai.tokensIn, input.tokensIn, labels);
  if (typeof input.tokensOut === 'number') registry.incr(M.ai.tokensOut, input.tokensOut, labels);
  if (input.retries) registry.incr(M.ai.retries, input.retries, labels);
  if (input.error) registry.incr(M.ai.errors, 1, labels);
  if (input.durationMs >= observabilityConfig.slowAiMs) {
    registry.incr(M.ai.slow, 1, labels);
    registry.top(BOARD.slowAi, input.durationMs, `${input.provider}:${input.model}`, { operation: input.operation ?? '' });
  }
}

export function recordExternal(input: { host: string; durationMs: number; status?: number; error?: boolean; timeout?: boolean }): void {
  if (!domainEnabled('externalApi')) return;
  registry.observe(M.ext.duration, input.durationMs, { host: input.host });
  registry.incr(M.ext.calls, 1, { host: input.host, status: input.status ?? 0 });
  if (input.error) registry.incr(M.ext.errors, 1, { host: input.host });
  if (input.timeout) registry.incr(M.ext.timeouts, 1, { host: input.host });
}

export function recordQueueJob(input: { queue: string; processingMs?: number; waitMs?: number; ok: boolean }): void {
  if (!domainEnabled('queue')) return;
  if (typeof input.processingMs === 'number') {
    registry.observe(M.queue.processing, input.processingMs, { queue: input.queue });
    registry.top(BOARD.expensiveJob, input.processingMs, input.queue, {});
  }
  if (typeof input.waitMs === 'number') registry.observe(M.queue.wait, input.waitMs, { queue: input.queue });
  registry.incr(input.ok ? M.queue.completed : M.queue.failed, 1, { queue: input.queue });
}

export function recordQueueDepth(queue: string, depth: number): void {
  if (!domainEnabled('queue')) return;
  registry.gauge(M.queue.depth, depth, { queue });
}

export function recordScheduler(input: { job: string; durationMs: number; outcome: 'completed' | 'failed' | 'skipped'; delayMs?: number }): void {
  if (!domainEnabled('scheduler')) return;
  registry.observe(M.scheduler.duration, input.durationMs, { job: input.job });
  registry.incr(M.scheduler.runs, 1, { job: input.job, outcome: input.outcome });
  if (input.outcome === 'skipped') registry.incr(M.scheduler.skipped, 1, { job: input.job });
  if (input.outcome === 'failed') registry.incr(M.scheduler.failures, 1, { job: input.job });
  if (typeof input.delayMs === 'number') registry.observe(M.scheduler.delay, input.delayMs, { job: input.job });
}

export function recordWorker(input: { job: string; durationMs: number; ok: boolean; timeout?: boolean }): void {
  if (!domainEnabled('worker')) return;
  registry.observe(M.worker.duration, input.durationMs, { job: input.job });
  registry.incr(M.worker.jobs, 1, { job: input.job });
  if (!input.ok) registry.incr(M.worker.failures, 1, { job: input.job });
  if (input.timeout) registry.incr(M.worker.timeouts, 1, { job: input.job });
}

export function recordCache(input: { cache: string; hit: boolean }): void {
  if (!domainEnabled('cache')) return;
  registry.incr(input.hit ? M.cache.hit : M.cache.miss, 1, { cache: input.cache });
}
export function recordCacheInvalidation(cache: string, count = 1): void {
  if (!domainEnabled('cache')) return;
  registry.incr(M.cache.invalidation, count, { cache });
}

export function recordSystem(input: { rss: number; heapUsed: number; cpuPct: number; loopLagMs: number }): void {
  if (!domainEnabled('system')) return;
  registry.gauge(M.system.rss, input.rss);
  registry.gauge(M.system.heapUsed, input.heapUsed);
  registry.gauge(M.system.cpuPct, input.cpuPct);
  registry.observe(M.system.loopLag, input.loopLagMs);
}

export { safeIncr as recordRawCounter, safeObserve as recordRawHistogram };
export type { Labels };
