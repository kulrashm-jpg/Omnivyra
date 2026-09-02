import { createHmac, timingSafeEqual, randomBytes } from 'crypto';

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

function getSecret(): string {
  // API-key migration note: the legacy variable below is used here as an HMAC
  // SIGNING SECRET, not as a Supabase API key, so it is deliberately NOT
  // migrated to SUPABASE_SECRET_KEY — changing the value would invalidate every
  // already-issued token. Consequence: SUPABASE_SERVICE_ROLE_KEY must stay set
  // in production until this chain gets a dedicated secret, otherwise signing
  // silently falls through to the hardcoded development constant.
  return (
    process.env.RPA_AUTH_SECRET ||
    process.env.AUTH_SECRET ||
    process.env.NEXTAUTH_SECRET ||
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    'omnivyra-rpa-auth-secret'
  );
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
  const expected = createHmac('sha256', getSecret()).update(payloadB64).digest('base64url');
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
