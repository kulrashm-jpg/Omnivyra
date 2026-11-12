/**
 * Cross-instance anomaly sweep detector.
 *
 * Runs every 2 minutes (via /api/cron/anomaly-sweep or backend scheduler).
 * Queries auth_audit_logs globally — a single DB that all instances write to —
 * so it sees the true aggregate traffic regardless of how many instances are running.
 *
 * Example gap this fixes:
 *   5 instances, each sees 8 ghost sessions/min (below local threshold of 5/5min)
 *   Sweep sees 40 ghost sessions/2min → threshold crossed → CRITICAL alert fires.
 */

import { createClient } from '@supabase/supabase-js';
import { SWEEP_EVENT_MAP } from './types';
import { evaluateAnomalyCount } from './detectionEngine';
import { requireSupabaseSecretKey } from '../../backend/db/supabaseKeys';

let _db: ReturnType<typeof createClient> | null = null;
function getDb() {
  if (_db) return _db;
  _db = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    requireSupabaseSecretKey(),
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  return _db;
}

const SWEEP_WINDOW_MINS = 5; // look at the last 5 minutes of auth_audit_logs

export interface SweepResult {
  checkedTypes: number;
  anomaliesFound: number;
  counts: Record<string, number>;
  durationMs: number;
  /**
   * Set when auth_audit_logs could not be read (an error, or no data with no
   * error, which is still no answer). The zero counts are then NOT "nothing
   * happened", and the worker timer throws on this so the run counts as an error.
   */
  queryError?: string;
}

/**
 * Run one sweep cycle.
 * Fetches all auth_audit_logs rows in the last 5 minutes, counts per event type,
 * and passes each count to evaluateAnomalyCount() with source='sweep'.
 */
export async function runAnomalySweep(): Promise<SweepResult> {
  const start = Date.now();
  const since = new Date(Date.now() - SWEEP_WINDOW_MINS * 60 * 1_000).toISOString();

  // Fetch raw events — limit 2000 so a sudden flood can't OOM this process
  const { data, error } = await getDb()
    .from('auth_audit_logs')
    .select('event')
    .gte('created_at', since)
    .limit(2_000);

  if (error || !data) {
    console.warn('[sweepDetector] query failed:', error?.message);
    return {
      checkedTypes: 0, anomaliesFound: 0, counts: {}, durationMs: Date.now() - start,
      queryError: error?.message ?? 'auth_audit_logs read returned no data',
    };
  }

  // Aggregate counts per auth event type
  const counts: Record<string, number> = {};
  for (const row of (data as Array<{ event: string | null }>)) {
    if (row.event) counts[row.event] = (counts[row.event] ?? 0) + 1;
  }

  // Evaluate each event type that maps to an anomaly type
  let checkedTypes = 0;
  let anomaliesFound = 0;

  const evalPromises = Object.entries(counts)
    .filter(([authEvent]) => SWEEP_EVENT_MAP[authEvent])
    .map(async ([authEvent, count]) => {
      const anomalyType = SWEEP_EVENT_MAP[authEvent];
      checkedTypes++;
      // We pass the raw count — evaluateAnomalyCount computes threshold and dedup,
      // and returns whether the threshold was crossed (dedup does not hide it).
      const crossed = await evaluateAnomalyCount(anomalyType, count, {
        source:   'sweep',
        metadata: { window_mins: SWEEP_WINDOW_MINS, global_count: count },
      });
      if (crossed) anomaliesFound++;
    });

  await Promise.allSettled(evalPromises);

  return {
    checkedTypes,
    anomaliesFound,
    counts,
    durationMs: Date.now() - start,
  };
}
