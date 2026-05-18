import type { NextApiRequest, NextApiResponse } from 'next';
import { enforceCompanyAccess } from '../../../backend/services/userContextService';
import { enforceRole, Role } from '../../../backend/services/rbacService';
import { createWebsiteFromSetup, getOrCreateWebsiteSetup, markWebsiteSetupStep, type WebsiteSetupStep } from '../../../backend/services/websiteSetupService';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const companyId =
    typeof req.query.company_id === 'string' ? req.query.company_id :
    typeof req.body?.company_id === 'string' ? req.body.company_id : null;
  if (!companyId) return res.status(400).json({ error: 'company_id is required' });
  const access = await enforceCompanyAccess({ req, res, companyId });
  if (!access) return;

  if (req.method === 'GET') {
    const result = await getOrCreateWebsiteSetup({
      companyId,
      websiteId: typeof req.query.website_id === 'string' ? req.query.website_id : null,
    });
    return res.status(200).json(result);
  }

  const roleGate = await enforceRole({ req, res, companyId, allowedRoles: [Role.COMPANY_ADMIN, Role.SUPER_ADMIN] });
  if (!roleGate) return;

  if (req.method === 'POST') {
    if (req.body?.action === 'create_website') {
      const { name, canonical_url, cms_provider } = req.body || {};
      if (!name || !canonical_url) return res.status(400).json({ error: 'name and canonical_url are required' });
      const result = await createWebsiteFromSetup({
        companyId,
        userId: roleGate.userId,
        name: String(name),
        canonicalUrl: String(canonical_url),
        cmsProvider: typeof cms_provider === 'string' ? cms_provider : null,
      });
      return res.status(201).json(result);
    }

    const websiteId = typeof req.body?.website_id === 'string' ? req.body.website_id : null;
    const step = typeof req.body?.step === 'string' ? req.body.step as WebsiteSetupStep : null;
    if (!websiteId || !step) return res.status(400).json({ error: 'website_id and step are required' });
    const progress = await markWebsiteSetupStep({
      companyId,
      websiteId,
      step,
      state: typeof req.body?.state === 'object' && req.body.state !== null ? req.body.state : {},
      error: typeof req.body?.error === 'string' ? req.body.error : null,
    });
    return res.status(200).json({ progress });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
