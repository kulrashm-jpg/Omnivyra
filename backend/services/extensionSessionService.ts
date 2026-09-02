import { createHmac, timingSafeEqual, randomBytes, createHash } from 'crypto';

type ExtensionSessionPayload = {
  userId: string;
  orgId: string;
  expiresAt: number;
  // Nonce bound into the session token so the server can re-derive the
  // extension's HMAC secret on every request without persisting raw secrets.
  hmacNonce?: string;
};

function getExtensionSessionSecret() {
  // API-key migration note: the legacy variable below is used here as an HMAC
  // SIGNING SECRET, not as a Supabase API key, so it is deliberately NOT
  // migrated to SUPABASE_SECRET_KEY — changing the value would invalidate every
  // already-issued token. Consequence: SUPABASE_SERVICE_ROLE_KEY must stay set
  // in production until this chain gets a dedicated secret, otherwise signing
  // silently falls through to the hardcoded development constant.
  return (
    process.env.EXTENSION_SESSION_SECRET ||
    process.env.AUTH_SECRET ||
    process.env.NEXTAUTH_SECRET ||
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    'omnivyra-extension-session-secret'
  );
}

function toBase64Url(value: string) {
  return Buffer.from(value, 'utf8').toString('base64url');
}

function fromBase64Url(value: string) {
  return Buffer.from(value, 'base64url').toString('utf8');
}

function signPayload(payloadBase64: string) {
  return createHmac('sha256', getExtensionSessionSecret()).update(payloadBase64).digest('base64url');
}

export function issueExtensionSessionToken(input: ExtensionSessionPayload) {
  const payloadBase64 = toBase64Url(JSON.stringify(input));
  const signature = signPayload(payloadBase64);
  return `${payloadBase64}.${signature}`;
}

export function verifyExtensionSessionToken(token: string | null | undefined): ExtensionSessionPayload | null {
  if (!token) return null;

  const [payloadBase64, signature] = token.split('.');
  if (!payloadBase64 || !signature) return null;

  const expectedSignature = signPayload(payloadBase64);
  const provided = Buffer.from(signature);
  const expected = Buffer.from(expectedSignature);
  if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) {
    return null;
  }

  try {
    const payload = JSON.parse(fromBase64Url(payloadBase64)) as ExtensionSessionPayload;
    if (!payload.userId || !payload.orgId || !payload.expiresAt) {
      return null;
    }
    if (Date.now() > payload.expiresAt) {
      return null;
    }
    return payload;
  } catch {
    return null;
  }
}

/**
 * Derive the HMAC secret issued to the extension. Given a session's
 * (userId, orgId, expiresAt, nonce) tuple, the secret is deterministic —
 * the server can recompute it on every request to verify signatures
 * without persisting raw secrets in a database.
 */
export function deriveExtensionHmacSecret(input: ExtensionSessionPayload & { nonce: string }) {
  const basis = `${input.userId}:${input.orgId}:${input.expiresAt}:${input.nonce}`;
  return createHmac('sha256', getExtensionSessionSecret())
    .update(`hmac-derive:${basis}`)
    .digest('base64url');
}

export function generateHmacNonce() {
  return randomBytes(16).toString('hex');
}

/**
 * Verify an HMAC-signed extension request.
 *
 * Headers expected on inbound requests:
 *   X-Omnivyra-Timestamp (unix seconds; must be within ±5 min)
 *   X-Omnivyra-Nonce     (per-request nonce; reject repeats within a window)
 *   X-Omnivyra-Signature (hex HMAC-SHA256 over METHOD\nPATH\nTIMESTAMP\nNONCE\nSHA256(body))
 */
const seenRequestNonces = new Map<string, number>(); // nonce -> expiresAt (epoch ms)
const REQUEST_NONCE_WINDOW_MS = 10 * 60 * 1000;

function gcRequestNonces() {
  const now = Date.now();
  for (const [nonce, expiresAt] of seenRequestNonces) {
    if (expiresAt < now) seenRequestNonces.delete(nonce);
  }
}

export function verifyExtensionRequestSignature(params: {
  method: string;
  path: string;
  rawBody: string;
  timestampHeader: string | string[] | undefined;
  nonceHeader: string | string[] | undefined;
  signatureHeader: string | string[] | undefined;
  session: ExtensionSessionPayload;
}): { ok: boolean; reason?: string } {
  const take = (h: string | string[] | undefined) => (Array.isArray(h) ? h[0] : h) || '';
  const timestamp = take(params.timestampHeader).trim();
  const nonce = take(params.nonceHeader).trim();
  const signature = take(params.signatureHeader).trim();

  if (!timestamp || !nonce || !signature) return { ok: false, reason: 'MISSING_SIGNATURE_HEADER' };
  if (!params.session.hmacNonce) return { ok: false, reason: 'SESSION_MISSING_HMAC_NONCE' };

  const ts = Number(timestamp);
  if (!Number.isFinite(ts)) return { ok: false, reason: 'BAD_TIMESTAMP' };
  const nowSeconds = Math.floor(Date.now() / 1000);
  if (Math.abs(nowSeconds - ts) > 5 * 60) return { ok: false, reason: 'TIMESTAMP_OUT_OF_WINDOW' };

  gcRequestNonces();
  if (seenRequestNonces.has(nonce)) return { ok: false, reason: 'NONCE_REPLAYED' };

  const secret = deriveExtensionHmacSecret({
    userId: params.session.userId,
    orgId: params.session.orgId,
    expiresAt: params.session.expiresAt,
    nonce: params.session.hmacNonce,
  });

  const bodyHash = createHash('sha256').update(params.rawBody || '').digest('hex');
  const canonical = [
    String(params.method || 'GET').toUpperCase(),
    params.path,
    timestamp,
    nonce,
    bodyHash,
  ].join('\n');
  const expected = createHmac('sha256', secret).update(canonical).digest('hex');

  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return { ok: false, reason: 'SIGNATURE_MISMATCH' };

  seenRequestNonces.set(nonce, Date.now() + REQUEST_NONCE_WINDOW_MS);
  return { ok: true };
}
