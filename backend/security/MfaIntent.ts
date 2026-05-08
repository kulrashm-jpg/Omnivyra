/**
 * MfaIntent — short-lived, HMAC-signed handoff token issued by the canonical
 * login flow (sync-supabase-user) when a user has at least one verified MFA
 * factor enrolled.
 *
 * Lifecycle:
 *   1. Password verifies via Supabase; sync-supabase-user runs identity
 *      checks; if MFA enrolled → issue an intent token + cookie + return
 *      `{ mfa_required: true }` WITHOUT minting an auth_session.
 *   2. Browser redirects to /auth/mfa, which presents a factor challenge.
 *   3. /api/auth/mfa-verify reads the cookie, validates the HMAC, and on
 *      successful factor verification consumes the intent (single-use) and
 *      mints the canonical auth_session.
 *
 * Rules:
 *   - 5-minute TTL — long enough for a real human, short enough that a
 *     stolen intent cannot sit on a clipboard.
 *   - Cookie is HttpOnly, SameSite=Lax, Secure in production. The browser
 *     never sees the userId.
 *   - The token is single-use: consumed (cleared) on the first successful
 *     mfa-verify, regardless of which factor was used.
 *   - The token is NOT a session — it CANNOT authorize any API call. It is
 *     ONLY accepted by /api/auth/mfa-verify.
 *   - HMAC secret is the existing SESSION_COOKIE_SECRET (single env source).
 */

import { createHmac, randomBytes, timingSafeEqual } from 'crypto';
import type { NextApiRequest, NextApiResponse } from 'next';

export const MFA_INTENT_COOKIE_NAME = 'omnivyra_mfa_intent';
export const MFA_INTENT_TTL_SECONDS = 300; // 5 min

export interface MfaIntentPayload {
  /** public.users.id */
  userId: string;
  /** auth.users.id */
  supabaseUid: string;
  /** lowercase canonical email — exposed only to the server */
  email: string;
  /** issued-at unix-seconds */
  iat: number;
  /** expires-at unix-seconds */
  exp: number;
  /** random nonce so two intents in the same second never collide */
  nonce: string;
}

function getSecret(): string {
  const secret = process.env.SESSION_COOKIE_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error('SESSION_COOKIE_SECRET missing or too short — required for MfaIntent');
  }
  return secret;
}

function sign(payloadB64: string): string {
  return createHmac('sha256', getSecret())
    .update(payloadB64)
    .digest('base64url');
}

function encodeToken(payload: MfaIntentPayload): string {
  const json = JSON.stringify(payload);
  const payloadB64 = Buffer.from(json, 'utf8').toString('base64url');
  return `${payloadB64}.${sign(payloadB64)}`;
}

function decodeToken(token: string): MfaIntentPayload | null {
  const idx = token.indexOf('.');
  if (idx < 0) return null;
  const payloadB64 = token.slice(0, idx);
  const sig = token.slice(idx + 1);
  if (!payloadB64 || !sig) return null;

  // Constant-time signature comparison.
  let expected: string;
  try {
    expected = sign(payloadB64);
  } catch {
    return null;
  }
  const a = Buffer.from(sig, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  try {
    const json = Buffer.from(payloadB64, 'base64url').toString('utf8');
    const parsed = JSON.parse(json) as MfaIntentPayload;
    if (
      typeof parsed.userId !== 'string' ||
      typeof parsed.supabaseUid !== 'string' ||
      typeof parsed.email !== 'string' ||
      typeof parsed.iat !== 'number' ||
      typeof parsed.exp !== 'number' ||
      typeof parsed.nonce !== 'string'
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

/**
 * Issue a fresh intent: builds payload, signs, and attaches the cookie to
 * the response. Returns the raw token in case the caller wants to surface
 * it for debugging — the cookie is the canonical transport.
 */
export function issueMfaIntent(
  res: NextApiResponse,
  input: { userId: string; supabaseUid: string; email: string },
): { token: string; expiresAt: number } {
  const now = Math.floor(Date.now() / 1000);
  const payload: MfaIntentPayload = {
    userId: input.userId,
    supabaseUid: input.supabaseUid,
    email: input.email.trim().toLowerCase(),
    iat: now,
    exp: now + MFA_INTENT_TTL_SECONDS,
    nonce: randomBytes(8).toString('base64url'),
  };
  const token = encodeToken(payload);
  attachIntentCookie(res, token);
  return { token, expiresAt: payload.exp };
}

/**
 * Read and validate the intent from the request cookie. Returns null on
 * any failure (missing, malformed, bad signature, expired). The caller
 * MUST treat null as "no valid intent" — never grant access.
 */
export function readMfaIntent(req: NextApiRequest): MfaIntentPayload | null {
  const cookies = req.headers.cookie || '';
  const match = cookies.match(new RegExp(`(?:^|; )${MFA_INTENT_COOKIE_NAME}=([^;]+)`));
  if (!match?.[1]) return null;

  let raw: string;
  try {
    raw = decodeURIComponent(match[1]);
  } catch {
    return null;
  }

  const payload = decodeToken(raw);
  if (!payload) return null;

  const now = Math.floor(Date.now() / 1000);
  if (payload.exp <= now) return null;
  if (payload.iat > now + 30) return null; // future-issued tokens are rejected (clock skew tolerance: 30s)

  return payload;
}

/**
 * Single-use consumption. After successful MFA verification, clear the
 * cookie so the same intent cannot be replayed against a different
 * factor verification (defense in depth — verify endpoints should
 * already write a session and the intent loses meaning after that).
 */
export function clearMfaIntent(res: NextApiResponse): void {
  attachIntentCookie(res, '', 0);
}

function attachIntentCookie(
  res: NextApiResponse,
  value: string,
  maxAgeSeconds: number = MFA_INTENT_TTL_SECONDS,
): void {
  const isProd = process.env.NODE_ENV === 'production';
  const parts = [
    `${MFA_INTENT_COOKIE_NAME}=${encodeURIComponent(value)}`,
    `Path=/`,
    `Max-Age=${Math.max(0, Math.floor(maxAgeSeconds))}`,
    `HttpOnly`,
    `SameSite=Lax`,
  ];
  if (isProd) parts.push('Secure');
  const header = parts.join('; ');

  const existing = res.getHeader('Set-Cookie');
  if (Array.isArray(existing)) {
    res.setHeader('Set-Cookie', [...existing, header]);
  } else if (typeof existing === 'string') {
    res.setHeader('Set-Cookie', [existing, header]);
  } else {
    res.setHeader('Set-Cookie', header);
  }
}

/**
 * Convenience: detect whether a user has at least one verified MFA
 * factor (TOTP or WebAuthn) and therefore should be challenged before
 * an auth_session is minted. Used by sync-supabase-user.
 *
 * Imports are local to avoid pulling MFA repos into the server bundle
 * for non-MFA paths.
 */
export async function userHasVerifiedMfaFactor(userId: string): Promise<{
  hasMfa: boolean;
  totpVerified: boolean;
  webauthnCount: number;
}> {
  const [{ findActiveForUser }, { listForUser }] = await Promise.all([
    import('./totp/TotpFactorRepository'),
    import('./webauthn/WebAuthnCredentialRepository'),
  ]);

  const [totp, passkeys] = await Promise.all([
    findActiveForUser(userId),
    listForUser(userId),
  ]);

  const totpVerified = !!totp && !!totp.verifiedAt && !totp.revokedAt;
  const webauthnCount = passkeys.length;

  return {
    hasMfa: totpVerified || webauthnCount > 0,
    totpVerified,
    webauthnCount,
  };
}
