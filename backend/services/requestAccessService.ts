import type { NextApiRequest, NextApiResponse } from 'next';
import { getSupabaseUserFromRequest } from './supabaseAuthService';
import { checkRateLimit, type RateLimitConfig } from '../../lib/auth/rateLimit';
import { isPlatformSuperAdmin } from './rbacService';
import { logger } from './logger';
import { seedRequestContextFromRequest } from './requestContext';
import {
  assertTenantAccess,
  requireTenantAccess,
} from '../security/TenantGuard';

export async function requireAdminRateLimit(
  req: NextApiRequest,
  res: NextApiResponse,
  keyPrefix: string,
  limit = 30,
  windowSecs = 60,
): Promise<boolean> {
  seedRequestContextFromRequest(req);
  const ip = String(req.headers['x-forwarded-for'] ?? req.socket?.remoteAddress ?? 'unknown')
    .split(',')[0]
    .trim();

  const config: RateLimitConfig = { keyPrefix, limit, windowSecs };
  const result = await checkRateLimit(ip, config);
  if (!result.allowed) {
    logger.warn('admin_rate_limit_blocked', { keyPrefix, ip });
    res.status(429).json({ error: 'Too many requests. Try again later.' });
    return false;
  }
  return true;
}

export async function requireAuthenticatedInternalUser(
  req: NextApiRequest,
  res: NextApiResponse,
): Promise<{ id: string; email?: string | null } | null> {
  seedRequestContextFromRequest(req);
  const { user, error } = await getSupabaseUserFromRequest(req);
  if (error || !user) {
    logger.warn('auth_required_failed', { error: error ?? 'UNKNOWN_AUTH_ERROR' });
    // Phase 2.B — distinct error codes for lifecycle states.
    if (error === 'ACCOUNT_DELETED') {
      res.status(403).json({ error: 'Account has been deactivated.', code: 'ACCOUNT_DELETED' });
      return null;
    }
    if (error === 'ACCOUNT_SUSPENDED') {
      res.status(403).json({
        error: 'Account is suspended. Contact your administrator.',
        code: 'ACCOUNT_SUSPENDED',
      });
      return null;
    }
    if (error === 'SESSION_REVOKED') {
      res.status(401).json({
        error: 'Session was revoked. Please sign in again.',
        code: 'SESSION_REVOKED',
      });
      return null;
    }
    if (error === 'ACCOUNT_INVITED') {
      res.status(403).json({
        error: 'Account is pending invitation acceptance. Complete onboarding to continue.',
        code: 'ACCOUNT_INVITED',
      });
      return null;
    }
    res.status(401).json({ error: 'Invalid session', code: error ?? undefined });
    return null;
  }
  seedRequestContextFromRequest(req, { userId: user.id });
  return user;
}

export async function requireSuperAdminUser(
  req: NextApiRequest,
  res: NextApiResponse,
): Promise<{ id: string; email?: string | null } | null> {
  const user = await requireAuthenticatedInternalUser(req, res);
  if (!user) return null;

  const ok = await isPlatformSuperAdmin(user.id);
  if (!ok) {
    logger.warn('super_admin_required_failed', { userId: user.id });
    res.status(403).json({ error: 'SUPER_ADMIN_REQUIRED' });
    return null;
  }
  seedRequestContextFromRequest(req, { userId: user.id });
  return user;
}

/**
 * Service-layer membership check — verify a userId belongs to an organization.
 *
 * SHIM: this is now a thin wrapper over `TenantGuard.assertTenantAccess`.
 * It exists for source-compatibility — the canonical authority is
 * `assertTenantAccess`, which adds soft-delete enforcement and bridge-
 * principal rejection that this helper previously bypassed. New code
 * should call `assertTenantAccess` directly so the failure reason is
 * available for richer error mapping.
 *
 * Returns `false` for plain non-members AND for soft-deleted orgs so
 * callers can produce the right domain-level error (credit execution
 * returns a typed result; background jobs should log + skip).
 */
export async function assertOrgMembership(
  userId:         string,
  organizationId: string,
): Promise<boolean> {
  if (!userId || !organizationId) return false;
  const result = await assertTenantAccess({ userId, organizationId });
  return result.ok === true;
}

/**
 * HTTP-route org access check — verify the request principal belongs to
 * the organization. SHIM: now delegates to `TenantGuard.requireTenantAccess`,
 * which composes principal resolution + active membership + active org +
 * platform-super-admin bypass + bridge-principal rejection. The return
 * shape is preserved for existing callers (`{ userId, superAdmin } | null`).
 *
 * On rejection, the canonical guard writes the standard 401/403/404 + an
 * audit row before returning null — same external contract as before, with
 * stricter centralised behaviour.
 */
export async function assertOrgAccess(
  req: NextApiRequest,
  res: NextApiResponse,
  organizationId: string,
): Promise<{ userId: string; superAdmin: boolean } | null> {
  const access = await requireTenantAccess(req, res, organizationId);
  if (!access) return null;
  // requireTenantAccess already seeded the request context with userId + orgId.
  return { userId: access.userId, superAdmin: access.isPlatformSuperAdmin };
}
