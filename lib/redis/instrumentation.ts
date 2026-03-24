/**
 * Redis command instrumentation layer.
 *
 * How it works:
 *   1. `createInstrumentedClient(redis, feature)` wraps any IORedis-compatible
 *      object in a JS Proxy. Every command call is counted by (feature, command).
 *   2. `startInstrumentation(getClient)` starts two background timers:
 *      - Every 60 s  → structured log flush (top features + commands)
 *      - Every 5 min → snapshot persisted to Redis key infra:metrics:redis:5min:{ts}
 *   3. Every 1 000th command → milestone log line.
 *   4. `getMetricsReport()` returns the live in-memory snapshot on demand.
 *
 * Feature IDs (string union for discoverability):
 *   queue | rate_limit | ai_cache | intelligence_cache | strategy_index
 *   metrics | cron | external_api_cache | shared
 */

// ── Types ─────────────────────────────────────────────────────────────────────

export type RedisFeature =
  | 'queue'
  | 'rate_limit'
  | 'ai_cache'
  | 'intelligence_cache'
  | 'strategy_index'
  | 'metrics'
  | 'cron'
  | 'external_api_cache'
  | 'shared';

export interface FeatureMetrics {
  total:    number;
  commands: Record<string, number>;
}

export interface RedisMetricsReport {
  windowStart:  string;
  windowEnd:    string;
  totalOps:     number;
  opsPerMin:    number;
  peakOpsPerMin: number;
  byFeature:    Record<string, FeatureMetrics>;
  topFeatures:  Array<{ feature: string; total: number; pct: number }>;
  topCommands:  Array<{ command: string; total: number; pct: number }>;
  /** Peak windows: 5-min buckets with highest observed ops/min */
  peakWindows:  Array<{ ts: string; opsPerMin: number }>;
  /** Memory used by Redis in bytes (injected externally from INFO memory) */
  storageBytesUsed: number;
}

/**
 * Parse `used_memory` bytes from the output of `redis.info('memory')`.
 * Returns 0 if not found.
 */
export function parseRedisInfoMemory(infoOutput: string): number {
  const match = infoOutput.match(/^used_memory:(\d+)/m);
  return match ? parseInt(match[1], 10) : 0;
}

// ── Commands to track ─────────────────────────────────────────────────────────
// Covers everything ioredis exposes; unlisted methods pass through untracked.

const TRACKED_COMMANDS = new Set([
  // String
  'get', 'set', 'del', 'exists', 'expire', 'pexpire', 'ttl', 'pttl',
  'getex', 'setex', 'setnx', 'psetex', 'getset', 'mget', 'mset', 'msetnx',
  'incr', 'decr', 'incrby', 'decrby', 'incrbyfloat', 'append', 'strlen',
  // Hash
  'hget', 'hset', 'hdel', 'hexists', 'hgetall', 'hmget', 'hmset',
  'hincrby', 'hincrbyfloat', 'hkeys', 'hvals', 'hlen', 'hscan',
  // Sorted set
  'zadd', 'zcard', 'zcount', 'zlexcount',
  'zrange', 'zrangebyscore', 'zrangebylex', 'zrevrange', 'zrevrangebyscore',
  'zrank', 'zrevrank', 'zscore', 'zmscore',
  'zrem', 'zremrangebyscore', 'zremrangebyrank', 'zremrangebylex',
  'zpopmin', 'zpopmax', 'zincrby', 'zunionstore', 'zinterstore', 'zscan',
  // Set
  'sadd', 'srem', 'scard', 'smembers', 'sismember', 'smismember',
  'sunion', 'sinter', 'sdiff', 'sunionstore', 'sinterstore', 'sdiffstore',
  'spop', 'srandmember', 'sscan', 'smove',
  // List
  'lpush', 'rpush', 'lpushx', 'rpushx',
  'lpop', 'rpop', 'blpop', 'brpop',
  'llen', 'lrange', 'lindex', 'lset', 'linsert', 'lrem', 'ltrim', 'lpos',
  // Key management
  'keys', 'scan', 'type', 'rename', 'renamenx', 'randomkey',
  'persist', 'dump', 'restore', 'object', 'sort',
  // Pipeline / transaction
  'multi', 'exec', 'discard', 'pipeline',
  // Pub/Sub
  'publish', 'subscribe', 'unsubscribe', 'psubscribe', 'punsubscribe',
  // Stream
  'xadd', 'xread', 'xreadgroup', 'xack', 'xlen', 'xrange', 'xrevrange',
  'xgroup', 'xinfo', 'xdel', 'xtrim',
  // Scripting
  'eval', 'evalsha', 'script',
  // Server
  'info', 'ping', 'flushdb', 'flushall', 'dbsize', 'time', 'config',
  'client', 'command', 'debug', 'slowlog', 'latency',
  // HyperLogLog
  'pfadd', 'pfcount', 'pfmerge',
  // Geo
  'geoadd', 'geodist', 'geohash', 'geopos', 'georadius', 'georadiusbymember',
]);

// ── In-memory state ───────────────────────────────────────────────────────────

const counters   = new Map<string, FeatureMetrics>();
const opTimeline: number[] = [];   // last 60 s of timestamps
const peakLog: Array<{ ts: number; opsPerMin: number }> = []; // 5-min peaks

const OPS_WINDOW_MS = 60_000;
let   windowStart   = Date.now();
let   globalTotal   = 0;
let   peakOpsPerMin = 0;

// ── Core recording ────────────────────────────────────────────────────────────

function recordOp(feature: string, command: string): void {
  // Feature counter
  let fc = counters.get(feature);
  if (!fc) {
    fc = { total: 0, commands: {} };
    counters.set(feature, fc);
  }
  fc.commands[command] = (fc.commands[command] ?? 0) + 1;
  fc.total++;

  // Rolling 60-second ops/min window
  const now = Date.now();
  opTimeline.push(now);
  // Trim timestamps older than the window (from the front)
  let i = 0;
  while (i < opTimeline.length && opTimeline[i] < now - OPS_WINDOW_MS) i++;
  if (i > 0) opTimeline.splice(0, i);
  // Track peak
  if (opTimeline.length > peakOpsPerMin) peakOpsPerMin = opTimeline.length;

  // Global total + milestone log
  globalTotal++;
  if (globalTotal % 1_000 === 0) {
    console.log(JSON.stringify({
      level:       'INFO',
      event:       'redis_cmd_milestone',
      feature,
      total:       globalTotal,
      last_cmd:    command,
      ops_per_min: opTimeline.length,
      ts:          new Date(now).toISOString(),
    }));
  }
}

// ── Report ────────────────────────────────────────────────────────────────────

export function getMetricsReport(): RedisMetricsReport {
  const now = Date.now();
  const currentOpsPerMin = opTimeline.filter(t => t >= now - OPS_WINDOW_MS).length;

  // Global command totals
  const cmdTotals: Record<string, number> = {};
  let   totalOps = 0;

  for (const fc of counters.values()) {
    totalOps += fc.total;
    for (const [cmd, cnt] of Object.entries(fc.commands)) {
      cmdTotals[cmd] = (cmdTotals[cmd] ?? 0) + cnt;
    }
  }

  const topFeatures = [...counters.entries()]
    .sort((a, b) => b[1].total - a[1].total)
    .map(([feature, fc]) => ({
      feature,
      total: fc.total,
      pct:   totalOps > 0 ? Math.round((fc.total / totalOps) * 1_000) / 10 : 0,
    }));

  const topCommands = Object.entries(cmdTotals)
    .sort((a, b) => b[1] - a[1])
    .map(([command, total]) => ({
      command,
      total,
      pct: totalOps > 0 ? Math.round((total / totalOps) * 1_000) / 10 : 0,
    }));

  const byFeature: Record<string, FeatureMetrics> = {};
  for (const [f, fc] of counters) {
    byFeature[f] = { total: fc.total, commands: { ...fc.commands } };
  }

  // Keep last 12 peak-window entries (1 h at 5-min cadence)
  const peakWindows = peakLog
    .slice(-12)
    .map(p => ({ ts: new Date(p.ts).toISOString(), opsPerMin: p.opsPerMin }));

  return {
    windowStart:      new Date(windowStart).toISOString(),
    windowEnd:        new Date(now).toISOString(),
    totalOps,
    opsPerMin:        currentOpsPerMin,
    peakOpsPerMin,
    byFeature,
    topFeatures,
    topCommands,
    peakWindows,
    storageBytesUsed: 0,   // populated externally by system-intelligence handler
  };
}

export function resetCounters(): void {
  counters.clear();
  opTimeline.length = 0;
  peakLog.length    = 0;
  globalTotal       = 0;
  peakOpsPerMin     = 0;
  windowStart       = Date.now();
}

// ── Proxy factory ─────────────────────────────────────────────────────────────

/**
 * Wrap any IORedis-compatible object so every command is counted under `feature`.
 * Non-command properties (EventEmitter, streams, connect/quit, etc.) pass through.
 * Pipeline/multi objects are also proxied so queued commands are counted individually.
 */
export function createInstrumentedClient<T extends object>(redis: T, feature: string): T {
  const wrapPipeline = (pipeline: object): object =>
    new Proxy(pipeline, {
      get(t, p) {
        if (typeof p !== 'string') return Reflect.get(t, p);
        const v = Reflect.get(t, p);
        if (typeof v === 'function' && TRACKED_COMMANDS.has(p)) {
          return (...args: unknown[]) => {
            recordOp(feature, p);
            return (v as (...a: unknown[]) => unknown).apply(t, args);
          };
        }
        return v;
      },
    });

  return new Proxy(redis, {
    get(target, prop) {
      if (typeof prop !== 'string') return Reflect.get(target, prop);
      const val = Reflect.get(target, prop);
      if (typeof val !== 'function') return val;

      if (prop === 'multi' || prop === 'pipeline') {
        return (...args: unknown[]) => {
          recordOp(feature, prop);
          const pl = (val as (...a: unknown[]) => unknown).apply(target, args);
          return wrapPipeline(pl as object);
        };
      }

      if (TRACKED_COMMANDS.has(prop)) {
        return (...args: unknown[]) => {
          recordOp(feature, prop);
          return (val as (...a: unknown[]) => unknown).apply(target, args);
        };
      }

      return val;
    },
  }) as T;
}

// ── Background timers ─────────────────────────────────────────────────────────

let _flushTimer:   ReturnType<typeof setInterval> | null = null;
let _persistTimer: ReturnType<typeof setInterval> | null = null;

/**
 * Start periodic flush + persist timers. Idempotent — safe to call multiple times.
 *
 * @param getRedisClient  Factory returning the Redis client used for persistence.
 *                        Passed in to avoid a circular dependency with bullmqClient.
 */
export function startInstrumentation(
  getRedisClient: () => { set(k: string, v: string, ex: 'EX', ttl: number): Promise<unknown> },
): void {
  if (_flushTimer) return; // already running

  // ── 60-second structured log flush ──────────────────────────────────────
  _flushTimer = setInterval(() => {
    const r = getMetricsReport();
    if (r.totalOps === 0) return;
    console.log(JSON.stringify({
      level:        'INFO',
      event:        'redis_metrics_flush',
      total_ops:    r.totalOps,
      ops_per_min:  r.opsPerMin,
      peak_ops_min: r.peakOpsPerMin,
      top_features: r.topFeatures.slice(0, 5),
      top_commands: r.topCommands.slice(0, 5),
      ts:           r.windowEnd,
    }));
  }, 60_000);

  // ── 5-minute persist ─────────────────────────────────────────────────────
  _persistTimer = setInterval(async () => {
    try {
      const r = getMetricsReport();

      // Record peak for this window before resetting
      peakLog.push({ ts: Date.now(), opsPerMin: r.opsPerMin });
      if (peakLog.length > 48) peakLog.splice(0, peakLog.length - 48); // keep 4 h

      const ts  = Math.floor(Date.now() / 1_000);
      const key = `infra:metrics:redis:5min:${ts}`;
      await getRedisClient().set(key, JSON.stringify(r), 'EX', 7 * 24 * 3600); // TTL 7 days

      resetCounters();
    } catch (err) {
      console.warn('[redis][instrumentation] persist failed:', (err as Error)?.message);
    }
  }, 5 * 60_000);

  // Allow Node.js to exit even if timers are still pending
  if (typeof _flushTimer.unref === 'function') _flushTimer.unref();
  if (_persistTimer && typeof _persistTimer.unref === 'function') _persistTimer.unref();
}

export function stopInstrumentation(): void {
  if (_flushTimer)   { clearInterval(_flushTimer);   _flushTimer   = null; }
  if (_persistTimer) { clearInterval(_persistTimer); _persistTimer = null; }
}
