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
 * Tokens are HMAC-signed and bound to (organization_id, platform, user_id).
 * Verification (verifyRpaAuthToken) is pure. REDEMPTION (consumeRpaAuthToken)
 * is single-use and durable: the token nonce is inserted into
 * rpa_auth_token_redemptions (primary key) before any session is written, so a
 * replayed or concurrently re-submitted token is refused. Redemption also
 * re-checks that the issuing user STILL holds a role allowed to manage
 * connectors for that organization (role revoked after issue => refused).
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

/**
 * Roles allowed to replace an organization's RPA browser session — the
 * existing community connector-management capability
 * (COMMUNITY_AI_CAPABILITIES.MANAGE_CONNECTORS). Read lazily so this module
 * stays importable without the RBAC / DB layers (pure token tests).
 */
async function rpaSessionWriterRoles(): Promise<string[]> {
  const { COMMUNITY_AI_CAPABILITIES } = await import('../rbac/communityAiCapabilities');
  return [...COMMUNITY_AI_CAPABILITIES.MANAGE_CONNECTORS] as string[];
}

/**
 * Server-side re-check, at redemption time, that `userId` may replace the RPA
 * session of `organizationId`. Mirrors enforceRole: platform super admins
 * pass; otherwise an ACTIVE company role in MANAGE_CONNECTORS is required.
 * Fail-closed on any lookup error.
 */
export async function isAuthorizedRpaSessionWriter(userId: string | null | undefined, organizationId: string): Promise<boolean> {
  if (!userId || !organizationId) return false;
  try {
    const rbac = await import('../rbacService');
    if (await rbac.isSuperAdmin(userId)) return true;
    if (await rbac.isPlatformSuperAdmin(userId)) return true;
    const { role, error } = await rbac.getUserRole(userId, organizationId);
    if (error || !role) return false;
    return (await rpaSessionWriterRoles()).includes(role as string);
  } catch {
    return false;
  }
}

export type RpaTokenRedemption =
  | { ok: true; payload: Payload & { user_id: string } }
  | { ok: false; reason: string; status: number };

/**
 * Single-use redemption of an RPA auth session token. Order matters:
 *   1. signature / expiry (pure);
 *   2. token must carry the issuing user (tokens minted before user binding,
 *      or without an authenticated issuer, are refused);
 *   3. that user must STILL be an authorized session writer for the org;
 *   4. the nonce is consumed by INSERT into rpa_auth_token_redemptions — a
 *      duplicate (23505) means the token was already used: refused.
 * Only after (4) succeeds may the caller write a session. A failure after
 * consumption burns the token (the operator restarts the flow) — fail closed.
 */
export async function consumeRpaAuthToken(token: string | null | undefined): Promise<RpaTokenRedemption> {
  const verified = verifyRpaAuthToken(token);
  if (verified.ok !== true) {
    const reason = (verified as { reason: string }).reason;
    return { ok: false, reason, status: reason === 'SIGNING_SECRET_UNAVAILABLE' ? 503 : 401 };
  }
  const payload = verified.payload;
  if (!payload.user_id || !payload.nonce) {
    return { ok: false, reason: 'TOKEN_NOT_USER_BOUND', status: 401 };
  }
  if (!(await isAuthorizedRpaSessionWriter(payload.user_id, payload.organization_id))) {
    return { ok: false, reason: 'FORBIDDEN_ROLE', status: 403 };
  }
  try {
    const { ownedDbTable } = await import('../../db/writeOwner');
    const { error } = await ownedDbTable('rpa_auth_token_redemptions').insert({
      nonce: payload.nonce,
      organization_id: payload.organization_id,
      platform: payload.platform,
      user_id: payload.user_id,
      token_expires_at: new Date(payload.expires_at).toISOString(),
    });
    if (error) {
      if (String((error as { code?: string }).code || '') === '23505') {
        return { ok: false, reason: 'TOKEN_ALREADY_USED', status: 401 };
      }
      return { ok: false, reason: 'TOKEN_REDEMPTION_UNAVAILABLE', status: 503 };
    }
  } catch {
    return { ok: false, reason: 'TOKEN_REDEMPTION_UNAVAILABLE', status: 503 };
  }
  return { ok: true, payload: payload as Payload & { user_id: string } };
}
