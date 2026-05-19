import type { NextApiRequest, NextApiResponse } from 'next';
import { enforceRole, Role } from '../../../../backend/services/rbacService';
import { getWebsiteIntelligenceDiagnostics } from '../../../../backend/services/adminObservabilityService';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const companyId = typeof req.query.company_id === 'string' ? req.query.company_id : null;
  const websiteId = typeof req.query.website_id === 'string' ? req.query.website_id : null;
  if (!companyId) return res.status(400).json({ error: 'company_id is required' });
  const role = await enforceRole({ req, res, companyId, allowedRoles: [Role.COMPANY_ADMIN, Role.SUPER_ADMIN] });
  if (!role) return;
  const diagnostics = await getWebsiteIntelligenceDiagnostics({ companyId, websiteId, status: typeof req.query.status === 'string' ? req.query.status : null });
  return res.status(200).json(diagnostics);
}
