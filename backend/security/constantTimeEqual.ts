/**
 * SEC-C4 (STEP 3AH-91) — constant-time comparison for shared machine secrets.
 *
 * Cron, internal-worker and metrics endpoints authenticate their callers with
 * a shared secret presented in a header. They compared it with `===` / `!==`,
 * which returns as soon as the first byte differs, so response timing leaks
 * how much of a guessed prefix is right. This module is the one place those
 * comparisons are made.
 *
 * Semantics are deliberately IDENTICAL to the strict equality they replace,
 * minus the timing channel:
 *   - exact, case-sensitive match of the whole string (no trimming, no
 *     prefix normalisation — callers keep whatever shaping they did before);
 *   - FAIL CLOSED: a missing/empty expected secret, or a presented value that
 *     is not a non-empty string (undefined header, string[] from a repeated
 *     header), never matches. `undefined === undefined` can therefore never
 *     authenticate a caller when the env var is unset.
 *
 * Both sides are hashed to fixed-length SHA-256 digests before
 * `timingSafeEqual`, so neither the content nor the LENGTH of the secret is
 * revealed by timing (timingSafeEqual itself throws on unequal lengths, and a
 * length pre-check would leak the length).
 */
import { createHash, timingSafeEqual } from 'crypto';

function digest(value: string): Buffer {
  return createHash('sha256').update(value, 'utf8').digest();
}

/**
 * True iff `presented` and `expected` are both non-empty strings with exactly
 * the same contents. Never throws.
 */
export function constantTimeEqual(presented: unknown, expected: unknown): boolean {
  if (typeof presented !== 'string' || typeof expected !== 'string') return false;
  if (presented.length === 0 || expected.length === 0) return false;
  return timingSafeEqual(digest(presented), digest(expected));
}

/**
 * True iff the Authorization header is exactly `Bearer <secret>` — the same
 * string the routes used to build and compare with `===` — and the secret is
 * configured (non-empty).
 */
export function bearerTokenMatches(authorization: unknown, secret: string | null | undefined): boolean {
  if (typeof secret !== 'string' || secret.length === 0) return false;
  return constantTimeEqual(authorization, `Bearer ${secret}`);
}
