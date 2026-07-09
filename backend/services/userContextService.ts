import type { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../db/supabaseClient';
import { resolveUserContext as resolveFromLib, type UserContext, type MembershipType } from '../lib/userContext';
import { getSupabaseUserFromRequest } from './supabaseAuthService';
import { getCompanyRoleIncludingInvited, normalizePermissionRole, Role } from './rbacPrimitives';
import { assertTenantAccess } from '../security/TenantGuard';

export type { UserContext, MembershipType };

const DEFAULT_MEMBERSHIP: MembershipType = 'INTERNAL';

function normalizeMembershipType(value: string | null | undefined): MembershipType {
  const v = (value || '').trim().toUpperCase();
  return v === 'EXTERNAL' ? 'EXTERNAL' : 'INTERNAL';
}

export const resolveUserContext = async (req?: NextApiRequest): Promise<UserContext> => {
  if (!req) return resolveFromLib();

  const { user, error } = await getSupabaseUserFromRequest(req);
  if (error || !user?.id) {
    return resolveFromLib();
  }

  const { data: roleRows, error: roleError } = await supabase
    .from('user_company_roles')
    .select('company_id, role, status')
    .eq('user_id', user.id);

  if (roleError) {
    return {
      userId: user.id,
      role: 'user',
      companyIds: [],
      defaultCompanyId: '',
    };
  }

  const activeRoles = (roleRows || []).filter((row) => row.status === 'active');
  const companyIds = Array.from(
    new Set(activeRoles.map((row) => row.company_id).filter(Boolean))
  ) as string[];
  const isAdmin = activeRoles.some((row) => {
    const normalized = normalizePermissionRole(row.role || '');
    return normalized === Role.COMPANY_ADMIN || normalized === Role.SUPER_ADMIN;
  });

  const membershipByCompany: Record<string, MembershipType> = {};
  for (const row of activeRoles) {
    if (row.company_id) {
      membershipByCompany[row.company_id] = DEFAULT_MEMBERSHIP;
    }
  }
  const defaultCompanyId = companyIds[0] || '';
  const membershipType = DEFAULT_MEMBERSHIP;

  return {
    userId: user.id,
    role: isAdmin ? 'admin' : 'user',
    companyIds,
    defaultCompanyId,
    membershipType,
    membershipByCompany: Object.keys(membershipByCompany).length ? membershipByCompany : undefined,
  };
};

/** True if the resolved context is an external (agency) member. No permission change; for future visibility filtering. */
export function isExternalMember(userContext: UserContext): boolean {
  return userContext.membershipType === 'EXTERNAL';
}

/** True if user is external for the given company. Use when filtering by company. */
export function isExternalMemberForCompany(
  userContext: UserContext,
  companyId: string
): boolean {
  return userContext.membershipByCompany?.[companyId] === 'EXTERNAL';
}

/**
 * SHIM: tenant authorization for legacy callers. The canonical decision
 * runs through `TenantGuard.assertTenantAccess`; this helper preserves
 * two pre-existing fallbacks for behavior parity:
 *
 *   1. content-architect cookie principal — admin-tier global access
 *      established by /api/super-admin/content-architect-login. This
 *      principal has userId='content_architect', is NOT in user_company_roles,
 *      and would otherwise be rejected by the canonical guard.
 *
 *   2. invited admin — a user with role IN (COMPANY_ADMIN, ADMIN, SUPER_ADMIN)
 *      and status='invited' may administer the company before accepting the
 *      invite. Existing behavior; preserved here so admin tooling that
 *      depends on it does not regress.
 *
 * Tightenings inherited from the canonical guard:
 *   - soft-deleted / suspended companies are now rejected even for
 *     invited admins (ORG_NOT_FOUND / ORG_INACTIVE override the fallback)
 *   - bridge principals (legacyCookieSuperAdmin) cannot satisfy tenant
 *     access — they have no tenant identity
 *
 * New code should call `requireTenantAccess` directly. This helper is
 * retained to avoid churn in 30+ existing callsites.
 */
export const enforceCompanyAccess = async (input: {
  req: NextApiRequest;
  res: NextApiResponse;
  companyId?: string | null;
  campaignId?: string | null;
  requireCampaignId?: boolean;
}): Promise<UserContext | null> => {
  const user = await resolveUserContext(input.req);

  if (!input.companyId) {
    console.warn('MISSING_COMPANY_ID', { path: input.req.url });
    input.res.status(400).json({ error: 'companyId required' });
    return null;
  }

  // Canonical fast path: principal is an active member of an active org.
  // Soft-delete + bridge-principal rejection happen inside assertTenantAccess.
  const canonical = await assertTenantAccess({
    userId:         user.userId,
    organizationId: input.companyId,
  });

  if (canonical.ok === true) {
    if (input.requireCampaignId && !input.campaignId) {
      console.warn('MISSING_CAMPAIGN_ID', { path: input.req.url, companyId: input.companyId });
      input.res.status(400).json({ error: 'campaignId required' });
      return null;
    }
    return user;
  }

  // Transient membership/org read failure (DB/network blip): do NOT report as
  // a denial. A legitimate member must never be locked out by a temporary
  // lookup error — return a retryable 503 so the client retries instead of
  // surfacing a misleading "Access denied to company".
  if (canonical.reason === 'TENANT_LOOKUP_ERROR') {
    console.warn('TENANT_LOOKUP_ERROR', {
      path: input.req.url,
      companyId: input.companyId,
      userId: user.userId,
    });
    input.res.status(503).json({
      error: 'Membership check is temporarily unavailable. Please try again.',
      code: 'TENANT_LOOKUP_ERROR',
      retryable: true,
    });
    return null;
  }

  // Soft-deleted / missing companies: deny. Don't apply legacy fallbacks
  // — a deleted org must remain locked, and an unknown id has no fallback
  // to apply.
  if (canonical.reason === 'ORG_NOT_FOUND' || canonical.reason === 'ORG_INACTIVE') {
    console.warn('ACCESS_DENIED', {
      path: input.req.url,
      companyId: input.companyId,
      userId: user.userId,
      role: user.role,
      reason: canonical.reason,
    });
    input.res.status(403).json({ error: 'Access denied to company' });
    return null;
  }

  // Legacy fallback (a): content-architect cookie principal.
  if (user.userId === 'content_architect') {
    if (input.requireCampaignId && !input.campaignId) {
      input.res.status(400).json({ error: 'campaignId required' });
      return null;
    }
    return user;
  }

  // Legacy fallback (b): invited admin role.
  const fallbackRole = await getCompanyRoleIncludingInvited(user.userId, input.companyId);
  const allowedViaInvited =
    fallbackRole === Role.COMPANY_ADMIN ||
    fallbackRole === Role.ADMIN ||
    fallbackRole === Role.SUPER_ADMIN;
  if (allowedViaInvited) {
    if (input.requireCampaignId && !input.campaignId) {
      console.warn('MISSING_CAMPAIGN_ID', { path: input.req.url, companyId: input.companyId });
      input.res.status(400).json({ error: 'campaignId required' });
      return null;
    }
    return user;
  }

  console.warn('ACCESS_DENIED', {
    path: input.req.url,
    companyId: input.companyId,
    userId: user.userId,
    role: user.role,
    reason: canonical.reason,
  });
  // HARDEN-007: observe tenant-access denials (fail-safe; no behavior change).
  try {
    const { recordRawCounter } = require('../observability');
    recordRawCounter('authz.tenant.denied', 1, { reason: String(canonical.reason ?? 'denied') });
  } catch { /* fail-safe */ }
  input.res.status(403).json({ error: 'Access denied to company' });
  return null;
};
