/**
 * Enterprise Governance — Redis-backed distributed persistence (Phase 6).
 *
 * Mirrors review records + escalations into the existing standalone Redis
 * topology so workflow state survives process restarts and is visible
 * across multiple instances. Process-local in-memory stores remain
 * authoritative for hot reads (they always exist); Redis is the
 * cross-instance source-of-truth and the warm-start source on restart.
 *
 * Design constraints:
 *   - Reuses `getInstrumentedStandaloneRedisClient` — no new connection,
 *     no new topology, no schema migrations.
 *   - All writes are best-effort with try/catch and bounded payloads.
 *     A Redis outage NEVER blocks creator-runtime flow.
 *   - All keys are namespaced under `creator:gov:` and TTL-capped.
 *   - Lazy client init — Redis is touched only when this module is
 *     imported AND the feature flag is on.
 *
 * Feature flag: ENTERPRISE_GOVERNANCE_REDIS_ENABLED=true
 */

import type IORedis from 'ioredis';

const KEY_PREFIX = 'creator:gov:';
const REVIEW_KEY = (assetId: string) => `${KEY_PREFIX}review:${assetId.trim().toLowerCase()}`;
const ESCALATION_KEY = (escalationId: string) => `${KEY_PREFIX}esc:${escalationId.trim().toLowerCase()}`;
const COMPANY_REVIEW_INDEX = (companyId: string) => `${KEY_PREFIX}company:${companyId.trim().toLowerCase()}:reviews`;
const COMPANY_ESC_INDEX = (companyId: string) => `${KEY_PREFIX}company:${companyId.trim().toLowerCase()}:escalations`;
const EVENT_STREAM_KEY = (companyId: string) => `${KEY_PREFIX}company:${companyId.trim().toLowerCase()}:events`;

// Phase 10 — TTL + bounded growth
const REVIEW_TTL_S = 90 * 24 * 60 * 60;        // 90 days; mirrors in-memory record TTL
const ESCALATION_TTL_S = 60 * 24 * 60 * 60;    // 60 days
const EVENT_STREAM_MAXLEN = 1000;              // bounded per-company event ring buffer
const COMPANY_INDEX_MAX = 500;                 // recent N records per company

let _client: IORedis | null = null;
let _disabled = false;
let _consecutiveFailures = 0;
const FAILURE_DISABLE_THRESHOLD = 3;

function isEnabled(): boolean {
  return String(process.env.ENTERPRISE_GOVERNANCE_REDIS_ENABLED ?? 'false').toLowerCase() === 'true';
}

function getClient(): IORedis | null {
  if (_disabled) return null;
  if (!isEnabled()) return null;
  if (_client) return _client;
  try {
    const { getInstrumentedStandaloneRedisClient } =
      require('../../queue/standaloneRedisClient') as typeof import('../../queue/standaloneRedisClient');
    _client = getInstrumentedStandaloneRedisClient('creator-governance');
    return _client;
  } catch (error) {
    _consecutiveFailures += 1;
    if (_consecutiveFailures >= FAILURE_DISABLE_THRESHOLD) _disabled = true;
    console.warn('[creator-gov-redis][unavailable]', {
      message: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

function markFailure(): void {
  _consecutiveFailures += 1;
  if (_consecutiveFailures >= FAILURE_DISABLE_THRESHOLD) _disabled = true;
}

function markSuccess(): void {
  _consecutiveFailures = 0;
}

/** Mirror a review record into Redis. Best-effort. Never throws. */
export async function mirrorReviewRecord(record: {
  assetId: string;
  companyId: string;
  campaignId: string | null;
  currentState: string;
  updatedAt: string;
}): Promise<void> {
  const client = getClient();
  if (!client) return;
  try {
    const key = REVIEW_KEY(record.assetId);
    const idx = COMPANY_REVIEW_INDEX(record.companyId);
    const payload = JSON.stringify(record).slice(0, 16_384); // bounded payload
    await Promise.all([
      client.set(key, payload, 'EX', REVIEW_TTL_S),
      client.zadd(idx, Date.now(), record.assetId),
      client.zremrangebyrank(idx, 0, -1 - COMPANY_INDEX_MAX), // keep most-recent N
      client.expire(idx, REVIEW_TTL_S),
    ]);
    markSuccess();
  } catch (error) {
    markFailure();
    console.warn('[creator-gov-redis][mirror-review-failed]', {
      assetId: record.assetId,
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

/** Mirror an escalation into Redis. Best-effort. Never throws. */
export async function mirrorEscalation(esc: {
  escalationId: string;
  assetId: string;
  companyId: string;
  reason: string;
  escalationLevel: string;
  escalationPriority: string;
  createdAt: string;
}): Promise<void> {
  const client = getClient();
  if (!client) return;
  try {
    const key = ESCALATION_KEY(esc.escalationId);
    const idx = COMPANY_ESC_INDEX(esc.companyId);
    const payload = JSON.stringify(esc).slice(0, 8_192);
    await Promise.all([
      client.set(key, payload, 'EX', ESCALATION_TTL_S),
      client.zadd(idx, Date.now(), esc.escalationId),
      client.zremrangebyrank(idx, 0, -1 - COMPANY_INDEX_MAX),
      client.expire(idx, ESCALATION_TTL_S),
    ]);
    markSuccess();
  } catch (error) {
    markFailure();
    console.warn('[creator-gov-redis][mirror-escalation-failed]', {
      escalationId: esc.escalationId,
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Append a workflow event to the per-company bounded stream. Used by the
 * event-envelope module for cross-instance observability + dashboard
 * tailing. Returns silently on failure.
 */
export async function appendWorkflowEvent(companyId: string, event: Record<string, unknown>): Promise<void> {
  const client = getClient();
  if (!client) return;
  try {
    const key = EVENT_STREAM_KEY(companyId);
    // XADD with MAXLEN approximate trims old entries automatically — bounded by EVENT_STREAM_MAXLEN.
    await client.xadd(
      key,
      'MAXLEN', '~', String(EVENT_STREAM_MAXLEN),
      '*',
      'payload', JSON.stringify(event).slice(0, 4_096),
    );
    await client.expire(key, ESCALATION_TTL_S);
    markSuccess();
  } catch (error) {
    markFailure();
    // Stream failures are noisy under degraded Redis — keep this quiet.
  }
}

export async function readRecentWorkflowEvents(companyId: string, limit = 50): Promise<Array<Record<string, unknown>>> {
  const client = getClient();
  if (!client) return [];
  try {
    const key = EVENT_STREAM_KEY(companyId);
    const safeLimit = Math.max(1, Math.min(200, limit));
    // XREVRANGE returns most-recent first.
    const entries = await client.xrevrange(key, '+', '-', 'COUNT', String(safeLimit));
    markSuccess();
    return entries.map((entry) => {
      const [, fields] = entry as [string, string[]];
      const payloadIdx = fields.indexOf('payload');
      const raw = payloadIdx >= 0 ? fields[payloadIdx + 1] : null;
      try { return raw ? JSON.parse(raw) : {}; } catch { return {}; }
    });
  } catch (error) {
    markFailure();
    return [];
  }
}

/** Read mirrored review records for a company (most-recent N). Used by
 *  warm-start restoration on worker boot. Returns empty array when Redis
 *  is unavailable / disabled. */
export async function readMirroredReviewRecords(companyId: string, limit = 200): Promise<Array<Record<string, unknown>>> {
  const client = getClient();
  if (!client) return [];
  try {
    const idx = COMPANY_REVIEW_INDEX(companyId);
    const safeLimit = Math.max(1, Math.min(500, limit));
    // Get most-recent N asset IDs (highest scores first).
    const ids = await client.zrevrange(idx, 0, safeLimit - 1);
    if (!ids || ids.length === 0) { markSuccess(); return []; }
    // MGET the actual records.
    const keys = ids.map((id) => REVIEW_KEY(id));
    const payloads = await client.mget(...keys);
    markSuccess();
    const out: Array<Record<string, unknown>> = [];
    for (const raw of payloads) {
      if (!raw) continue;
      try { out.push(JSON.parse(raw)); } catch { /* skip malformed */ }
    }
    return out;
  } catch (error) {
    markFailure();
    return [];
  }
}

export async function readMirroredEscalationsForCompany(companyId: string, limit = 200): Promise<Array<Record<string, unknown>>> {
  const client = getClient();
  if (!client) return [];
  try {
    const idx = COMPANY_ESC_INDEX(companyId);
    const safeLimit = Math.max(1, Math.min(500, limit));
    const ids = await client.zrevrange(idx, 0, safeLimit - 1);
    if (!ids || ids.length === 0) { markSuccess(); return []; }
    const keys = ids.map((id) => ESCALATION_KEY(id));
    const payloads = await client.mget(...keys);
    markSuccess();
    const out: Array<Record<string, unknown>> = [];
    for (const raw of payloads) {
      if (!raw) continue;
      try { out.push(JSON.parse(raw)); } catch { /* skip malformed */ }
    }
    return out;
  } catch (error) {
    markFailure();
    return [];
  }
}

/** List known company IDs by scanning the per-company index keys.
 *  Bounded SCAN with COUNT 100 hint; capped at MAX_COMPANIES_PER_PASS. */
export async function listMirroredCompanies(limit = 50): Promise<string[]> {
  const client = getClient();
  if (!client) return [];
  try {
    const safeLimit = Math.max(1, Math.min(200, limit));
    const found = new Set<string>();
    let cursor = '0';
    let iterations = 0;
    do {
      const [next, keys] = await client.scan(cursor, 'MATCH', `${KEY_PREFIX}company:*:reviews`, 'COUNT', 100);
      cursor = String(next);
      for (const k of keys) {
        // Key shape: creator:gov:company:<id>:reviews
        const parts = k.split(':');
        if (parts.length >= 4) {
          const cid = parts.slice(3, parts.length - 1).join(':');
          if (cid) found.add(cid);
        }
        if (found.size >= safeLimit) break;
      }
      iterations += 1;
    } while (cursor !== '0' && iterations < 20 && found.size < safeLimit);
    markSuccess();
    return Array.from(found);
  } catch (error) {
    markFailure();
    return [];
  }
}

/** Diagnostics — used by dashboard/operational-diagnostics surfaces. */
export function persistenceDiagnostics(): {
  enabled: boolean;
  disabled: boolean;
  consecutiveFailures: number;
  failureDisableThreshold: number;
  reviewTtlSeconds: number;
  escalationTtlSeconds: number;
  eventStreamMaxLen: number;
} {
  return {
    enabled: isEnabled(),
    disabled: _disabled,
    consecutiveFailures: _consecutiveFailures,
    failureDisableThreshold: FAILURE_DISABLE_THRESHOLD,
    reviewTtlSeconds: REVIEW_TTL_S,
    escalationTtlSeconds: ESCALATION_TTL_S,
    eventStreamMaxLen: EVENT_STREAM_MAXLEN,
  };
}

/** Test-only — re-enable + reset failure counters. */
export function resetPersistenceForTests(): void {
  _disabled = false;
  _consecutiveFailures = 0;
  _client = null;
}
