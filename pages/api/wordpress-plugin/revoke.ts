import { createApiRoute as __createApiRoute } from '../../../lib/platform/routeFactory';
import type { NextApiRequest, NextApiResponse } from 'next';
import { enforceCompanyAccess } from '../../../backend/services/userContextService';
import { enforceRole, Role } from '../../../backend/services/rbacService';
import { revokeWordPressPlugin } from '../../../backend/services/wordpressPluginService';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const { company_id, registration_id, reason } = req.body || {};
  if (!company_id || !registration_id) return res.status(400).json({ error: 'company_id and registration_id are required' });
  const access = await enforceCompanyAccess({ req, res, companyId: String(company_id) });
  if (!access) return;
  const role = await enforceRole({ req, res, companyId: String(company_id), allowedRoles: [Role.COMPANY_ADMIN, Role.SUPER_ADMIN] });
  if (!role) return;
  await revokeWordPressPlugin({
    registrationId: String(registration_id),
    reason: typeof reason === 'string' ? reason : null,
    actorUserId: role.userId,
  });
  return res.status(200).json({ ok: true });
}

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/wordpress-plugin/revoke' });
