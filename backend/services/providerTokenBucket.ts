/**
 * Provider-level token bucket / QPS governance.
 *
 * Sits IN FRONT of the per-pool semaphore. Pool isolation prevents
 * intra-planner starvation; this bucket prevents the planner from running
 * the upstream provider into a 429 storm. Each provider has its own bucket:
 *
 *   tokens(t)   = min(burst, tokens(t-1) + qps * dt)
 *   refill rate = qps tokens / second
 *   capacity    = burst (allows short spikes)
 *
 * acquire() decrements one token. If tokens < 1, the caller waits up to
 * `maxWaitMs` for a refill. When the wait is unsuccessful we throw —
 * `callProviderWithRetry` treats this as a soft 429 and applies the same
 * backoff/fallback logic it does for real 429s.
 *
 * Per-process. Cross-instance coordination via Redis would be ideal but
 * adds latency to every call — out of scope here. The per-process bucket
 * shaves QPS by `instance_count`× which is enough for the typical 1–4 worker
 * deployment.
 *
 * Refund: an aborted call MAY refund its token if it can prove the request
 * never actually went out. Conservative — we only refund when the abort
 * fires BEFORE `markRequestStarted()` is called. This avoids double-spending
 * a token on a call that the provider already saw.
 */

import { logger } from './logger';
import { getRequestContext } from './requestContext';

export type ProviderName = 'openai' | 'anthropic';

type BucketState = {
  provider: ProviderName;
  /** Tokens currently in the bucket (decimal — partial refills count). */
  tokens: number;
  /** Last time the bucket was refilled (ms epoch). */
  lastRefillAt: number;
  /** Configured refill rate, tokens / second. */
  qps: number;
  /** Configured burst capacity (max bucket size). */
  burst: number;
  /** Counter: how many requests waited > 0ms for a token. */
  totalWaits: number;
  /** Counter: how many requests were rejected because the bucket was empty
   *  and the wait window expired. */
  totalExhausted: number;
  /** Counter: tokens refunded by abort. */
  totalRefunds: number;
};

const DEFAULT_OPENAI_QPS = 8;
const DEFAULT_ANTHROPIC_QPS = 4;
const DEFAULT_BURST = 16;

const _buckets: Record<ProviderName, BucketState> = {
  openai: {
    provider: 'openai',
    tokens: DEFAULT_BURST,
    lastRefillAt: Date.now(),
    qps: DEFAULT_OPENAI_QPS,
    burst: DEFAULT_BURST,
    totalWaits: 0,
    totalExhausted: 0,
    totalRefunds: 0,
  },
  anthropic: {
    provider: 'anthropic',
    tokens: DEFAULT_BURST,
    lastRefillAt: Date.now(),
    qps: DEFAULT_ANTHROPIC_QPS,
    burst: DEFAULT_BURST,
    totalWaits: 0,
    totalExhausted: 0,
    totalRefunds: 0,
  },
};

function readQpsEnv(provider: ProviderName, fallback: number): number {
  const raw = process.env[provider === 'openai' ? 'OPENAI_QPS_LIMIT' : 'ANTHROPIC_QPS_LIMIT'];
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function readBurstEnv(fallback: number): number {
  const raw = process.env.PROVIDER_BUCKET_BURST;
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : fallback;
}

/** Reload bucket sizes from env. Safe to call repeatedly. */
export function reloadBucketSizes(): Record<ProviderName, { qps: number; burst: number }> {
  for (const provider of ['openai', 'anthropic'] as ProviderName[]) {
    const fallback = provider === 'openai' ? DEFAULT_OPENAI_QPS : DEFAULT_ANTHROPIC_QPS;
    _buckets[provider].qps = readQpsEnv(provider, fallback);
    _buckets[provider].burst = readBurstEnv(DEFAULT_BURST);
    if (_buckets[provider].tokens > _buckets[provider].burst) {
      _buckets[provider].tokens = _buckets[provider].burst;
    }
  }
  return {
    openai: { qps: _buckets.openai.qps, burst: _buckets.openai.burst },
    anthropic: { qps: _buckets.anthropic.qps, burst: _buckets.anthropic.burst },
  };
}

reloadBucketSizes();

function refill(bucket: BucketState, now: number): void {
  const elapsedMs = now - bucket.lastRefillAt;
  if (elapsedMs <= 0) return;
  const added = (bucket.qps * elapsedMs) / 1000;
  bucket.tokens = Math.min(bucket.burst, bucket.tokens + added);
  bucket.lastRefillAt = now;
}

export interface AcquireOptions {
  signal?: AbortSignal;
  /** Max time to wait for refill before giving up, ms. Default 5000. */
  maxWaitMs?: number;
  /** Poll interval while waiting, ms. Default 50. */
  pollIntervalMs?: number;
}

export interface TokenReceipt {
  provider: ProviderName;
  /** Time spent waiting for a token (ms). 0 if grabbed immediately. */
  waitMs: number;
  /** When false, the token was never actually decremented because the
   *  bucket was disabled. release()/refund() are no-ops. */
  decremented: boolean;
  /** Internal — set when the caller calls markRequestStarted(). After
   *  that, refund() becomes a no-op so a token isn't double-spent. */
  _started?: boolean;
}

export function isEnabled(): boolean {
  return String(process.env.PROVIDER_BUCKET_ENABLED ?? 'true').toLowerCase() === 'true';
}

/**
 * Acquire one token from the provider bucket. Blocks up to `maxWaitMs`,
 * checking the bucket every `pollIntervalMs`. Throws with
 * `code: 'PROVIDER_BUCKET_EXHAUSTED'` if the wait window expires.
 */
export async function acquire(
  provider: ProviderName,
  opts: AcquireOptions = {},
): Promise<TokenReceipt> {
  if (!isEnabled()) {
    return { provider, waitMs: 0, decremented: false };
  }
  const bucket = _buckets[provider];
  const startAt = Date.now();
  const maxWaitMs = Math.max(0, opts.maxWaitMs ?? 5_000);
  const pollIntervalMs = Math.max(20, opts.pollIntervalMs ?? 50);

  if (opts.signal?.aborted) {
    throw Object.assign(new Error('provider bucket acquire aborted'), { code: 'PROVIDER_BUCKET_ABORTED' });
  }

  // First try without waiting.
  refill(bucket, Date.now());
  if (bucket.tokens >= 1) {
    bucket.tokens -= 1;
    return { provider, waitMs: 0, decremented: true };
  }

  // Slow path: wait.
  while (true) {
    if (opts.signal?.aborted) {
      throw Object.assign(new Error('provider bucket acquire aborted'), {
        code: 'PROVIDER_BUCKET_ABORTED',
      });
    }
    // Deadline BEFORE the sleep. Checked afterwards, `maxWaitMs: 0` blocked for a
    // full poll interval (>= 20ms, 50ms by default) and then credited that
    // elapsed time as refill — so a caller asking not to wait both waited and
    // handed tokens back to the bucket. "Blocks up to maxWaitMs" now means
    // exactly that, and 0 means do not block at all.
    const waitedMs = Date.now() - startAt;
    if (waitedMs >= maxWaitMs) {
      bucket.totalExhausted += 1;
      logger.warn('provider_bucket_exhausted', {
        request_id: getRequestContext().requestId,
        provider,
        wait_ms: waitedMs,
        max_wait_ms: maxWaitMs,
        tokens: Math.round(bucket.tokens * 100) / 100,
        qps: bucket.qps,
        burst: bucket.burst,
      });
      // Distributed-metric counter — survives Redis outage via local fallback.
      try {
        const { recordPlannerAlertCounter } = require('./plannerAlerting') as typeof import('./plannerAlerting');
        recordPlannerAlertCounter('provider_bucket_exhausted', { provider });
      } catch { /* alerting is best-effort */ }
      throw Object.assign(
        new Error(`provider ${provider} token bucket exhausted (qps=${bucket.qps}, waited ${waitedMs}ms)`),
        { code: 'PROVIDER_BUCKET_EXHAUSTED', status: 429 },
      );
    }
    await new Promise((r) => setTimeout(r, pollIntervalMs));
    const now = Date.now();
    refill(bucket, now);
    // Abort outranks a token that refilled during this same poll interval. The
    // abort check at the top of the loop cannot see a signal raised while we
    // were sleeping, so without this a caller that aborted mid-wait could still
    // be charged a token and handed a receipt.
    if (opts.signal?.aborted) {
      throw Object.assign(new Error('provider bucket acquire aborted'), {
        code: 'PROVIDER_BUCKET_ABORTED',
      });
    }
    if (bucket.tokens >= 1) {
      bucket.tokens -= 1;
      const waitMs = now - startAt;
      bucket.totalWaits += 1;
      if (waitMs > 0) {
        logger.info('provider_bucket_wait', {
          request_id: getRequestContext().requestId,
          provider,
          wait_ms: waitMs,
          tokens_left: Math.round(bucket.tokens * 100) / 100,
          qps: bucket.qps,
          burst: bucket.burst,
        });
      }
      return { provider, waitMs, decremented: true };
    }
  }
}

/**
 * Mark the request as started — call this just before dispatching the
 * provider API call. After this point, refund() becomes a no-op because
 * we can no longer prove the request never reached the provider.
 */
export function markRequestStarted(receipt: TokenReceipt): void {
  receipt._started = true;
}

/**
 * Refund a token to the bucket if the call was aborted BEFORE the request
 * was dispatched. Safe to call multiple times; only the first call after
 * an unsent acquire actually refunds.
 */
export function refund(receipt: TokenReceipt): void {
  if (!receipt.decremented) return;
  if (receipt._started) return; // Request already in flight or completed.
  const bucket = _buckets[receipt.provider];
  bucket.tokens = Math.min(bucket.burst, bucket.tokens + 1);
  bucket.totalRefunds += 1;
  receipt.decremented = false;
  logger.info('provider_bucket_recovered', {
    request_id: getRequestContext().requestId,
    provider: receipt.provider,
    tokens: Math.round(bucket.tokens * 100) / 100,
  });
}

export interface BucketSnapshot {
  provider: ProviderName;
  tokens: number;
  qps: number;
  burst: number;
  totalWaits: number;
  totalExhausted: number;
  totalRefunds: number;
}

export function snapshot(provider: ProviderName): BucketSnapshot {
  const b = _buckets[provider];
  // Refill on read so the surfaced count reflects current state.
  refill(b, Date.now());
  return {
    provider,
    tokens: Math.round(b.tokens * 100) / 100,
    qps: b.qps,
    burst: b.burst,
    totalWaits: b.totalWaits,
    totalExhausted: b.totalExhausted,
    totalRefunds: b.totalRefunds,
  };
}

export function snapshotAll(): Record<ProviderName, BucketSnapshot> {
  return {
    openai: snapshot('openai'),
    anthropic: snapshot('anthropic'),
  };
}

/** Test-only: reset both buckets. */
export function __resetForTests(): void {
  const now = Date.now();
  for (const p of ['openai', 'anthropic'] as ProviderName[]) {
    _buckets[p].tokens = _buckets[p].burst;
    _buckets[p].lastRefillAt = now;
    _buckets[p].totalWaits = 0;
    _buckets[p].totalExhausted = 0;
    _buckets[p].totalRefunds = 0;
  }
}
