/**
 * Extension auth middleware — verify session token + HMAC signature on
 * protected /api/extension/* endpoints.
 *
 * Usage inside a Next.js API route:
 *   const auth = await requireExtensionAuth(req, res);
 *   if (!auth) return; // middleware already wrote the error response
 *   const { session } = auth;
 *
 * Dev bypass: setting DEV_EXTENSION_AUTH_BYPASS=1 skips both session-token
 * and HMAC checks — the request body's `organization_id` becomes the
 * tenant. Only honored when NODE_ENV !== 'production'. Used to unblock
 * local DOM-scraper testing without grinding through the SW HMAC chain.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import {
  verifyExtensionSessionToken,
  verifyExtensionRequestSignature,
} from '@/backend/services/extensionSessionService';
import { supabase } from '@/backend/db/supabaseClient';
import { hasCommunityAiCapability } from '@/backend/services/rbac/communityAiCapabilities';
import { isPlatformSuperAdmin } from '@/backend/services/rbacService';

/**
 * e9 BLOCKING (b), 2026-11-13: an extension token EXECUTES engagement actions (command leasing, action results, event
 * ingestion). Minting one now needs EXECUTE_ACTIONS (extension/bootstrap), and EVERY token request re-checks that the
 * token's user STILL holds EXECUTE_ACTIONS in the token's company - so a role downgrade or removal revokes the token
 * instead of leaving it valid until expiry.
 *   - no longer allowed  -> 403 EXTENSION_ROLE_REVOKED
 *   - role lookup FAILED -> 503 ROLE_CHECK_UNAVAILABLE (retryable; nothing granted - a DB blip must neither let a
 *     revoked user through nor read as a revocation)
 * Only ALLOWED results are cached (EXTENSION_ROLE_CACHE_MS): a re-grant takes effect at once; a revoke within that.
 */
export const EXTENSION_ROLE_CACHE_MS = 60_000;
/** Bounded (05): expired entries are pruned on write, and the map never exceeds this many live entries. */
export const EXTENSION_ROLE_CACHE_MAX = 5_000;
const extensionRoleCache = new Map<string, number>();
function cacheAllow(key: string, nowMs: number): void {
  for (const [k, until] of extensionRoleCache) if (until <= nowMs) extensionRoleCache.delete(k);
  if (extensionRoleCache.size >= EXTENSION_ROLE_CACHE_MAX) {
    const oldest = extensionRoleCache.keys().next().value; // insertion order: the oldest entry
    if (oldest !== undefined) extensionRoleCache.delete(oldest);
  }
  extensionRoleCache.set(key, nowMs + EXTENSION_ROLE_CACHE_MS);
}
export function __extensionRoleCacheSizeForTests(): number { return extensionRoleCache.size; }
export function __resetExtensionRoleCacheForTests(): void { extensionRoleCache.clear(); }

export async function extensionUserMayExecute(userId: string, orgId: string, nowMs: number = Date.now()): Promise<'allow' | 'deny' | 'unavailable'> {
  const key = `${userId}:${orgId}`;
  if ((extensionRoleCache.get(key) ?? 0) > nowMs) return 'allow';
  try {
    const { data, error } = await supabase
      .from('user_company_roles')
      .select('role')
      .eq('user_id', userId)
      .eq('company_id', orgId)
      .eq('status', 'active');
    if (error) return 'unavailable';
    // The ONE capability check (05: reuse hasCommunityAiCapability). The UPPER-CASING is NOT redundant: the helper's
    // normalizePermissionRole does not fold case, so a stored 'company_admin' would otherwise be refused (pinned).
    let ok = (Array.isArray(data) ? data : []).some((r: { role?: unknown }) => hasCommunityAiCapability(String(r.role ?? '').trim().toUpperCase(), 'EXECUTE_ACTIONS'));
    // EXECUTE_ACTIONS includes SUPER_ADMIN, as enforceRole honours it. If isPlatformSuperAdmin swallows a read
    // failure as "not a super-admin", the result is a false DENY - safe (fails closed), deliberately not a 503.
    if (!ok) ok = await isPlatformSuperAdmin(userId);
    if (!ok) return 'deny';
    cacheAllow(key, nowMs);
    return 'allow';
  } catch {
    return 'unavailable';
  }
}

function take(h: string | string[] | undefined) { return (Array.isArray(h) ? h[0] : h) || ''; }

async function inferDevBypassOrgId(req: NextApiRequest): Promise<string | null> {
  const path = (req.url || '').split('?')[0] || '';
  const body = (req.body && typeof req.body === 'object' ? req.body : {}) as {
    commandId?: unknown;
    command_id?: unknown;
  };
  const commandId = String(body.commandId ?? body.command_id ?? req.query.commandId ?? req.query.command_id ?? '').trim();

  if (commandId) {
    const { data } = await supabase
      .from('community_ai_actions')
      .select('organization_id')
      .eq('id', commandId)
      .maybeSingle();
    return typeof data?.organization_id === 'string' ? data.organization_id : null;
  }

  if (req.method?.toUpperCase() === 'GET' && path === '/api/extension/commands') {
    const { data } = await supabase
      .from('community_ai_actions')
      .select('organization_id')
      .eq('status', 'pending')
      .eq('execution_mode', 'browser')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    return typeof data?.organization_id === 'string' ? data.organization_id : null;
  }

  return null;
}

export async function requireExtensionAuth(req: NextApiRequest, res: NextApiResponse) {
  // Dev bypass — short-circuit the entire HMAC/session chain when the
  // operator opts in via env. Refuses to run in production no matter what
  // the env says, so a stray flag in a deployed env can't disable auth.
  const bypassEnabled =
    process.env.NODE_ENV !== 'production'
    && (process.env.DEV_EXTENSION_AUTH_BYPASS === '1'
        || process.env.DEV_EXTENSION_AUTH_BYPASS === 'true');
  if (bypassEnabled) {
    // Accept all three orgId casings — the codebase isn't consistent and
    // refusing one shape silently breaks the dev-bypass redeem chain
    // (authBridge sends `orgId` camelCase from the SW, while events/dms
    // sends `organization_id` snake_case from the scraper).
    const body = (req.body && typeof req.body === 'object' ? req.body : {}) as {
      organization_id?: unknown;
      org_id?: unknown;
      orgId?: unknown;
    };
    const orgFromBody = String(body.organization_id ?? body.org_id ?? body.orgId ?? '').trim();
    const orgFromQuery = String(req.query.organization_id ?? req.query.org_id ?? req.query.orgId ?? '').trim();
    const orgId = orgFromBody || orgFromQuery || await inferDevBypassOrgId(req);
    if (!orgId) {
      res.status(400).json({ success: false, error: 'BYPASS_REQUIRES_ORG_ID' });
      return null;
    }
    // Use a deterministic sentinel UUID for the bypass user so downstream
    // writes that need a uuid-typed user_id (e.g. extension_sessions
    // heartbeat) succeed instead of erroring on type mismatch. The string
    // 'dev-bypass-user' was easier to read in logs but blocked uuid columns.
    return {
      session: {
        userId: '00000000-0000-4000-8000-000000000001',
        orgId,
        expiresAt: Date.now() + 24 * 60 * 60 * 1000,
        hmacNonce: 'dev-bypass',
      },
    };
  }

  const authHeader = take(req.headers.authorization);
  const bearer = authHeader.replace(/^Bearer\s+/i, '').trim();
  const session = verifyExtensionSessionToken(bearer);
  if (!session) {
    res.status(401).json({ success: false, error: 'INVALID_SESSION' });
    return null;
  }

  // Reconstruct raw body for signature verification. Next.js has already
  // parsed JSON into req.body; re-serialize with stable formatting. The
  // extension also serializes via JSON.stringify, so this matches for POST.
  // For GET the body is empty.
  const rawBody = req.method && req.method.toUpperCase() !== 'GET'
    ? (req.body ? JSON.stringify(req.body) : '')
    : '';

  const path = (req.url || '').split('?')[0] || '';
  const verify = verifyExtensionRequestSignature({
    method: req.method || 'GET',
    path,
    rawBody,
    timestampHeader: req.headers['x-omnivyra-timestamp'],
    nonceHeader: req.headers['x-omnivyra-nonce'],
    signatureHeader: req.headers['x-omnivyra-signature'],
    session,
  });

  if (!verify.ok) {
    res.status(401).json({ success: false, error: 'SIGNATURE_INVALID', reason: verify.reason });
    return null;
  }

  const may = await extensionUserMayExecute(session.userId, session.orgId);
  if (may === 'unavailable') {
    res.status(503).json({ success: false, error: 'ROLE_CHECK_UNAVAILABLE', retryable: true });
    return null;
  }
  if (may === 'deny') {
    res.status(403).json({ success: false, error: 'EXTENSION_ROLE_REVOKED' });
    return null;
  }

  return { session };
}
