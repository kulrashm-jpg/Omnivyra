import { createApiRoute as __createApiRoute } from '../../../lib/platform/routeFactory';
import type { NextApiRequest, NextApiResponse } from 'next';
import { enforceCompanyAccess } from '../../../backend/services/userContextService';
import { enforceRole, Role } from '../../../backend/services/rbacService';
import { createWebsite, getWebsites } from '../../../backend/services/websiteService';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  const companyId =
    typeof req.query.company_id === 'string' ? req.query.company_id :
    typeof req.body?.company_id === 'string' ? req.body.company_id : null;
  if (!companyId) return res.status(400).json({ error: 'company_id is required' });

  const access = await enforceCompanyAccess({ req, res, companyId });
  if (!access) return;

  if (req.method === 'GET') {
    const websites = await getWebsites(companyId);
    return res.status(200).json({ websites });
  }

  if (req.method === 'POST') {
    const roleGate = await enforceRole({
      req,
      res,
      companyId,
      allowedRoles: [Role.COMPANY_ADMIN, Role.SUPER_ADMIN],
    });
    if (!roleGate) return;

    const { name, canonical_url, cms_provider, settings, metadata } = req.body || {};
    if (!name || typeof name !== 'string') return res.status(400).json({ error: 'name is required' });
    if (!canonical_url || typeof canonical_url !== 'string') {
      return res.status(400).json({ error: 'canonical_url is required' });
    }

    try {
      const website = await createWebsite({
        companyId,
        createdBy: roleGate.userId,
        name: name.trim(),
        canonicalUrl: canonical_url,
        cmsProvider: typeof cms_provider === 'string' ? cms_provider : null,
        settings: typeof settings === 'object' && settings !== null ? settings : {},
        metadata: typeof metadata === 'object' && metadata !== null ? metadata : {},
      });
      return res.status(201).json({ website });
    } catch (err) {
      return res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to create website' });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/websites' });
