/**
 * Enterprise Governance — Distributed locks + idempotency (Phase 7).
 *
 * Protects review-record establishment, escalation issuance, and approval
 * transitions from duplicate processing when the orchestrator is running
 * across multiple instances or a job retries after partial failure.
 *
 * Two primitives:
 *   1. `withIdempotency(key, fn)` — runs `fn` only if `key` has not been
 *      seen in the configured window; otherwise returns the cached
 *      outcome marker. Keys are namespaced and TTL-capped.
 *   2. `withDistributedLock(key, fn)` — acquires a short-lived Redis
 *      lock, runs `fn`, releases. Lock TTL caps the blast radius if the
 *      worker crashes.
 *
 * Both gracefully fall back to in-process Maps when Redis is unavailable
 * (single-instance mode behaves correctly; multi-instance loses the
 * cross-instance guarantee but never deadlocks).
 *
 * Bounded:
 *   - In-process idempotency cache: 5_000 entries, FIFO eviction.
 *   - Local locks: held only for the duration of the wrapped fn.
 */

import type IORedis from 'ioredis';
import { randomUUID } from 'crypto';

const KEY_PREFIX = 'creator:gov:';
const IDEMPOTENCY_KEY = (k: string) => `${KEY_PREFIX}idem:${k}`;
const LOCK_KEY = (k: string) => `${KEY_PREFIX}lock:${k}`;

const DEFAULT_IDEMPOTENCY_TTL_S = 60 * 60;      // 1 hour — covers retry windows
const DEFAULT_LOCK_TTL_MS = 30_000;             // 30 seconds
const LOCAL_IDEMPOTENCY_MAX = 5_000;

const localIdempotency = new Map<string, number>(); // key → expiresAt
const localLocks = new Map<string, number>();       // key → expiresAt

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
    _client = getInstrumentedStandaloneRedisClient('creator-gov-lock');
    return _client;
  } catch {
    _consecutiveFailures += 1;
    if (_consecutiveFailures >= FAILURE_DISABLE_THRESHOLD) _disabled = true;
    return null;
  }
}

function markFailure(): void {
  _consecutiveFailures += 1;
  if (_consecutiveFailures >= FAILURE_DISABLE_THRESHOLD) _disabled = true;
}

function markSuccess(): void { _consecutiveFailures = 0; }

function pruneLocalIdempotency(): void {
  if (localIdempotency.size <= LOCAL_IDEMPOTENCY_MAX) return;
  const now = Date.now();
  for (const [k, exp] of localIdempotency) {
    if (exp < now) localIdempotency.delete(k);
    if (localIdempotency.size <= LOCAL_IDEMPOTENCY_MAX) return;
  }
  if (localIdempotency.size > LOCAL_IDEMPOTENCY_MAX) {
    const firstKey = localIdempotency.keys().next().value;
    if (firstKey) localIdempotency.delete(firstKey);
  }
}

/**
 * Run `fn` at most once per `key` within `ttlSeconds`. Returns:
 *   - `{ ran: true, result: fn() }` on the first run
 *   - `{ ran: false }` on duplicate calls within the window.
 *
 * Multi-instance: Redis-backed, atomic via SET NX EX.
 * Single-instance / Redis-down: local Map fallback.
 */
export async function withIdempotency<T>(
  key: string,
  fn: () => Promise<T>,
  ttlSeconds: number = DEFAULT_IDEMPOTENCY_TTL_S,
): Promise<{ ran: boolean; result?: T }> {
  const fullKey = IDEMPOTENCY_KEY(key);
  const client = getClient();

  if (client) {
    try {
      const ok = await client.set(fullKey, '1', 'EX', ttlSeconds, 'NX');
      markSuccess();
      if (ok !== 'OK') return { ran: false };
      const result = await fn();
      return { ran: true, result };
    } catch (error) {
      markFailure();
      console.warn('[creator-gov-lock][idempotency-redis-failed]', {
        key, message: error instanceof Error ? error.message : String(error),
      });
      // fall through to local
    }
  }

  // Local fallback
  pruneLocalIdempotency();
  const now = Date.now();
  const expiresAt = localIdempotency.get(fullKey);
  if (expiresAt && expiresAt > now) return { ran: false };
  localIdempotency.set(fullKey, now + ttlSeconds * 1000);
  const result = await fn();
  return { ran: true, result };
}

/**
 * Acquire a distributed lock for `key`, run `fn`, release. On lock
 * contention, throws `LockBusyError` IMMEDIATELY (no waiting) so callers
 * can decide whether to retry, fail open, or skip. This prevents thread
 * stacking under storms.
 *
 * Lock holds for `ttlMs` even if the worker crashes, capping blast radius.
 */
export class LockBusyError extends Error {
  constructor(key: string) {
    super(`Lock busy for key ${key}`);
    this.name = 'LockBusyError';
  }
}

export async function withDistributedLock<T>(
  key: string,
  fn: () => Promise<T>,
  ttlMs: number = DEFAULT_LOCK_TTL_MS,
): Promise<T> {
  const fullKey = LOCK_KEY(key);
  const client = getClient();
  const token = randomUUID();

  if (client) {
    try {
      const ok = await client.set(fullKey, token, 'PX', ttlMs, 'NX');
      markSuccess();
      if (ok !== 'OK') throw new LockBusyError(key);
      try {
        return await fn();
      } finally {
        try {
          // Release only if we still own it (compare-and-delete via Lua).
          await client.eval(
            `if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) else return 0 end`,
            1, fullKey, token,
          );
        } catch {
          // Lock will expire naturally; ignore.
        }
      }
    } catch (error) {
      if (error instanceof LockBusyError) throw error;
      markFailure();
      // fall through to local
    }
  }

  // Local fallback — process-local mutual exclusion only
  const now = Date.now();
  const existing = localLocks.get(fullKey);
  if (existing && existing > now) throw new LockBusyError(key);
  localLocks.set(fullKey, now + ttlMs);
  try {
    return await fn();
  } finally {
    localLocks.delete(fullKey);
  }
}

export function lockingDiagnostics(): {
  enabled: boolean;
  disabled: boolean;
  consecutiveFailures: number;
  localIdempotencySize: number;
  localIdempotencyMax: number;
  localLocksSize: number;
  defaultIdempotencyTtlSeconds: number;
  defaultLockTtlMs: number;
} {
  return {
    enabled: isEnabled(),
    disabled: _disabled,
    consecutiveFailures: _consecutiveFailures,
    localIdempotencySize: localIdempotency.size,
    localIdempotencyMax: LOCAL_IDEMPOTENCY_MAX,
    localLocksSize: localLocks.size,
    defaultIdempotencyTtlSeconds: DEFAULT_IDEMPOTENCY_TTL_S,
    defaultLockTtlMs: DEFAULT_LOCK_TTL_MS,
  };
}

export function resetLockingForTests(): void {
  _disabled = false;
  _consecutiveFailures = 0;
  _client = null;
  localIdempotency.clear();
  localLocks.clear();
}
