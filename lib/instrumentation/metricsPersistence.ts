/**
 * System metrics persistence — 5-minute slim snapshots to Redis.
 *
 * v2 enhancements vs v1:
 *  - SlimSnapshot replaces full SystemMetrics — stores only scalar summaries
 *    (~600 bytes raw vs ~8 KB for the full object)
 *  - Optional gzip compression: set METRICS_COMPRESS=true to halve stored size
 *  - Environment tag on every snapshot
 *  - Format prefix ("gz1:" / "v2:") allows seamless future migrations
 *
 * Key structure:
 *   infra:metrics:system:5min:{timestamp}   — slim payload (TTL: 30 days)
 *   infra:metrics:system:index              — sorted set: score=ts, member=ts
 *
 * The sorted-set index allows O(log N) range queries without key scanning.
 */

import { gzipSync, gunzipSync } from 'zlib';
import type { SystemMetrics, Env } from './systemMetrics';
import type { CostEstimate }       from './costEngine';

// ── SlimSnapshot ──────────────────────────────────────────────────────────────

/**
 * Compact snapshot storing only scalar summary values.
 * Excludes: latency arrays, per-endpoint maps, timeline arrays, full breakdowns.
 * These are never needed for trend / baseline / projection queries.
 */
export interface SlimSnapshot {
  /** Format version — allows future schema migrations. */
  v:   2;
  ts:  number;
  iso: string;
  env: Env;

  redis: {
    opsPerMin:     number;
    peakOpsPerMin: number;
    topFeature:    string | null;
    topFeaturePct: number;
    topCommand:    string | null;
  } | null;

  supabase: {
    qpm:     number;
    reads:   number;
    writes:  number;
    errors:  number;
    bytesIn: number;
  } | null;

  api: {
    cpm:     number;
    total:   number;
    errRate: number;
    avgMs:   number | null;
    p95Ms:   number | null;
  } | null;

  external: {
    totalCalls:    number;
    topService:    string | null;
    openaiCalls:   number;
    anthropicCalls: number;
  } | null;

  cost: {
    total:      number;
    confidence: string;
    topDriver:  string | null;
  } | null;
}

// ── Slimifier ─────────────────────────────────────────────────────────────────

export function slimify(
  metrics: SystemMetrics,
  cost:    CostEstimate | null,
): SlimSnapshot {
  const ts  = Date.now();
  const iso = new Date(ts).toISOString();

  const redis = metrics.redis ? {
    opsPerMin:     metrics.redis.opsPerMin,
    peakOpsPerMin: metrics.redis.peakOpsPerMin,
    topFeature:    metrics.redis.topFeatures?.[0]?.feature ?? null,
    topFeaturePct: metrics.redis.topFeatures?.[0]?.pct     ?? 0,
    topCommand:    metrics.redis.topCommands?.[0]?.command ?? null,
  } : null;

  const supabase = metrics.supabase ? {
    qpm:     metrics.supabase.queriesPerMin,
    reads:   metrics.supabase.reads,
    writes:  metrics.supabase.writes,
    errors:  metrics.supabase.errors,
    bytesIn: metrics.supabase.estimatedBytesIn,
  } : null;

  const api = metrics.api ? {
    cpm:     metrics.api.callsPerMin,
    total:   metrics.api.totalCalls,
    errRate: metrics.api.errorRate,
    avgMs:   metrics.api.avgLatencyMs,
    p95Ms:   metrics.api.p95LatencyMs,
  } : null;

  const ext = metrics.external;
  const external = ext ? {
    totalCalls:    ext.totalExternalCalls,
    topService:    ext.topServices?.[0]?.service ?? null,
    openaiCalls:   ext.byService?.['openai']?.calls    ?? 0,
    anthropicCalls: ext.byService?.['anthropic']?.calls ?? 0,
  } : null;

  const costSlim = cost ? {
    total:      cost.totalMonthlyEstimate,
    confidence: cost.confidence,
    topDriver:  cost.topCostDrivers?.[0]?.reason ?? null,
  } : null;

  return { v: 2, ts, iso, env: metrics.env, redis, supabase, api, external, cost: costSlim };
}

// ── Compression helpers ───────────────────────────────────────────────────────

const COMPRESS = process.env.METRICS_COMPRESS === 'true';

function encode(json: string): string {
  if (!COMPRESS) return json;
  try {
    return 'gz1:' + gzipSync(Buffer.from(json, 'utf8')).toString('base64');
  } catch {
    return json; // fall back to plain on any error
  }
}

function decode(raw: string): string {
  if (raw.startsWith('gz1:')) {
    try {
      return gunzipSync(Buffer.from(raw.slice(4), 'base64')).toString('utf8');
    } catch {
      return raw; // malformed — let JSON.parse fail gracefully
    }
  }
  return raw;
}

// ── Constants ──────────────────────────────────────────────────────────────────

const KEY_PREFIX = 'infra:metrics:system:5min';
const INDEX_KEY  = 'infra:metrics:system:index';
const TTL_SECS   = 30 * 24 * 60 * 60;   // 30 days
const INTERVAL   = 5 * 60 * 1_000;       // 5 minutes

// ── Internal state ─────────────────────────────────────────────────────────────

let _timer: ReturnType<typeof setInterval> | null = null;

// ── Redis shim ────────────────────────────────────────────────────────────────

interface RedisPipeline {
  set(key: string, value: string, ex: 'EX', ttl: number): unknown;
  zadd(key: string, score: number, member: string): unknown;
  expire(key: string, ttl: number): unknown;
  exec(): Promise<unknown>;
}

interface RedisLike {
  set(key: string, value: string, ex: 'EX', ttl: number): Promise<unknown>;
  zadd(key: string, score: number, member: string): Promise<unknown>;
  expire(key: string, ttl: number): Promise<unknown>;
  pipeline?(): RedisPipeline;
}

interface RangeQueryRedis extends RedisLike {
  zrangebyscore(key: string, min: number | string, max: number | string): Promise<string[]>;
  mget(...keys: string[]): Promise<(string | null)[]>;
}

// ── Core persist function ──────────────────────────────────────────────────────

/**
 * Slimify and persist one snapshot to Redis.
 * Any Redis error is swallowed — never propagates to the metrics loop.
 */
export async function persistSnapshot(
  getRedis: () => RedisLike,
  metrics:  SystemMetrics,
  cost:     CostEstimate | null,
): Promise<void> {
  try {
    const slim  = slimify(metrics, cost);
    const key   = `${KEY_PREFIX}:${slim.ts}`;
    const value = encode(JSON.stringify(slim));

    const redis = getRedis();
    if (redis.pipeline) {
      const pipe = redis.pipeline();
      pipe.set(key, value, 'EX', TTL_SECS);
      pipe.zadd(INDEX_KEY, slim.ts, String(slim.ts));
      pipe.expire(INDEX_KEY, TTL_SECS);
      await pipe.exec();
    } else {
      await redis.set(key, value, 'EX', TTL_SECS);
      await redis.zadd(INDEX_KEY, slim.ts, String(slim.ts));
      await redis.expire(INDEX_KEY, TTL_SECS);
    }
  } catch {
    // Swallow — Redis unavailability must never break the metrics loop
  }
}

// ── Timer management ───────────────────────────────────────────────────────────

/**
 * Start the 5-minute persistence loop.  Safe to call multiple times — only
 * one timer runs per process.
 */
export function startMetricsPersistence(
  getRedis:   () => RedisLike,
  getMetrics: () => Promise<SystemMetrics>,
  getCost:    (metrics: SystemMetrics) => CostEstimate | null,
): void {
  if (_timer) return;

  _timer = setInterval(async () => {
    try {
      const metrics = await getMetrics();
      let cost: CostEstimate | null = null;
      try { cost = getCost(metrics); } catch { /* ignore cost errors */ }
      await persistSnapshot(getRedis, metrics, cost);
    } catch {
      // getMetrics() threw — skip this tick
    }
  }, INTERVAL);

  if (_timer.unref) _timer.unref();
}

export function stopMetricsPersistence(): void {
  if (_timer) { clearInterval(_timer); _timer = null; }
}

// ── Query helpers ──────────────────────────────────────────────────────────────

/**
 * Retrieve slim snapshots in a time window.
 * Returns snapshots ascending by timestamp; empty array on any error.
 */
export async function querySnapshots(
  getRedis: () => RangeQueryRedis,
  fromMs:   number,
  toMs:     number,
): Promise<SlimSnapshot[]> {
  try {
    const redis   = getRedis();
    const members = await redis.zrangebyscore(INDEX_KEY, fromMs, toMs);
    if (members.length === 0) return [];

    const keys   = members.map(ts => `${KEY_PREFIX}:${ts}`);
    const values = await redis.mget(...keys);

    const snapshots: SlimSnapshot[] = [];
    for (const raw of values) {
      if (!raw) continue;
      try {
        const parsed = JSON.parse(decode(raw));
        // Accept v2 snapshots only (v1 full-metrics snapshots are silently dropped)
        if (parsed?.v === 2) snapshots.push(parsed as SlimSnapshot);
      } catch { /* skip malformed */ }
    }
    return snapshots.sort((a, b) => a.ts - b.ts);
  } catch {
    return [];
  }
}

/** Convenience: query the last N milliseconds. */
export async function queryRecentSnapshots(
  getRedis: () => RangeQueryRedis,
  windowMs: number,
): Promise<SlimSnapshot[]> {
  const now = Date.now();
  return querySnapshots(getRedis, now - windowMs, now);
}
