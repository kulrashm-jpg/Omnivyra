
/**
 * GET  /api/admin/cache-management  — Returns cache stats for all layers
 * POST /api/admin/cache-management  — Flushes a specific cache layer
 *
 * Body for POST: { action: 'flush_ai' | 'flush_ext_api' | 'flush_intelligence' }
 *
 * Auth: super_admin_session cookie OR Supabase SUPER_ADMIN role
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import IORedis from 'ioredis';
import { getSupabaseUserFromRequest } from '../../../backend/services/supabaseAuthService';
import { isPlatformSuperAdmin } from '../../../backend/services/rbacService';
import { getCacheStats as getExtApiStats } from '../../../backend/services/redisExternalApiCache';
import { invalidateCacheByPrefix } from '../../../backend/services/aiResponseCache';

const requireSuperAdmin = async (req: NextApiRequest, res: NextApiResponse): Promise<boolean> => {
  if (req.cookies?.super_admin_session === '1') return true;
  const { user, error } = await getSupabaseUserFromRequest(req);
  if (!error && user?.id && (await isPlatformSuperAdmin(user.id))) return true;
  res.status(403).json({ error: 'NOT_AUTHORIZED' });
  return false;
};

function getRedisClient(): IORedis | null {
  const url = process.env.REDIS_URL || process.env.REDIS_PRIVATE_URL;
  if (!url) return null;
  try {
    return new IORedis(url, { lazyConnect: true, maxRetriesPerRequest: 1, connectTimeout: 3000 });
  } catch {
    return null;
  }
}

interface RedisInfo {
  used_memory_human: string;
  used_memory_peak_human: string;
  maxmemory_human: string;
  maxmemory_policy: string;
  evicted_keys: string;
  expired_keys: string;
  connected_clients: string;
  uptime_in_days: string;
}

function parseRedisInfo(raw: string): Partial<RedisInfo> {
  const out: Record<string, string> = {};
  for (const line of raw.split('\r\n')) {
    const [k, v] = line.split(':');
    if (k && v !== undefined) out[k.trim()] = v.trim();
  }
  return out as Partial<RedisInfo>;
}

async function getRedisKeyStats(client: IORedis): Promise<{ prefix: string; count: number }[]> {
  const prefixes = [
    { prefix: 'omnivyra:ai_resp:v2', label: 'ai_cache' },
    { prefix: 'omnivyra:ai_sem:v2',  label: 'ai_semantic' },
    { prefix: 'virality:ext_api',    label: 'ext_api' },
    { prefix: 'infra:metrics',       label: 'metrics' },
    { prefix: 'virality:intel',      label: 'intelligence' },
    { prefix: 'virality:strategy',   label: 'strategy_index' },
  ];

  const results: { prefix: string; count: number }[] = [];
  for (const { prefix, label } of prefixes) {
    try {
      // SCAN to count keys — more efficient than KEYS for production
      let cursor = '0';
      let count = 0;
      do {
        const [nextCursor, keys] = await client.scan(cursor, 'MATCH', `${prefix}*`, 'COUNT', 100);
        cursor = nextCursor;
        count += keys.length;
      } while (cursor !== '0' && count < 10_000);
      results.push({ prefix: label, count });
    } catch {
      results.push({ prefix: label, count: -1 });
    }
  }
  return results;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (!(await requireSuperAdmin(req, res))) return;

  // ── POST: flush a cache layer ────────────────────────────────────────────
  if (req.method === 'POST') {
    const { action } = req.body as { action?: string };

    if (action === 'flush_ai') {
      const deleted = await invalidateCacheByPrefix('omnivyra:ai_resp:v2').catch(() => 0);
      await invalidateCacheByPrefix('omnivyra:ai_sem:v2').catch(() => 0);
      return res.status(200).json({ ok: true, deleted, message: `AI response cache flushed (${deleted} keys)` });
    }

    if (action === 'flush_ext_api') {
      const client = getRedisClient();
      let deleted = 0;
      if (client) {
        try {
          await client.connect().catch(() => {});
          let cursor = '0';
          do {
            const [nextCursor, keys] = await client.scan(cursor, 'MATCH', 'virality:ext_api*', 'COUNT', 100);
            cursor = nextCursor;
            if (keys.length > 0) {
              await client.del(...keys);
              deleted += keys.length;
            }
          } while (cursor !== '0');
        } finally {
          client.disconnect();
        }
      }
      return res.status(200).json({ ok: true, deleted, message: `External API cache flushed (${deleted} keys)` });
    }

    if (action === 'flush_intelligence') {
      const client = getRedisClient();
      let deleted = 0;
      if (client) {
        try {
          await client.connect().catch(() => {});
          let cursor = '0';
          do {
            const [nextCursor, keys] = await client.scan(cursor, 'MATCH', 'virality:intel*', 'COUNT', 100);
            cursor = nextCursor;
            if (keys.length > 0) {
              await client.del(...keys);
              deleted += keys.length;
            }
          } while (cursor !== '0');
        } finally {
          client.disconnect();
        }
      }
      return res.status(200).json({ ok: true, deleted, message: `Intelligence cache flushed (${deleted} keys)` });
    }

    return res.status(400).json({ error: 'Unknown action' });
  }

  // ── GET: return cache stats ──────────────────────────────────────────────
  if (req.method !== 'GET') return res.status(405).end();

  const client = getRedisClient();
  let redisInfo: Partial<RedisInfo> = {};
  let keyStats: { prefix: string; count: number }[] = [];
  let redisAvailable = false;

  if (client) {
    try {
      await client.connect().catch(() => {});
      const raw = await client.info() as string;
      redisInfo = parseRedisInfo(raw);
      keyStats = await getRedisKeyStats(client);
      redisAvailable = true;
    } catch {
      redisAvailable = false;
    } finally {
      client.disconnect();
    }
  }

  const extApiStats = getExtApiStats();

  return res.status(200).json({
    redis: {
      available:         redisAvailable,
      used_memory:       redisInfo.used_memory_human ?? '—',
      peak_memory:       redisInfo.used_memory_peak_human ?? '—',
      max_memory:        redisInfo.maxmemory_human ?? 'unlimited',
      eviction_policy:   redisInfo.maxmemory_policy ?? '—',
      evicted_keys:      parseInt(redisInfo.evicted_keys ?? '0', 10),
      expired_keys:      parseInt(redisInfo.expired_keys ?? '0', 10),
      connected_clients: parseInt(redisInfo.connected_clients ?? '0', 10),
      uptime_days:       parseInt(redisInfo.uptime_in_days ?? '0', 10),
    },
    key_counts: keyStats,
    ext_api_cache: {
      hits:           extApiStats.hits,
      misses:         extApiStats.misses,
      hit_rate:       extApiStats.hits + extApiStats.misses > 0
                        ? Math.round((extApiStats.hits / (extApiStats.hits + extApiStats.misses)) * 100)
                        : null,
      per_api_hits:   extApiStats.per_api_hits,
      per_api_misses: extApiStats.per_api_misses,
    },
    layers: [
      { name: 'AI Response Cache',    prefix: 'ai_cache',      ttl: '6h–24h',  auto_evict: true  },
      { name: 'External API Cache',   prefix: 'ext_api',       ttl: '12 min',  auto_evict: true  },
      { name: 'Intelligence Cache',   prefix: 'intelligence',  ttl: '1h',      auto_evict: true  },
      { name: 'Strategy Index',       prefix: 'strategy_index', ttl: '24h',    auto_evict: true  },
    ],
    collected_at: new Date().toISOString(),
  });
}
