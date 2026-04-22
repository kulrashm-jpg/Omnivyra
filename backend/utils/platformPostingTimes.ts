/**
 * Per-platform best posting time / day lookup.
 *
 * Source of truth is the `platform_rules` table (seeded in
 * supabase/migrations/20260508_platform_rules_table.sql). When the table is
 * unreachable or missing a row (e.g. facebook isn't seeded yet), we fall back
 * to research-backed defaults so scheduling never regresses to 09:00 UTC for
 * every platform.
 */

import { supabase } from '../db/supabaseClient';
import { normalizePlatform } from '../constants/platforms';

/** Built-in fallback times (HH:MM UTC) — used when platform_rules row is missing. */
const FALLBACK_BEST_TIMES: Record<string, string> = {
  linkedin:  '09:00',
  instagram: '19:00',
  facebook:  '13:00',
  x:         '12:00',
  twitter:   '12:00',
  youtube:   '18:00',
  tiktok:    '20:00',
  reddit:    '09:00',
  pinterest: '20:00',
  blog:      '08:00',
  podcast:   '08:00',
};

/** Built-in fallback best days per platform. */
const FALLBACK_BEST_DAYS: Record<string, string[]> = {
  linkedin:  ['Tuesday', 'Wednesday', 'Thursday'],
  instagram: ['Wednesday', 'Friday', 'Sunday'],
  facebook:  ['Tuesday', 'Wednesday', 'Thursday'],
  x:         ['Tuesday', 'Thursday'],
  twitter:   ['Tuesday', 'Thursday'],
  youtube:   ['Friday'],
  tiktok:    ['Thursday', 'Saturday'],
  reddit:    ['Monday', 'Wednesday'],
  pinterest: ['Saturday', 'Sunday'],
  blog:      ['Tuesday'],
  podcast:   ['Monday'],
};

type PlatformWindow = {
  best_times: string[];
  best_days: string[];
};

let cache: Map<string, PlatformWindow> | null = null;
let inflight: Promise<Map<string, PlatformWindow>> | null = null;

/** Fetches platform_rules once per process and caches the result in memory. */
async function loadPlatformWindows(): Promise<Map<string, PlatformWindow>> {
  if (cache) return cache;
  if (inflight) return inflight;

  inflight = (async () => {
    const map = new Map<string, PlatformWindow>();
    try {
      const { data, error } = await supabase
        .from('platform_rules')
        .select('platform, best_times, best_days');
      if (!error && Array.isArray(data)) {
        for (const row of data as Array<{ platform?: string; best_times?: unknown; best_days?: unknown }>) {
          const key = normalizePlatform(String(row.platform ?? ''));
          if (!key) continue;
          const times = Array.isArray(row.best_times) ? row.best_times.map((t) => String(t)) : [];
          const days = Array.isArray(row.best_days) ? row.best_days.map((d) => String(d)) : [];
          const existing = map.get(key);
          // Multiple rows per platform (one per content_type). Keep the first
          // non-empty times/days we see so we always produce a real hint.
          if (!existing || (existing.best_times.length === 0 && times.length > 0)) {
            map.set(key, {
              best_times: times.length > 0 ? times : existing?.best_times ?? [],
              best_days: days.length > 0 ? days : existing?.best_days ?? [],
            });
          }
        }
      }
    } catch {
      /* fall through to built-in fallback */
    }
    cache = map;
    return map;
  })();

  return inflight;
}

/** Best posting time (HH:MM) for a platform. Falls back to built-in map, then '09:00'. */
export async function getPlatformBestTime(platform: string): Promise<string> {
  const key = normalizePlatform(platform);
  const windows = await loadPlatformWindows();
  const fromDb = windows.get(key)?.best_times?.[0];
  if (fromDb) return fromDb;
  return FALLBACK_BEST_TIMES[key] ?? '09:00';
}

/** Best posting days (capitalised day names) for a platform. Falls back to built-in map. */
export async function getPlatformBestDays(platform: string): Promise<string[]> {
  const key = normalizePlatform(platform);
  const windows = await loadPlatformWindows();
  const fromDb = windows.get(key)?.best_days;
  if (fromDb && fromDb.length > 0) return fromDb;
  return FALLBACK_BEST_DAYS[key] ?? ['Tuesday', 'Wednesday', 'Thursday'];
}

/** Batch version — prefer this when scheduling many rows in one pass. */
export async function getPlatformBestTimesMap(platforms: string[]): Promise<Record<string, string>> {
  await loadPlatformWindows();
  const out: Record<string, string> = {};
  for (const p of platforms) {
    out[normalizePlatform(p)] = await getPlatformBestTime(p);
  }
  return out;
}

const DAY_TO_INDEX: Record<string, number> = {
  monday: 1, tuesday: 2, wednesday: 3, thursday: 4,
  friday: 5, saturday: 6, sunday: 7,
};

/**
 * Map a platform's best_days list to 1-based day indexes (1=Monday … 7=Sunday).
 * Falls back to all weekdays if the platform has no configured best_days.
 */
export async function getPlatformBestDayIndexes(platform: string): Promise<number[]> {
  const days = await getPlatformBestDays(platform);
  const indexes = days
    .map((d) => DAY_TO_INDEX[String(d).trim().toLowerCase()])
    .filter((n): n is number => typeof n === 'number' && n >= 1 && n <= 7);
  return indexes.length > 0 ? indexes : [2, 3, 4]; // Tue/Wed/Thu default
}

/**
 * Pick the nth best day index for a platform (round-robin through best_days).
 * Example: LinkedIn best_days = [Tue, Wed, Thu] →
 *   n=0 → Tue(2), n=1 → Wed(3), n=2 → Thu(4), n=3 → Tue(2) again.
 */
export async function pickPlatformDayIndex(platform: string, nth: number): Promise<number> {
  const indexes = await getPlatformBestDayIndexes(platform);
  const i = ((nth % indexes.length) + indexes.length) % indexes.length;
  return indexes[i]!;
}
