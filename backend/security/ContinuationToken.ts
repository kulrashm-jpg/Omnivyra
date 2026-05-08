/**
 * ContinuationToken — canonical short-lived HMAC-signed token for
 * resumable user flows that span multiple requests / devices / tabs.
 *
 * Generalises the `MfaIntent` pattern (which is one specific kind) so
 * every continuation flow uses the same primitives:
 *   - email-verification resume
 *   - password-reset resume
 *   - invite acceptance handoff
 *   - onboarding resume
 *   - MFA recovery session continuation
 *
 * Design:
 *   - HMAC-SHA256 signed with SESSION_COOKIE_SECRET (single env source)
 *   - Compact base64url(payload).base64url(signature) format
 *   - Carries kind + subject + data (kind-specific) + iat + exp + nonce
 *   - 15-minute default TTL — long enough for a real human, short enough
 *     to bound stolen-token risk. Callers may pass a custom TTL.
 *   - The token is NOT a session — it CANNOT authenticate any API call
 *     other than the specific resume endpoint that consumes it.
 *
 * Single-use semantics are NOT enforced by this module — the consuming
 * endpoint is responsible for marking the underlying state advanced
 * (e.g. invite.accepted_at, recovery_codes.used_at). This module
 * provides the cryptographic + payload-shape guarantees.
 *
 * Cookie vs. URL transport:
 *   The token can be carried either as an HttpOnly cookie (set + read
 *   by the same domain — preferred for browser-flow tokens like MFA
 *   intent) or in a URL query parameter (preferred for email-link
 *   tokens like password reset / verify / invite). This module returns
 *   the raw token string; the caller picks the transport that fits
 *   the flow.
 */

import { createHmac, randomBytes, timingSafeEqual } from 'crypto';

export type ContinuationTokenKind =
  | 'verify_email'
  | 'invite_resend'
  | 'onboarding_resume'
  | 'recovery_session'
  | 'password_reset_resume';

export interface ContinuationTokenPayload<TData = Record<string, unknown>> {
  kind: ContinuationTokenKind;
  /**
   * Subject the token is about. Convention: lowercased email for
   * pre-account flows (verify, invite); users.id for post-account flows
   * (onboarding, recovery). Empty string when the token is not subject-
   * scoped (rare).
   */
  subject: string;
  /** Kind-specific payload. JSON-shaped; kept small for cookie limits. */
  data: TData;
  /** Issued-at unix-seconds. */
  iat: number;
  /** Expires-at unix-seconds. */
  exp: number;
  /** Random nonce so two tokens issued in the same second never collide. */
  nonce: string;
}

const DEFAULT_TTL_SECONDS = 15 * 60;
const MAX_TTL_SECONDS     = 24 * 60 * 60;

function getSecret(): string {
  const secret = process.env.SESSION_COOKIE_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error('SESSION_COOKIE_SECRET missing or too short — required for ContinuationToken');
  }
  return secret;
}

function sign(payloadB64: string): string {
  return createHmac('sha256', getSecret()).update(payloadB64).digest('base64url');
}

/**
 * Mint a continuation token.
 *
 * Returns the raw token string. The caller chooses the transport:
 *   - cookie:  Set-Cookie with HttpOnly + SameSite=Lax + path-scoped
 *   - URL:     append as a query parameter to a magic link
 */
export function issueContinuationToken<TData extends Record<string, unknown>>(input: {
  kind: ContinuationTokenKind;
  subject: string;
  data: TData;
  ttlSeconds?: number;
}): { token: string; expiresAt: number } {
  const ttl = Math.min(MAX_TTL_SECONDS, Math.max(60, input.ttlSeconds ?? DEFAULT_TTL_SECONDS));
  const now = Math.floor(Date.now() / 1000);
  const payload: ContinuationTokenPayload<TData> = {
    kind:    input.kind,
    subject: input.subject.trim().toLowerCase(),
    data:    input.data,
    iat:     now,
    exp:     now + ttl,
    nonce:   randomBytes(8).toString('base64url'),
  };
  const json = JSON.stringify(payload);
  const payloadB64 = Buffer.from(json, 'utf8').toString('base64url');
  const sig = sign(payloadB64);
  return { token: `${payloadB64}.${sig}`, expiresAt: payload.exp };
}

/**
 * Validate + decode a continuation token. Returns the typed payload on
 * success, or null on any failure (missing, malformed, bad signature,
 * expired, kind-mismatch). The caller MUST treat null as "no valid
 * continuation".
 *
 * `expectedKind` is enforced: a token minted for `verify_email` cannot
 * be replayed against an `invite_resend` consumer.
 */
export function readContinuationToken<TData extends Record<string, unknown>>(input: {
  token: string | null | undefined;
  expectedKind: ContinuationTokenKind;
}): ContinuationTokenPayload<TData> | null {
  if (!input.token || typeof input.token !== 'string') return null;
  const idx = input.token.indexOf('.');
  if (idx < 0) return null;

  const payloadB64 = input.token.slice(0, idx);
  const sig        = input.token.slice(idx + 1);
  if (!payloadB64 || !sig) return null;

  let expected: string;
  try {
    expected = sign(payloadB64);
  } catch {
    return null;
  }

  const a = Buffer.from(sig,      'utf8');
  const b = Buffer.from(expected, 'utf8');
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  let parsed: ContinuationTokenPayload<TData>;
  try {
    const json = Buffer.from(payloadB64, 'base64url').toString('utf8');
    const v = JSON.parse(json) as ContinuationTokenPayload<TData>;
    if (
      typeof v.kind     !== 'string' ||
      typeof v.subject  !== 'string' ||
      typeof v.iat      !== 'number' ||
      typeof v.exp      !== 'number' ||
      typeof v.nonce    !== 'string' ||
      !v.data || typeof v.data !== 'object'
    ) {
      return null;
    }
    parsed = v;
  } catch {
    return null;
  }

  if (parsed.kind !== input.expectedKind) return null;

  const now = Math.floor(Date.now() / 1000);
  if (parsed.exp <= now) return null;
  if (parsed.iat > now + 30) return null; // future-issued tolerance: 30s clock skew

  return parsed;
}
