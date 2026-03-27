/**
 * GET /api/super-admin/system-health
 *
 * Returns anomaly data for the Super Admin system-health dashboard.
 *
 * Response:
 *   summary        — 24h anomaly counts by severity
 *   anomalies      — last 100 anomaly rows, most-recent first
 *   authEvents     — last-24h auth_audit_log event counts (for trending)
 *   systemStatus   — quick-read Redis / auth service health
 *   baselines      — current cached hourly baselines per event type
 *
 * Auth: super_admin_session cookie OR Supabase SUPER_ADMIN role
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '@/backend/db/supabaseClient';
import { getSupabaseUserFromRequest } from '../../../backend/services/supabaseAuthService';
import { isPlatformSuperAdmin } from '../../../backend/services/rbacService';
import { getHourlyBaseline } from '../../../lib/anomaly/baselineService';
import { ANOMALY_CONFIGS } from '../../../lib/anomaly/types';
import { getUsageStatus } from '../../../lib/redis/usageProtection';

const requireSuperAdmin = async (
  req: NextApiRequest,
  res: NextApiResponse,
): Promise<boolean> => {
  if (req.cookies?.super_admin_session === '1') return true;
  const { user, error } = await getSupabaseUserFromRequest(req);
  if (!error && user?.id && await isPlatformSuperAdmin(user.id)) return true;
  res.status(403).json({ error: 'NOT_AUTHORIZED' });
  return false;
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  if (!(await requireSuperAdmin(req, res))) return;

  const since24h = new Date(Date.now() - 24 * 60 * 60 * 1_000).toISOString();
  const since1h  = new Date(Date.now() -       60 * 60 * 1_000).toISOString();
  const since5m  = new Date(Date.now() -        5 * 60 * 1_000).toISOString();

  // ── Parallel queries ─────────────────────────────────────────────────────
  const [anomaliesRes, authEventsRes, recentRedisRes, recent5mRes] = await Promise.all([
    // Last 100 anomalies (all severities, last 24 h)
    supabase
      .from('system_anomalies')
      .select('id, type, severity, entity_type, entity_id, metric_value, threshold, baseline, metadata, alerted_at, created_at')
      .gte('created_at', since24h)
      .order('created_at', { ascending: false })
      .limit(100),

    // Auth event counts in last 24 h (for trending panel)
    supabase
      .from('auth_audit_logs')
      .select('event, created_at')
      .gte('created_at', since24h),

    // Most recent Redis failure in last 1 h (for system-status badge)
    supabase
      .from('system_anomalies')
      .select('created_at')
      .eq('type', 'redis_fallback_mode')
      .gte('created_at', since1h)
      .order('created_at', { ascending: false })
      .limit(1),

    // All anomalies in last 5 min (for system_state computation)
    supabase
      .from('system_anomalies')
      .select('severity, type')
      .gte('created_at', since5m),
  ]);

  // ── Summary counts ───────────────────────────────────────────────────────
  const anomalies = anomaliesRes.data ?? [];
  const summary = {
    critical_24h:    anomalies.filter(a => a.severity === 'CRITICAL').length,
    warning_24h:     anomalies.filter(a => a.severity === 'WARNING').length,
    info_24h:        anomalies.filter(a => a.severity === 'INFO').length,
    last_critical_at: anomalies.find(a => a.severity === 'CRITICAL')?.created_at ?? null,
  };

  // ── Auth event counts (map: eventType → count) ───────────────────────────
  const authEventCounts: Record<string, number> = {};
  for (const row of authEventsRes.data ?? []) {
    authEventCounts[row.event] = (authEventCounts[row.event] ?? 0) + 1;
  }

  // ── System status ────────────────────────────────────────────────────────
  const lastRedisFail = (recentRedisRes.data ?? [])[0]?.created_at ?? null;
  const systemStatus = {
    redis:              lastRedisFail ? 'degraded' : 'ok',
    last_redis_failure: lastRedisFail,
  };

  // ── System state (overall health signal) ─────────────────────────────────
  const recent5m    = recent5mRes.data ?? [];
  const crit5m      = recent5m.filter(a => a.severity === 'CRITICAL');
  const warn5m      = recent5m.filter(a => a.severity === 'WARNING');
  const crit1h      = anomalies.filter(
    a => a.severity === 'CRITICAL' && a.created_at >= since1h,
  );

  const stateReasons: string[] = [];

  if (lastRedisFail) {
    stateReasons.push('Redis fallback active in the last hour');
  }
  if (crit5m.length > 0) {
    const types = [...new Set(crit5m.map((a: { type: string }) => a.type))].join(', ');
    stateReasons.push(`${crit5m.length} critical anomaly${crit5m.length > 1 ? 'ies' : ''} in last 5 min (${types})`);
  }
  if (crit5m.length === 0 && crit1h.length > 0) {
    stateReasons.push(`${crit1h.length} critical anomaly${crit1h.length > 1 ? 'ies' : ''} in the last hour`);
  }
  if (warn5m.length > 3) {
    stateReasons.push(`${warn5m.length} warnings in last 5 min`);
  }

  const systemState: { status: 'healthy' | 'degraded' | 'critical'; reasons: string[] } = {
    status: crit5m.length > 0
      ? 'critical'
      : (lastRedisFail || crit1h.length > 0 || warn5m.length > 3)
        ? 'degraded'
        : 'healthy',
    reasons: stateReasons,
  };

  // ── Baselines (current cached values for all registered anomaly types) ───
  // Fetched concurrently; failures return 0 (safe default)
  const baselineEntries = await Promise.all(
    Object.keys(ANOMALY_CONFIGS).map(async (type) => {
      const val = await getHourlyBaseline(type);
      return [type, val] as const;
    }),
  );
  const baselines = Object.fromEntries(baselineEntries);

  // ── Redis usage protection status ────────────────────────────────────────
  const redisUsage = getUsageStatus();

  // Fold Redis pressure into the overall system state
  if (redisUsage.level === 'critical' && systemState.status !== 'critical') {
    systemState.status = 'critical';
    systemState.reasons.push(
      `Redis at ${redisUsage.effectivePct.toFixed(1)}% effective usage (critical threshold exceeded)`,
    );
  } else if (redisUsage.level === 'throttle' && systemState.status === 'healthy') {
    systemState.status = 'degraded';
    systemState.reasons.push(
      `Redis at ${redisUsage.effectivePct.toFixed(1)}% effective usage (throttle active)`,
    );
  } else if (redisUsage.level === 'warning' && systemState.status === 'healthy') {
    systemState.status = 'degraded';
    systemState.reasons.push(
      `Redis at ${redisUsage.effectivePct.toFixed(1)}% effective usage (warning threshold)`,
    );
  }

  if (redisUsage.impact.longDeferredCronJobs.length > 0) {
    systemState.reasons.push(
      `${redisUsage.impact.longDeferredCronJobs.length} cron job(s) deferred >4 h under critical Redis pressure`,
    );
  }

  return res.status(200).json({
    summary,
    anomalies,
    authEventCounts,
    systemStatus,
    systemState,
    baselines,
    redisUsage,
  });
}
