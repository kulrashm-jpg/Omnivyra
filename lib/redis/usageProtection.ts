/**
 * Redis usage protection — three-tier graceful degradation.
 *
 * Monitors two independent usage axes every 60 s and uses the higher of the
 * two to set the protection level:
 *
 *   Memory axis  — used_memory / maxmemory  (from INFO memory)
 *   Requests axis — daily commands processed / configured limit
 *                   (from INFO stats total_commands_processed)
 *
 * Protection levels (driven by max of the two axes):
 *   normal   (< 70%)   full operation
 *   warning  (70–85%)  structured WARN log + admin alert key written to Redis
 *   throttle (85–95%)  queue fan-out capped to 50%, cron intervals doubled
 *   critical (≥ 95%)   non-essential queues blocked → overflow buffer;
 *                       non-essential cron jobs skipped entirely
 *
 * Overflow buffer (task 2 — no silent job loss):
 *   Blocked queue jobs are held in a per-queue in-memory ring buffer
 *   (capped at REDIS_OVERFLOW_CAP_PER_QUEUE, default 200).
 *   When the level recovers to normal, registered drain callbacks flush the
 *   buffer back into the real queues via their original addBulk path.
 *
 * Recovery (task 3):
 *   On any level→normal transition, the module:
 *     1. Logs a structured "system_recovered" INFO event.
 *     2. Writes a recovery admin alert key (6 h TTL).
 *     3. Fires all registered drain callbacks.
 *     4. Resets all per-elevation impact counters.
 *
 * Impact reporting (task 4):
 *   getUsageStatus().impact exposes:
 *     blockedQueues, fanOutReductionPct, totalJobsBlocked,
 *     totalJobsOverflowed, overflowByQueue,
 *     totalCronSkipped, skippedCronJobs, longDeferredCronJobs
 *
 * Anti-starvation (task 5):
 *   - Under throttle, the 2× interval multiplier is derived from the live
 *     level and resets immediately when the level drops — no accumulation.
 *   - Under critical, non-essential jobs are blocked.  Jobs deferred for
 *     more than CRITICAL_STARVATION_WARN_MS (default 4 h) are surfaced in
 *     impact.longDeferredCronJobs so an operator can investigate.
 *   - Recovery callbacks are idempotent; overflow is drained exactly once.
 *
 * Env vars:
 *   REDIS_MAX_BYTES                — fallback maxmemory (bytes); default 256 MB
 *   UPSTASH_DAILY_REQUEST_LIMIT    — daily command cap; default 10 000 (free tier)
 *   REDIS_OVERFLOW_CAP_PER_QUEUE   — max buffered jobs per queue; default 200
 */

import IORedis from 'ioredis';
import * as fs from 'fs';
import * as path from 'path';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export type UsageLevel = 'normal' | 'warning' | 'throttle' | 'critical';

export interface MemoryUsage {
  usedBytes: number;
  maxBytes:  number;
  usagePct:  number;  // 0–100
}

export interface RequestUsage {
  dailyUsed:  number;
  dailyLimit: number;
  usagePct:   number;  // 0–100
  resetAt:    string;  // ISO — next UTC midnight
}

export interface ProtectionImpact {
  /** Queues currently gated out (empty when level < critical). */
  blockedQueues:       string[];
  /** % reduction applied to bulk job fan-out (0 | 50 | 100). */
  fanOutReductionPct:  number;
  /** Jobs sent to the overflow buffer since level was last elevated. */
  totalJobsBlocked:    number;
  /** Jobs dropped because the overflow buffer was full (truly lost — not recoverable). */
  totalJobsDropped:    number;
  /** Jobs currently sitting in the overflow buffer (not yet drained). */
  totalJobsOverflowed: number;
  /** Per-queue overflow buffer depth. */
  overflowByQueue:     Record<string, number>;
  /** Cron job runs skipped since level was last elevated. */
  totalCronSkipped:    number;
  /** Distinct cron job keys skipped during the current elevated period. */
  skippedCronJobs:     string[];
  /**
   * Cron job keys blocked under critical for longer than
   * CRITICAL_STARVATION_WARN_MS without a recovery — need operator attention.
   */
  longDeferredCronJobs: string[];
}

export interface AdvisoryCounters {
  /** DB SELECT calls recorded today (advisory only). */
  dbReadsToday:   number;
  /** DB write calls (INSERT/UPSERT/UPDATE/DELETE) recorded today (advisory only). */
  dbWritesToday:  number;
  /** LLM tokens consumed today (advisory only). */
  llmTokensToday: number;
  /** Configured daily read limit — 0 means unlimited / not configured. */
  dbMaxReads:     number;
  /** Configured daily write limit — 0 means unlimited / not configured. */
  dbMaxWrites:    number;
  /** Configured daily LLM token limit — 0 means unlimited / not configured. */
  llmMaxTokens:   number;
}

export interface RedisUsageStatus {
  level:        UsageLevel;
  /** True once at least one poll has completed — false means level='normal' is the uninitialised default, not a real reading. */
  initialized:  boolean;
  /** Memory pressure axis. */
  memory:       MemoryUsage;
  /** Request-rate pressure axis. */
  requests:     RequestUsage;
  /** Max of memory.usagePct and requests.usagePct — drives the level. */
  effectivePct: number;
  checkedAt:    string;
  impact:       ProtectionImpact;
  /** Advisory counters for DB and LLM operations (never affect protection level). */
  advisory:     AdvisoryCounters;
}

/** A single job entry held in the overflow buffer. */
export interface OverflowEntry {
  name: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  data: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  opts?: any;
}

type DrainCallback = (queueName: string, jobs: OverflowEntry[]) => Promise<void>;

// ─────────────────────────────────────────────────────────────────────────────
// Constants / thresholds
// ─────────────────────────────────────────────────────────────────────────────

const WARN_PCT     = 0.70;
const THROTTLE_PCT = 0.85;
const CRITICAL_PCT = 0.95;

/** Alert written to Redis at most once per this window (prevents write storms). */
const NOTIFY_COOLDOWN_MS = 5 * 60_000;

/** Jobs blocked under critical for this long appear in longDeferredCronJobs. */
const CRITICAL_STARVATION_WARN_MS = 4 * 60 * 60_000;  // 4 hours

// ─────────────────────────────────────────────────────────────────────────────
// Non-essential classification
// ─────────────────────────────────────────────────────────────────────────────

/** Always allowed regardless of usage level. */
const CRITICAL_QUEUES = new Set(['posting', 'publish']);

/**
 * Cron job keys that are skipped at critical and slowed at throttle.
 * Keys must match those passed to shouldRunCronJob() in cron.ts.
 */
const NON_ESSENTIAL_CRON_JOBS = new Set([
  'signalClustering',
  'signalIntelligence',
  'strategicTheme',
  'campaignOpportunity',
  'contentOpportunity',
  'narrativeEngine',
  'communityPost',
  'threadEngine',
  'engagementCapture',
  'feedbackIntelligence',
  'companyTrendRelevance',
  'performanceIngestion',
  'performanceAggregation',
  'campaignHealthEvaluation',
  'dailyIntelligence',
  'intelligenceEventCleanup',
  'engagementDigest',
  'engagementSignalScheduler',
  'engagementSignalArchive',
  'engagementOpportunityScanner',
  'opportunitySlots',
  'governanceAudit',
  'autoOptimization',
  'replyIntelligenceAggregation',
  'responsePerformanceEval',
  'responseStrategyLearning',
  'opportunityLearning',
  'influencerLearning',
  'insightLearning',
  'buyerIntentLearning',
  'confidenceCalibration',
  'engagementPolling',
  'intelligencePolling',
]);

// ─────────────────────────────────────────────────────────────────────────────
// In-memory state
// ─────────────────────────────────────────────────────────────────────────────

let _memory: MemoryUsage = { usedBytes: 0, maxBytes: 0, usagePct: 0 };
let _requests: RequestUsage = {
  dailyUsed: 0, dailyLimit: 0, usagePct: 0,
  resetAt: new Date(0).toISOString(),
};
let _effectivePct = 0;
let _level:        UsageLevel = 'normal';
let _prevLevel:    UsageLevel = 'normal';
let _checkedAt     = new Date(0).toISOString();
let _notifiedAt    = 0;
// BUG#3 fix: track whether the engine has ever completed a poll. Consumers can
// check getUsageStatus().initialized before trusting the level.
let _initialized   = false;

// Per-elevation impact counters (reset when level returns to normal)
let _totalJobsBlocked   = 0;
let _totalJobsDropped   = 0;  // BUG#14 fix: separate dropped (buffer full = truly lost) from buffered
let _totalCronSkipped   = 0;
const _skippedCronJobs  = new Set<string>();

// Per-critical-job deferral start times (for starvation detection)
const _criticalDeferStart = new Map<string, number>();

// Dynamic limit overrides (loaded from omnivyra:admin:config:infra_limits each poll)
// 0 = not set — fall back to env-var / code default.
let _adminDailyLimit   = 0;   // overrides UPSTASH_DAILY_REQUEST_LIMIT
let _adminMaxMemBytes  = 0;   // overrides REDIS_MAX_BYTES

// BUG#7/#8 fix: Advisory DB + LLM counters (in-memory, reset daily).
// These are advisory only — they NEVER block operations, but emit stderr
// warnings when admin-configured daily limits are crossed.
let _dbReadsToday      = 0;
let _dbWritesToday     = 0;
let _llmTokensToday    = 0;
let _advisoryDate      = '';   // UTC date when advisory counters were last reset
let _adminDbMaxReads   = 0;   // 0 = unlimited (from infra limits)
let _adminDbMaxWrites  = 0;   // 0 = unlimited (from infra limits)
let _adminLlmMaxTokens = 0;   // 0 = unlimited (from infra limits)
let _dbAdvisoryWarnedAt  = 0; // rate-limit advisory warnings (avoid stderr flood)
let _llmAdvisoryWarnedAt = 0;

// Daily request baseline — persisted to Redis (key: omnivyra:usage:baseline:YYYY-MM-DD)
// so process restarts/hot-reloads never reset the daily count.
// The in-memory copy is updated after each successful poll.
let _reqBaseline = { date: '', total: 0 };

/**
 * Load (or initialise) the daily baseline from Redis.
 * Uses SET … NX so only the very first process to poll today sets the value;
 * all later pollers (any process, any restart) read the same stored number.
 * Returns the baseline total to subtract from today's totalCommandsProcessed.
 */
async function loadDailyBaseline(redis: IORedis, totalNow: number): Promise<number> {
  const today       = todayUtc();
  const key         = `omnivyra:usage:baseline:${today}`;
  const ttl         = 49 * 3600;   // expires safely after midnight UTC

  // If our in-memory copy is still for today, trust it (saves a round-trip)
  if (_reqBaseline.date === today) return _reqBaseline.total;

  try {
    // Try to set baseline only if key does not exist for today
    const setOk = await redis.set(key, totalNow.toString(), 'EX', ttl, 'NX');
    if (setOk === 'OK') {
      // This process is first today — baseline = current total
      _reqBaseline = { date: today, total: totalNow };
      return totalNow;
    }
    // Another process already set the baseline — read it
    const stored = await redis.get(key);
    const base   = stored !== null ? parseInt(stored, 10) : totalNow;
    _reqBaseline  = { date: today, total: base };
    return base;
  } catch {
    // Redis unavailable — fall back to in-memory (may undercount after restart)
    if (_reqBaseline.date !== today) _reqBaseline = { date: today, total: totalNow };
    return _reqBaseline.total;
  }
}

// Overflow buffer
const OVERFLOW_CAP = parseInt(process.env.REDIS_OVERFLOW_CAP_PER_QUEUE ?? '200', 10);
const _overflow    = new Map<string, OverflowEntry[]>();
const _drainCbs    = new Map<string, DrainCallback>();

let _pollTimer: ReturnType<typeof setInterval> | null = null;

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function resolveMaxBytes(infoMax: number): number {
  if (infoMax > 0) return infoMax;
  if (_adminMaxMemBytes > 0) return _adminMaxMemBytes;
  const envMax = parseInt(process.env.REDIS_MAX_BYTES ?? '0', 10);
  if (envMax > 0) return envMax;
  return 256 * 1024 * 1024;  // 256 MB — Upstash free-tier ceiling
}

function parseInfo(info: string): {
  usedBytes:              number;
  maxBytes:               number;
  totalCommandsProcessed: number;
} {
  const usedMatch  = info.match(/^used_memory:(\d+)/m);
  const maxMatch   = info.match(/^maxmemory:(\d+)/m);
  const cmdsMatch  = info.match(/^total_commands_processed:(\d+)/m);
  return {
    usedBytes:              usedMatch  ? parseInt(usedMatch[1],  10) : 0,
    maxBytes:               resolveMaxBytes(maxMatch ? parseInt(maxMatch[1], 10) : 0),
    totalCommandsProcessed: cmdsMatch  ? parseInt(cmdsMatch[1], 10) : 0,
  };
}

function classify(pct: number): UsageLevel {
  if (pct >= CRITICAL_PCT) return 'critical';
  if (pct >= THROTTLE_PCT) return 'throttle';
  if (pct >= WARN_PCT)     return 'warning';
  return 'normal';
}

function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);  // 'YYYY-MM-DD'
}

function nextUtcMidnight(): string {
  const d = new Date(todayUtc());
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString();
}

async function computeRequestUsage(redis: IORedis, totalCommandsProcessed: number): Promise<RequestUsage> {
  const baseline   = await loadDailyBaseline(redis, totalCommandsProcessed);
  // Default is 25,000 — a conservative limit between the free tier (10k) and paid entry tier.
  // ALWAYS set UPSTASH_DAILY_REQUEST_LIMIT explicitly in your .env — do not rely on this default.
  const dailyLimit = _adminDailyLimit > 0
    ? _adminDailyLimit
    : parseInt(process.env.UPSTASH_DAILY_REQUEST_LIMIT ?? '25000', 10);
  const dailyUsed  = Math.max(0, totalCommandsProcessed - baseline);
  return {
    dailyUsed,
    dailyLimit,
    usagePct: dailyLimit > 0 ? Math.round((dailyUsed / dailyLimit) * 10_000) / 100 : 0,
    resetAt:  nextUtcMidnight(),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Overflow buffer
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Store a blocked job in the per-queue overflow buffer.
 * Returns true if stored, false if the buffer is full (job truly dropped).
 */
export function storeOverflow(queueName: string, entry: OverflowEntry): boolean {
  let buf = _overflow.get(queueName);
  if (!buf) {
    buf = [];
    _overflow.set(queueName, buf);
  }
  if (buf.length >= OVERFLOW_CAP) {
    console.error(JSON.stringify({
      level:  'ERROR',
      event:  'queue_overflow_buffer_full',
      queue:  queueName,
      cap:    OVERFLOW_CAP,
      job:    entry.name,
      reason: 'overflow_cap_reached_job_dropped',
    }));
    _totalJobsDropped++;  // BUG#14 fix: count truly dropped jobs separately
    return false;
  }
  buf.push(entry);
  _totalJobsBlocked++;
  return true;
}

/**
 * Register a callback that drains the overflow buffer for `queueName` back
 * into the real queue when the protection level recovers to normal.
 *
 * Called from bullmqClient.ts inside applyQueueProtection() using the
 * original (unpatched) addBulk binding so the drain bypasses the guard.
 */
export function registerOverflowDrain(queueName: string, cb: DrainCallback): void {
  _drainCbs.set(queueName, cb);
}

/** Total overflow jobs across all queues. */
function totalOverflowed(): number {
  let n = 0;
  for (const buf of _overflow.values()) n += buf.length;
  return n;
}

/** Per-queue overflow depths. */
function overflowByQueue(): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [k, v] of _overflow.entries()) {
    if (v.length > 0) out[k] = v.length;
  }
  return out;
}

async function drainAllOverflows(): Promise<void> {
  for (const [queueName, buf] of _overflow.entries()) {
    if (buf.length === 0) continue;
    const cb = _drainCbs.get(queueName);
    if (!cb) continue;

    const snapshot = buf.splice(0);  // atomic clear
    try {
      await cb(queueName, snapshot);
      console.log(JSON.stringify({
        level:  'INFO',
        event:  'queue_overflow_drained',
        queue:  queueName,
        count:  snapshot.length,
      }));
    } catch (err) {
      // Re-buffer on failure so jobs aren't lost
      buf.unshift(...snapshot);
      console.warn(JSON.stringify({
        level:  'WARN',
        event:  'queue_overflow_drain_failed',
        queue:  queueName,
        count:  snapshot.length,
        error:  (err as Error)?.message,
      }));
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Alert / log helpers
// ─────────────────────────────────────────────────────────────────────────────

async function writeAdminAlert(redis: IORedis, recovered: boolean): Promise<void> {
  const payload = JSON.stringify({
    level:        _level,
    recovered,
    effectivePct: _effectivePct,
    memoryPct:    _memory.usagePct,
    requestsPct:  _requests.usagePct,
    usedMb:       Math.round(_memory.usedBytes / 1024 / 1024),
    maxMb:        Math.round(_memory.maxBytes  / 1024 / 1024),
    dailyUsed:    _requests.dailyUsed,
    dailyLimit:   _requests.dailyLimit,
    ts:           _checkedAt,
  });

  // ── 1. Write alert key to Redis (best-effort — may fail when Redis is at limit) ──
  await redis.set('omnivyra:redis:usage:alert', payload, 'EX', 6 * 3600).catch(() => {});

  // ── 2. Write to filesystem (survives Redis failure / high-usage states) ──
  // Lives at <project-root>/.redis-usage-alert.json
  try {
    const alertPath = path.resolve(process.cwd(), '.redis-usage-alert.json');
    fs.writeFileSync(alertPath, payload + '\n', { flag: 'w' });
  } catch { /* non-fatal — filesystem might be read-only in some hosting envs */ }

  // ── 3. Loud stderr banner so it's impossible to miss in any terminal ──
  if (_level === 'critical' || _level === 'throttle') {
    const bar = '='.repeat(70);
    process.stderr.write(
      `\n${bar}\n` +
      `🚨 REDIS USAGE ${_level.toUpperCase()} — ${_effectivePct.toFixed(1)}% of daily limit used\n` +
      `   Commands today: ${_requests.dailyUsed.toLocaleString()} / ${_requests.dailyLimit.toLocaleString()}\n` +
      `   Memory: ${Math.round(_memory.usedBytes/1024/1024)} MB / ${Math.round(_memory.maxBytes/1024/1024)} MB\n` +
      `   Time: ${_checkedAt}\n` +
      `${bar}\n\n`,
    );
  } else if (_level === 'warning') {
    process.stderr.write(
      `⚠️  Redis usage WARNING: ${_effectivePct.toFixed(1)}% ` +
      `(${_requests.dailyUsed.toLocaleString()}/${_requests.dailyLimit.toLocaleString()} cmds, ` +
      `${_memory.usagePct.toFixed(1)}% mem)\n`,
    );
  }
}

function logTransition(prev: UsageLevel, next: UsageLevel): void {
  const entry = {
    event:         'redis_usage_level_change',
    prev_level:    prev,
    level:         next,
    effective_pct: _effectivePct.toFixed(1),
    memory_pct:    _memory.usagePct.toFixed(1),
    requests_pct:  _requests.usagePct.toFixed(1),
    used_mb:       Math.round(_memory.usedBytes / 1024 / 1024),
    max_mb:        Math.round(_memory.maxBytes  / 1024 / 1024),
    daily_used:    _requests.dailyUsed,
    daily_limit:   _requests.dailyLimit,
    ts:            _checkedAt,
  };

  if (next === 'critical') {
    console.error(JSON.stringify({ level: 'ERROR', ...entry }));
  } else if (next === 'warning' || next === 'throttle') {
    console.warn(JSON.stringify({ level: 'WARN', ...entry }));
  } else {
    // Recovered to normal
    console.log(JSON.stringify({
      level: 'INFO',
      event: 'redis_usage_system_recovered',
      prev_level:    prev,
      effective_pct: _effectivePct.toFixed(1),
      jobs_unblocked: totalOverflowed(),
      ts: _checkedAt,
    }));
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Core poll
// ─────────────────────────────────────────────────────────────────────────────

async function poll(getRedis: () => IORedis): Promise<void> {
  let redis: IORedis;
  try { redis = getRedis(); } catch { return; }

  try {
    // Refresh admin-configured infra limits (single GET, low overhead)
    try {
      const raw = await redis.get('omnivyra:admin:config:infra_limits');
      if (raw) {
        const limits = JSON.parse(raw);
        if (limits?.redis?.maxCommandsPerDay > 0) _adminDailyLimit  = limits.redis.maxCommandsPerDay;
        if (limits?.redis?.maxMemoryBytes    > 0) _adminMaxMemBytes = limits.redis.maxMemoryBytes;
        // BUG#7/#8 fix: also load advisory DB/LLM limits
        if (limits?.db  !== undefined) {
          _adminDbMaxReads  = limits.db.maxReadsPerDay  ?? 0;
          _adminDbMaxWrites = limits.db.maxWritesPerDay ?? 0;
        }
        if (limits?.llm !== undefined) {
          _adminLlmMaxTokens = limits.llm.maxTokensPerDay ?? 0;
        }
        // Reset advisory counters on UTC date rollover
        const todayStr = todayUtc();
        if (_advisoryDate !== todayStr) {
          _dbReadsToday = 0; _dbWritesToday = 0; _llmTokensToday = 0;
          _advisoryDate = todayStr;
        }
      }
    } catch { /* non-fatal — keep previous values */ }

    // Single INFO call — returns memory + stats sections together
    const info = await redis.info();
    const { usedBytes, maxBytes, totalCommandsProcessed } = parseInfo(info);

    const memPct = maxBytes > 0 ? usedBytes / maxBytes : 0;
    _memory = {
      usedBytes,
      maxBytes,
      usagePct: Math.round(memPct * 10_000) / 100,
    };

    _requests     = await computeRequestUsage(redis, totalCommandsProcessed);
    _effectivePct = Math.max(_memory.usagePct, _requests.usagePct);
    _level        = classify(_effectivePct / 100);
    _checkedAt    = new Date().toISOString();

    // Level transition handling
    if (_level !== _prevLevel) {
      logTransition(_prevLevel, _level);

      const recovered = _level === 'normal' && _prevLevel !== 'normal';

      if (recovered) {
        // Drain FIRST then reset counters (BUG#13 previously fixed order)
        await drainAllOverflows();

        _totalJobsBlocked = 0;
        _totalJobsDropped = 0;   // reset dropped counter on recovery too
        _totalCronSkipped = 0;
        _skippedCronJobs.clear();
        _criticalDeferStart.clear();
      }

      _prevLevel  = _level;
      _notifiedAt = 0;  // force immediate alert on transition

      await writeAdminAlert(redis, recovered);
      _notifiedAt = Date.now();
    }

    // Periodic alert refresh at elevated levels
    if (_level !== 'normal' && Date.now() - _notifiedAt > NOTIFY_COOLDOWN_MS) {
      _notifiedAt = Date.now();
      await writeAdminAlert(redis, false);
    }
    _initialized = true;   // BUG#3 fix: mark that at least one poll completed
  } catch (err) {
    console.warn('[redis][usageProtection] poll error:', (err as Error)?.message);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Immediately override the infra limits used by the protection engine.
 * Called by the admin API after saving new limits to Redis so they apply
 * within the current poll cycle without waiting for the next auto-refresh.
 */
export function applyInfraLimitsOverride(limits: {
  redisMaxCommandsPerDay?: number;
  redisMaxMemoryBytes?:    number;
}): void {
  if ((limits.redisMaxCommandsPerDay ?? 0) > 0) _adminDailyLimit  = limits.redisMaxCommandsPerDay!;
  if ((limits.redisMaxMemoryBytes    ?? 0) > 0) _adminMaxMemBytes = limits.redisMaxMemoryBytes!;
}

/** Full status snapshot including both usage axes and protection impact. */
export function getUsageStatus(): RedisUsageStatus {
  // Derive which queues are currently blocked
  const blockedQueues: string[] = [];
  if (_level === 'critical') {
    for (const name of _drainCbs.keys()) {
      if (!CRITICAL_QUEUES.has(name)) blockedQueues.push(name);
    }
  }

  // Jobs deferred under critical for longer than the starvation threshold
  const longDeferredCronJobs: string[] = [];
  const now = Date.now();
  for (const [jobKey, since] of _criticalDeferStart.entries()) {
    if (now - since > CRITICAL_STARVATION_WARN_MS) longDeferredCronJobs.push(jobKey);
  }

  const fanOutReductionPct =
    _level === 'throttle' ? 50 :
    _level === 'critical' ? 100 : 0;

  return {
    level:        _level,
    initialized:  _initialized,
    memory:       { ..._memory },
    requests:     { ..._requests },
    effectivePct: _effectivePct,
    checkedAt:    _checkedAt,
    impact: {
      blockedQueues,
      fanOutReductionPct,
      totalJobsBlocked:    _totalJobsBlocked,
      totalJobsDropped:    _totalJobsDropped,
      totalJobsOverflowed: totalOverflowed(),
      overflowByQueue:     overflowByQueue(),
      totalCronSkipped:    _totalCronSkipped,
      skippedCronJobs:     [..._skippedCronJobs],
      longDeferredCronJobs,
    },
    advisory: {
      dbReadsToday:   _dbReadsToday,
      dbWritesToday:  _dbWritesToday,
      llmTokensToday: _llmTokensToday,
      dbMaxReads:     _adminDbMaxReads,
      dbMaxWrites:    _adminDbMaxWrites,
      llmMaxTokens:   _adminLlmMaxTokens,
    },
  };
}

/** Current protection level. Synchronous, never blocks. */
export function getUsageLevel(): UsageLevel {
  return _level;
}

/**
 * Returns false when the queue should be blocked due to Redis pressure.
 * Critical queues (posting, publish) are never blocked.
 */
export function isQueueAllowed(queueName: string): boolean {
  if (_level === 'critical') return CRITICAL_QUEUES.has(queueName);
  return true;
}

/**
 * Fan-out multiplier for bulk job adds.
 *   normal/warning → 1.0
 *   throttle       → 0.5
 *   critical       → 0.0 (non-critical queues already blocked)
 */
export function getQueueFanOutMultiplier(): number {
  if (_level === 'throttle') return 0.5;
  if (_level === 'critical') return 0.0;
  return 1.0;
}

/**
 * Usage-aware cron gate called by shouldRunCronJob() in adminRuntimeConfig.ts.
 *
 * normal/warning  → no restriction (returns true)
 * throttle        → non-essential jobs: require 2× the base interval
 * critical        → non-essential jobs: always false
 *
 * Side effects:
 *   - Increments _totalCronSkipped and records in _skippedCronJobs when blocking.
 *   - Records first-block time in _criticalDeferStart for starvation detection.
 */
export function isCronJobAllowedByUsage(
  jobKey:          string,
  lastRunMs:       number,
  baseIntervalMs:  number,
): boolean {
  const lvl          = _level;
  const isNonEssential = NON_ESSENTIAL_CRON_JOBS.has(jobKey);

  if (lvl === 'critical' && isNonEssential) {
    _totalCronSkipped++;
    _skippedCronJobs.add(jobKey);
    if (!_criticalDeferStart.has(jobKey)) {
      _criticalDeferStart.set(jobKey, Date.now());
    }
    return false;
  }

  if (lvl === 'throttle' && isNonEssential) {
    const ready = Date.now() - lastRunMs >= baseIntervalMs * 2;
    if (!ready) {
      _totalCronSkipped++;
      _skippedCronJobs.add(jobKey);
    }
    return ready;
  }

  // Cleared critical deferral once the job would be allowed again
  _criticalDeferStart.delete(jobKey);
  return true;
}

/**
 * Start the background polling loop. Idempotent — safe to call multiple times.
 *
 * BUG#1+#25 fix: Returns a promise that resolves after the FIRST poll completes
 * so callers can await it before enqueuing jobs. Poll interval reduced from
 * 60 s → 15 s so the protection level goes stale for at most 15 s instead of 60 s.
 */
export function startUsageProtection(getRedis: () => IORedis): Promise<void> {
  if (_pollTimer) return Promise.resolve();  // already running

  // BUG#24 fix: warn loudly at startup if critical env vars are missing so
  // operators don't rely on wrong defaults that cause premature throttling.
  if (!process.env.REDIS_MAX_BYTES && !process.env.UPSTASH_DAILY_REQUEST_LIMIT) {
    process.stderr.write(
      `⚠️  [redis][usageProtection] Neither REDIS_MAX_BYTES nor UPSTASH_DAILY_REQUEST_LIMIT\n` +
      `   is set. Using defaults: 256 MB memory cap, 500,000 commands/day.\n` +
      `   Set these in .env to match your actual Redis tier.\n`,
    );
  } else if (!process.env.REDIS_MAX_BYTES) {
    process.stderr.write(
      `⚠️  [redis][usageProtection] REDIS_MAX_BYTES is not set.\n` +
      `   Memory cap defaults to 256 MB. Set REDIS_MAX_BYTES=<bytes> to match your tier.\n`,
    );
  }

  const firstPoll = poll(getRedis);   // awaitable first poll

  _pollTimer = setInterval(() => {
    poll(getRedis).catch(() => {});
  }, 15_000);   // BUG#25 fix: was 60 s — stale window now ≤15 s

  if (typeof _pollTimer.unref === 'function') _pollTimer.unref();

  return firstPoll;   // callers can await this to ensure initial state is known
}

export function stopUsageProtection(): void {
  if (_pollTimer) { clearInterval(_pollTimer); _pollTimer = null; }
}

/**
 * (Advisory) Track a database operation.  Call once per Supabase query;
 * count=1 for a single-row call, or the row count for bulk ops.
 *
 * BUG#7 fix: provides the DB tracking hook required by the infra limits config.
 * Never blocks — advisory only.  Emits a stderr warning (throttled to once per
 * 5 min) when the admin-configured maxReadsPerDay / maxWritesPerDay is crossed.
 */
export function trackDbOp(count: number, type: 'read' | 'write'): void {
  if (type === 'read') {
    _dbReadsToday += count;
    if (_adminDbMaxReads > 0 && _dbReadsToday > _adminDbMaxReads) {
      const now = Date.now();
      if (now - _dbAdvisoryWarnedAt > NOTIFY_COOLDOWN_MS) {
        _dbAdvisoryWarnedAt = now;
        process.stderr.write(
          `⚠️  [advisory] DB reads today: ${_dbReadsToday.toLocaleString()} ` +
          `exceeds configured limit of ${_adminDbMaxReads.toLocaleString()}/day\n`,
        );
      }
    }
  } else {
    _dbWritesToday += count;
    if (_adminDbMaxWrites > 0 && _dbWritesToday > _adminDbMaxWrites) {
      const now = Date.now();
      if (now - _dbAdvisoryWarnedAt > NOTIFY_COOLDOWN_MS) {
        _dbAdvisoryWarnedAt = now;
        process.stderr.write(
          `⚠️  [advisory] DB writes today: ${_dbWritesToday.toLocaleString()} ` +
          `exceeds configured limit of ${_adminDbMaxWrites.toLocaleString()}/day\n`,
        );
      }
    }
  }
}

/**
 * (Advisory) Track LLM token consumption.  Call once per AI completion;
 * pass the total_tokens value returned by the model API.
 *
 * BUG#8 fix: provides the LLM tracking hook required by the infra limits config.
 * Never blocks — advisory only.  Emits a stderr warning (throttled to once per
 * 5 min) when the admin-configured maxTokensPerDay is crossed.
 */
export function trackLlmTokens(count: number): void {
  if (count <= 0) return;
  _llmTokensToday += count;
  if (_adminLlmMaxTokens > 0 && _llmTokensToday > _adminLlmMaxTokens) {
    const now = Date.now();
    if (now - _llmAdvisoryWarnedAt > NOTIFY_COOLDOWN_MS) {
      _llmAdvisoryWarnedAt = now;
      process.stderr.write(
        `⚠️  [advisory] LLM tokens today: ${_llmTokensToday.toLocaleString()} ` +
        `exceeds configured limit of ${_adminLlmMaxTokens.toLocaleString()}/day\n`,
      );
    }
  }
}
