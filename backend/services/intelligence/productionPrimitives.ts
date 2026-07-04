// Production primitives shared across all real intelligence adapters.
//
// Every real-provider adapter (OpenAI, Anthropic, Ahrefs, etc.) wraps its
// HTTP calls in these primitives. The contract: a failing provider returns
// `state: 'unavailable'` with the actual reason — never a synthesized score.
//
// Rules (Phase 4 "no fake data"):
//  - rate-limit exceeded → unavailable, reason="rate_limited:<provider>"
//  - timeout            → unavailable, reason="timeout:<provider>"
//  - quota exceeded     → unavailable, reason="quota_exceeded:<provider>"
//  - auth error         → unavailable, reason="auth_failure:<provider>"
//  - 5xx after retries  → unavailable, reason="upstream_error:<provider>"

import type { EvidenceSourceKind } from '../canonicalReport/canonicalReportTypes';
import { authorizeProviderCall, recordProviderUsage, recordProviderOutcome } from '../providers/providerCostGovernor';

// ── Rate limiter (token bucket) ───────────────────────────────────────────────
//
// Per-provider rate limiting. Refill rate is tokens/sec. Acquire returns true
// when the call may proceed; false when over-budget — caller must surface
// `unavailable: rate_limited`.

export class TokenBucket {
  private tokens: number;
  constructor(
    private readonly capacity: number,
    private readonly refillPerSecond: number,
    private lastRefillMs: number = Date.now(),
  ) {
    this.tokens = capacity;
  }

  tryAcquire(cost: number = 1): boolean {
    const now = Date.now();
    const elapsedSec = (now - this.lastRefillMs) / 1000;
    if (elapsedSec > 0) {
      this.tokens = Math.min(this.capacity, this.tokens + elapsedSec * this.refillPerSecond);
      this.lastRefillMs = now;
    }
    if (this.tokens >= cost) {
      this.tokens -= cost;
      return true;
    }
    return false;
  }

  available(): number {
    return Math.floor(this.tokens);
  }
}

const rateLimiters = new Map<string, TokenBucket>();

export function getRateLimiter(providerId: string, capacity: number, refillPerSecond: number): TokenBucket {
  const key = `${providerId}:${capacity}:${refillPerSecond}`;
  const existing = rateLimiters.get(key);
  if (existing) return existing;
  const next = new TokenBucket(capacity, refillPerSecond);
  rateLimiters.set(key, next);
  return next;
}

// ── Timeout wrapper ───────────────────────────────────────────────────────────

export class TimeoutError extends Error {
  constructor(public readonly providerId: string, public readonly timeoutMs: number) {
    super(`timeout:${providerId} after ${timeoutMs}ms`);
    this.name = 'TimeoutError';
  }
}

export async function withTimeout<T>(
  providerId: string,
  timeoutMs: number,
  fn: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fn(controller.signal);
  } catch (error) {
    if ((error as { name?: string }).name === 'AbortError') {
      throw new TimeoutError(providerId, timeoutMs);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

// ── Retry with exponential backoff ────────────────────────────────────────────
//
// Idempotent operations only. Each retry doubles the delay (cap at 8s). 5xx and
// network errors retry; 4xx (auth/quota) does NOT retry — that's a hard fail.

export type RetryOptions = {
  maxAttempts: number;
  initialDelayMs: number;
  maxDelayMs: number;
};

const DEFAULT_RETRY: RetryOptions = {
  maxAttempts: 3,
  initialDelayMs: 400,
  maxDelayMs: 8000,
};

export class HardFailureError extends Error {
  constructor(
    public readonly providerId: string,
    public readonly reason:
      | 'auth_failure'
      | 'quota_exceeded'
      | 'rate_limited'
      | 'invalid_request'
      | 'upstream_error'
      | 'governor_blocked',
    message: string,
  ) {
    super(`${reason}:${providerId} ${message}`);
    this.name = 'HardFailureError';
  }
}

export async function withRetry<T>(
  providerId: string,
  fn: () => Promise<T>,
  options: RetryOptions = DEFAULT_RETRY,
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= options.maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      // Don't retry hard failures (auth / quota / 4xx).
      if (error instanceof HardFailureError) {
        if (error.reason === 'auth_failure' || error.reason === 'quota_exceeded' || error.reason === 'invalid_request') {
          throw error;
        }
      }
      // Don't retry timeouts on the last attempt.
      if (attempt === options.maxAttempts) break;
      const delay = Math.min(options.initialDelayMs * Math.pow(2, attempt - 1), options.maxDelayMs);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
  throw lastError;
}

// ── Cache with TTL + freshness tracking ───────────────────────────────────────
//
// Production cache: keyed lookup, TTL eviction, freshness exposed for the
// caller to attach to the EvidenceTrace.

export type CacheEntry<T> = {
  value: T;
  cached_at: string;
  expires_at: string;
};

export class TtlCache<T> {
  private store = new Map<string, CacheEntry<T>>();

  constructor(public readonly ttlSeconds: number) {}

  get(key: string): CacheEntry<T> | null {
    const entry = this.store.get(key);
    if (!entry) return null;
    if (new Date(entry.expires_at).getTime() < Date.now()) {
      this.store.delete(key);
      return null;
    }
    return entry;
  }

  set(key: string, value: T): CacheEntry<T> {
    const now = Date.now();
    const entry: CacheEntry<T> = {
      value,
      cached_at: new Date(now).toISOString(),
      expires_at: new Date(now + this.ttlSeconds * 1000).toISOString(),
    };
    this.store.set(key, entry);
    return entry;
  }

  size(): number {
    return this.store.size;
  }

  clear(): void {
    this.store.clear();
  }
}

// ── HTTP helper with timeout + structured error mapping ───────────────────────

export type FetchEnvelope = {
  ok: boolean;
  status: number;
  text: string;
  json: () => Promise<unknown>;
};

export async function fetchProduction(
  providerId: string,
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<FetchEnvelope> {
  // Canonical cost governor — the single no-bypass gate for every provider HTTP
  // call routed through this primitive. Kill-switch / dry-run / over-budget →
  // block before the paid request fires (surfaced as an unavailable reason).
  const decision = authorizeProviderCall({ providerId });
  if (!decision.allowed) {
    throw new HardFailureError(providerId, 'governor_blocked', decision.reason);
  }
  try {
    const envelope = await withTimeout(providerId, timeoutMs, async (signal) => {
    const response = await fetch(url, { ...init, signal });
    const text = await response.text();
    // Usage accounting (fire-and-forget; never blocks the response).
    void recordProviderUsage({ providerId, units: 1, operation: 'http' });
    if (response.status === 401 || response.status === 403) {
      throw new HardFailureError(providerId, 'auth_failure', `HTTP ${response.status}`);
    }
    if (response.status === 429) {
      throw new HardFailureError(providerId, 'rate_limited', 'HTTP 429 from upstream');
    }
    if (response.status === 402) {
      throw new HardFailureError(providerId, 'quota_exceeded', 'HTTP 402 quota exceeded');
    }
    if (response.status >= 500) {
      throw new HardFailureError(providerId, 'upstream_error', `HTTP ${response.status}`);
    }
    if (response.status >= 400) {
      throw new HardFailureError(providerId, 'invalid_request', `HTTP ${response.status}: ${text.slice(0, 200)}`);
    }
    return {
      ok: response.ok,
      status: response.status,
      text,
      json: async () => {
        try {
          return JSON.parse(text);
        } catch {
          throw new HardFailureError(providerId, 'invalid_request', 'response was not valid JSON');
        }
      },
    };
    });
    // Canonical outcome tracking (last success) for provider health.
    recordProviderOutcome(providerId, true);
    return envelope;
  } catch (err) {
    // Canonical outcome tracking (last failure) — record then rethrow unchanged.
    recordProviderOutcome(providerId, false, reasonFromError(providerId, err));
    throw err;
  }
}

// ── Failure → unavailable reason mapping ──────────────────────────────────────

export function reasonFromError(providerId: string, error: unknown): string {
  if (error instanceof TimeoutError) return `timeout:${providerId}`;
  if (error instanceof HardFailureError) return `${error.reason}:${providerId}`;
  if (error instanceof Error) return `error:${providerId}: ${error.message}`;
  return `error:${providerId}: unknown`;
}

// ── Evidence logger ───────────────────────────────────────────────────────────
//
// Writes a single structured log line per provider call. Replace `console.info`
// with the project's logger when one is wired; for now we use console so the
// audit trail exists in the runtime log.

export function logProviderCall(params: {
  providerId: string;
  operation: string;
  status: 'ok' | 'unavailable' | 'cache_hit';
  reason?: string;
  cache_age_ms?: number;
  duration_ms?: number;
}): void {
  // eslint-disable-next-line no-console
  console.info('[intelligence-provider]', {
    provider: params.providerId,
    op: params.operation,
    status: params.status,
    reason: params.reason ?? null,
    cache_age_ms: params.cache_age_ms ?? null,
    duration_ms: params.duration_ms ?? null,
    at: new Date().toISOString(),
  });
}

// ── Evidence freshness helper ─────────────────────────────────────────────────

export function freshnessFromTimestamp(observedAt: string): { last_observed_at: string; age_hours: number } {
  const ageMs = Date.now() - new Date(observedAt).getTime();
  return {
    last_observed_at: observedAt,
    age_hours: Math.max(0, Math.round((ageMs / 1000 / 60 / 60) * 10) / 10),
  };
}

export const PROVIDER_SOURCE: Record<string, EvidenceSourceKind> = {
  openai: 'llm_probe',
  anthropic: 'llm_probe',
  google: 'llm_probe',
  perplexity: 'llm_probe',
  copilot: 'llm_probe',
  ahrefs: 'backlink_api',
  moz: 'backlink_api',
  majestic: 'backlink_api',
  semrush: 'backlink_api',
  trustpilot: 'review_aggregator',
  g2: 'review_aggregator',
  capterra: 'review_aggregator',
};
