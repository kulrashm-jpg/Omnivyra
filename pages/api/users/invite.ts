import { createApiRoute as __createApiRoute } from '../../../lib/platform/routeFactory';
import { NextApiRequest, NextApiResponse } from 'next';
import { Role } from '../../../backend/services/rbacService';
import { withRBAC } from '../../../backend/middleware/withRBAC';

/**
 * POST /api/users/invite — RETIRED (Closure-015I, F-3).
 *
 * This legacy route never created an invitation: it wrote a user_company_roles
 * row that defaulted to status 'invited' and could never be accepted (and, since
 * Closure-015E, conferred nothing). Its only in-repo caller (/admin/users) now
 * uses the governed POST /api/admin/invite-user, which creates a durable,
 * expiring, token-hashed invitation through invitationService, validates the
 * role against the invitation vocabulary, audits, and gates super-admin
 * cross-organization invites on identity.admin.assign with step-up.
 *
 * The route stays registered and authenticated (withRBAC) so a stale client gets
 * an explicit, non-mutating answer naming the replacement rather than a 404.
 */
async function handler(_req: NextApiRequest, res: NextApiResponse) {
  return res.status(410).json({ error: 'ENDPOINT_RETIRED', replacement: '/api/admin/invite-user' });
}

export default __createApiRoute(withRBAC(handler, [Role.SUPER_ADMIN, Role.ADMIN]), { route: '/api/users/invite' });
