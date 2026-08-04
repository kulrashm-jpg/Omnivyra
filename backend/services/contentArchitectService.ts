import type { NextApiRequest, NextApiResponse } from 'next';
import { getSupabaseUserFromRequest } from './supabaseAuthService';
import { getUserRole, isSuperAdmin } from './rbacService';
import { getCompanyRoleIncludingInvited, Role } from './rbacPrimitives';
import {
  LEGACY_BRIDGE_HARD_EXPIRY_AT,
  evaluateBridgeCookieLifecycle,
} from '../security/legacyCookieSuperAdminBridge';
import { logger } from './logger';

/**
 * Content Architect: platform-level role (next to Super Admin) with access to all companies'
 * content to help refine strategy or campaigns.
 *
 * SEC-001A — AUTHORIZATION HARDENING. This helper previously returned true for
 * `content_architect_session === '1'`: an UNSIGNED, static value any client
 * could set, which then granted access to EVERY company across ~43 routes. It
 * now enforces exactly the guarantees SEC-001 Phase 2 already applied to the
 * super-admin bridge cookie, reusing those same primitives — no second
 * authentication system is introduced:
 *   • HMAC signature (`parseSignedBridgeCookie`) — a forged or tampered value
 *     cannot validate without BRIDGE_COOKIE_SECRET / SESSION_COOKIE_SECRET;
 *   • server-enforced max age — independent of the browser cookie expiry;
 *   • the bridge HARD EXPIRY — after LEGACY_BRIDGE_HARD_EXPIRY_AT this path is
 *     dead platform-wide and cannot be revived without a code change;
 *   • the Wave-3A dry-run switch (LEGACY_BRIDGE_DRY_RUN=1) — fail-closed
 *     simulation of bridge removal.
 *
 * DEPRECATED — REMOVAL DATE 2026-08-05T00:00:00Z (LEGACY_BRIDGE_HARD_EXPIRY_AT).
 * The canonical replacement already ships: /api/super-admin/content-architect-login
 * mints a real `auth_session` via SessionAuthorityService for the designated
 * CONTENT_ARCHITECT user, and authorization should resolve from that
 * authenticated identity. Callers still on this helper must migrate before the
 * expiry, after which every one of them fails closed.
 *
 * BREAKING (intended): a Phase-1 `=1` cookie is now rejected as `legacy_format`,
 * exactly as the super-admin bridge already rejects it. Legitimate architects
 * re-login once to receive a signed cookie.
 */
export function isContentArchitectSession(req: NextApiRequest): boolean {
  const raw = req.cookies?.content_architect_session;
  if (!raw) return false;

  // SEC-001C: the signature + dry-run + hard-expiry sequence is no longer
  // re-implemented here. It is ONE shared decision procedure owned by the
  // module that owns the lifecycle constants, so this cookie and the
  // super-admin cookie can never drift apart in behaviour or attribution.
  const verdict = evaluateBridgeCookieLifecycle(raw);
  // Narrow with `!== true`, not a truthy test — a truthy check on the
  // discriminant does not reliably narrow this union under the repo's TS
  // settings (the same trap SEC-001A hit on BridgeCookieParseResult).
  if (verdict.ok !== true) {
    const reason = verdict.reason;
    logger.warn('content_architect_cookie_rejected', {
      reason,
      action:
        reason === 'legacy_format'
          ? 'stale unsigned cookie — operator must re-login to receive a signed cookie'
          : reason === 'bad_signature'
            ? 'possible forgery or tamper'
            : reason === 'dry_run'
              ? 'LEGACY_BRIDGE_DRY_RUN=1 — simulating Wave-3 bridge removal'
              : reason === 'hard_expired'
                ? `legacy bridge hard-expired at ${LEGACY_BRIDGE_HARD_EXPIRY_AT.toISOString()}`
                : 'see reason',
    });
    return false;
  }

  return true;
}

/**
 * Returns the pinned company ID if the request is a Content Architect session
 * with a company cookie set; otherwise null (session can still be architect with access to all companies).
 */
export function getContentArchitectCompanyId(req: NextApiRequest): string | null {
  const companyId = req.cookies?.content_architect_company_id;
  if (!companyId || typeof companyId !== 'string') return null;
  const trimmed = companyId.trim();
  return trimmed || null;
}

/**
 * Content Architect is a platform-level role (next to Super Admin) with access to all companies'
 * content so they can help any company refine strategy or campaigns.
 *
 * If the request has a valid Content Architect session, grants access to the requested company
 * (any company). The content_architect_company_id cookie is for UI default only, not for gating.
 */
export function checkContentArchitectAccess(
  req: NextApiRequest,
  res: NextApiResponse,
  companyId: string | null | undefined
): { userId: string; role: string } | null | undefined {
  if (!isContentArchitectSession(req)) return undefined;
  if (!companyId) return undefined;
  return { userId: 'content_architect', role: 'CONTENT_ARCHITECT' };
}

/**
 * Resolve company access for any request: Content Architect (cookie) or Supabase user with role.
 * Sends 400/401/403 and returns null on failure; returns { userId, role } on success.
 *
 * Isolation: COMPANY_ADMIN only gets access when getUserRole(userId, companyId) returns a role
 * for that exact company — so a company's admin can only view their own company, never another.
 */
export async function resolveCompanyAccess(
  req: NextApiRequest,
  res: NextApiResponse,
  companyId?: string | null
): Promise<{ userId: string; role: string } | null> {
  if (!companyId) {
    res.status(400).json({ error: 'companyId required' });
    return null;
  }
  const archAccess = checkContentArchitectAccess(req, res, companyId);
  if (archAccess === null) return null;
  if (archAccess) return archAccess;
  const { user, error } = await getSupabaseUserFromRequest(req);
  if (error || !user) {
    res.status(401).json({ error: 'UNAUTHORIZED' });
    return null;
  }
  if (await isSuperAdmin(user.id)) {
    return { userId: user.id, role: 'SUPER_ADMIN' };
  }
  // Company Admin and other roles: access only for the specific company they have a role for
  let role: string | null = null;
  let roleError: string | null = null;
  const roleResult = await getUserRole(user.id, companyId);
  role = roleResult.role;
  roleError = roleResult.error;
  if (!role && (roleError === 'COMPANY_ACCESS_DENIED' || roleError === null)) {
    const fallbackRole = await getCompanyRoleIncludingInvited(user.id, companyId);
    if (
      fallbackRole === Role.COMPANY_ADMIN ||
      fallbackRole === Role.ADMIN ||
      fallbackRole === Role.SUPER_ADMIN
    ) {
      role = fallbackRole;
      roleError = null;
    }
  }
  if (roleError || !role) {
    if (isContentArchitectSession(req)) {
      return { userId: 'content_architect', role: 'CONTENT_ARCHITECT' };
    }
    res.status(403).json({ error: 'FORBIDDEN_ROLE' });
    return null;
  }
  return { userId: user.id, role: role as string };
}
