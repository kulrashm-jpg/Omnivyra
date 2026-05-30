/**
 * Variant Diagnostics — Redis-backed persistence (Final Corrective Pass — P2-5).
 *
 * Mirrors the in-memory recorder + tracker state into the existing
 * standalone Redis topology so diagnostic surfaces stay consistent
 * across replicas. Process-local in-memory stores remain authoritative
 * for hot reads (they always exist); Redis is the cross-instance
 * source-of-truth and the warm-start source on restart.
 *
 * STRICT scope:
 *   - DIAGNOSTICS ONLY. Generation pipelines, analytics contracts,
 *     and tracker public APIs are untouched.
 *   - Best-effort writes — failures NEVER block the runtime path.
 *   - Bounded payloads + TTLs match the governance precedent.
 *
 * Feature flag: VARIANT_DIAGNOSTICS_REDIS_ENABLED=true
 */

import type IORedis from 'ioredis';
import type { StrategyAnalyticsEvent } from './strategyAnalyticsRecorder';
import type { ExperimentRecord } from './variantExperimentTracker';

const KEY_PREFIX = 'creator:variant-diag:';
const EVENT_STREAM_KEY = (companyId: string) =>
  `${KEY_PREFIX}company:${companyId.trim().toLowerCase()}:events`;
const EXPERIMENT_KEY = (experimentId: string) =>
  `${KEY_PREFIX}exp:${experimentId.trim().toLowerCase()}`;
const COMPANY_EXPERIMENT_INDEX = (companyId: string) =>
  `${KEY_PREFIX}company:${companyId.trim().toLowerCase()}:experiments`;

// TTL + bounds — match governance precedent so storage growth is bounded.
const EVENT_STREAM_MAXLEN = 2000;
const EXPERIMENT_TTL_S = 90 * 24 * 60 * 60; // 90 days
const COMPANY_INDEX_MAX = 500;

let _client: IORedis | null = null;
let _disabled = false;
let _consecutiveFailures = 0;
const FAILURE_DISABLE_THRESHOLD = 3;

function isEnabled(): boolean {
  return String(process.env.VARIANT_DIAGNOSTICS_REDIS_ENABLED ?? 'false').toLowerCase() === 'true';
}

function getClient(): IORedis | null {
  if (_disabled) return null;
  if (!isEnabled()) return null;
  if (_client) return _client;
  try {
    const { getInstrumentedStandaloneRedisClient } =
      require('../../queue/standaloneRedisClient') as typeof import('../../queue/standaloneRedisClient');
    _client = getInstrumentedStandaloneRedisClient('variant-diagnostics');
    return _client;
  } catch (error) {
    _consecutiveFailures += 1;
    if (_consecutiveFailures >= FAILURE_DISABLE_THRESHOLD) _disabled = true;
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

/**
 * Mirror a strategy analytics event into the per-company bounded
 * stream. Best-effort — never throws, never blocks the recorder.
 */
export async function mirrorStrategyEvent(
  companyId: string,
  event: StrategyAnalyticsEvent,
): Promise<void> {
  const client = getClient();
  if (!client) return;
  try {
    const key = EVENT_STREAM_KEY(companyId);
    await client.xadd(
      key,
      'MAXLEN', '~', String(EVENT_STREAM_MAXLEN),
      '*',
      'payload', JSON.stringify(event).slice(0, 4_096),
    );
    await client.expire(key, EXPERIMENT_TTL_S);
    markSuccess();
  } catch {
    markFailure();
  }
}

/**
 * Mirror an experiment record (registration or transition) into Redis
 * so the experiment tracker remains visible across replicas. Best-
 * effort. Never throws.
 */
export async function mirrorExperimentRecord(record: ExperimentRecord): Promise<void> {
  const client = getClient();
  if (!client) return;
  try {
    const key = EXPERIMENT_KEY(record.experiment_id);
    const idx = COMPANY_EXPERIMENT_INDEX(record.company_id);
    const payload = JSON.stringify(record).slice(0, 16_384);
    await Promise.all([
      client.set(key, payload, 'EX', EXPERIMENT_TTL_S),
      client.zadd(idx, Date.now(), record.experiment_id),
      client.zremrangebyrank(idx, 0, -1 - COMPANY_INDEX_MAX),
      client.expire(idx, EXPERIMENT_TTL_S),
    ]);
    markSuccess();
  } catch {
    markFailure();
  }
}

/**
 * Read recent strategy events from Redis for a company. Used by
 * diagnostic surfaces to merge cross-replica state. Returns empty
 * array when disabled / unavailable.
 */
export async function readMirroredStrategyEvents(
  companyId: string,
  limit = 200,
): Promise<StrategyAnalyticsEvent[]> {
  const client = getClient();
  if (!client) return [];
  try {
    const key = EVENT_STREAM_KEY(companyId);
    const safeLimit = Math.max(1, Math.min(EVENT_STREAM_MAXLEN, limit));
    const entries = await client.xrevrange(key, '+', '-', 'COUNT', String(safeLimit));
    markSuccess();
    const out: StrategyAnalyticsEvent[] = [];
    for (const entry of entries) {
      const [, fields] = entry as [string, string[]];
      const idx = fields.indexOf('payload');
      const raw = idx >= 0 ? fields[idx + 1] : null;
      if (!raw) continue;
      try {
        out.push(JSON.parse(raw) as StrategyAnalyticsEvent);
      } catch {
        // skip malformed
      }
    }
    return out;
  } catch {
    markFailure();
    return [];
  }
}

/**
 * Read recent experiment records from Redis for a company. Used by
 * diagnostic surfaces to surface tracker state from replicas other
 * than the one currently serving the request.
 */
export async function readMirroredExperiments(
  companyId: string,
  limit = 200,
): Promise<ExperimentRecord[]> {
  const client = getClient();
  if (!client) return [];
  try {
    const idx = COMPANY_EXPERIMENT_INDEX(companyId);
    const safeLimit = Math.max(1, Math.min(500, limit));
    const ids = await client.zrevrange(idx, 0, safeLimit - 1);
    if (!ids || ids.length === 0) { markSuccess(); return []; }
    const keys = ids.map((id) => EXPERIMENT_KEY(id));
    const payloads = await client.mget(...keys);
    markSuccess();
    const out: ExperimentRecord[] = [];
    for (const raw of payloads) {
      if (!raw) continue;
      try {
        out.push(JSON.parse(raw) as ExperimentRecord);
      } catch {
        // skip malformed
      }
    }
    return out;
  } catch {
    markFailure();
    return [];
  }
}

/** Diagnostics surface — reports persistence status. */
export function variantDiagnosticsPersistenceStatus(): {
  enabled: boolean;
  disabled: boolean;
  consecutiveFailures: number;
  failureDisableThreshold: number;
  eventStreamMaxLen: number;
  experimentTtlSeconds: number;
} {
  return {
    enabled: isEnabled(),
    disabled: _disabled,
    consecutiveFailures: _consecutiveFailures,
    failureDisableThreshold: FAILURE_DISABLE_THRESHOLD,
    eventStreamMaxLen: EVENT_STREAM_MAXLEN,
    experimentTtlSeconds: EXPERIMENT_TTL_S,
  };
}

/** Test-only — re-enable + reset failure counters. */
export function resetVariantDiagnosticsPersistenceForTests(): void {
  _disabled = false;
  _consecutiveFailures = 0;
  _client = null;
}
