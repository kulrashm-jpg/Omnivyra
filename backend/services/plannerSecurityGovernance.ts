/**
 * Planner security & governance.
 *
 * Five concerns in one module so the orchestrator can call a single entry
 * point at request preflight:
 *
 *   1. Org-level quotas       — caps planner runs per rolling window per org
 *   2. Abuse detection        — flags planner storms (N runs / second from
 *                                one org) and short-circuits with a structured
 *                                deny + audit entry
 *   3. Operator audit chain   — append-only Redis Stream `planner:operator:audit`
 *                                with HMAC-chained entries so any operator
 *                                action tampered with after-the-fact is
 *                                detectable on replay
 *   4. SSE auth hardening     — token verification helper for the SSE
 *                                endpoint with per-token connection caps
 *   5. Secret rotation tracking — record which API key version was used
 *                                  for a planner call so a post-rotation
 *                                  audit can show "X plans ran with key v3"
 *
 * Everything is OPT-IN behind env flags. Default behavior is unchanged —
 * the orchestrator's existing checks (admission control, cost governance,
 * planner budget, distributed semaphore) remain authoritative. This layer
 * adds DETECTION + RECORDS, not new rejection paths, EXCEPT for the
 * abuse-detection short-circuit which has its own kill-switch.
 */

import type IORedis from 'ioredis';
import { createHash, createHmac, randomBytes } from 'crypto';
import { logger } from './logger';
import { getRequestContext } from './requestContext';
import { counter } from './plannerTelemetry';

/* eslint-disable @typescript-eslint/no-explicit-any */

const QUOTA_KEY_PREFIX  = 'planner:quota:';
const STORM_KEY_PREFIX  = 'planner:storm:';
const AUDIT_STREAM      = 'planner:operator:audit';
const SSE_TOKEN_PREFIX  = 'planner:sse:token:';
const FAILURE_DISABLE_THRESHOLD = 5;

let _client: IORedis | null = null;
let _failureCount = 0;

function getRedisOrNull(): IORedis | null {
  if (_failureCount >= FAILURE_DISABLE_THRESHOLD) return null;
  if (_client) return _client;
  try {
    const { getInstrumentedStandaloneRedisClient } =
      require('../queue/standaloneRedisClient') as typeof import('../queue/standaloneRedisClient');
    _client = getInstrumentedStandaloneRedisClient('planner-security');
    return _client;
  } catch (err) {
    _failureCount = FAILURE_DISABLE_THRESHOLD;
    logger.warn('planner_security_redis_unavailable', { error: err instanceof Error ? err.message : String(err) });
    return null;
  }
}

/* ───────────────────────────────────────────────────────────────────────
 * 1. Org-level quotas
 * ────────────────────────────────────────────────────────────────────── */

const DEFAULT_QUOTA_WINDOW_MS = 24 * 60 * 60_000;
const DEFAULT_QUOTA_PER_ORG = 1_000; // plans / window

function quotaEnabled(): boolean {
  return String(process.env.PLANNER_QUOTA_ENABLED ?? 'false').toLowerCase() === 'true';
}

export interface QuotaCheckResult {
  allowed: boolean;
  usedInWindow: number;
  limit: number;
  windowMs: number;
  reason?: string;
}

/**
 * Check + record one planner-run against the org's quota. Returns
 * `{ allowed: false }` when the rolling-window count is at or above the
 * limit. Quota enabled by `PLANNER_QUOTA_ENABLED=true`. Per-org override
 * via `PLANNER_QUOTA_LIMIT_<orgId>`.
 *
 * Failures are fail-open — when Redis is unhealthy, the call ALLOWS the
 * planner run so a Redis outage doesn't black-hole the product.
 */
export async function checkOrgQuota(orgId: string): Promise<QuotaCheckResult> {
  const windowMs = Math.max(60_000, Number(process.env.PLANNER_QUOTA_WINDOW_MS ?? DEFAULT_QUOTA_WINDOW_MS));
  const limit = Number(process.env[`PLANNER_QUOTA_LIMIT_${orgId}`] ?? process.env.PLANNER_QUOTA_LIMIT_DEFAULT ?? DEFAULT_QUOTA_PER_ORG);
  if (!quotaEnabled()) return { allowed: true, usedInWindow: 0, limit, windowMs, reason: 'quota_disabled' };
  if (!orgId) return { allowed: true, usedInWindow: 0, limit, windowMs, reason: 'no_org_id' };

  const client = getRedisOrNull();
  if (!client) return { allowed: true, usedInWindow: 0, limit, windowMs, reason: 'redis_unhealthy_fail_open' };

  const key = `${QUOTA_KEY_PREFIX}${orgId}`;
  const now = Date.now();
  try {
    // Sliding window via ZSET: trim old, add current, count.
    const member = `${now}:${randomBytes(4).toString('hex')}`;
    const pipeline = client.multi();
    pipeline.zremrangebyscore(key, '-inf', now - windowMs);
    pipeline.zadd(key, now, member);
    pipeline.zcard(key);
    pipeline.pexpire(key, windowMs * 2);
    const res = await pipeline.exec();
    const used = Number(((res?.[2] as [Error | null, unknown])?.[1]) ?? 0);
    if (used > limit) {
      counter('planner_overload_transitions', 1, { from: 'normal', to: 'quota_exceeded' });
      logger.warn('planner_org_quota_exceeded', {
        request_id: getRequestContext().requestId,
        org_id: orgId, used_in_window: used, limit, window_ms: windowMs,
      });
      return { allowed: false, usedInWindow: used, limit, windowMs, reason: 'quota_exceeded' };
    }
    return { allowed: true, usedInWindow: used, limit, windowMs };
  } catch (err) {
    _failureCount += 1;
    logger.warn('planner_org_quota_check_failed', {
      org_id: orgId, error: err instanceof Error ? err.message : String(err),
    });
    return { allowed: true, usedInWindow: 0, limit, windowMs, reason: 'redis_error_fail_open' };
  }
}

/* ───────────────────────────────────────────────────────────────────────
 * 2. Abuse / planner-storm detection
 * ────────────────────────────────────────────────────────────────────── */

const STORM_WINDOW_MS = 60_000;
const STORM_THRESHOLD = 20; // > N plans per minute from one org = storm

function abuseDetectionEnabled(): boolean {
  return String(process.env.PLANNER_ABUSE_DETECTION_ENABLED ?? 'false').toLowerCase() === 'true';
}

export interface StormCheckResult {
  storming: boolean;
  recent: number;
  threshold: number;
}

/**
 * Track planner attempts per-org over a 1-min window. When `recent >
 * threshold` returns `storming: true`. Caller decides what to do — the
 * orchestrator typically translates this into an admission-control reject
 * with a structured reason.
 */
export async function checkPlannerStorm(orgId: string): Promise<StormCheckResult> {
  if (!abuseDetectionEnabled() || !orgId) return { storming: false, recent: 0, threshold: STORM_THRESHOLD };
  const client = getRedisOrNull();
  if (!client) return { storming: false, recent: 0, threshold: STORM_THRESHOLD };
  const key = `${STORM_KEY_PREFIX}${orgId}`;
  const now = Date.now();
  try {
    const pipeline = client.multi();
    pipeline.zremrangebyscore(key, '-inf', now - STORM_WINDOW_MS);
    pipeline.zadd(key, now, `${now}:${randomBytes(3).toString('hex')}`);
    pipeline.zcard(key);
    pipeline.pexpire(key, STORM_WINDOW_MS * 2);
    const res = await pipeline.exec();
    const recent = Number(((res?.[2] as [Error | null, unknown])?.[1]) ?? 0);
    const storming = recent > STORM_THRESHOLD;
    if (storming) {
      logger.warn('planner_storm_detected', {
        request_id: getRequestContext().requestId,
        org_id: orgId, recent, threshold: STORM_THRESHOLD,
      });
    }
    return { storming, recent, threshold: STORM_THRESHOLD };
  } catch {
    return { storming: false, recent: 0, threshold: STORM_THRESHOLD };
  }
}

/* ───────────────────────────────────────────────────────────────────────
 * 3. Immutable operator audit chain
 *
 * Every operator action (rollout, force-mode, feature-rule) appends one
 * entry to `planner:operator:audit` with a SHA256 HMAC over
 *   prev_hmac || action_payload
 * using a secret from `PLANNER_AUDIT_HMAC_KEY`. A periodic verifier walks
 * the chain; any entry whose HMAC doesn't match its predecessor's
 * indicates tampering OR a stream-truncation event.
 * ────────────────────────────────────────────────────────────────────── */

const AUDIT_MAXLEN = 5000;

function auditHmacKey(): string | null {
  return process.env.PLANNER_AUDIT_HMAC_KEY || null;
}

export interface OperatorAuditEntry {
  ts: number;
  operator_id: string;
  action: string;
  details: Record<string, unknown>;
  request_id?: string;
}

/**
 * Append an HMAC-chained audit entry. When `PLANNER_AUDIT_HMAC_KEY` is
 * absent, falls back to plain unchained entries (still useful for audit
 * but without tamper detection).
 */
export async function recordOperatorAudit(entry: OperatorAuditEntry): Promise<void> {
  const client = getRedisOrNull();
  if (!client) return;
  try {
    let prevHmac = '';
    const key = auditHmacKey();
    if (key) {
      // Read the most-recent entry's hmac to chain.
      const last = (await client.xrevrange(AUDIT_STREAM, '+', '-', 'COUNT', '1')) as Array<[string, string[]]>;
      if (last.length > 0) {
        const fields = last[0][1];
        for (let i = 0; i + 1 < fields.length; i += 2) {
          if (fields[i] === 'hmac') prevHmac = fields[i + 1];
        }
      }
      const payload = JSON.stringify(entry);
      const hmac = createHmac('sha256', key).update(prevHmac + payload).digest('hex');
      await client.xadd(
        AUDIT_STREAM,
        'MAXLEN', '~', String(AUDIT_MAXLEN),
        '*',
        'ts', String(entry.ts),
        'operator_id', entry.operator_id,
        'action', entry.action,
        'details', JSON.stringify(entry.details),
        'request_id', entry.request_id ?? '',
        'prev_hmac', prevHmac,
        'hmac', hmac,
      );
    } else {
      await client.xadd(
        AUDIT_STREAM,
        'MAXLEN', '~', String(AUDIT_MAXLEN),
        '*',
        'ts', String(entry.ts),
        'operator_id', entry.operator_id,
        'action', entry.action,
        'details', JSON.stringify(entry.details),
        'request_id', entry.request_id ?? '',
      );
    }
  } catch (err) {
    logger.warn('planner_operator_audit_record_failed', {
      action: entry.action, error: err instanceof Error ? err.message : String(err),
    });
  }
}

export interface AuditVerificationResult {
  total: number;
  verified: number;
  invalid: Array<{ entry_id: string; ts: number; reason: string }>;
  chained: boolean; // false when HMAC key isn't configured
}

/**
 * Verify the audit chain. Walks oldest → newest and confirms each entry's
 * HMAC matches `HMAC(prev_hmac || payload, key)`. Tampering OR
 * stream-truncation (MAXLEN trimming the oldest entries) appears as
 * `invalid[0]` with a chain-break reason.
 */
export async function verifyOperatorAuditChain(limit: number = 1000): Promise<AuditVerificationResult> {
  const client = getRedisOrNull();
  const key = auditHmacKey();
  if (!client) return { total: 0, verified: 0, invalid: [], chained: !!key };
  if (!key) {
    const entries = (await client.xrange(AUDIT_STREAM, '-', '+', 'COUNT', limit)) as Array<[string, string[]]>;
    return { total: entries.length, verified: entries.length, invalid: [], chained: false };
  }
  const entries = (await client.xrange(AUDIT_STREAM, '-', '+', 'COUNT', limit)) as Array<[string, string[]]>;
  const invalid: AuditVerificationResult['invalid'] = [];
  let prevHmac = '';
  let verified = 0;
  for (const [entryId, fields] of entries) {
    const f: Record<string, string> = {};
    for (let i = 0; i + 1 < fields.length; i += 2) f[fields[i]] = fields[i + 1];
    const payload = JSON.stringify({
      ts: Number(f.ts),
      operator_id: f.operator_id,
      action: f.action,
      details: JSON.parse(f.details || '{}'),
      request_id: f.request_id || undefined,
    });
    const expected = createHmac('sha256', key).update((f.prev_hmac ?? '') + payload).digest('hex');
    if ((f.prev_hmac ?? '') !== prevHmac) {
      invalid.push({ entry_id: entryId, ts: Number(f.ts), reason: 'chain_break_prev_hmac_mismatch' });
    } else if (f.hmac !== expected) {
      invalid.push({ entry_id: entryId, ts: Number(f.ts), reason: 'hmac_mismatch' });
    } else {
      verified += 1;
    }
    prevHmac = f.hmac ?? '';
  }
  return { total: entries.length, verified, invalid, chained: true };
}

/* ───────────────────────────────────────────────────────────────────────
 * 4. SSE auth hardening
 *
 * Issuing short-lived bearer tokens for SSE connections. The token is
 * minted by an API endpoint (capability-checked) and verified by the SSE
 * endpoint. Per-token connection cap enforced via INCR/EXPIRE so a single
 * leaked token can't fan out to thousands of connections.
 * ────────────────────────────────────────────────────────────────────── */

const SSE_TOKEN_TTL_MS = 5 * 60_000;
const SSE_TOKEN_CONN_CAP = 10;

export async function mintSseToken(opts: { orgId: string; campaignId: string; operatorId: string }): Promise<{ token: string; expiresAt: number } | null> {
  const client = getRedisOrNull();
  if (!client) return null;
  const token = randomBytes(24).toString('base64url');
  const expiresAt = Date.now() + SSE_TOKEN_TTL_MS;
  try {
    await client.set(`${SSE_TOKEN_PREFIX}${token}`, JSON.stringify({
      org_id: opts.orgId,
      campaign_id: opts.campaignId,
      operator_id: opts.operatorId,
      issued_at: Date.now(),
      expires_at: expiresAt,
      connections: 0,
    }), 'PX', SSE_TOKEN_TTL_MS);
    return { token, expiresAt };
  } catch {
    return null;
  }
}

export interface SseTokenVerification {
  valid: boolean;
  reason?: string;
  orgId?: string;
  campaignId?: string;
}

/**
 * Verify an SSE bearer token. ATOMICALLY increments the connection count
 * and rejects if > SSE_TOKEN_CONN_CAP. The token's TTL caps cumulative
 * usage to 5 min.
 */
export async function verifySseToken(token: string): Promise<SseTokenVerification> {
  const client = getRedisOrNull();
  if (!client) return { valid: false, reason: 'redis_unavailable' };
  try {
    const key = `${SSE_TOKEN_PREFIX}${token}`;
    const raw = await client.get(key);
    if (!raw) return { valid: false, reason: 'unknown_token' };
    const parsed = JSON.parse(raw) as { org_id: string; campaign_id: string; expires_at: number; connections?: number };
    if (parsed.expires_at < Date.now()) return { valid: false, reason: 'expired_token' };
    const n = await client.hincrby(`${key}:counts`, 'used', 1);
    await client.pexpire(`${key}:counts`, SSE_TOKEN_TTL_MS);
    if (n > SSE_TOKEN_CONN_CAP) {
      return { valid: false, reason: 'connection_cap_exceeded' };
    }
    return { valid: true, orgId: parsed.org_id, campaignId: parsed.campaign_id };
  } catch (err) {
    return { valid: false, reason: 'verify_failed' };
  }
}

/* ───────────────────────────────────────────────────────────────────────
 * 5. Secret rotation tracking
 *
 * Records which API-key version was used for a given planner run so a
 * post-rotation audit can answer "how many plans ran with the old key
 * before we rotated?". Stored as a simple counter per (provider,
 * key_fingerprint) pair in a 7-day rolling window.
 * ────────────────────────────────────────────────────────────────────── */

const KEY_USAGE_PREFIX = 'planner:key_usage:';
const KEY_USAGE_WINDOW_MS = 7 * 24 * 60 * 60_000;

function fingerprintKey(apiKey: string): string {
  // First 8 hex chars of SHA256. Just enough to disambiguate rotations
  // without exposing the key itself.
  return createHash('sha256').update(apiKey).digest('hex').slice(0, 8);
}

export async function recordKeyUsage(provider: string, apiKey: string): Promise<void> {
  if (!apiKey) return;
  const client = getRedisOrNull();
  if (!client) return;
  try {
    const fp = fingerprintKey(apiKey);
    const key = `${KEY_USAGE_PREFIX}${provider}:${fp}`;
    await client.incr(key);
    await client.pexpire(key, KEY_USAGE_WINDOW_MS);
  } catch {
    /* best-effort */
  }
}

export interface KeyUsageSnapshot {
  provider: string;
  fingerprints: Array<{ fingerprint: string; count: number }>;
}

export async function getKeyUsageSnapshot(provider: string): Promise<KeyUsageSnapshot | null> {
  const client = getRedisOrNull();
  if (!client) return null;
  try {
    const pattern = `${KEY_USAGE_PREFIX}${provider}:*`;
    const keys = await client.keys(pattern);
    const out: KeyUsageSnapshot['fingerprints'] = [];
    for (const k of keys) {
      const fp = k.slice(`${KEY_USAGE_PREFIX}${provider}:`.length);
      const count = Number(await client.get(k)) || 0;
      out.push({ fingerprint: fp, count });
    }
    return { provider, fingerprints: out.sort((a, b) => b.count - a.count) };
  } catch {
    return null;
  }
}
