/**
 * bridgeCookie — Phase 2 hardened bridge-cookie format.
 *
 * The Phase 1 bridge cookie was a static `super_admin_session=1`. Anyone
 * who could write a cookie on the browser (XSS in any dependency, MITM
 * without HTTPS in non-prod) could mint a working super-admin principal.
 * This module replaces that format with a signed, time-boxed, tamper-
 * detected value.
 *
 * Cookie shape:
 *   `<base64url(payload)>.<base64url(hmac)>`
 *   payload = `<issuedAtUnix>:<nonceHex>`
 *   hmac    = HMAC-SHA256(BRIDGE_COOKIE_SECRET, payload)
 *
 * Reads:
 *   - `parseSignedBridgeCookie(rawValue)` returns { ok: true, issuedAt }
 *     or a structured failure (no_value, malformed, bad_signature,
 *     too_old, no_secret, legacy_format).
 *   - The legacy `=1` value is RECOGNIZED but REJECTED with a
 *     `legacy_format` audit, so operators see when stale cookies are
 *     still being presented (and silently fail closed).
 *
 * Writes:
 *   - `mintSignedBridgeCookieValue()` returns the payload-and-signature
 *     string the caller embeds in a Set-Cookie header.
 *   - Use `buildBridgeSetCookieHeader(value, ttlSeconds)` to get the
 *     full Set-Cookie line with HttpOnly + SameSite=Lax + Secure-in-prod.
 *
 * Constraints:
 *   - This module DOES NOT grant authority. The bridge principal is
 *     still synthesized in `legacyCookieSuperAdminBridge.resolveLegacy
 *     CookieSuperAdminPrincipal`. Hardening here just upgrades the
 *     format the resolver accepts.
 *   - Signature secret is `BRIDGE_COOKIE_SECRET` (≥32 chars). Falls back
 *     to `SESSION_COOKIE_SECRET` if unset, with a warn log — separate
 *     secrets are best practice but reusing the canonical-session secret
 *     is acceptable when the canonical secret is already long-lived.
 */
import { createHmac, randomBytes, timingSafeEqual } from 'crypto';
import { logger } from '../services/logger';

export const BRIDGE_COOKIE_NAME = 'super_admin_session';

/** Maximum age we accept on a presented bridge cookie. Mirrors the 24h
 *  Max-Age set on issuance — the server enforces it independently of the
 *  browser-controlled cookie expiry. */
export const BRIDGE_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24;

export type BridgeCookieParseResult =
  | { ok: true; issuedAtUnix: number }
  | { ok: false; reason: BridgeCookieParseFailure };

export type BridgeCookieParseFailure =
  | 'no_value'
  | 'no_secret'
  | 'malformed'
  | 'bad_signature'
  | 'too_old'
  | 'legacy_format';

function getBridgeSecret(): string | null {
  const dedicated = process.env.BRIDGE_COOKIE_SECRET;
  if (dedicated && dedicated.length >= 32) return dedicated;
  const sessionSecret = process.env.SESSION_COOKIE_SECRET;
  if (sessionSecret && sessionSecret.length >= 32) {
    // Fallback: reuse the canonical-session secret. Logged once per cold
    // start so operators notice if they intended to provision a separate
    // bridge secret.
    logSecretFallbackOnce();
    return sessionSecret;
  }
  return null;
}

let secretFallbackLogged = false;
function logSecretFallbackOnce(): void {
  if (secretFallbackLogged) return;
  secretFallbackLogged = true;
  logger.warn('bridge_cookie_secret_fallback_to_session_secret', {
    note: 'BRIDGE_COOKIE_SECRET unset; reusing SESSION_COOKIE_SECRET. Provision a dedicated bridge secret.',
  });
}

function sign(payload: string, secret: string): string {
  return createHmac('sha256', secret).update(payload).digest('base64url');
}

/**
 * Mint the value that goes into the cookie. Caller embeds it in a
 * Set-Cookie header (use `buildBridgeSetCookieHeader` for the full line).
 */
export function mintSignedBridgeCookieValue(): string {
  const secret = getBridgeSecret();
  if (!secret) {
    throw new Error('Cannot mint bridge cookie: no BRIDGE_COOKIE_SECRET / SESSION_COOKIE_SECRET configured');
  }
  const issuedAt = Math.floor(Date.now() / 1000);
  const nonce = randomBytes(12).toString('hex');
  const payload = `${issuedAt}:${nonce}`;
  const payloadEncoded = Buffer.from(payload, 'utf8').toString('base64url');
  const sig = sign(payload, secret);
  return `${payloadEncoded}.${sig}`;
}

/**
 * Parse + verify a presented bridge-cookie value. Distinguishes:
 *   - legacy_format: the static `1` from Phase 1 — rejected so operators
 *     see when stale cookies are presented after Phase 2 ships.
 *   - bad_signature: HMAC mismatch (tamper / wrong secret / forged).
 *   - too_old: issuedAt older than BRIDGE_COOKIE_MAX_AGE_SECONDS.
 */
export function parseSignedBridgeCookie(rawValue: string | null | undefined): BridgeCookieParseResult {
  if (!rawValue) return { ok: false, reason: 'no_value' };

  // Phase 1 legacy: static "1". Reject explicitly so we can audit it.
  if (rawValue === '1') return { ok: false, reason: 'legacy_format' };

  const dotIdx = rawValue.indexOf('.');
  if (dotIdx <= 0) return { ok: false, reason: 'malformed' };
  const payloadEncoded = rawValue.slice(0, dotIdx);
  const presentedSig = rawValue.slice(dotIdx + 1);
  if (!payloadEncoded || !presentedSig) return { ok: false, reason: 'malformed' };

  const secret = getBridgeSecret();
  if (!secret) return { ok: false, reason: 'no_secret' };

  let payload: string;
  try {
    payload = Buffer.from(payloadEncoded, 'base64url').toString('utf8');
  } catch {
    return { ok: false, reason: 'malformed' };
  }
  const colonIdx = payload.indexOf(':');
  if (colonIdx <= 0) return { ok: false, reason: 'malformed' };
  const issuedAtStr = payload.slice(0, colonIdx);
  const issuedAtUnix = Number(issuedAtStr);
  if (!Number.isFinite(issuedAtUnix) || issuedAtUnix <= 0) {
    return { ok: false, reason: 'malformed' };
  }

  const expected = sign(payload, secret);
  // Constant-time compare; length difference short-circuits but the
  // overall surface is small enough that the attacker model here is XSS,
  // not network timing.
  const expectedBuf = Buffer.from(expected, 'utf8');
  const presentedBuf = Buffer.from(presentedSig, 'utf8');
  if (expectedBuf.length !== presentedBuf.length) {
    return { ok: false, reason: 'bad_signature' };
  }
  if (!timingSafeEqual(expectedBuf, presentedBuf)) {
    return { ok: false, reason: 'bad_signature' };
  }

  const ageSec = Math.floor(Date.now() / 1000) - issuedAtUnix;
  if (ageSec > BRIDGE_COOKIE_MAX_AGE_SECONDS) {
    return { ok: false, reason: 'too_old' };
  }
  // Accept future-dated up to 60s of clock skew, otherwise treat as
  // tamper.
  if (ageSec < -60) {
    return { ok: false, reason: 'bad_signature' };
  }

  return { ok: true, issuedAtUnix };
}

/**
 * SEC-001C — `hasValidLegacySuperAdminCookie` USED TO LIVE HERE. It has been
 * REMOVED; do not reintroduce it or any equivalent.
 *
 * SEC-001B introduced it as the drop-in replacement for the forgeable
 * `req.cookies.super_admin_session === '1'` comparison, and it did fix the
 * signature hole. But it verified signature + embedded age ONLY, so the ~34
 * routes gating on it silently bypassed the bridge LIFECYCLE:
 * `LEGACY_BRIDGE_HARD_EXPIRY_AT`, `LEGACY_BRIDGE_DRY_RUN`, the bridge audit
 * trail, and the bypass counters. That left two bridge entry points with
 * different semantics — the inconsistency SEC-001C exists to remove.
 *
 * The single canonical entry point for route-level bridge authorization is
 * `superAdminSession.getLegacySuperAdminSession(req)`, which layers the
 * lifecycle on top of `parseSignedBridgeCookie` below. This module stays a
 * pure CRYPTO leaf (mint / parse / cookie headers) with no lifecycle
 * knowledge — that is what keeps the dependency graph acyclic.
 *
 * Pinned by backend/tests/unit/sec001cBridgeUnification.test.ts.
 */

/**
 * Build the Set-Cookie header line for the bridge cookie. Adds Secure in
 * production, HttpOnly always, SameSite=Lax (matches the canonical
 * session cookie's posture).
 */
export function buildBridgeSetCookieHeader(value: string, maxAgeSeconds: number = BRIDGE_COOKIE_MAX_AGE_SECONDS): string {
  const isProd = process.env.NODE_ENV === 'production';
  const parts = [
    `${BRIDGE_COOKIE_NAME}=${value}`,
    'Path=/',
    `Max-Age=${Math.max(0, Math.floor(maxAgeSeconds))}`,
    'HttpOnly',
    'SameSite=Lax',
  ];
  if (isProd) parts.push('Secure');
  return parts.join('; ');
}

/** Build a Set-Cookie line that clears the bridge cookie. */
export function buildBridgeClearCookieHeader(): string {
  return buildBridgeSetCookieHeader('', 0);
}
