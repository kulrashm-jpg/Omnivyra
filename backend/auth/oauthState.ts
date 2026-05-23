/**
 * OAuth State Encoding/Decoding
 *
 * Encodes companyId + userId + returnTo into a compact state string.
 * Backward compatible: old colon-delimited and unsigned states are still parsed.
 */

import crypto from 'crypto';
import { config } from '@/config';

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
 *   1. `OAUTH_STATE_HMAC_KEY` — dedicated key. Recommended in production so a
 *      compromise of the at-rest token encryption key does not also forge
 *      OAuth state (and vice versa). Splits the blast radius.
 *   2. `ENCRYPTION_KEY` — backward-compatible fallback. Used when the
 *      dedicated HMAC key has not been provisioned yet, so existing
 *      deployments continue to validate previously-signed state.
 *
 * Both are read from `config` first (Zod-validated) and `process.env` only
 * as a defensive fallback for any caller that imports this module before
 * the `config` proxy is initialized.
 */
function getStateSigningKey(): string | null {
  const dedicated = config.OAUTH_STATE_HMAC_KEY || process.env.OAUTH_STATE_HMAC_KEY;
  if (dedicated && dedicated.trim()) return dedicated.trim();
  const key = config.ENCRYPTION_KEY || process.env.ENCRYPTION_KEY;
  if (!key || !key.trim()) return null;
  return key;
}

function requireStateSigningKey(): string {
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

export function encodeOAuthState(params: OAuthStateParams): string {
  const payload: Record<string, string> = {
    cid: params.companyId || '',
    uid: params.userId || '',
    ts: String(Date.now()),
  };
  if (params.flow) payload.flo = params.flow;
  if (params.tenantId) payload.tid = params.tenantId;
  if (params.codeVerifier) payload.cv = params.codeVerifier;

  const base = Buffer.from(JSON.stringify(payload)).toString('base64');
  const signature = signForEncode(base, params.returnTo);
  return params.returnTo ? `${base}.${signature}|${params.returnTo}` : `${base}.${signature}`;
}

export function decodeOAuthState(state: string | undefined): OAuthStateParams {
  if (!state || typeof state !== 'string') return { valid: false, reason: 'missing' };

  const pipeIdx = state.indexOf('|');
  const signedBase = pipeIdx >= 0 ? state.slice(0, pipeIdx) : state;
  const returnToRaw = pipeIdx >= 0 ? state.slice(pipeIdx + 1) : '';
  const returnTo = returnToRaw.startsWith('/') ? returnToRaw : undefined;

  const dotIdx = signedBase.lastIndexOf('.');
  const base = dotIdx >= 0 ? signedBase.slice(0, dotIdx) : signedBase;
  const signature = dotIdx >= 0 ? signedBase.slice(dotIdx + 1) : '';
  const expected = signForDecode(base, returnTo);
  const signatureValid = Boolean(signature) && Boolean(expected) && signature === expected;

  if (!signatureValid) {
    return { returnTo, valid: false, reason: 'signature' };
  }

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
