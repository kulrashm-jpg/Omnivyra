/**
 * Scheduled anomalous-access scan (cron: every SCAN_INTERVAL_MINUTES, in ALWAYS_RUN_JOBS - an activity-gated job
 * never fires here because recordUserActivity has no callers). Wires the pure detector to real I/O.
 *
 * Config (never code): AUDIT_PRIVILEGED_ACTOR_IDS = comma-separated actor UUIDs (R4 allowlist). Writers record BOTH
 * public.users ids (principal.userId) and auth.users ids (invite-user's `user.id` fallback), so the allowlist holds
 * both ids of each legit account. Unset -> R4 reports itself DISABLED on every run (never a silent pass).
 */
import { supabase } from '../db/supabaseClient';
import { getSharedRedisConnection } from '../../lib/redis/client';
import { logger } from '../services/logger';
import { recordRawCounter } from '../observability';
import { SYSTEM_USER_ID } from '../services/auditActorService';
import {
  runAnomalousAccessScan, type ScanDeps, type ScanSummary, type AuditRow, type CapabilityRow, type AdminRow,
} from '../services/security/anomalousAccessDetector';
import { R3_DECISIONS, SYSTEM_EXPECTED_PRIVILEGED_ACTIONS, type RuleId } from '../services/security/anomalousAccessRules';

/** Rows per source per 10-minute window above which the read is reported TRUNCATED (loud), never trusted as quiet. */
export const SOURCE_ROW_LIMIT = 5000;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function parseAllowlist(raw: string | undefined): ReadonlySet<string> | null {
  if (!raw || raw.trim() === '') return null;
  const ids = raw.split(',').map((s) => s.trim()).filter(Boolean);
  const bad = ids.filter((id) => !UUID_RE.test(id));
  if (bad.length) logger.error('anomalous_access_allowlist_invalid_entries', { count: bad.length });
  const good = ids.filter((id) => UUID_RE.test(id)).map((id) => id.toLowerCase());
  return good.length ? new Set(good) : null;
}

// In-process fallbacks when Redis is unavailable (per process; a restart may re-alert once - acceptable).
const memCooldown = new Map<string, number>();
const memFires = new Map<string, number>();
const dayOf = (ms: number) => new Date(ms).toISOString().slice(0, 10);

async function claimCooldown(key: string, ttlSeconds: number): Promise<boolean> {
  try {
    const redis = await getSharedRedisConnection();
    const r = await redis.set(key, '1', 'EX', ttlSeconds, 'NX');
    return r === 'OK';
  } catch {
    const now = Date.now();
    const until = memCooldown.get(key) ?? 0;
    if (until > now) return false;
    memCooldown.set(key, now + ttlSeconds * 1000);
    return true;
  }
}

async function recordFire(rule: RuleId, nowMs: number): Promise<void> {
  const key = `anomalous_access:fires:${rule}:${dayOf(nowMs)}`;
  try {
    const redis = await getSharedRedisConnection();
    await redis.incr(key);
    await redis.expire(key, 8 * 86_400);
  } catch {
    memFires.set(key, (memFires.get(key) ?? 0) + 1);
  }
}

async function firesLast7Days(rule: RuleId, nowMs: number): Promise<number> {
  const keys = Array.from({ length: 7 }, (_, i) => `anomalous_access:fires:${rule}:${dayOf(nowMs - i * 86_400_000)}`);
  try {
    const redis = await getSharedRedisConnection();
    const vals: Array<string | null> = await redis.mget(...keys);
    return vals.reduce((s, v) => s + (v ? Number(v) || 0 : 0), 0);
  } catch {
    return keys.reduce((s, k) => s + (memFires.get(k) ?? 0), 0);
  }
}

export function buildScanDeps(env: NodeJS.ProcessEnv = process.env): ScanDeps {
  return {
    now: () => Date.now(),
    readAudit: async (sinceIso) => {
      // AI_GATEWAY_CALL (99.8% of rows, NULL actor) is excluded at the source; rows with a NULL action (logAuditEvent's
      // operation-shaped rows) are excluded by neq as well - a stated limitation, re-baseline when they land.
      const { data, error } = await supabase.from('audit_logs')
        .select('actor_user_id, action, target_user_id')
        .gte('created_at', sinceIso)
        .neq('action', 'AI_GATEWAY_CALL')
        .limit(SOURCE_ROW_LIMIT);
      return { rows: (data ?? []) as AuditRow[], error: error?.message ?? null, truncated: (data?.length ?? 0) >= SOURCE_ROW_LIMIT };
    },
    readCapability: async (sinceIso) => {
      const { data, error } = await supabase.from('capability_audit_log')
        .select('actor_user_id, decision')
        .gte('occurred_at', sinceIso)
        .in('decision', [...R3_DECISIONS])
        .limit(SOURCE_ROW_LIMIT);
      return { rows: (data ?? []) as CapabilityRow[], error: error?.message ?? null, truncated: (data?.length ?? 0) >= SOURCE_ROW_LIMIT };
    },
    readAdmin: async (sinceIso) => {
      const { data, error } = await supabase.from('super_admin_audit_logs')
        .select('actor_user_id, action')
        .gte('created_at', sinceIso)
        .limit(SOURCE_ROW_LIMIT);
      return { rows: (data ?? []) as AdminRow[], error: error?.message ?? null, truncated: (data?.length ?? 0) >= SOURCE_ROW_LIMIT };
    },
    claimCooldown,
    recordFire,
    firesLast7Days,
    config: {
      allowlist: parseAllowlist(env.AUDIT_PRIVILEGED_ACTOR_IDS),
      systemUserId: SYSTEM_USER_ID,
      systemExpected: SYSTEM_EXPECTED_PRIVILEGED_ACTIONS,
    },
    log: logger,
    counter: (name, labels) => recordRawCounter(name, 1, labels),
  };
}

export async function runAnomalousAccessScanJob(): Promise<ScanSummary> {
  return runAnomalousAccessScan(buildScanDeps());
}
