import { createApiRoute as __createApiRoute } from '../../../../../lib/platform/routeFactory';
import { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../../../../backend/db/supabaseClient';
import { requireCompanyContext } from '../../../../../backend/services/companyContextGuardService';
import { getSupabaseUserFromRequest } from '../../../../../backend/services/supabaseAuthService';
import { getUserRole, isSuperAdmin, Role } from '../../../../../backend/services/rbacService';
import { normalizeRole } from '../../../../../backend/services/rbacPrimitives';
import { requireCapability } from '../../../../../backend/security/requireCapability';
import { IDENTITY_ADMIN_ASSIGN } from '../../../../../shared/contracts/security';
import { requireAdminRateLimit } from '../../../../../backend/services/requestAccessService';

const mapAppRoleToRbac = (role: string): Role | null => {
  const normalized = role.toUpperCase();
  if (normalized === 'COMPANY_ADMIN') return Role.ADMIN;
  if (normalized === 'USER') return Role.CONTENT_CREATOR;
  return null;
};

const ensureCompanyAdminAccess = async (
  req: NextApiRequest,
  res: NextApiResponse,
  companyId: string
): Promise<{ userId: string } | null> => {
  const { user, error } = await getSupabaseUserFromRequest(req);
  if (error || !user) {
    res.status(401).json({ error: 'UNAUTHORIZED' });
    return null;
  }

  const superAdmin = await isSuperAdmin(user.id);
  if (superAdmin) {
    return { userId: user.id };
  }

  const { role, error: roleError } = await getUserRole(user.id, companyId);
  if (roleError === 'COMPANY_ACCESS_DENIED') {
    res.status(403).json({ error: 'COMPANY_ACCESS_DENIED' });
    return null;
  }
  if (roleError || !role) {
    res.status(403).json({ error: 'ROLE_NOT_ASSIGNED' });
    return null;
  }
  if (role !== Role.ADMIN) {
    res.status(403).json({ error: 'NOT_AUTHORIZED' });
    return null;
  }

  return { userId: user.id };
};

/**
 * Closure-015F — governed role change on an EXISTING membership (no insert path:
 * the handler requires the membership to exist). Refuses, before any write:
 *   - a SUPER_ADMIN membership in ANY status (granted only via identity.admin.assign,
 *     revoked only via identity.admin.revoke — never rewritten here);
 *   - a non-active membership (an invited one activates invitation.role on
 *     acceptance; an inactive / expired one is not a member) — as
 *     companies/promote-admin and PATCH /api/users/[userId]/role.
 * The write is a compare-and-set on the row read (id, status 'active', role), so a
 * concurrent change (e.g. a promotion to SUPER_ADMIN) is never overwritten.
 */
type GovernedRoleChange =
  | { ok: true }
  | { ok: false; status: number; error: string };
const changeActiveMembershipRole = async (userId: string, companyId: string, role: string): Promise<GovernedRoleChange> => {
  const { data: current, error: readError } = await supabase
    .from('user_company_roles')
    .select('id, role, status')
    .eq('user_id', userId)
    .eq('company_id', companyId)
    .limit(1);
  if (readError) return { ok: false, status: 500, error: 'FAILED_TO_LOOKUP_USER' };
  const row = (current ?? [])[0] as { id: string; role: string; status: string | null } | undefined;
  if (!row) return { ok: false, status: 404, error: 'USER_NOT_FOUND' };
  if (normalizeRole(row.role) === Role.SUPER_ADMIN) {
    return { ok: false, status: 403, error: 'SUPER_ADMIN_MEMBERSHIP_NOT_CHANGEABLE_HERE' };
  }
  if (row.status !== 'active') return { ok: false, status: 409, error: 'STALE_MEMBERSHIP' };
  // Snapshot what the compare-and-set compares against, at read time.
  const readId = row.id;
  const readRole = row.role;
  if (readRole === role) return { ok: true };
  const { data: updated, error: updateError } = await supabase
    .from('user_company_roles')
    .update({ role, updated_at: new Date().toISOString() })
    .eq('id', readId)
    .eq('status', 'active')
    .eq('role', readRole)
    .select('id');
  if (updateError) return { ok: false, status: 500, error: 'FAILED_TO_UPDATE_ROLE' };
  if (!updated || updated.length === 0) return { ok: false, status: 409, error: 'STALE_MEMBERSHIP' };
  return { ok: true };
};

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'PATCH') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  // Closure-015J (R-10): Closure-014 (D) per-route write rate limit — before authorization
  // and any business work; sensitive = strict in-process budget when Redis is unavailable.
  if (!(await requireAdminRateLimit(req, res, 'rl:company:users:role', 10, 60, { sensitive: true }))) return;

  const { userId } = req.query;
  if (!userId || typeof userId !== 'string') {
    return res.status(400).json({ error: 'userId required' });
  }

  const { companyId, role } = req.body || {};
  if (!companyId || !role) {
    return res.status(400).json({ error: 'companyId and role are required' });
  }

  const companyContext = await requireCompanyContext({ req, res, companyId: String(companyId).trim() });
  if (!companyContext) return;

  const access = await ensureCompanyAdminAccess(req, res, companyContext.companyId);
  if (!access) return;

  const desiredRole = String(role).toUpperCase();
  if (desiredRole !== 'COMPANY_ADMIN' && desiredRole !== 'USER') {
    return res.status(400).json({ error: 'ROLE_NOT_ALLOWED' });
  }

  const rbacRole = mapAppRoleToRbac(desiredRole);
  if (!rbacRole) {
    return res.status(400).json({ error: 'INVALID_ROLE_MAPPING' });
  }

  // Closure-015F — a role change is identity assignment. The company-scoped
  // checks above (requireCompanyContext / ensureCompanyAdminAccess) never
  // authorize it on their own: the same gate as every other super-admin identity
  // assignment (IDENTITY_ADMIN_ASSIGN — platform-tier, mandatory passkey step-up
  // on a trusted device) runs before the membership is read or written.
  const guard = await requireCapability(req, res, {
    capability: IDENTITY_ADMIN_ASSIGN,
    reason: `company role change for ${userId} in company ${companyContext.companyId} (company/users/role)`,
    organizationId: companyContext.companyId,
    resourceId: userId,
  });
  if (guard.ok !== true) return;

  // The membership read, refusals and the conditional write (canonical authority:
  // user_company_roles), all bound to the company the context guard authorized.
  const result = await changeActiveMembershipRole(userId, companyContext.companyId, rbacRole);
  if (result.ok !== true) return res.status(result.status).json({ error: result.error });

  return res.status(200).json({ success: true });
}

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/company/users/:userId/role' });
