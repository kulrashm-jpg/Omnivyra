import { createApiRoute as __createApiRoute } from '../../../../lib/platform/routeFactory';
import { NextApiRequest, NextApiResponse } from 'next';
import { resolveUserContext } from '../../../../backend/services/userContextService';
import { updateUserRole } from '../../../../backend/services/userManagementService';
import { Role } from '../../../../backend/services/rbacService';
import { withRBAC } from '../../../../backend/middleware/withRBAC';
import { requireCapability } from '../../../../backend/security/requireCapability';
import { IDENTITY_ADMIN_ASSIGN } from '../../../../shared/contracts/security';
import { requireAdminRateLimit } from '../../../../backend/services/requestAccessService';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'PATCH') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  // Closure-015J (R-10): Closure-014 (D) per-route write rate limit — before authorization
  // and any business work; sensitive = strict in-process budget when Redis is unavailable.
  if (!(await requireAdminRateLimit(req, res, 'rl:users:role', 10, 60, { sensitive: true }))) return;

  const { userId } = req.query;
  if (!userId || typeof userId !== 'string') {
    return res.status(400).json({ error: 'userId required' });
  }

  const { role, companyId } = req.body || {};
  if (!role || !companyId) {
    return res.status(400).json({ error: 'role and companyId are required' });
  }

  // Closure-015E — changing a member's role is identity assignment. A company-
  // scoped role check (withRBAC above) never authorizes it on its own: the same
  // gate as every other super-admin identity assignment (admin/invite-user,
  // super-admin/users/create, companies/promote-admin) — IDENTITY_ADMIN_ASSIGN,
  // platform-tier (platform write authority required) with mandatory passkey
  // step-up on a trusted device — runs before any membership is read or written.
  const guard = await requireCapability(req, res, {
    capability: IDENTITY_ADMIN_ASSIGN,
    reason: `role change for ${userId} in company ${String(companyId)} (users/role)`,
    organizationId: String(companyId),
    resourceId: userId,
  });
  if (guard.ok !== true) return;

  const requester = await resolveUserContext(req);
  const result = await updateUserRole(userId, String(companyId), String(role), requester);
  if (!result.ok) {
    const err = result as { status: number; error: string; allowedRoles?: ReadonlyArray<string> };
    return res.status(err.status).json(err.allowedRoles ? { error: err.error, allowedRoles: err.allowedRoles } : { error: err.error });
  }

  return res.status(200).json({ success: true });
}

export default __createApiRoute(withRBAC(handler, [Role.SUPER_ADMIN, Role.ADMIN]), { route: '/api/users/:userId/role' });
