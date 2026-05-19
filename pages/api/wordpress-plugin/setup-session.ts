import type { NextApiRequest, NextApiResponse } from 'next';
import { enforceCompanyAccess } from '../../../backend/services/userContextService';
import { enforceRole, Role } from '../../../backend/services/rbacService';
import { createWordPressSetupSession } from '../../../backend/services/wordpressPluginSetupService';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const { company_id, website_id, connection_id, expected_domain, expires_in_minutes } = req.body || {};
  if (!company_id) return res.status(400).json({ error: 'company_id is required' });
  const companyId = String(company_id);
  const access = await enforceCompanyAccess({ req, res, companyId });
  if (!access) return;
  const role = await enforceRole({ req, res, companyId, allowedRoles: [Role.COMPANY_ADMIN, Role.SUPER_ADMIN] });
  if (!role) return;
  const result = await createWordPressSetupSession({
    companyId,
    websiteId: typeof website_id === 'string' ? website_id : null,
    connectionId: typeof connection_id === 'string' ? connection_id : null,
    expectedDomain: typeof expected_domain === 'string' ? expected_domain : null,
    createdBy: role.userId,
    expiresInMinutes: Number.isFinite(Number(expires_in_minutes)) ? Number(expires_in_minutes) : 60,
  });
  return res.status(201).json(result);
}
