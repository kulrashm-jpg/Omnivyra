import type { NextApiRequest, NextApiResponse } from 'next';
import { enforceCompanyAccess } from '../../../backend/services/userContextService';
import { aggregateFormPerformance, getFormPerformance } from '../../../backend/services/formIntelligenceService';

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
    const result = await aggregateFormPerformance({
      companyId,
      websiteId,
      day: typeof req.body?.day === 'string' ? req.body.day : null,
    });
    return res.status(202).json(result);
  }
  if (req.method === 'GET') {
    const result = await getFormPerformance({
      companyId,
      websiteId,
      from: typeof req.query.from === 'string' ? req.query.from : null,
      to: typeof req.query.to === 'string' ? req.query.to : null,
    });
    return res.status(200).json(result);
  }
  return res.status(405).json({ error: 'Method not allowed' });
}
