import type { NextApiRequest, NextApiResponse } from 'next';
import { enforceCompanyAccess } from '../../../backend/services/userContextService';
import { generateWebsiteIntelligenceSignals, getWebsiteIntelligenceSignals } from '../../../backend/services/websiteIntelligenceService';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const companyId =
    typeof req.query.company_id === 'string' ? req.query.company_id :
    typeof req.body?.company_id === 'string' ? req.body.company_id : null;
  const websiteId =
    typeof req.query.website_id === 'string' ? req.query.website_id :
    typeof req.body?.website_id === 'string' ? req.body.website_id : null;
  if (!companyId) return res.status(400).json({ error: 'company_id is required' });
  const access = await enforceCompanyAccess({ req, res, companyId });
  if (!access) return;
  if (req.method === 'POST') {
    const result = await generateWebsiteIntelligenceSignals({ companyId, websiteId });
    return res.status(202).json(result);
  }
  if (req.method === 'GET') {
    const signals = await getWebsiteIntelligenceSignals({ companyId, websiteId, includeResolved: req.query.include_resolved === 'true' });
    return res.status(200).json({ signals });
  }
  return res.status(405).json({ error: 'Method not allowed' });
}
