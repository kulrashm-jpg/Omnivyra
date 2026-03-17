import type { NextApiRequest, NextApiResponse } from 'next';
import { enforceCompanyAccess } from '../../../backend/services/userContextService';
import { enforceRole, Role } from '../../../backend/services/rbacService';
import {
  getIntegration,
  updateIntegration,
  deleteIntegration,
} from '../../../backend/services/integrationService';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const id = typeof req.query.id === 'string' ? req.query.id : null;
  if (!id) return res.status(400).json({ error: 'id is required' });

  const companyId =
    typeof req.query.company_id === 'string' ? req.query.company_id :
    typeof req.body?.company_id === 'string' ? req.body.company_id : null;
  if (!companyId) return res.status(400).json({ error: 'company_id is required' });

  const access = await enforceCompanyAccess({ req, res, companyId });
  if (!access) return;

  if (req.method === 'GET') {
    const integration = await getIntegration(id, companyId);
    if (!integration) return res.status(404).json({ error: 'Integration not found' });
    return res.status(200).json({ integration });
  }

  // PUT / DELETE require admin
  const roleGate = await enforceRole({
    req, res, companyId,
    allowedRoles: [Role.COMPANY_ADMIN, Role.SUPER_ADMIN],
  });
  if (!roleGate) return;

  if (req.method === 'PUT' || req.method === 'PATCH') {
    const { name, config } = req.body || {};
    const updates: { name?: string; config?: Record<string, string> } = {};
    if (name && typeof name === 'string') updates.name = name.trim();
    if (config && typeof config === 'object') updates.config = config;
    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ error: 'Nothing to update' });
    }
    try {
      const integration = await updateIntegration(id, companyId, updates);
      return res.status(200).json({ integration });
    } catch (err) {
      return res.status(500).json({ error: err instanceof Error ? err.message : 'Update failed' });
    }
  }

  if (req.method === 'DELETE') {
    try {
      await deleteIntegration(id, companyId);
      return res.status(200).json({ status: 'deleted' });
    } catch (err) {
      return res.status(500).json({ error: err instanceof Error ? err.message : 'Delete failed' });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
