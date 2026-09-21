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
import { getInstrumentedStandaloneRedisClient } from '../queue/standaloneRedisClient';

// ── Identity ───────────────────────────────────────────────────────────────────

const INSTANCE_ID = `${hostname()}:${process.pid}`;

// ── Keys ──────────────────────────────────────────────────────────────────────

const REPORT_KEY    = 'omnivyra:cron:report';
const INSTANCE_KEY  = 'omnivyra:cron:instances';
const CYCLE_LOG_KEY = 'omnivyra:cron:cycles:recent';

// TTL must exceed the longest gap between cron cycles or the report/cycle-log
// keys expire between writes and the cron dashboard 503s. Cron writes these on
// each cycle; the longest normal gap is the 4h safety-net base tick
// (BASE_TICK_MS in scheduler/cron.ts). Set to 12h (3× that) so a normally-
// running cron always refreshes before expiry, while a truly dead cron still
// goes stale within half a day. Applied to both omnivyra:cron:report and
// omnivyra:cron:cycles:recent (line 228 / 231).
const REPORT_TTL_S    = 12 * 60 * 60;    // 12 hours (3× the 4h base-tick cadence)
const INSTANCE_TTL_MS = 15 * 60 * 1_000; // 15 minutes — 3× heartbeat window
const HEARTBEAT_MS    = 5 * 60_000;      // write heartbeat every 5 min (was 60s — saves 5,760 ops/day)
const CYCLE_LOG_MAX   = 20;              // keep last 20 cycle records
// 3AH-142: a gracefully-stopped instance ZREMs itself from INSTANCE_KEY so the
// next container does not read a departed predecessor as a live duplicate.
// Bounded well inside the worker's drain budget (drain ≤15 s + three 3 s
// post-drain steps inside a 10 s grace, with a 25 s hard-exit backstop) so it
// can never be the reason a shutdown rides the backstop. Abnormal termination
// never runs it — the entry then ages out via INSTANCE_TTL_MS, so a crash is
// never recorded as a clean exit.
const DEREGISTER_TIMEOUT_MS = 2_000;     // bounded: never eats the worker drain budget

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
  readonly instanceId: string;

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
  /** Set by deregister(): no later heartbeat or in-flight cycle may re-add us. */
  private deregistered = false;

  /**
   * Serializes EVERY mutation of INSTANCE_KEY.
   *
   * The latch alone was not enough. `updateInstanceSet` checked it once,
   * synchronously, and then yielded at `await pipe.exec()` — so a ZADD that had
   * already passed the check could land AFTER deregister()'s ZREM and silently
   * re-register a stopped instance (observed in production: removed=1, then the
   * next worker still saw the entry).
   *
   * Queueing the ZREM behind the same chain gives a real happens-before: work
   * already running finishes first, and the re-checked latch refuses anything
   * queued afterwards. Mirrors the tail-chain in
   * leadIntelligenceOrchestration/orchestrator.ts.
   */
  private registryTail: Promise<unknown> = Promise.resolve();

  /** Run `op` after every registry operation already queued. Never poisons the chain. */
  private queueRegistryOp<T>(op: () => Promise<T>): Promise<T> {
    const run = this.registryTail.then(op, op);
    this.registryTail = run.then(() => undefined, () => undefined);
    return run;
  }

  /**
   * `instanceId` defaults to the process identity. It is injectable only so a
   * test can simulate two schedulers inside one process — every instance
   * otherwise shares `hostname:pid`, which makes duplicate detection (and the
   * regression guard for this fix) impossible to exercise.
   */
  constructor(instanceId: string = INSTANCE_ID) {
    this.instanceId = instanceId;
    try {
      this.redis = getInstrumentedStandaloneRedisClient('cron');
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
    return this.queueRegistryOp(async () => {
    // Re-evaluated when this op actually RUNS — after everything queued before
    // it — so a deregistration that got in first refuses this write outright
    // instead of letting a stale ZADD land behind the ZREM.
    if (!this.redis || this.deregistered) return [];
    const staleTs = now - INSTANCE_TTL_MS;

    // Batch the three write commands into one round-trip, then read separately
    const pipe = this.redis.pipeline();
    pipe.zadd(INSTANCE_KEY, now, this.instanceId);
    pipe.zremrangebyscore(INSTANCE_KEY, '-inf', staleTs);
    pipe.expire(INSTANCE_KEY, Math.ceil(INSTANCE_TTL_MS / 1_000) * 2);
    await pipe.exec();

    const all = await this.redis.zrangebyscore(INSTANCE_KEY, staleTs, '+inf');
    return all.filter(id => id !== this.instanceId);
    });
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

  /**
   * GRACEFUL shutdown only: remove this instance from the duplicate-detection
   * set (`omnivyra:cron:instances`) so the next container does not read a
   * predecessor that has already exited as a live duplicate.
   *
   * MUST be awaited BEFORE shutdown() — shutdown() nulls the Redis handle.
   *
   * Bounded by DEREGISTER_TIMEOUT_MS on an unref'd timer, so it can neither
   * hold the process open past the drain nor extend it. It never throws: on any
   * failure it logs honestly and returns false, and the entry then ages out via
   * INSTANCE_TTL_MS exactly as it did before this method existed.
   *
   * Returns true only when Redis confirmed the command — i.e. this instance is
   * no longer in the set. It never claims success for a timeout, an error, or a
   * missing Redis handle.
   */
  async deregister(): Promise<boolean> {
    this.deregistered = true;
    if (!this.redis) {
      console.warn(
        `[cron] instance ${this.instanceId} not deregistered — no Redis client; entry expires via TTL`,
      );
      return false;
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`timed out after ${DEREGISTER_TIMEOUT_MS}ms`)),
          DEREGISTER_TIMEOUT_MS,
        );
        if (timer.unref) timer.unref();
      });
      // Queued behind the chain: any ZADD already running completes FIRST, so it
      // cannot land after this removal. Still bounded by DEREGISTER_TIMEOUT_MS.
      const removed = await Promise.race([
        this.queueRegistryOp(() => this.redis!.zrem(INSTANCE_KEY, this.instanceId)),
        timeout,
      ]);
      console.info(
        `[cron] instance ${this.instanceId} deregistered (graceful shutdown, removed=${removed})`,
      );
      return true;
    } catch (err) {
      console.warn(
        `[cron] instance ${this.instanceId} deregistration failed — entry expires via TTL:`,
        err instanceof Error ? err.message : String(err),
      );
      return false;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  /** Disconnect the Redis client and stop timers (for graceful shutdown). */
  shutdown(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    if (this.redis) {
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
