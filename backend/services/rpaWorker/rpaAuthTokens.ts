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
 * Retention for rpa_auth_token_redemptions (single-use nonce ledger).
 *
 * A redemption row only has to outlive the token it burns: once the token is
 * expired, verifyRpaAuthToken refuses it (`Date.now() > payload.expires_at` →
 * TOKEN_EXPIRED) before the nonce is ever looked at, and consumeRpaAuthToken
 * re-checks expiry AFTER its insert (see below), so a pruned nonce can never be
 * redeemed again. Rows are pruned only when
 *   token_expires_at < now - RPA_TOKEN_REDEMPTION_PRUNE_MARGIN_MS   (strict)
 * The margin absorbs clock skew between the pruning instance and a redeeming
 * instance; it is far larger than any plausible skew and 2x the token TTL.
 */
export const RPA_TOKEN_REDEMPTION_PRUNE_MARGIN_MS = 60 * 60 * 1000;
/** Hard upper bound on rows deleted by one prune call. */
export const RPA_TOKEN_REDEMPTION_PRUNE_MAX = 500;
/** Rows pruned best-effort, tenant-scoped, on each successful redemption. */
export const RPA_TOKEN_REDEMPTION_PRUNE_ON_REDEEM = 20;

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
  // Expiry re-check AFTER the nonce insert. Pruning deletes a nonce only once
  // its token expired more than the margin ago, so a redemption that verified
  // a still-valid token but reached the insert only after such a prune would
  // otherwise succeed a second time. Any insert that lands after the token's
  // expiry is refused here — so pruning can never re-enable a token. Fail
  // closed: the (expired) token stays burnt.
  if (Date.now() > payload.expires_at) {
    return { ok: false, reason: 'TOKEN_EXPIRED', status: 401 };
  }
  // Bounded, tenant-scoped, best-effort retention (no cron/schedule).
  try {
    await pruneExpiredRpaAuthTokenRedemptions({
      organizationId: payload.organization_id,
      limit: RPA_TOKEN_REDEMPTION_PRUNE_ON_REDEEM,
    });
  } catch {
    /* cleanup never affects the redemption */
  }
  return { ok: true, payload: payload as Payload & { user_id: string } };
}

/**
 * Delete redemption rows whose token expired more than
 * RPA_TOKEN_REDEMPTION_PRUNE_MARGIN_MS ago. Bounded (limit, capped at
 * RPA_TOKEN_REDEMPTION_PRUNE_MAX), optionally tenant-scoped, oldest first.
 * The DELETE repeats the expiry predicate (and tenant scope), so a row can
 * only be removed if it is prunable at delete time. Never throws on DB errors.
 * `db` defaults to the owned write seam (service role).
 */
export async function pruneExpiredRpaAuthTokenRedemptions(
  opts: {
    organizationId?: string;
    limit?: number;
    nowMs?: number;
    db?: { from: (table: string) => any };
  } = {},
): Promise<{ deleted: number; cutoff: string }> {
  const now = opts.nowMs ?? Date.now();
  const cutoff = new Date(now - RPA_TOKEN_REDEMPTION_PRUNE_MARGIN_MS).toISOString();
  const requested = Number.isFinite(opts.limit) ? Math.floor(opts.limit as number) : 100;
  const limit = Math.max(1, Math.min(requested, RPA_TOKEN_REDEMPTION_PRUNE_MAX));
  try {
    // Resolve the table accessor first: query builders are thenables, so they
    // must never be awaited before the chain is complete.
    const from: (t: string) => any = opts.db
      ? (t: string) => opts.db!.from(t)
      : (await import('../../db/writeOwner')).ownedDbTable;
    let q = from('rpa_auth_token_redemptions').select('nonce').lt('token_expires_at', cutoff);
    if (opts.organizationId) q = q.eq('organization_id', opts.organizationId);
    const { data, error } = await q.order('token_expires_at', { ascending: true }).limit(limit);
    if (error || !Array.isArray(data) || data.length === 0) return { deleted: 0, cutoff };
    const nonces = (data as Array<{ nonce: string }>).map((r) => r.nonce).slice(0, limit);
    let del = from('rpa_auth_token_redemptions').delete().in('nonce', nonces).lt('token_expires_at', cutoff);
    if (opts.organizationId) del = del.eq('organization_id', opts.organizationId);
    const { error: delErr } = await del;
    return { deleted: delErr ? 0 : nonces.length, cutoff };
  } catch {
    return { deleted: 0, cutoff };
  }
}
