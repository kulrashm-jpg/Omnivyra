/**
 * adminRuntimeConfig — Redis-backed hot-reload configuration.
 *
 * Provides runtime control (no restart needed) for three subsystems:
 *   1. Rate Limiter — per-endpoint limit + window overrides
 *   2. Queue System — per-queue maxJobsPerCycle, attempts, concurrency
 *   3. Cron System  — per-job enabled flag + interval multiplier
 *
 * Storage:
 *   omnivyra:admin:config:rate_limit  (30-day TTL)
 *   omnivyra:admin:config:queue       (30-day TTL)
 *   omnivyra:admin:config:cron        (30-day TTL)
 *
 * Cache: 30-second in-memory cache avoids per-request Redis RTT.
 *        Callers must await the async loader once per cycle/request to warm
 *        the cache; sync helpers then read from it without I/O.
 *
 * Safety:
 *   - All writes go through validateXxxConfig() which enforces safe ranges.
 *   - Corrupt/missing Redis data always falls back to code defaults.
 *   - shouldRunCronJob() is synchronous (reads cache only) — never blocks.
 */

import IORedis from 'ioredis';
import { isCronJobAllowedByUsage } from '../../lib/redis/usageProtection';
import {
  getIntentGate,
  getJobMinFrequencyMs,
  recordIntentSkip,
} from './intentExecutionService';

// ── Redis client ──────────────────────────────────────────────────────────────

let _client: IORedis | null = null;

function getClient(): IORedis {
  if (_client) return _client;
  const url = process.env.REDIS_URL || 'redis://localhost:6379';
  _client = new IORedis(url, {
    enableReadyCheck:     false,
    maxRetriesPerRequest: 1,
    connectTimeout:       2_000,
    commandTimeout:       1_000,
    lazyConnect:          true,
    retryStrategy:        () => null,
  });
  _client.on('error', () => {});
  _client.connect().catch(() => {});
  return _client;
}

/** Disconnect the Redis client (for graceful shutdown). */
export function shutdownAdminRuntimeConfig(): void {
  if (_client) {
    _client.quit().catch(() => {});
    _client = null;
  }
}

// ── Redis keys ────────────────────────────────────────────────────────────────

export const CONFIG_KEYS = {
  rateLimitConfig: 'omnivyra:admin:config:rate_limit',
  queueConfig:     'omnivyra:admin:config:queue',
  cronConfig:      'omnivyra:admin:config:cron',
} as const;

const CONFIG_TTL_SECS = 30 * 24 * 3600; // 30 days

// ── Types ─────────────────────────────────────────────────────────────────────

export interface RateLimitEndpointOverride {
  limit:      number;   // max requests in window (1–1000)
  windowSecs: number;   // window duration (10–86400)
}

export interface RateLimitAdminConfig {
  v:         1;
  updatedAt: string;
  updatedBy: string;
  /** Keys match endpoint slugs: "login", "otp_send", "uid:invite" etc. */
  endpoints: Record<string, RateLimitEndpointOverride>;
}

export interface QueueJobOverride {
  maxJobsPerCycle: number;   // addBulk cap (1–5000)
  attempts:        number;   // retry count (0–10)
  concurrency:     number;   // worker concurrency (1–50)
}

export interface QueueAdminConfig {
  v:         1;
  updatedAt: string;
  updatedBy: string;
  /** Keys match queue names: "publish", "posting", "ai-heavy", "engagement-polling" */
  queues:    Record<string, QueueJobOverride>;
}

export interface CronJobOverride {
  enabled:            boolean;
  /** 1 = normal cadence, 2 = half-frequency, 0.5 = double-frequency (0.1–20) */
  intervalMultiplier: number;
}

export interface CronAdminConfig {
  v:         1;
  updatedAt: string;
  updatedBy: string;
  /** Keys match cron snap keys: "engagementPolling", "signalClustering", etc. */
  jobs:      Record<string, CronJobOverride>;
}

// ── Defaults ──────────────────────────────────────────────────────────────────

const DEFAULT_RL_CONFIG: RateLimitAdminConfig = {
  v: 1, updatedAt: new Date(0).toISOString(), updatedBy: 'system', endpoints: {},
};

const DEFAULT_QUEUE_CONFIG: QueueAdminConfig = {
  v: 1, updatedAt: new Date(0).toISOString(), updatedBy: 'system', queues: {},
};

const DEFAULT_CRON_CONFIG: CronAdminConfig = {
  v: 1, updatedAt: new Date(0).toISOString(), updatedBy: 'system', jobs: {},
};

// ── In-memory cache ───────────────────────────────────────────────────────────

interface CacheEntry<T> { data: T; ts: number }
// BUG#5 fix: was 5 minutes — too slow for limit changes to apply under high usage.
// 30 seconds balances Redis I/O savings vs. config freshness.
const CACHE_TTL_MS = 30_000;   // 30 seconds

let _rlCache:    CacheEntry<RateLimitAdminConfig> | null = null;
let _queueCache: CacheEntry<QueueAdminConfig>     | null = null;
let _cronCache:  CacheEntry<CronAdminConfig>      | null = null;

function fresh<T>(e: CacheEntry<T> | null): e is CacheEntry<T> {
  return !!e && Date.now() - e.ts < CACHE_TTL_MS;
}

// ── Loaders ───────────────────────────────────────────────────────────────────

async function readKey<T extends object>(key: string, fallback: T): Promise<T> {
  try {
    const raw = await getClient().get(key);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    // BUG#6 fix: reject empty / wrong-type parses instead of silently accepting them.
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return fallback;
    return parsed as T;
  } catch {
    return fallback;
  }
}

export async function getRateLimitAdminConfig(): Promise<RateLimitAdminConfig> {
  if (fresh(_rlCache)) return _rlCache.data;
  const data = await readKey(CONFIG_KEYS.rateLimitConfig, DEFAULT_RL_CONFIG);
  _rlCache = { data, ts: Date.now() };
  return data;
}

export async function getQueueAdminConfig(): Promise<QueueAdminConfig> {
  if (fresh(_queueCache)) return _queueCache.data;
  const data = await readKey(CONFIG_KEYS.queueConfig, DEFAULT_QUEUE_CONFIG);
  _queueCache = { data, ts: Date.now() };
  return data;
}

export async function getCronAdminConfig(): Promise<CronAdminConfig> {
  if (fresh(_cronCache)) return _cronCache.data;
  const data = await readKey(CONFIG_KEYS.cronConfig, DEFAULT_CRON_CONFIG);
  _cronCache = { data, ts: Date.now() };
  return data;
}

// ── Validation ────────────────────────────────────────────────────────────────

export function validateRateLimitConfig(
  raw: unknown,
): { valid: boolean; error?: string; config?: RateLimitAdminConfig } {
  if (!raw || typeof raw !== 'object') return { valid: false, error: 'Payload must be an object' };
  const r = raw as Record<string, unknown>;
  if (!r.endpoints || typeof r.endpoints !== 'object') {
    return { valid: false, error: 'Missing endpoints object' };
  }
  for (const [k, v] of Object.entries(r.endpoints as Record<string, unknown>)) {
    const e = v as Record<string, unknown>;
    if (typeof e.limit !== 'number' || e.limit < 1 || e.limit > 1_000) {
      return { valid: false, error: `${k}.limit must be 1–1000` };
    }
    if (typeof e.windowSecs !== 'number' || e.windowSecs < 10 || e.windowSecs > 86_400) {
      return { valid: false, error: `${k}.windowSecs must be 10–86400` };
    }
  }
  return { valid: true, config: r as unknown as RateLimitAdminConfig };
}

export function validateQueueConfig(
  raw: unknown,
): { valid: boolean; error?: string; config?: QueueAdminConfig } {
  if (!raw || typeof raw !== 'object') return { valid: false, error: 'Payload must be an object' };
  const r = raw as Record<string, unknown>;
  if (!r.queues || typeof r.queues !== 'object') {
    return { valid: false, error: 'Missing queues object' };
  }
  for (const [k, v] of Object.entries(r.queues as Record<string, unknown>)) {
    const q = v as Record<string, unknown>;
    if (typeof q.maxJobsPerCycle !== 'number' || q.maxJobsPerCycle < 1 || q.maxJobsPerCycle > 5_000) {
      return { valid: false, error: `${k}.maxJobsPerCycle must be 1–5000` };
    }
    if (typeof q.attempts !== 'number' || q.attempts < 0 || q.attempts > 10) {
      return { valid: false, error: `${k}.attempts must be 0–10` };
    }
    if (typeof q.concurrency !== 'number' || q.concurrency < 1 || q.concurrency > 50) {
      return { valid: false, error: `${k}.concurrency must be 1–50` };
    }
  }
  return { valid: true, config: r as unknown as QueueAdminConfig };
}

export function validateCronConfig(
  raw: unknown,
): { valid: boolean; error?: string; config?: CronAdminConfig } {
  if (!raw || typeof raw !== 'object') return { valid: false, error: 'Payload must be an object' };
  const r = raw as Record<string, unknown>;
  if (!r.jobs || typeof r.jobs !== 'object') {
    return { valid: false, error: 'Missing jobs object' };
  }
  for (const [k, v] of Object.entries(r.jobs as Record<string, unknown>)) {
    const j = v as Record<string, unknown>;
    if (typeof j.enabled !== 'boolean') {
      return { valid: false, error: `${k}.enabled must be boolean` };
    }
    if (typeof j.intervalMultiplier !== 'number' || j.intervalMultiplier < 0.1 || j.intervalMultiplier > 20) {
      return { valid: false, error: `${k}.intervalMultiplier must be 0.1–20` };
    }
  }
  return { valid: true, config: r as unknown as CronAdminConfig };
}

// ── Save helpers ──────────────────────────────────────────────────────────────

export async function saveRateLimitAdminConfig(config: RateLimitAdminConfig): Promise<void> {
  await getClient().set(CONFIG_KEYS.rateLimitConfig, JSON.stringify(config), 'EX', CONFIG_TTL_SECS);
  _rlCache = null; // invalidate cache
}

export async function saveQueueAdminConfig(config: QueueAdminConfig): Promise<void> {
  await getClient().set(CONFIG_KEYS.queueConfig, JSON.stringify(config), 'EX', CONFIG_TTL_SECS);
  _queueCache = null;
}

export async function saveCronAdminConfig(config: CronAdminConfig): Promise<void> {
  await getClient().set(CONFIG_KEYS.cronConfig, JSON.stringify(config), 'EX', CONFIG_TTL_SECS);
  _cronCache = null;
}

// ── Infrastructure Hard Limits ────────────────────────────────────────────────

/**
 * System-wide infrastructure resource caps.
 * Set to 0 to fall back to the corresponding env-var default.
 *
 * redis.maxCommandsPerDay  overrides UPSTASH_DAILY_REQUEST_LIMIT (0 = env / code default)
 * redis.maxMemoryBytes     overrides REDIS_MAX_BYTES              (0 = env / code default)
 * db.maxReadsPerDay        tracked + alerting only; 0 = unlimited
 * db.maxWritesPerDay       tracked + alerting only; 0 = unlimited
 * llm.maxTokensPerDay      tracked + alerting only; 0 = unlimited
 */
export interface InfraLimitsConfig {
  v:         1;
  updatedAt: string;
  updatedBy: string;
  redis: {
    maxCommandsPerDay: number;   // 0 = use env UPSTASH_DAILY_REQUEST_LIMIT
    maxMemoryBytes:    number;   // 0 = use env REDIS_MAX_BYTES (default 256 MB)
  };
  db: {
    maxReadsPerDay:  number;     // 0 = unlimited (advisory)
    maxWritesPerDay: number;     // 0 = unlimited (advisory)
  };
  llm: {
    maxTokensPerDay: number;     // 0 = unlimited (advisory)
  };
}

export const DEFAULT_INFRA_LIMITS: InfraLimitsConfig = {
  v: 1,
  updatedAt: new Date(0).toISOString(),
  updatedBy: 'system',
  redis: { maxCommandsPerDay: 0, maxMemoryBytes: 0 },
  db:    { maxReadsPerDay: 0, maxWritesPerDay: 0 },
  llm:   { maxTokensPerDay: 0 },
};

let _infraCache: CacheEntry<InfraLimitsConfig> | null = null;

export async function getInfraLimitsConfig(): Promise<InfraLimitsConfig> {
  if (fresh(_infraCache)) return _infraCache.data;
  const data = await readKey<InfraLimitsConfig>(
    'omnivyra:admin:config:infra_limits',
    DEFAULT_INFRA_LIMITS,
  );
  _infraCache = { data, ts: Date.now() };
  return data;
}

export async function saveInfraLimitsConfig(config: InfraLimitsConfig): Promise<void> {
  await getClient().set(
    'omnivyra:admin:config:infra_limits',
    JSON.stringify(config),
    'EX',
    CONFIG_TTL_SECS,
  );
  _infraCache = null;
}

// ── Sync runtime helpers (read from in-memory cache only) ────────────────────

/**
 * Drop-in replacement for the interval condition in cron.ts.
 *
 *   // Before:
 *   if (Date.now() - lastJobRun >= JOB_INTERVAL_MS)
 *
 *   // After:
 *   if (shouldRunCronJob('jobKey', JOB_INTERVAL_MS, lastJobRun))
 *
 * Reads from the 30-second in-memory cache — never blocks.
 * Cache must be warmed by calling getCronAdminConfig() earlier in the cycle.
 */
export function shouldRunCronJob(
  jobKey:         string,
  baseIntervalMs: number,
  lastRunMs:      number,
): boolean {
  // ── 1. User-intent gate ─────────────────────────────────────────────────
  // Reads the context warmed by warmIntentContext() at cycle start.
  // Synchronous — zero I/O on the hot path.
  const gate = getIntentGate(jobKey);
  if (!gate.allowed) {
    recordIntentSkip(jobKey, gate.reason!);
    return false;
  }

  // User-triggered jobs bypass the interval check and run immediately.
  if (gate.immediateRun) return true;

  // ── 2. Redis usage-protection overlay ──────────────────────────────────
  if (!isCronJobAllowedByUsage(jobKey, lastRunMs, baseIntervalMs)) {
    return false;
  }

  // ── 3. Admin runtime override ───────────────────────────────────────────
  const override = _cronCache?.data?.jobs?.[jobKey];
  if (override && !override.enabled) return false;
  const adminMultiplier = override
    ? Math.max(0.1, override.intervalMultiplier ?? 1)
    : 1;

  // ── 4. Intent frequency stretching ─────────────────────────────────────
  // Company config may request a slower cadence than the hardcoded base.
  // effectiveInterval = max(baseIntervalMs, minConfiguredFreqMs).
  // This never runs jobs FASTER than the hardcoded base, only SLOWER.
  const minFreqMs = getJobMinFrequencyMs(jobKey);
  const effectiveInterval = minFreqMs !== null
    ? Math.max(baseIntervalMs, minFreqMs)
    : baseIntervalMs;

  return Date.now() - lastRunMs >= effectiveInterval * adminMultiplier;
}

/**
 * Returns override for the given rate-limit keyPrefix, or null.
 * keyPrefix is e.g. "rl:login" — strips "rl:" to get the endpoint key.
 */
export function getRateLimitOverride(
  keyPrefix: string,
): { limit: number; windowSecs: number } | null {
  const cfg = _rlCache?.data;
  if (!cfg) return null;
  const endpointKey = keyPrefix.startsWith('rl:') ? keyPrefix.slice(3) : keyPrefix;
  return cfg.endpoints[endpointKey] ?? null;
}

/**
 * Returns the configured maxJobsPerCycle cap for a queue, or defaultCap.
 */
export function getQueueMaxJobsCap(queueName: string, defaultCap: number): number {
  const cfg = _queueCache?.data;
  const override = cfg?.queues?.[queueName];
  if (override?.maxJobsPerCycle != null && override.maxJobsPerCycle > 0) {
    return override.maxJobsPerCycle;
  }
  return defaultCap;
}
