/**
 * Cron execution instrumentation.
 *
 * Tracks per-cycle and per-worker metrics for the cron scheduler process.
 * Persists a live report to Redis so the super-admin API can read it from a
 * separate Next.js process without shared memory.
 *
 * Architecture:
 *   - Cron process: CronInstrumentation (this module) → Redis
 *   - API route   : reads omnivyra:cron:report from Redis
 *
 * Detections:
 *   1. Cycles/min — rolling 60-second window
 *   2. Useful vs wasted cycles — useful when ≥1 interval-gated job fired
 *   3. Duplicate instances — Redis sorted-set heartbeat; >1 active entry = dup
 *
 * Redis keys:
 *   omnivyra:cron:report            JSON report (TTL 5 min, refreshed every cycle)
 *   omnivyra:cron:instances         Sorted set — score=ts, member=instance_id
 *   omnivyra:cron:cycles:recent     List of last 20 cycle JSON records
 */

import { hostname } from 'os';
import IORedis        from 'ioredis';
import { config } from '@/config';
import { createInstrumentedClient } from '../../lib/redis/instrumentation';

// ── Identity ───────────────────────────────────────────────────────────────────

const INSTANCE_ID = `${hostname()}:${process.pid}`;

// ── Keys ──────────────────────────────────────────────────────────────────────

const REPORT_KEY    = 'omnivyra:cron:report';
const INSTANCE_KEY  = 'omnivyra:cron:instances';
const CYCLE_LOG_KEY = 'omnivyra:cron:cycles:recent';

const REPORT_TTL_S    = 5 * 60;          // 5 minutes — stale if cron dies
const INSTANCE_TTL_MS = 15 * 60 * 1_000; // 15 minutes — 3× heartbeat window
const HEARTBEAT_MS    = 5 * 60_000;      // write heartbeat every 5 min (was 60s — saves 5,760 ops/day)
const CYCLE_LOG_MAX   = 20;              // keep last 20 cycle records

// ── Types ──────────────────────────────────────────────────────────────────────

export interface CycleRecord {
  cycleId:       string;
  instanceId:    string;
  timestamp:     string;
  jobsTriggered: number;
  jobNames:      string[];
  usefulCycle:   boolean;
  durationMs:    number;
}

export interface WorkerStats {
  executions: number;
  lastRunAt:  string | null;
  errors:     number;
}

export interface CronReport {
  instanceId:         string;
  generatedAt:        string;
  uptimeMs:           number;
  cyclesPerMin:       number;
  totalCycles:        number;
  usefulCycles:       number;
  wastedCycles:       number;
  usefulPct:          number;
  wastedPct:          number;
  totalJobsTriggered: number;
  avgJobsPerCycle:    number;
  duplicateInstances: string[];
  recentCycles:       CycleRecord[];
  workers:            Record<string, WorkerStats>;
}

// ── CronInstrumentation ───────────────────────────────────────────────────────

export class CronInstrumentation {
  readonly instanceId = INSTANCE_ID;

  // ── In-process state ───────────────────────────────────────────────────────

  private startedAt      = Date.now();
  private totalCycles    = 0;
  private usefulCycles   = 0;
  private totalJobs      = 0;
  private cycleTimeline: number[] = [];   // start-ts for each cycle in last 60s
  private recentCycles:  CycleRecord[] = [];
  private workers: Record<string, WorkerStats> = {};

  // Active cycle state
  private cycleStart_  = 0;
  private currentCycleId = '';

  // ── Redis (optional — fails silently) ─────────────────────────────────────

  private redis: IORedis | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    const url = config.REDIS_URL;
    try {
      const raw = new IORedis(url, {
        enableReadyCheck:     false,
        maxRetriesPerRequest: 1,
        retryStrategy:        () => null,
        lazyConnect:          true,
      });
      raw.on('error', () => {});
      raw.connect().catch(() => {});
      this.redis = createInstrumentedClient(raw, 'cron') as IORedis;
    } catch {
      this.redis = null;
    }
    this.startHeartbeat();
  }

  // ── Cycle lifecycle ────────────────────────────────────────────────────────

  /** Call at the very start of runSchedulerCycle(). */
  cycleStart(): void {
    this.cycleStart_     = Date.now();
    this.currentCycleId  = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

    // Rolling 60s window
    this.cycleTimeline.push(this.cycleStart_);
    const cutoff = this.cycleStart_ - 60_000;
    let i = 0;
    while (i < this.cycleTimeline.length && this.cycleTimeline[i] < cutoff) i++;
    if (i > 0) this.cycleTimeline.splice(0, i);
  }

  /**
   * Call at the end of runSchedulerCycle() with the names of jobs that fired.
   * "Fired" means the job's interval condition was met and its body ran.
   */
  cycleEnd(triggeredJobNames: string[]): CycleRecord {
    const durationMs = Date.now() - this.cycleStart_;
    const useful     = triggeredJobNames.length > 0;

    this.totalCycles++;
    if (useful) this.usefulCycles++;
    this.totalJobs += triggeredJobNames.length;

    const record: CycleRecord = {
      cycleId:       this.currentCycleId,
      instanceId:    this.instanceId,
      timestamp:     new Date().toISOString(),
      jobsTriggered: triggeredJobNames.length,
      jobNames:      triggeredJobNames,
      usefulCycle:   useful,
      durationMs,
    };

    // Keep last 20 in memory
    this.recentCycles.unshift(record);
    if (this.recentCycles.length > CYCLE_LOG_MAX) this.recentCycles.pop();

    // Structured log
    console.log(
      `[cron] instance=${this.instanceId} cycle=${this.currentCycleId}` +
      ` jobs=${triggeredJobNames.length} useful=${useful}` +
      ` duration=${durationMs}ms` +
      (triggeredJobNames.length > 0 ? ` fired=[${triggeredJobNames.join(',')}]` : ''),
    );

    // Warn on wasted cycle (likely misconfiguration or idle system)
    if (!useful && this.totalCycles > 1) {
      console.warn(`[cron] wasted cycle — no interval-gated jobs fired (cycle ${this.currentCycleId})`);
    }

    // Persist to Redis asynchronously
    void this.persistAsync(record);

    return record;
  }

  // ── Worker tracking ────────────────────────────────────────────────────────

  /** Call inside scheduleWorker tick on every execution. */
  workerExecuted(label: string, hadError = false): void {
    if (!this.workers[label]) {
      this.workers[label] = { executions: 0, lastRunAt: null, errors: 0 };
    }
    this.workers[label].executions++;
    this.workers[label].lastRunAt = new Date().toISOString();
    if (hadError) this.workers[label].errors++;
  }

  // ── Report ─────────────────────────────────────────────────────────────────

  /**
   * Build and return the current in-process report.
   * For the API route (separate process) use getReportFromRedis() instead.
   */
  buildReport(duplicateInstances: string[] = []): CronReport {
    const now         = Date.now();
    const uptimeMs    = now - this.startedAt;
    const cyclesPerMin = this.cycleTimeline.length; // events in last 60s = per-min rate
    const wastedCycles = this.totalCycles - this.usefulCycles;
    const usefulPct    = this.totalCycles === 0 ? 0
      : Math.round((this.usefulCycles / this.totalCycles) * 100);
    const wastedPct    = 100 - usefulPct;
    const avgJobsPerCycle = this.totalCycles === 0 ? 0
      : Math.round((this.totalJobs / this.totalCycles) * 10) / 10;

    return {
      instanceId:         this.instanceId,
      generatedAt:        new Date().toISOString(),
      uptimeMs,
      cyclesPerMin,
      totalCycles:        this.totalCycles,
      usefulCycles:       this.usefulCycles,
      wastedCycles,
      usefulPct,
      wastedPct,
      totalJobsTriggered: this.totalJobs,
      avgJobsPerCycle,
      duplicateInstances,
      recentCycles:       this.recentCycles,
      workers:            { ...this.workers },
    };
  }

  // ── Redis helpers ──────────────────────────────────────────────────────────

  /** Write heartbeat + report to Redis. Errors are swallowed. */
  private async persistAsync(record: CycleRecord): Promise<void> {
    if (!this.redis) return;
    try {
      const now       = Date.now();
      const dupeIds   = await this.updateInstanceSet(now);
      const report    = this.buildReport(dupeIds);

      const pipe = this.redis.pipeline();
      pipe.set(REPORT_KEY, JSON.stringify(report), 'EX', REPORT_TTL_S);
      pipe.lpush(CYCLE_LOG_KEY, JSON.stringify(record));
      pipe.ltrim(CYCLE_LOG_KEY, 0, CYCLE_LOG_MAX - 1);
      pipe.expire(CYCLE_LOG_KEY, REPORT_TTL_S);
      await pipe.exec();

      if (dupeIds.length > 0) {
        console.warn(
          `[cron] ⚠️  DUPLICATE INSTANCES DETECTED: ${dupeIds.join(', ')} ` +
          `(this instance: ${this.instanceId})`,
        );
      }
    } catch {
      // Redis unavailable — in-process state still accurate
    }
  }

  /**
   * Write own heartbeat to sorted set; prune stale entries; return other active instances.
   */
  private async updateInstanceSet(now: number): Promise<string[]> {
    if (!this.redis) return [];
    const staleTs = now - INSTANCE_TTL_MS;

    // Batch the three write commands into one round-trip, then read separately
    const pipe = this.redis.pipeline();
    pipe.zadd(INSTANCE_KEY, now, this.instanceId);
    pipe.zremrangebyscore(INSTANCE_KEY, '-inf', staleTs);
    pipe.expire(INSTANCE_KEY, Math.ceil(INSTANCE_TTL_MS / 1_000) * 2);
    await pipe.exec();

    const all = await this.redis.zrangebyscore(INSTANCE_KEY, staleTs, '+inf');
    return all.filter(id => id !== this.instanceId);
  }

  private startHeartbeat(): void {
    if (this.heartbeatTimer) return;
    this.heartbeatTimer = setInterval(async () => {
      if (!this.redis) return;
      try {
        await this.updateInstanceSet(Date.now());
      } catch { /* ignore */ }
    }, HEARTBEAT_MS);
    if (this.heartbeatTimer.unref) this.heartbeatTimer.unref();
  }

  /** Disconnect the Redis client and stop timers (for graceful shutdown). */
  shutdown(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    if (this.redis) {
      this.redis.quit().catch(() => {});
      this.redis = null;
    }
  }
}

// ── Singleton (used by cron.ts) ────────────────────────────────────────────────

export const cronInstr = new CronInstrumentation();

// ── Static reader (used by API route in Next.js process) ──────────────────────

/**
 * Read the latest persisted report from Redis.
 * Call this from the API route — it runs in a different process from the cron.
 *
 * Returns null when no report is present (cron not started, or Redis down).
 */
export async function getReportFromRedis(redis: IORedis): Promise<CronReport | null> {
  try {
    const raw = await redis.get(REPORT_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as CronReport;
  } catch {
    return null;
  }
}

/**
 * Read recent cycle records from the Redis list (most recent first).
 */
export async function getRecentCyclesFromRedis(redis: IORedis): Promise<CycleRecord[]> {
  try {
    const raw = await redis.lrange(CYCLE_LOG_KEY, 0, CYCLE_LOG_MAX - 1);
    return raw.map(r => JSON.parse(r) as CycleRecord);
  } catch {
    return [];
  }
}
