/**
 * verificationSecret.ts
 *
 * Loads the VERIFICATION_SECRET env var and exposes an HMAC helper used to
 * hash domain-ownership tokens before storage and to recompute the hash
 * during verification.
 *
 * Security contract:
 *   - The raw token is only known to the server at row-creation time.
 *     What's persisted is HMAC-SHA-256(raw_token, VERIFICATION_SECRET).
 *   - The user publishes the raw token via DNS TXT or /.well-known/omnivira.txt.
 *   - At verify time, the server re-hashes the published value and compares
 *     to the stored HMAC with timingSafeEqual.
 *   - Compromise of the DB without the secret does NOT let an attacker
 *     pretend to publish the token (they don't know the raw value).
 *
 * Operational contract:
 *   - VERIFICATION_SECRET MUST be stable for the lifetime of issued tokens.
 *     Rotating it invalidates EVERY pending verification (all stored HMACs
 *     become unverifiable). A rotation requires a one-shot regeneration of
 *     all unverified tokens; document the procedure before doing it.
 *   - Loaded lazily (first call) so the module can be imported in test envs
 *     without env. The first hash/verify call in a process throws if the
 *     env var is missing — fail-loud rather than silently storing tokens
 *     under an empty key.
 */

import crypto from 'crypto';

let _cachedSecret: string | null = null;

export function getVerificationSecret(): string {
  if (_cachedSecret) return _cachedSecret;
  const v = process.env.VERIFICATION_SECRET;
  if (!v || v.length < 32) {
    throw new Error(
      'VERIFICATION_SECRET env var is required and must be at least 32 characters. '
      + 'Set it to a stable random value before issuing or verifying domain tokens.',
    );
  }
  _cachedSecret = v;
  return v;
}

/**
 * Compute HMAC-SHA-256 hex of the input token using VERIFICATION_SECRET.
 * Used both to hash the raw token at storage time AND to hash the published
 * value at verify time.
 */
export function hashVerificationToken(rawToken: string): string {
  return crypto
    .createHmac('sha256', getVerificationSecret())
    .update(String(rawToken))
    .digest('hex');
}

/**
 * Constant-time comparison of two hex-encoded HMACs. Falls back to string
 * inequality when length differs (timingSafeEqual would throw).
 */
export function constantTimeEqualHex(a: string, b: string): boolean {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  if (a.length !== b.length) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'));
  } catch {
    return false;
  }
}
