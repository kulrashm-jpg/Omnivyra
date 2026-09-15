/**
 * OAuth State Encoding/Decoding
 *
 * Encodes companyId + userId + returnTo into a compact state string.
 * Backward compatible: old colon-delimited and unsigned states are still parsed.
 */

import crypto from 'crypto';
import { config } from '@/config';
import { safeRelativeRedirectPath } from './safeRedirect';

export type OAuthStateInvalidReason =
  | 'missing'
  | 'signature'
  | 'malformed'
  | 'missing_ts'
  | 'malformed_ts'
  | 'expired'
  | 'future';

export interface OAuthStateParams {
  companyId?: string;
  userId?: string;
  returnTo?: string;
  flow?: string;
  tenantId?: string;
  codeVerifier?: string;
  /** Optional provider discriminator (e.g. meta: 'facebook' | 'instagram'). Signed. */
  provider?: string;
  valid?: boolean;
  reason?: OAuthStateInvalidReason;
}

// Strict TTL bounds for OAuth state. Captured/leaked state must not be
// replayable forever; 10 min covers typical consent latency, 2 min future
// skew tolerates modest clock drift without permitting timestamp forgery.
const OAUTH_STATE_MAX_AGE_MS = 10 * 60 * 1000;
const OAUTH_STATE_MAX_FUTURE_MS = 2 * 60 * 1000;

/**
 * The OAuth state HMAC signs the company/user binding sent to Google.
 * Falling back to a static literal would make the signature trivially
 * forgeable by anyone who has read the source — which would let an
 * attacker craft a state that pins the OAuth result to another tenant's
 * companyId. So we fail closed.
 *
 * Key resolution (in priority order):
 *   1. `OAUTH_STATE_HMAC_KEY` — dedicated key, used verbatim (unchanged).
 *      Recommended in production so a compromise of the at-rest token
 *      encryption key does not also forge OAuth state (and vice versa).
 *   2. `ENCRYPTION_KEY` — fallback, but NEVER used directly as the HMAC key
 *      (SEC91-B7). The key is domain-separated first:
 *        HMAC-SHA256(ENCRYPTION_KEY, 'omnivyra/oauth-state/v1')
 *      so the AES token-encryption key is not reused raw for a second purpose.
 *      Deploy note: states minted with the raw key before this change stop
 *      verifying; they live at most OAUTH_STATE_MAX_AGE_MS (10 min), so only
 *      a consent screen open across the deploy has to be restarted.
 *
 * Both are read from `config` first (Zod-validated) and `process.env` only
 * as a defensive fallback for any caller that imports this module before
 * the `config` proxy is initialized.
 */
const OAUTH_STATE_KEY_DERIVATION_LABEL = 'omnivyra/oauth-state/v1';

function getStateSigningKey(): string | Buffer | null {
  const dedicated = config.OAUTH_STATE_HMAC_KEY || process.env.OAUTH_STATE_HMAC_KEY;
  if (dedicated && dedicated.trim()) return dedicated.trim();
  const key = config.ENCRYPTION_KEY || process.env.ENCRYPTION_KEY;
  if (!key || !key.trim()) return null;
  return crypto.createHmac('sha256', key).update(OAUTH_STATE_KEY_DERIVATION_LABEL).digest();
}

function requireStateSigningKey(): string | Buffer {
  const key = getStateSigningKey();
  if (!key) {
    throw new Error(
      'OAUTH_STATE_KEY_MISSING: ENCRYPTION_KEY is not configured. ' +
        'OAuth state signing cannot proceed without a server-only secret.',
    );
  }
  return key;
}

// Encode (mints state for the OAuth start) — fail closed: a missing key is
// a deployment misconfiguration that must surface, not silently downgrade.
function signForEncode(base: string, returnTo?: string): string {
  return crypto
    .createHmac('sha256', requireStateSigningKey())
    .update(`${base}|${returnTo || ''}`)
    .digest('base64url');
}

// Decode (validates state from Google's callback) — never throw on a
// missing key, because the callback handler treats throw-from-decode as
// an unhandled 500. Returning a non-matching signature gives the same
// safety (valid=false) without the opaque crash.
function signForDecode(base: string, returnTo?: string): string | null {
  const key = getStateSigningKey();
  if (!key) {
    console.error('[oauthState][decode] ENCRYPTION_KEY missing — treating state as invalid');
    return null;
  }
  return crypto
    .createHmac('sha256', key)
    .update(`${base}|${returnTo || ''}`)
    .digest('base64url');
}

/** Constant-time comparison of two base64url signatures (SEC91-B7). */
function signaturesMatch(provided: string, expected: string | null): boolean {
  if (!provided || !expected) return false;
  const a = Buffer.from(provided, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export function encodeOAuthState(params: OAuthStateParams): string {
  const payload: Record<string, string> = {
    cid: params.companyId || '',
    uid: params.userId || '',
    ts: String(Date.now()),
  };
  if (params.flow) payload.flo = params.flow;
  if (params.tenantId) payload.tid = params.tenantId;
  if (params.codeVerifier) payload.cv = params.codeVerifier;
  if (params.provider) payload.prv = params.provider;

  // SEC91-B4: only a same-origin relative path is ever signed into the state. A caller-
  // supplied '//evil.example' (or '/\evil.example', 'https://…') is dropped, so the
  // callback falls back to its default destination instead of redirecting off-site.
  const returnTo = safeRelativeRedirectPath(params.returnTo);

  const base = Buffer.from(JSON.stringify(payload)).toString('base64');
  const signature = signForEncode(base, returnTo);
  return returnTo ? `${base}.${signature}|${returnTo}` : `${base}.${signature}`;
}

export function decodeOAuthState(state: string | undefined): OAuthStateParams {
  if (!state || typeof state !== 'string') return { valid: false, reason: 'missing' };

  const pipeIdx = state.indexOf('|');
  const signedBase = pipeIdx >= 0 ? state.slice(0, pipeIdx) : state;
  const returnToRaw = pipeIdx >= 0 ? state.slice(pipeIdx + 1) : '';

  const dotIdx = signedBase.lastIndexOf('.');
  const base = dotIdx >= 0 ? signedBase.slice(0, dotIdx) : signedBase;
  const signature = dotIdx >= 0 ? signedBase.slice(dotIdx + 1) : '';
  // The signature covers the returnTo exactly as it travelled.
  const expected = signForDecode(base, returnToRaw || undefined);
  const signatureValid = signaturesMatch(signature, expected);

  // SEC91-B4: an unsigned / forged state yields NO returnTo at all (the callbacks build
  // their error redirect from it), and even a correctly signed one is re-validated.
  if (!signatureValid) {
    return { valid: false, reason: 'signature' };
  }
  const returnTo = safeRelativeRedirectPath(returnToRaw);

  try {
    const parsed = JSON.parse(Buffer.from(base, 'base64').toString('utf8'));

    const tsRaw = parsed.ts;
    if (tsRaw === undefined || tsRaw === null || tsRaw === '') {
      return { returnTo, valid: false, reason: 'missing_ts' };
    }
    const ts = Number(tsRaw);
    if (!Number.isFinite(ts)) {
      return { returnTo, valid: false, reason: 'malformed_ts' };
    }
    const ageMs = Date.now() - ts;
    if (ageMs > OAUTH_STATE_MAX_AGE_MS) {
      return { returnTo, valid: false, reason: 'expired' };
    }
    if (ageMs < -OAUTH_STATE_MAX_FUTURE_MS) {
      return { returnTo, valid: false, reason: 'future' };
    }

    return {
      companyId: parsed.cid || undefined,
      userId: parsed.uid || undefined,
      flow: parsed.flo || undefined,
      tenantId: parsed.tid || undefined,
      codeVerifier: parsed.cv || undefined,
      provider: parsed.prv || undefined,
      returnTo,
      valid: true,
    };
  } catch {
    // Signature matched but payload is not JSON. The only known pre-HMAC
    // payload shape is `c:<companyId>`; it could never satisfy the current
    // signature so this branch is effectively unreachable in production,
    // but we keep the legacy extraction defensively while marking invalid.
    const result: OAuthStateParams = { returnTo, valid: false, reason: 'malformed' };
    if (base.startsWith('c:')) {
      const parts = base.split(':');
      if (parts.length >= 2 && parts[1]) result.companyId = parts[1];
    }
    return result;
  }
}
