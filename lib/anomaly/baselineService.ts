/**
 * Baseline calculation service.
 *
 * Computes the "normal" hourly rate for each event type by averaging
 * auth_audit_log counts over the past 24 hours.
 *
 * Results are cached in-process for 1 hour — baseline only needs to update
 * once per hour to remain meaningful, and frequent DB queries would add
 * unnecessary load.
 *
 * Unit: events per hour.
 */

import { createClient } from '@supabase/supabase-js';

let _client: ReturnType<typeof createClient> | null = null;

function getClient() {
  if (_client) return _client;
  _client = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  return _client;
}

interface BaselineCacheEntry {
  hourlyAvg: number;
  cachedAt:  number;
}

const cache       = new Map<string, BaselineCacheEntry>();
const CACHE_TTL   = 60 * 60 * 1_000;   // 1 hour
const WINDOW_24H  = 24 * 60 * 60 * 1_000;

/**
 * Returns the average number of `eventType` events per hour over the last 24 h.
 * Falls back to 0 silently on DB errors (conservative — allows minThreshold to govern).
 */
export async function getHourlyBaseline(eventType: string): Promise<number> {
  const now = Date.now();
  const cached = cache.get(eventType);
  if (cached && now - cached.cachedAt < CACHE_TTL) return cached.hourlyAvg;

  try {
    const since = new Date(now - WINDOW_24H).toISOString();
    const { count, error } = await getClient()
      .from('auth_audit_logs')
      .select('*', { count: 'exact', head: true })
      .eq('event', eventType)
      .gte('created_at', since);

    const hourlyAvg = error ? 0 : (count ?? 0) / 24;
    cache.set(eventType, { hourlyAvg, cachedAt: now });
    return hourlyAvg;
  } catch {
    return 0;
  }
}

/** Invalidate the cached baseline for a given event type (e.g. after a known spike). */
export function invalidateBaseline(eventType: string): void {
  cache.delete(eventType);
}

/** Compute the effective detection threshold for an anomaly config. */
export function computeThreshold(
  baseline: number,
  multiplier: number,
  minThreshold: number,
): number {
  return Math.max(minThreshold, baseline * multiplier);
}
