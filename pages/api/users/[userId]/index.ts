import { createApiRoute as __createApiRoute } from '../../../../lib/platform/routeFactory';
import { NextApiRequest, NextApiResponse } from 'next';
import { resolveUserContext } from '../../../../backend/services/userContextService';
import { removeUser } from '../../../../backend/services/userManagementService';
import { Role } from '../../../../backend/services/rbacService';
import { withRBAC } from '../../../../backend/middleware/withRBAC';
import { requireCapability } from '../../../../backend/security/requireCapability';
import { IDENTITY_ADMIN_DELETE } from '../../../../shared/contracts/security';
import { requireAdminRateLimit } from '../../../../backend/services/requestAccessService';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'DELETE') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  // Closure-015J (R-10): Closure-014 (D) per-route write rate limit — before authorization
  // and any business work; sensitive = strict in-process budget when Redis is unavailable.
  if (!(await requireAdminRateLimit(req, res, 'rl:users:remove', 10, 60, { sensitive: true }))) return;

  const { userId } = req.query;
  if (!userId || typeof userId !== 'string') {
    return res.status(400).json({ error: 'userId required' });
  }

  const companyId = req.query.companyId as string | undefined;
  if (!companyId) {
    return res.status(400).json({ error: 'companyId required' });
  }

  // Closure-015F — removing a member from a company is identity deletion: the
  // capability the super-admin membership removal uses (super-admin/users DELETE)
  // — IDENTITY_ADMIN_DELETE, platform-tier (platform write authority required),
  // registered passkey step-up on a trusted device — before the membership is
  // read or deleted. No organizationId: the capability is platform-tier (no tenant
  // role can hold it; platformCapabilities.ts), and AuthorizationService waives the
  // actor-in-target-org check only for IDENTITY_ADMIN_ASSIGN, so binding it would
  // refuse every platform SA who is not a member of the target company
  // (NOT_ORG_MEMBER). The target company is recorded in the audit reason.
  const guard = await requireCapability(req, res, {
    capability: IDENTITY_ADMIN_DELETE,
    reason: `remove ${userId} from company ${String(companyId)} (users/[userId])`,
    resourceId: `${String(companyId)}:${userId}`,
  });
  if (guard.ok !== true) return;

  const requester = await resolveUserContext(req);
  const result = await removeUser(userId, String(companyId), requester);
  if (!result.ok) {
    const err = result as { status: number; error: string };
    return res.status(err.status).json({ error: err.error });
  }

  return res.status(200).json({ success: true });
}

export default __createApiRoute(withRBAC(handler, [Role.SUPER_ADMIN, Role.ADMIN]), { route: '/api/users/:userId' });
