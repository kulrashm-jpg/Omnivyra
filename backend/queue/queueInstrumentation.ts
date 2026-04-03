/**
 * BullMQ queue instrumentation.
 *
 * Tracks per-queue metrics by:
 *   - Patching queue.add() / queue.addBulk() for enqueue counts
 *   - Attaching Worker event listeners for completion/failure/duration
 *
 * Redis ops estimation uses the BullMQ Lua script model:
 *   Every job lifecycle = add + moveToActive + moveToCompleted/Failed
 *   Each phase is one Lua script executing multiple Redis commands atomically.
 *
 *   Phase breakdown (based on BullMQ v5 source):
 *     add            ~6 ops  LPUSH/ZADD + HSET + SADD + PUBLISH + counters
 *     moveToActive   ~8 ops  LMOVE + HSET + ZADD + rate-limiter + PUBLISH
 *     moveToComplete ~6 ops  LREM + DEL/ZADD + HSET + PUBLISH + counters
 *     moveToFailed   ~6 ops  LREM + ZADD + HSET + PUBLISH + counters
 *     retry (ZADD)   ~4 ops  ZADD delayed + HSET + PUBLISH + counter
 *
 *   Successful job:  add + active + complete = 20 ops
 *   Failed job:      add + active + fail     = 20 ops
 *   Per retry:       +4 ops above base
 *   Stall check:     +2 ops (periodic, amortised)
 *
 * The report is written to Redis every 60 s so the super-admin API can
 * aggregate it from a separate Next.js process.
 *
 * Redis keys:
 *   omnivyra:queue:report    — JSON report blob (TTL 5 min)
 *   omnivyra:queue:durations:{queueName}  — list of recent durations (LTRIM 200)
 */

import type { Queue, Worker, Job } from 'bullmq';
import IORedis from 'ioredis';

// ── Redis ops model ────────────────────────────────────────────────────────────

/**
 * Estimated Redis commands executed per job phase (BullMQ v5 Lua scripts).
 * These are internal Redis ops, not application-level HSET/GET calls.
 */
const OPS = {
  add:      6,
  active:   8,
  complete: 6,
  fail:     6,
  retry:    4,
  stall:    2,   // amortised — stall check runs ~every 30s
} as const;

/** Base ops for a full job lifecycle (add → active → complete or fail). */
const OPS_PER_JOB_BASE = OPS.add + OPS.active + OPS.complete;   // 20

/**
 * Per-queue ops multiplier based on retry configuration.
 * Higher retry counts → more ops on failure paths.
 */
const QUEUE_RETRY_CONFIG: Record<string, { attempts: number; failRate: number }> = {
  'publish':            { attempts: 1, failRate: 0.02 },
  'posting':            { attempts: 3, failRate: 0.05 },
  'ai-heavy':           { attempts: 2, failRate: 0.10 },
  'engagement-polling': { attempts: 1, failRate: 0.03 },
};

function estimateOpsPerJob(queueName: string): number {
  const cfg = QUEUE_RETRY_CONFIG[queueName] ?? { attempts: 1, failRate: 0.05 };
  const avgRetries = cfg.failRate * Math.max(0, cfg.attempts - 1);
  return Math.round(OPS_PER_JOB_BASE + avgRetries * OPS.retry + OPS.stall);
}

// ── Types ──────────────────────────────────────────────────────────────────────

export interface QueueStats {
  queueName:            string;
  jobsAdded:            number;
  jobsCompleted:        number;
  jobsFailed:           number;
  jobsProcessed:        number;   // completed + failed
  addedPerMin:          number;
  processedPerMin:      number;
  avgJobDurationMs:     number | null;
  p95JobDurationMs:     number | null;
  errorRate:            number;   // 0–1
  estimatedOpsPerJob:   number;
  estimatedOpsPerMin:   number;
  estimatedOpsTotal:    number;
}

export interface QueueReport {
  generatedAt:              string;
  queues:                   Record<string, QueueStats>;
  topQueuesByRedisOps:      Array<{ queueName: string; opsPerMin: number; opsPct: number }>;
  totalJobsAddedPerMin:     number;
  totalJobsProcessedPerMin: number;
  totalRedisOpsPerMin:      number;
  totalRedisOpsTotal:       number;
  /** Fraction of total Redis ops attributed to BullMQ (0–1). null if Redis total unavailable. */
  bullmqOpsFraction:        number | null;
}

// ── In-process state ───────────────────────────────────────────────────────────

interface PerQueueState {
  added:          number;
  completed:      number;
  failed:         number;
  addTimeline:    number[];    // timestamps of add events (rolling 60s)
  procTimeline:   number[];    // timestamps of processed events (rolling 60s)
  durations:      number[];    // rolling 200-sample window of job durations (ms)
}

const queueMap = new Map<string, PerQueueState>();
const OPS_WINDOW = 60_000;

function getState(name: string): PerQueueState {
  let s = queueMap.get(name);
  if (!s) {
    s = { added: 0, completed: 0, failed: 0, addTimeline: [], procTimeline: [], durations: [] };
    queueMap.set(name, s);
  }
  return s;
}

function tickTimeline(arr: number[]): void {
  const now    = Date.now();
  const cutoff = now - OPS_WINDOW;
  arr.push(now);
  let i = 0;
  while (i < arr.length && arr[i] < cutoff) i++;
  if (i > 0) arr.splice(0, i);
}

function pushDuration(arr: number[], ms: number): void {
  arr.push(ms);
  if (arr.length > 200) arr.shift();
}

// ── Recorders ──────────────────────────────────────────────────────────────────

export function recordAdd(queueName: string, count = 1): void {
  const s = getState(queueName);
  s.added += count;
  for (let i = 0; i < count; i++) tickTimeline(s.addTimeline);
}

export function recordProcessed(
  queueName: string,
  durationMs: number,
  failed: boolean,
): void {
  const s = getState(queueName);
  if (failed) s.failed++;
  else        s.completed++;
  tickTimeline(s.procTimeline);
  if (durationMs >= 0) pushDuration(s.durations, durationMs);
}

// ── Queue / Worker patching ───────────────────────────────────────────────────

/**
 * Patch a Queue instance to track job additions.
 * Call once per Queue instance, immediately after creation.
 */
export function instrumentQueue(queue: Queue): void {
  const name = queue.name;

  // Ensure state entry exists (makes the queue appear in reports even before any jobs)
  getState(name);

  // Patch add()
  const origAdd = queue.add.bind(queue);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (queue as any).add = async (...args: Parameters<typeof queue.add>) => {
    recordAdd(name, 1);
    return origAdd(...args);
  };

  // Patch addBulk()
  const origBulk = queue.addBulk.bind(queue);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (queue as any).addBulk = async (jobs: Parameters<typeof queue.addBulk>[0]) => {
    recordAdd(name, jobs.length);
    return origBulk(jobs);
  };
}

/**
 * Attach event listeners to a Worker instance to track job outcomes.
 * Call once per Worker instance, immediately after creation.
 */
export function instrumentWorker(worker: Worker): void {
  const name = worker.name;
  getState(name);

  worker.on('completed', (job: Job) => {
    if (!job) return;
    const duration = (job.finishedOn ?? Date.now()) - (job.processedOn ?? job.timestamp);
    recordProcessed(name, Math.max(0, duration), false);
  });

  worker.on('failed', (job: Job | undefined) => {
    if (!job) return;
    // Only record on final failure (no more attempts)
    const isLastAttempt = (job.attemptsMade ?? 0) >= (job.opts?.attempts ?? 1);
    if (!isLastAttempt) return;
    const duration = job.finishedOn && job.processedOn
      ? job.finishedOn - job.processedOn
      : 0;
    recordProcessed(name, Math.max(0, duration), true);
  });
}

// ── Snapshot ───────────────────────────────────────────────────────────────────

function percentile(sorted: number[], p: number): number | null {
  if (sorted.length === 0) return null;
  return sorted[Math.max(0, Math.ceil(sorted.length * p) - 1)];
}

function buildQueueStats(name: string, s: PerQueueState): QueueStats {
  const now    = Date.now();
  const cutoff = now - OPS_WINDOW;

  const addedPerMin     = s.addTimeline.filter(t => t >= cutoff).length;
  const processedPerMin = s.procTimeline.filter(t => t >= cutoff).length;
  const processed       = s.completed + s.failed;
  const errorRate       = processed === 0 ? 0 : s.failed / processed;

  const sorted = [...s.durations].sort((a, b) => a - b);
  const avg    = sorted.length === 0 ? null
    : Math.round(sorted.reduce((a, b) => a + b, 0) / sorted.length);
  const p95    = percentile(sorted, 0.95);

  const opsPerJob  = estimateOpsPerJob(name);
  const opsPerMin  = processedPerMin * opsPerJob + addedPerMin * OPS.add;
  const opsTotal   = processed * opsPerJob + s.added * OPS.add;

  return {
    queueName:           name,
    jobsAdded:           s.added,
    jobsCompleted:       s.completed,
    jobsFailed:          s.failed,
    jobsProcessed:       processed,
    addedPerMin,
    processedPerMin,
    avgJobDurationMs:    avg,
    p95JobDurationMs:    p95 !== null ? Math.round(p95) : null,
    errorRate,
    estimatedOpsPerJob:  opsPerJob,
    estimatedOpsPerMin:  opsPerMin,
    estimatedOpsTotal:   opsTotal,
  };
}

export function buildQueueReport(redisOpsPerMin?: number): QueueReport {
  const queues: Record<string, QueueStats> = {};
  let totalAddedPerMin = 0;
  let totalProcPerMin  = 0;
  let totalOpsPerMin   = 0;
  let totalOpsTotal    = 0;

  for (const [name, state] of queueMap) {
    const stats = buildQueueStats(name, state);
    queues[name]      = stats;
    totalAddedPerMin += stats.addedPerMin;
    totalProcPerMin  += stats.processedPerMin;
    totalOpsPerMin   += stats.estimatedOpsPerMin;
    totalOpsTotal    += stats.estimatedOpsTotal;
  }

  const topQueuesByRedisOps = Object.values(queues)
    .sort((a, b) => b.estimatedOpsPerMin - a.estimatedOpsPerMin)
    .map(q => ({
      queueName: q.queueName,
      opsPerMin: q.estimatedOpsPerMin,
      opsPct:    totalOpsPerMin === 0 ? 0
        : Math.round((q.estimatedOpsPerMin / totalOpsPerMin) * 100),
    }));

  const bullmqOpsFraction = redisOpsPerMin && redisOpsPerMin > 0
    ? Math.min(1, totalOpsPerMin / redisOpsPerMin)
    : null;

  return {
    generatedAt:              new Date().toISOString(),
    queues,
    topQueuesByRedisOps,
    totalJobsAddedPerMin:     totalAddedPerMin,
    totalJobsProcessedPerMin: totalProcPerMin,
    totalRedisOpsPerMin:      totalOpsPerMin,
    totalRedisOpsTotal:       totalOpsTotal,
    bullmqOpsFraction,
  };
}

// ── Redis persistence ──────────────────────────────────────────────────────────

const REPORT_KEY = 'omnivyra:queue:report';
const REPORT_TTL = 5 * 60;   // 5 minutes

/** Persist report to Redis. Called periodically by the flush timer. */
export async function persistQueueReport(redis: IORedis, redisOpsPerMin?: number): Promise<void> {
  try {
    const report = buildQueueReport(redisOpsPerMin);
    await redis.set(REPORT_KEY, JSON.stringify(report), 'EX', REPORT_TTL);
  } catch { /* swallow — never block callers */ }
}

/** Read latest report from Redis (for API route in separate process). */
export async function getQueueReportFromRedis(redis: IORedis): Promise<QueueReport | null> {
  try {
    const raw = await redis.get(REPORT_KEY);
    return raw ? (JSON.parse(raw) as QueueReport) : null;
  } catch {
    return null;
  }
}

// ── Flush timer ───────────────────────────────────────────────────────────────

let _flushTimer: ReturnType<typeof setInterval> | null = null;

/**
 * Start the 60-second report flush timer.
 * Call once from bullmqClient.ts after Redis is ready.
 */
export function startQueueReportFlush(
  getRedis: () => IORedis,
  getRedisOpsPerMin?: () => number,
): void {
  if (_flushTimer) return;

  _flushTimer = setInterval(() => {
    void persistQueueReport(getRedis(), getRedisOpsPerMin?.());
  }, 600_000); // 10 min — was 60s

  if (_flushTimer.unref) _flushTimer.unref();
}
