/**
 * OAuth State Encoding/Decoding
 *
 * Encodes companyId + userId + returnTo into a compact state string.
 * Backward compatible: old colon-delimited and unsigned states are still parsed.
 */

import crypto from 'crypto';
import { config } from '@/config';

export interface OAuthStateParams {
  companyId?: string;
  userId?: string;
  returnTo?: string;
  flow?: string;
  tenantId?: string;
  codeVerifier?: string;
  valid?: boolean;
}

/**
 * The OAuth state HMAC signs the company/user binding sent to Google.
 * Falling back to a static literal would make the signature trivially
 * forgeable by anyone who has read the source — which would let an
 * attacker craft a state that pins the OAuth result to another tenant's
 * companyId. So we fail closed.
 *
 * `config.ENCRYPTION_KEY` is the canonical key (also used by
 * credentialEncryption for AES-GCM at-rest token storage). We only fall
 * back to `process.env.ENCRYPTION_KEY` for environments where the
 * `config` proxy is initialized lazily.
 */
function getStateSigningKey(): string | null {
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
  if (!state || typeof state !== 'string') return { valid: false };

  const pipeIdx = state.indexOf('|');
  const signedBase = pipeIdx >= 0 ? state.slice(0, pipeIdx) : state;
  const returnToRaw = pipeIdx >= 0 ? state.slice(pipeIdx + 1) : '';
  const returnTo = returnToRaw.startsWith('/') ? returnToRaw : undefined;

  const dotIdx = signedBase.lastIndexOf('.');
  const base = dotIdx >= 0 ? signedBase.slice(0, dotIdx) : signedBase;
  const signature = dotIdx >= 0 ? signedBase.slice(dotIdx + 1) : '';
  const expected = signForDecode(base, returnTo);
  const valid = Boolean(signature) && Boolean(expected) && signature === expected;

  try {
    const parsed = JSON.parse(Buffer.from(base, 'base64').toString('utf8'));
    return {
      companyId: parsed.cid || undefined,
      userId: parsed.uid || undefined,
      flow: parsed.flo || undefined,
      tenantId: parsed.tid || undefined,
      codeVerifier: parsed.cv || undefined,
      returnTo,
      valid,
    };
  } catch {
    const result: OAuthStateParams = { returnTo, valid };
    if (base.startsWith('c:')) {
      const parts = base.split(':');
      if (parts.length >= 2 && parts[1]) result.companyId = parts[1];
    }
    return result;
  }
}
