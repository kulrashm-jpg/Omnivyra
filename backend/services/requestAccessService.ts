import type { NextApiRequest, NextApiResponse } from 'next';
import { getSupabaseUserFromRequest } from './supabaseAuthService';
import { supabase } from '../db/supabaseClient';
import { checkRateLimit, type RateLimitConfig } from '../../lib/auth/rateLimit';
import { isPlatformSuperAdmin } from './rbacService';
import { logger } from './logger';
import { seedRequestContextFromRequest } from './requestContext';

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
    res.status(error === 'ACCOUNT_DELETED' ? 403 : 401).json({
      error: error === 'ACCOUNT_DELETED' ? 'Account has been deactivated.' : 'Invalid session',
      code: error ?? undefined,
    });
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
 * Unlike `assertOrgAccess`, this helper has NO req/res coupling: it returns
 * a boolean so service-layer callers (credit execution wrapper, background
 * jobs, queue processors) can gate work on membership without bringing in
 * HTTP plumbing. Platform super-admins are treated as members of every org.
 *
 * Throws only on unexpected DB errors. Returns `false` for plain non-members
 * so callers can produce the right domain-level error (credit execution
 * returns a typed result; background jobs should log + skip).
 */
export async function assertOrgMembership(
  userId:         string,
  organizationId: string,
): Promise<boolean> {
  if (!userId || !organizationId) return false;

  if (await isPlatformSuperAdmin(userId)) return true;

  const { data, error } = await supabase
    .from('user_company_roles')
    .select('id')
    .eq('user_id', userId)
    .eq('company_id', organizationId)
    .eq('status', 'active')
    .limit(1)
    .maybeSingle();

  if (error) {
    logger.error('assert_org_membership_db_error', {
      userId,
      organizationId,
      message: error.message,
    });
    throw new Error(`[assertOrgMembership] DB error: ${error.message}`);
  }

  return !!data;
}

export async function assertOrgAccess(
  req: NextApiRequest,
  res: NextApiResponse,
  organizationId: string,
): Promise<{ userId: string; superAdmin: boolean } | null> {
  const user = await requireAuthenticatedInternalUser(req, res);
  if (!user) return null;

  const superAdmin = await isPlatformSuperAdmin(user.id);
  if (superAdmin) {
    seedRequestContextFromRequest(req, { userId: user.id, orgId: organizationId });
    return { userId: user.id, superAdmin: true };
  }

  const { data, error } = await supabase
    .from('user_company_roles')
    .select('id')
    .eq('user_id', user.id)
    .eq('company_id', organizationId)
    .eq('status', 'active')
    .limit(1)
    .maybeSingle();

  if (error || !data) {
    logger.warn('org_scope_violation', { userId: user.id, organizationId });
    res.status(403).json({ error: 'ORG_SCOPE_VIOLATION' });
    return null;
  }

  seedRequestContextFromRequest(req, { userId: user.id, orgId: organizationId });
  return { userId: user.id, superAdmin: false };
}
