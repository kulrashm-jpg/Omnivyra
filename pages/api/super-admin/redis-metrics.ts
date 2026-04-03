
/**
 * GET /api/super-admin/redis-metrics
 *
 * Returns the live Redis command instrumentation report.
 *
 * Query params:
 *   ?history=true   Also returns the last 12 persisted 5-min snapshots from Redis
 *                   (up to 1 hour of history). Snapshots are stored at
 *                   infra:metrics:redis:5min:{unix-ts}
 *
 * Auth: super_admin_session cookie  OR  Supabase SUPER_ADMIN role
 *
 * Response shape:
 * {
 *   live: RedisMetricsReport           // current in-memory window
 *   history?: RedisMetricsReport[]     // up to 12 past 5-min snapshots, oldest first
 * }
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { getSupabaseUserFromRequest } from '../../../backend/services/supabaseAuthService';
import { isPlatformSuperAdmin } from '../../../backend/services/rbacService';
import { getMetricsReport } from '../../../lib/redis/instrumentation';
import { getSharedRedisClient } from '../../../backend/queue/bullmqClient';

// ── Auth ──────────────────────────────────────────────────────────────────────

async function requireSuperAdmin(req: NextApiRequest, res: NextApiResponse): Promise<boolean> {
  if (req.cookies?.super_admin_session === '1') return true;
  const { user, error } = await getSupabaseUserFromRequest(req);
  if (!error && user?.id && await isPlatformSuperAdmin(user.id)) return true;
  res.status(403).json({ error: 'NOT_AUTHORIZED' });
  return false;
}

// ── History loader ────────────────────────────────────────────────────────────

async function loadHistory(): Promise<unknown[]> {
  try {
    const redis = getSharedRedisClient();

    // SCAN for all 5-min snapshot keys (avoids KEYS blocking in production)
    const keys: string[] = [];
    let cursor = '0';
    do {
      const [next, found] = await redis.scan(cursor, 'MATCH', 'infra:metrics:redis:5min:*', 'COUNT', 100);
      cursor = next;
      keys.push(...found);
    } while (cursor !== '0');

    if (keys.length === 0) return [];

    // Sort by the embedded timestamp and take the 12 most recent
    keys.sort(); // ascending numeric timestamp suffix → oldest first
    const recent = keys.slice(-12);

    const values = await redis.mget(...recent);
    return values
      .filter((v): v is string => v !== null)
      .map(v => {
        try { return JSON.parse(v) as unknown; } catch { return null; }
      })
      .filter(Boolean);
  } catch (err) {
    console.warn('[redis-metrics] history load failed:', (err as Error)?.message);
    return [];
  }
}

// ── Handler ───────────────────────────────────────────────────────────────────

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  if (!(await requireSuperAdmin(req, res))) return;

  const live = getMetricsReport();

  if (req.query.history === 'true') {
    const history = await loadHistory();
    return res.status(200).json({ live, history });
  }

  return res.status(200).json({ live });
}
