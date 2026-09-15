import { createHmac, timingSafeEqual, randomBytes } from 'crypto';
import { resolveSigningSecret, isSigningSecretUnavailable } from '../../auth/signingSecrets';

/**
 * RPA auth bootstrapping tokens.
 *
 * The flow is:
 *   1. UI (or operator) hits POST /api/rpa/auth/start with (org, platform).
 *      Server returns an HMAC-signed `session_token` + the platform login URL.
 *   2. Operator logs in via a real browser. The captured storageState blob
 *      is posted back to POST /api/rpa/auth/save-session along with the
 *      session_token. Server verifies token, writes rpa_sessions.
 *
 * Tokens are self-contained HMAC — no server-side state required. 30-minute
 * TTL; per-token-nonce rebound is out of scope.
 */

const TOKEN_TTL_MS = 30 * 60 * 1000;

/**
 * SEC91-B1: dedicated secret, then AUTH_SECRET — nothing else. The chain used to continue
 * into NEXTAUTH_SECRET, the Supabase service-role API key and a literal committed to this
 * repository. Production resolves AUTH_SECRET exactly as before (tokens live 30 min).
 * Missing both → SigningSecretUnavailableError: issuing throws, verifying rejects.
 */
function getSecret(): string {
  return resolveSigningSecret('RPA auth tokens', ['RPA_AUTH_SECRET', 'AUTH_SECRET']);
}

function b64url(buf: Buffer): string {
  return buf.toString('base64url');
}

type Payload = {
  organization_id: string;
  platform: string;
  user_id: string | null;
  nonce: string;
  issued_at: number;
  expires_at: number;
};

function sign(payload: Payload): string {
  const payloadB64 = b64url(Buffer.from(JSON.stringify(payload), 'utf8'));
  const sig = createHmac('sha256', getSecret()).update(payloadB64).digest('base64url');
  return `${payloadB64}.${sig}`;
}

export function issueRpaAuthToken(input: {
  organization_id: string;
  platform: string;
  user_id: string | null;
}): { token: string; expires_at: number } {
  const now = Date.now();
  const payload: Payload = {
    organization_id: input.organization_id,
    platform: input.platform.toLowerCase(),
    user_id: input.user_id,
    nonce: randomBytes(8).toString('hex'),
    issued_at: now,
    expires_at: now + TOKEN_TTL_MS,
  };
  return { token: sign(payload), expires_at: payload.expires_at };
}

export function verifyRpaAuthToken(token: string | null | undefined):
  | { ok: true; payload: Payload }
  | { ok: false; reason: string }
{
  if (!token) return { ok: false, reason: 'MISSING_TOKEN' };
  const [payloadB64, sig] = token.split('.');
  if (!payloadB64 || !sig) return { ok: false, reason: 'BAD_TOKEN_SHAPE' };
  let expected: string;
  try {
    expected = createHmac('sha256', getSecret()).update(payloadB64).digest('base64url');
  } catch (err) {
    if (isSigningSecretUnavailable(err)) return { ok: false, reason: 'SIGNING_SECRET_UNAVAILABLE' };
    throw err;
  }
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return { ok: false, reason: 'BAD_TOKEN_SIGNATURE' };
  }
  let payload: Payload;
  try {
    payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8')) as Payload;
  } catch {
    return { ok: false, reason: 'BAD_TOKEN_PAYLOAD' };
  }
  if (!payload?.organization_id || !payload?.platform) {
    return { ok: false, reason: 'BAD_TOKEN_FIELDS' };
  }
  if (Date.now() > payload.expires_at) {
    return { ok: false, reason: 'TOKEN_EXPIRED' };
  }
  return { ok: true, payload };
}
