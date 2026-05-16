/**
 * Phase 13 — Bounded jittered backoff helpers.
 *
 * Replaces inline `Math.pow(2, attempt) * delay` patterns with a
 * deterministic-seedable jittered exponential backoff suitable for
 * BullMQ retry tuning and operator-driven retry suggestions in the
 * resilience advisory surface.
 *
 * Adoption is opt-in. The existing BullMQ queues
 * (listeningExecutionQueue, semanticIndexingQueue, replayPartitionQueue)
 * use BullMQ's built-in exponential backoff (`type: 'exponential'`);
 * this helper is for callers that schedule custom retries (e.g. the
 * connector sandbox audit recorder, or advisory step suggestions).
 *
 * NOT a behavioral change. Pure functions; same inputs → same outputs.
 */

import { createHash } from 'crypto';

export type JitterPolicy = {
  baseMs: number;           // first-attempt delay
  capMs: number;            // upper bound (never sleep longer than this)
  maxAttempts: number;      // hard ceiling on attempts
  fullJitter: boolean;      // true = [0, exp]; false = [exp/2, exp]
};

export const DEFAULT_RETRY_POLICY: JitterPolicy = {
  baseMs: 1_000,
  capMs: 60_000,
  maxAttempts: 5,
  fullJitter: true,
};

/**
 * Compute the next retry delay (deterministic when a seed is supplied).
 * Without a seed, falls back to `Math.random()` for actual workers; with
 * a seed, produces stable values so unit tests + replay traces match.
 */
export function nextRetryDelayMs(
  attempt: number,
  policy: JitterPolicy = DEFAULT_RETRY_POLICY,
  seed?: string,
): number {
  if (attempt < 0) return 0;
  if (attempt >= policy.maxAttempts) return policy.capMs;
  const exp = Math.min(policy.capMs, policy.baseMs * Math.pow(2, attempt));
  const rand = seed ? seededUnit(seed, attempt) : Math.random();
  if (policy.fullJitter) return Math.round(exp * rand);
  return Math.round(exp * (0.5 + rand * 0.5));
}

/**
 * Produce the entire schedule deterministically — useful when the
 * resilience advisory service wants to show "retries will land at
 * t+Xs, t+Ys, t+Zs" to operators.
 */
export function buildRetrySchedule(
  policy: JitterPolicy = DEFAULT_RETRY_POLICY,
  seed?: string,
): number[] {
  const out: number[] = [];
  for (let a = 0; a < policy.maxAttempts; a += 1) {
    out.push(nextRetryDelayMs(a, policy, seed));
  }
  return out;
}

function seededUnit(seed: string, salt: number): number {
  const h = createHash('sha256').update(`${seed}|${salt}`).digest();
  const u32 = h.readUInt32BE(0);
  return u32 / 0xffffffff;
}
