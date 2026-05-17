#!/usr/bin/env node
/**
 * x-token-lifecycle-audit.mjs  —  PHASE EX6 operator tooling (READ-ONLY)
 *
 * Inspects the X/Twitter (and all social) token lifecycle WITHOUT mutating
 * anything. No token writes, no lock deletion, no refresh calls.
 *
 *   node scripts/operator/auth/x-token-lifecycle-audit.mjs
 *
 * Requires env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY  (REDIS_URL optional —
 * enables scheduler-heartbeat inspection).
 *
 * Reports:
 *   1. Scheduler heartbeat   — last cron cycle / token-refresh run age + lock
 *   2. Stale token audit     — expired / near-expiry accounts, refresh_token?
 *   3. Orphaned refresh locks — token_refresh_locks older than TTL
 *   4. Lifecycle report      — counts by connection_state / refresh_status
 *
 * Tolerant of the EX2 columns not yet existing (degrades gracefully).
 */

const SUPA = process.env.SUPABASE_URL;
const SR = process.env.SUPABASE_SERVICE_ROLE_KEY;
const REDIS_URL = process.env.REDIS_URL;
const NEAR_EXPIRY_MS = 15 * 60 * 1000;
const LOCK_TTL_MS = 30 * 1000;          // matches refreshLock DEFAULT_TTL_SECONDS
const CRON_STALE_MS = 20 * 60 * 1000;   // 10-min cadence → >20m == suspicious

if (!SUPA || !SR) {
  console.error('Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY env.');
  process.exit(2);
}

const h = { apikey: SR, Authorization: `Bearer ${SR}` };
const j = async (path) => {
  const r = await fetch(`${SUPA}${path}`, { headers: h });
  if (!r.ok) return { __err: `${r.status} ${(await r.text()).slice(0, 200)}` };
  return r.json();
};

async function schedulerHeartbeat() {
  if (!REDIS_URL) return { skipped: 'no REDIS_URL' };
  try {
    const { default: IORedis } = await import('ioredis');
    const c = new IORedis(REDIS_URL, { maxRetriesPerRequest: 1, lazyConnect: true });
    await c.connect();
    const state = await c.get('omnivyra:cron:last_run_state');
    const lock = await c.get('omnivyra:cron:lock');
    await c.quit();
    const parsed = state ? JSON.parse(state) : {};
    const last = parsed.socialAccountTokenRefresh ?? null;
    const ageMin = last ? Math.round((Date.now() - last) / 60000) : null;
    return {
      cron_lock_held_by: lock ?? '(none)',
      socialAccountTokenRefresh_last_run: last ? new Date(last).toISOString() : '(never)',
      age_minutes: ageMin,
      ALERT: last == null || (Date.now() - last) > CRON_STALE_MS
        ? 'SCHEDULER_UNREACHABLE — token refresh not running on cadence'
        : 'ok',
    };
  } catch (e) {
    return { error: e.message };
  }
}

async function staleTokenAudit() {
  const rows = await j('/rest/v1/social_accounts?select=id,platform,is_active,token_expires_at,refresh_token,access_token,connection_state');
  if (rows.__err || !Array.isArray(rows)) return { error: rows.__err || 'unexpected' };
  const now = Date.now();
  const out = [];
  for (const r of rows) {
    const exp = r.token_expires_at ? new Date(r.token_expires_at).getTime() : 0;
    const expired = exp ? exp <= now : null;
    const near = exp ? exp > now && exp - now < NEAR_EXPIRY_MS : false;
    if (expired || near) {
      out.push({
        platform: r.platform,
        id: String(r.id).slice(0, 8),
        is_active: r.is_active,
        state: expired ? 'EXPIRED' : 'NEAR_EXPIRY',
        minutes: exp ? Math.round((exp - now) / 60000) : null,
        recoverable: !!r.refresh_token,         // refresh_token present → self-heals
        connection_state: r.connection_state ?? null,
      });
    }
  }
  return { total_social_accounts: rows.length, stale_or_near: out.length, accounts: out };
}

async function orphanedLocks() {
  const rows = await j('/rest/v1/token_refresh_locks?select=lock_key,acquired_at,acquired_by');
  if (rows.__err || !Array.isArray(rows)) return { note: rows.__err || 'table absent/empty' };
  const now = Date.now();
  const stale = rows
    .filter((r) => now - new Date(r.acquired_at).getTime() > LOCK_TTL_MS)
    .map((r) => ({
      lock_key: r.lock_key,
      held_by: r.acquired_by ?? '(null)',
      age_seconds: Math.round((now - new Date(r.acquired_at).getTime()) / 1000),
    }));
  return {
    total_locks: rows.length,
    stale_locks: stale.length,
    note: 'stale locks auto-expire via guarded takeover; listed for visibility only',
    locks: stale,
  };
}

async function lifecycleReport() {
  const rows = await j('/rest/v1/social_accounts?select=platform,connection_state');
  if (rows.__err || !Array.isArray(rows)) return { error: rows.__err || 'unexpected' };
  const byState = {};
  for (const r of rows) {
    const k = `${r.platform}:${r.connection_state ?? 'null'}`;
    byState[k] = (byState[k] || 0) + 1;
  }
  return byState;
}

const report = {
  generated_at: new Date().toISOString(),
  mode: 'READ-ONLY',
  scheduler_heartbeat: await schedulerHeartbeat(),
  stale_token_audit: await staleTokenAudit(),
  orphaned_refresh_locks: await orphanedLocks(),
  lifecycle_report: await lifecycleReport(),
};
console.log(JSON.stringify(report, null, 2));
