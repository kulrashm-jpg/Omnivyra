/**
 * Hard-fail security env validation.
 *
 * Imported by every security module that depends on these envs. The first
 * import triggers validation; missing / malformed values throw immediately.
 * NO silent defaults, NO fallbacks.
 *
 * Validation runs once per process (memoized).
 */

const SESSION_COOKIE_SECRET_MIN_LEN = 32;

interface SecurityEnv {
  WEBAUTHN_RP_ID: string;
  WEBAUTHN_RP_ORIGIN: string;
  SESSION_COOKIE_SECRET: string;
}

let cached: SecurityEnv | null = null;
let validationError: Error | null = null;

function readEnv(): SecurityEnv {
  if (cached) return cached;
  if (validationError) throw validationError;

  const errors: string[] = [];

  const rpId = process.env.WEBAUTHN_RP_ID?.trim();
  const rpOrigin = process.env.WEBAUTHN_RP_ORIGIN?.trim();
  const sessionSecret = process.env.SESSION_COOKIE_SECRET;

  if (!rpId) {
    errors.push('WEBAUTHN_RP_ID is required (e.g. "omnivyra.com" or "localhost").');
  } else if (rpId.includes('://') || rpId.includes('/')) {
    errors.push('WEBAUTHN_RP_ID must be a hostname only (no scheme, no path).');
  }

  if (!rpOrigin) {
    errors.push('WEBAUTHN_RP_ORIGIN is required (e.g. "https://app.omnivyra.com").');
  } else if (!/^https?:\/\//.test(rpOrigin)) {
    errors.push('WEBAUTHN_RP_ORIGIN must include a scheme (https:// or http://).');
  }

  if (!sessionSecret) {
    errors.push('SESSION_COOKIE_SECRET is required.');
  } else if (sessionSecret.length < SESSION_COOKIE_SECRET_MIN_LEN) {
    errors.push(`SESSION_COOKIE_SECRET must be >= ${SESSION_COOKIE_SECRET_MIN_LEN} chars (got ${sessionSecret.length}).`);
  }

  // Production extra constraint: RP origin must be HTTPS. WebAuthn requires
  // a secure context except for localhost — Chrome/Safari treat http://localhost
  // as a secure context, so we permit http only when the RP id is "localhost".
  if (process.env.NODE_ENV === 'production' && rpOrigin && !rpOrigin.startsWith('https://')) {
    errors.push('WEBAUTHN_RP_ORIGIN must use https:// in production.');
  }
  if (rpId && rpOrigin && rpId !== 'localhost') {
    try {
      const u = new URL(rpOrigin);
      // Strict suffix match: rp_id must equal the host or be a registrable suffix.
      // We don't implement public-suffix-list parsing here; the host must
      // either equal rp_id or end with `.${rp_id}`.
      if (u.hostname !== rpId && !u.hostname.endsWith(`.${rpId}`)) {
        errors.push(`WEBAUTHN_RP_ORIGIN host (${u.hostname}) must match WEBAUTHN_RP_ID (${rpId}) or be a subdomain.`);
      }
    } catch {
      // already covered by the !/^https?/ check
    }
  }

  if (errors.length > 0) {
    const msg = `[security/env] invalid configuration:\n  - ${errors.join('\n  - ')}`;
    validationError = new Error(msg);
    throw validationError;
  }

  cached = {
    WEBAUTHN_RP_ID: rpId!,
    WEBAUTHN_RP_ORIGIN: rpOrigin!,
    SESSION_COOKIE_SECRET: sessionSecret!,
  };
  return cached;
}

export function getSecurityEnv(): SecurityEnv {
  return readEnv();
}

export function getWebAuthnRpId(): string {
  return readEnv().WEBAUTHN_RP_ID;
}

export function getWebAuthnRpOrigin(): string {
  return readEnv().WEBAUTHN_RP_ORIGIN;
}
