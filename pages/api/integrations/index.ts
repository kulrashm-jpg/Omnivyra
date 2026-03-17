import type { NextApiRequest, NextApiResponse } from 'next';
import { enforceCompanyAccess } from '../../../backend/services/userContextService';
import { enforceRole, Role } from '../../../backend/services/rbacService';
import {
  createIntegration,
  getIntegrations,
  IntegrationType,
} from '../../../backend/services/integrationService';

const ALLOWED_TYPES: IntegrationType[] = ['lead_webhook', 'wordpress', 'custom_blog_api'];

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const companyId =
    typeof req.query.company_id === 'string' ? req.query.company_id :
    typeof req.body?.company_id === 'string' ? req.body.company_id : null;

  if (!companyId) return res.status(400).json({ error: 'company_id is required' });

  const access = await enforceCompanyAccess({ req, res, companyId });
  if (!access) return;

  // GET — any company member can list integrations
  if (req.method === 'GET') {
    const type = typeof req.query.type === 'string' ? req.query.type as IntegrationType : undefined;
    const integrations = await getIntegrations(companyId, type).catch(() => []);
    // Mask sensitive config fields for non-admins
    return res.status(200).json({ integrations });
  }

  // POST — only admins can create
  if (req.method === 'POST') {
    const roleGate = await enforceRole({
      req, res, companyId,
      allowedRoles: [Role.COMPANY_ADMIN, Role.SUPER_ADMIN],
    });
    if (!roleGate) return;

    const { type, name, config } = req.body || {};
    if (!type || !ALLOWED_TYPES.includes(type)) {
      return res.status(400).json({ error: `type must be one of: ${ALLOWED_TYPES.join(', ')}` });
    }
    if (!name || typeof name !== 'string' || !name.trim()) {
      return res.status(400).json({ error: 'name is required' });
    }
    if (!config || typeof config !== 'object') {
      return res.status(400).json({ error: 'config object is required' });
    }

    try {
      const integration = await createIntegration(companyId, roleGate.userId, type, name.trim(), config);
      return res.status(201).json({ integration });
    } catch (err) {
      return res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to create integration' });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
