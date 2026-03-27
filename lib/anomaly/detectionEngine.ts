/**
 * Anomaly Detection Engine — v2
 *
 * Detection flow (per-event call):
 *   1. Increment in-process 5-minute window counter (local traffic)
 *   2. Fetch recent DB count for the same window (global cross-instance traffic)
 *      → cached 1 min; negligible overhead
 *   3. effectiveCount = max(local, db)  → survives restarts + multi-instance
 *   4. Compare effectiveCount against adaptive threshold
 *      threshold = max(minThreshold, hourlyBaseline × multiplier)
 *   5. If exceeded:
 *      a. DB-insert dedup (5 min) — suppress duplicate rows
 *      b. INSERT into system_anomalies (async)
 *      c. Notify-dedup (1 h cooldown escalation) — suppress duplicate Slack alerts
 *      d. sendCriticalAlert for CRITICAL severity
 *
 * Sweep flow (called by cron every 2 min):
 *   - Queries auth_audit_logs globally (all instances) for last 5 min
 *   - Passes raw DB counts directly to evaluateAnomalyCount()
 *   - Catches distributed attacks invisible to any single instance
 */

import { createClient } from '@supabase/supabase-js';
import { ANOMALY_CONFIGS, type AnomalyEntityType } from './types';
import { getHourlyBaseline, computeThreshold } from './baselineService';
import { sendCriticalAlert } from './notificationService';

// ── Supabase client ───────────────────────────────────────────────────────────
let _db: ReturnType<typeof createClient> | null = null;
function getDb() {
  if (_db) return _db;
  _db = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  return _db;
}

// ── In-process 5-minute window counters ──────────────────────────────────────
// Shorter than baseline window (1 h) to detect spikes quickly.
// Reset naturally every 5 minutes; smoothed by the global DB count.
interface WindowBucket { count: number; windowStart: number }
const windowCounters = new Map<string, WindowBucket>();
const LOCAL_WINDOW_MS = 5 * 60 * 1_000; // 5 minutes

function incrementWindowCounter(key: string): number {
  const now = Date.now();
  let b = windowCounters.get(key);
  if (!b || now - b.windowStart >= LOCAL_WINDOW_MS) {
    b = { count: 0, windowStart: now };
    windowCounters.set(key, b);
  }
  b.count++;
  return b.count;
}

// ── Recent DB count (cross-instance smoother) ─────────────────────────────────
// Queries auth_audit_logs for events in the last N minutes across ALL instances.
// Cached per (dbEventType, windowMins) for 1 minute — cheap after first call.
interface DbCountCache { count: number; cachedAt: number }
const dbCountCache = new Map<string, DbCountCache>();
const DB_COUNT_CACHE_TTL = 60 * 1_000; // 1 minute

async function getRecentDbCount(dbEventType: string, windowMins: number): Promise<number> {
  const cacheKey = `${dbEventType}:${windowMins}`;
  const now = Date.now();
  const cached = dbCountCache.get(cacheKey);
  if (cached && now - cached.cachedAt < DB_COUNT_CACHE_TTL) return cached.count;

  try {
    const since = new Date(now - windowMins * 60 * 1_000).toISOString();
    const { count, error } = await getDb()
      .from('auth_audit_logs')
      .select('*', { count: 'exact', head: true })
      .eq('event', dbEventType)
      .gte('created_at', since);

    const val = error ? 0 : (count ?? 0);
    dbCountCache.set(cacheKey, { count: val, cachedAt: now });
    return val;
  } catch {
    return 0;
  }
}

// ── Deduplication (two layers) ────────────────────────────────────────────────

// Layer 1 — DB insert dedup: suppress duplicate system_anomalies rows.
const dbDedupeMap  = new Map<string, number>();
const DB_DEDUPE_TTL = 5 * 60 * 1_000;  // 5 minutes

// Layer 2 — Notification dedup: 1-hour cooldown escalation.
// 1st occurrence → alert; same key again within 1 h → skip; after 1 h → alert again.
const notifyDedupeMap  = new Map<string, number>();
const NOTIFY_DEDUPE_TTL = 60 * 60 * 1_000; // 1 hour

function isDbDuplicate(key: string): boolean {
  const last = dbDedupeMap.get(key);
  return !!last && Date.now() - last < DB_DEDUPE_TTL;
}
function isNotifyDuplicate(key: string): boolean {
  const last = notifyDedupeMap.get(key);
  return !!last && Date.now() - last < NOTIFY_DEDUPE_TTL;
}
function markDbAlerted(key: string)     { dbDedupeMap.set(key, Date.now()); }
function markNotifyAlerted(key: string) { notifyDedupeMap.set(key, Date.now()); }

// ── Shared evaluation core ────────────────────────────────────────────────────
// Called by both detectAnomaly() (local+smoothed) and the sweep detector (DB-only).

interface EvalOptions {
  entityType?: AnomalyEntityType;
  entityId?:   string;
  metadata?:   Record<string, unknown>;
  source?:     'local' | 'sweep';
}

export async function evaluateAnomalyCount(
  type: string,
  effectiveCount: number,
  opts: EvalOptions = {},
): Promise<void> {
  const config = ANOMALY_CONFIGS[type];
  if (!config) return;

  // Adaptive threshold
  const baseline  = await getHourlyBaseline(type);
  // Scale baseline from per-hour to per-5-minute window
  const baselinePer5Min = baseline / 12;
  const threshold = computeThreshold(baselinePer5Min, config.multiplier, config.minThreshold);

  if (effectiveCount < threshold) return;

  const dedupeKey = `${type}:${opts.entityId ?? 'global'}`;

  // ── DB insert ──────────────────────────────────────────────────────────────
  if (!isDbDuplicate(dedupeKey)) {
    markDbAlerted(dedupeKey);
    const now = new Date().toISOString();
    const row = {
      type,
      severity:     config.severity,
      entity_type:  opts.entityType ?? config.entityType,
      entity_id:    opts.entityId   ?? null,
      metric_value: effectiveCount,
      threshold,
      baseline:     baselinePer5Min,
      metadata:     { ...(opts.metadata ?? {}), source: opts.source ?? 'local' },
      alerted_at:   config.severity === 'CRITICAL' ? now : null,
      created_at:   now,
    };
    getDb()
      .from('system_anomalies')
      .insert(row as any)
      .then(({ error }) => {
        if (error) console.warn('[detectionEngine] persist failed:', error.message);
      });
  }

  // ── Notification ───────────────────────────────────────────────────────────
  // CRITICAL only; 1-hour cooldown escalation prevents Slack fatigue.
  if (config.severity === 'CRITICAL' && !isNotifyDuplicate(dedupeKey)) {
    markNotifyAlerted(dedupeKey);
    void sendCriticalAlert({
      type,
      severity:    config.severity,
      entityType:  opts.entityType ?? config.entityType,
      entityId:    opts.entityId ?? null,
      metricValue: effectiveCount,
      threshold,
      metadata:    { ...(opts.metadata ?? {}), source: opts.source ?? 'local' },
      detectedAt:  new Date().toISOString(),
    });
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

export interface DetectAnomalyParams {
  type:        string;
  entityType?: AnomalyEntityType;
  entityId?:   string;
  metadata?:   Record<string, unknown>;
}

/**
 * Record one occurrence of an anomaly signal.
 * Combines local in-process count with global DB count to survive both
 * process restarts and multi-instance deployments.
 *
 * Fire-and-forget: `void detectAnomaly({ type: '...' })`
 */
export async function detectAnomaly(params: DetectAnomalyParams): Promise<void> {
  const config = ANOMALY_CONFIGS[params.type];
  if (!config) return;

  const windowKey = `${params.type}:${params.entityId ?? 'global'}`;

  // Local count (fast, in-process)
  const localCount = incrementWindowCounter(windowKey);

  // Global DB count (cross-instance truth, 1-min cached)
  const dbCount = config.dbEventType
    ? await getRecentDbCount(config.dbEventType, 5)
    : 0;

  // Use whichever is higher — restart-safe + distributed-attack-aware
  const effectiveCount = Math.max(localCount, dbCount);

  await evaluateAnomalyCount(params.type, effectiveCount, {
    entityType: params.entityType,
    entityId:   params.entityId,
    metadata:   params.metadata,
    source:     'local',
  });
}
