/**
 * Intelligence Health Service
 *
 * Two responsibilities:
 *
 * 1. COMPANY HEALTH SCORE
 *    Computes a 0–100 score per company from three components:
 *      - Activity    (0–40): run volume in the last 30 days
 *      - Success rate (0–40): completed / (completed + failed)
 *      - Recency     (0–20): days since last run, linear decay over 30 days
 *
 *    Grade: A (≥80) / B (≥60) / C (≥40) / D (≥20) / F (<20)
 *    Recommendation: healthy / monitor / at_risk / inactive
 *
 * 2. SYSTEM THROTTLE LEVEL
 *    Reads the singleton intelligence_throttle_config row and compares:
 *      - CPU load average (1-min) vs. cpu thresholds
 *      - Concurrent running jobs vs. queue thresholds
 *    Returns 'none' | 'medium' | 'high'.
 *
 *    Priority rules (for runWithConfig callers):
 *      'none'   → all jobs run
 *      'medium' → skip jobs with effective priority ≥ 7 (low-priority jobs)
 *      'high'   → skip jobs with effective priority ≥ 4 (medium + low priority)
 *      P1–P3 are NEVER throttled regardless of load.
 */

import os from 'os';
import { supabase } from '../db/supabaseClient';

// ── Types ─────────────────────────────────────────────────────────────────────

export type ThrottleLevel = 'none' | 'medium' | 'high';

export interface ThrottleConfig {
  cpu_medium_threshold:   number;
  cpu_high_threshold:     number;
  queue_medium_threshold: number;
  queue_high_threshold:   number;
  enabled:                boolean;
}

export interface SystemLoad {
  cpu_pct:       number;   // 1-min load avg as % of total CPU capacity
  running_jobs:  number;   // jobs currently in 'running' status
  throttle_level: ThrottleLevel;
  config:         ThrottleConfig;
}

export type HealthGrade          = 'A' | 'B' | 'C' | 'D' | 'F';
export type HealthRecommendation = 'healthy' | 'monitor' | 'at_risk' | 'inactive';

export interface CompanyHealthScore {
  company_id: string;
  score:      number;        // 0–100
  grade:      HealthGrade;
  components: {
    activity:     number;   // 0–40
    success_rate: number;   // 0–40
    recency:      number;   // 0–20
  };
  stats: {
    runs_30d:            number;
    success_rate_pct:    number;
    days_since_last_run: number | null;
  };
  recommendation: HealthRecommendation;
}

// ── System throttle ───────────────────────────────────────────────────────────

// Simple in-memory cache to avoid a DB hit on every job run
let _throttleCache: { level: ThrottleLevel; load: SystemLoad; expiresAt: number } | null = null;
const CACHE_TTL_MS = 30_000; // 30 seconds

export async function getSystemThrottleLevel(): Promise<SystemLoad> {
  const now = Date.now();
  if (_throttleCache && now < _throttleCache.expiresAt) {
    return _throttleCache.load;
  }

  // Fetch throttle config from DB
  const { data: cfgRow } = await supabase
    .from('intelligence_throttle_config')
    .select('*')
    .eq('id', 1)
    .maybeSingle();

  const cfg: ThrottleConfig = {
    cpu_medium_threshold:   cfgRow?.cpu_medium_threshold   ?? 70,
    cpu_high_threshold:     cfgRow?.cpu_high_threshold     ?? 85,
    queue_medium_threshold: cfgRow?.queue_medium_threshold ?? 6,
    queue_high_threshold:   cfgRow?.queue_high_threshold   ?? 12,
    enabled:                cfgRow?.enabled                ?? true,
  };

  // CPU load: 1-min load average as percentage of total logical CPUs
  const loadAvg  = os.loadavg()[0]; // returns 0 on Windows — falls back to queue check
  const cpuCount = Math.max(1, os.cpus().length);
  const cpuPct   = Math.min(100, (loadAvg / cpuCount) * 100);

  // Running jobs count
  const { count: runningCount } = await supabase
    .from('intelligence_execution_log')
    .select('*', { count: 'exact', head: true })
    .eq('status', 'running');

  const runningJobs = runningCount ?? 0;

  // Determine throttle level
  let level: ThrottleLevel = 'none';
  if (cfg.enabled) {
    if (cpuPct >= cfg.cpu_high_threshold || runningJobs >= cfg.queue_high_threshold) {
      level = 'high';
    } else if (cpuPct >= cfg.cpu_medium_threshold || runningJobs >= cfg.queue_medium_threshold) {
      level = 'medium';
    }
  }

  const load: SystemLoad = { cpu_pct: Math.round(cpuPct), running_jobs: runningJobs, throttle_level: level, config: cfg };

  _throttleCache = { level, load, expiresAt: now + CACHE_TTL_MS };
  return load;
}

/** Invalidate the throttle cache (call after updating config). */
export function invalidateThrottleCache(): void {
  _throttleCache = null;
}

/**
 * Returns true if a job with the given effective priority should be
 * skipped given the current throttle level.
 *
 * P1–P3 are never throttled.
 * P4–P6 are throttled only under 'high' load.
 * P7–P10 are throttled under 'medium' or 'high' load.
 */
export function isThrottled(effectivePriority: number, level: ThrottleLevel): boolean {
  if (level === 'none') return false;
  if (level === 'medium') return effectivePriority >= 7;
  // 'high'
  return effectivePriority >= 4;
}

// ── Company health score ──────────────────────────────────────────────────────

/**
 * Compute a health score for one company from the last 30 days of execution logs.
 */
export async function computeCompanyHealthScore(
  companyId: string,
): Promise<CompanyHealthScore> {
  const thirtyDaysAgo = new Date(Date.now() - 30 * 86_400_000).toISOString();

  const { data: logs } = await supabase
    .from('intelligence_execution_log')
    .select('status, started_at')
    .eq('company_id', companyId)
    .gte('started_at', thirtyDaysAgo)
    .in('status', ['completed', 'failed', 'running']); // exclude skipped

  const rows = (logs ?? []) as Array<{ status: string; started_at: string }>;

  const completed = rows.filter(r => r.status === 'completed').length;
  const failed    = rows.filter(r => r.status === 'failed').length;
  const total     = completed + failed;

  // Activity (0–40): linear, 100+ runs = full score
  const activityScore = Math.min(40, Math.round((rows.length / 100) * 40));

  // Success rate (0–40)
  const successRate  = total > 0 ? completed / total : 0;
  const successScore = Math.round(successRate * 40);

  // Recency (0–20): linear decay — 0 days ago = 20, 30+ days = 0
  const sorted = rows
    .slice()
    .sort((a, b) => b.started_at.localeCompare(a.started_at));

  let recencyScore         = 0;
  let daysSinceLastRun: number | null = null;

  if (sorted.length > 0) {
    const lastRunMs = new Date(sorted[0].started_at).getTime();
    const daysAgo   = (Date.now() - lastRunMs) / 86_400_000;
    daysSinceLastRun = Math.round(daysAgo);
    recencyScore     = Math.max(0, Math.round(20 * (1 - daysAgo / 30)));
  }

  const score = activityScore + successScore + recencyScore;

  const grade: HealthGrade =
    score >= 80 ? 'A' :
    score >= 60 ? 'B' :
    score >= 40 ? 'C' :
    score >= 20 ? 'D' : 'F';

  const recommendation: HealthRecommendation =
    score >= 70 ? 'healthy' :
    score >= 45 ? 'monitor' :
    score >= 20 ? 'at_risk' : 'inactive';

  return {
    company_id: companyId,
    score,
    grade,
    components: { activity: activityScore, success_rate: successScore, recency: recencyScore },
    stats: {
      runs_30d:            rows.length,
      success_rate_pct:    Math.round(successRate * 100),
      days_since_last_run: daysSinceLastRun,
    },
    recommendation,
  };
}

/**
 * Compute health scores for multiple companies in parallel (batch of 10).
 * Returns results sorted by score descending.
 */
export async function computeAllCompanyHealthScores(
  companyIds: string[],
): Promise<CompanyHealthScore[]> {
  const BATCH = 10;
  const results: CompanyHealthScore[] = [];

  for (let i = 0; i < companyIds.length; i += BATCH) {
    const batch = companyIds.slice(i, i + BATCH);
    const scores = await Promise.all(batch.map(id => computeCompanyHealthScore(id)));
    results.push(...scores);
  }

  return results.sort((a, b) => b.score - a.score);
}
