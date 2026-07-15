/**
 * W2-3 — Lua-batched AI guard limiter (audit B-10).
 *
 * The JS guard path checks up to 8 sliding-window layers (burst + 7 rate
 * layers) SEQUENTIALLY, each a 4-command MULTI → ~28 commands / ~8 serial
 * round-trips per AI request — the single largest interactive driver of the
 * Upstash daily command cap. This module executes ALL eligible layers in ONE
 * EVAL round-trip with semantics that mirror the JS path exactly:
 *
 *   per layer, in order: ZREMRANGEBYSCORE(-inf, now-window) → ZCARD →
 *   ZADD(now, member) → EXPIRE(window+10). Blocked when countBefore >= limit.
 *   The blocking layer's request IS still recorded (JS records before it
 *   evaluates), and layers AFTER the blocking layer are NOT touched (JS
 *   short-circuits). Same keys, same keyspace, same admin-override limits —
 *   the JS and Lua paths are interchangeable mid-flight.
 *
 * ROLLOUT: gated by the 'lua-ai-guard' flag in aiRequestGuard. Shadow mode is
 * deliberately NOT supported for this flag — the check MUTATES counters, so
 * running both paths would double-record every request. Validation is
 * test-based + staged enable (off → enforce per env), with AUTOMATIC fallback
 * to the JS path on any script/Redis error (fail-open preserved).
 */
import type IORedis from 'ioredis';
import { getInstrumentedStandaloneRedisClient } from '../../queue/standaloneRedisClient';
import { recordRawCounter } from '../../observability';

export interface LuaGuardLayer {
  /** Full Redis key (`${prefix}:${identifier}`) — identical to the JS path. */
  key: string;
  /** Effective (admin-override-resolved) limit. */
  limit: number;
  windowSecs: number;
}

export interface LuaGuardResult {
  /** 0 = all layers allowed; N = 1-based index of the blocking layer. */
  blockedIndex: number;
  /** countBefore observed at the blocking layer (diagnostics). */
  blockedCount: number;
}

// Mirrors checkRateLimit's MULTI body per layer; early-returns on first block.
const GUARD_SCRIPT = `
local now = tonumber(ARGV[1])
local n = (#ARGV - 1) / 3
for i = 1, n do
  local base = 1 + (i - 1) * 3
  local limit = tonumber(ARGV[base + 1])
  local windowMs = tonumber(ARGV[base + 2])
  local member = ARGV[base + 3]
  redis.call('ZREMRANGEBYSCORE', KEYS[i], '-inf', now - windowMs)
  local count = redis.call('ZCARD', KEYS[i])
  redis.call('ZADD', KEYS[i], now, member)
  redis.call('EXPIRE', KEYS[i], math.floor(windowMs / 1000) + 10)
  if count >= limit then
    return {i, count}
  end
end
return {0, 0}
`;

let _client: (IORedis & { aiGuardCheckLayers?: (...args: Array<string | number>) => Promise<[number, number]> }) | null = null;

function getClient() {
  if (_client) return _client;
  const client = getInstrumentedStandaloneRedisClient('rate_limit') as NonNullable<typeof _client>;
  // defineCommand without numberOfKeys → first call argument carries it;
  // ioredis manages EVALSHA/EVAL fallback + script caching automatically.
  if (!client.aiGuardCheckLayers) {
    (client as IORedis).defineCommand('aiGuardCheckLayers', { lua: GUARD_SCRIPT });
  }
  _client = client;
  return client;
}

/**
 * Evaluate all layers in one round-trip. THROWS on Redis/script failure —
 * the caller (guardAiRequest) catches and falls back to the JS path.
 */
export async function checkLayersLua(layers: LuaGuardLayer[], nowMs: number): Promise<LuaGuardResult> {
  if (layers.length === 0) return { blockedIndex: 0, blockedCount: 0 };
  const client = getClient();
  const args: Array<string | number> = [layers.length, ...layers.map((l) => l.key), String(nowMs)];
  for (const layer of layers) {
    args.push(String(layer.limit), String(layer.windowSecs * 1_000), `${nowMs}-${Math.random()}`);
  }
  const raw = await client.aiGuardCheckLayers!(...args);
  const blockedIndex = Number(raw?.[0] ?? 0);
  const blockedCount = Number(raw?.[1] ?? 0);
  try {
    recordRawCounter('ai_guard.lua_check', 1, { blocked: blockedIndex > 0 });
  } catch { /* fail-safe */ }
  return { blockedIndex, blockedCount };
}
