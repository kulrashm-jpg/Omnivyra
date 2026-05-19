import type { NextApiRequest, NextApiResponse } from 'next';
import { enforceCompanyAccess } from '../../../backend/services/userContextService';
import { getAttributionReport } from '../../../backend/services/attributionReportingService';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const companyId = typeof req.query.company_id === 'string' ? req.query.company_id : null;
  const websiteId = typeof req.query.website_id === 'string' ? req.query.website_id : null;
  if (!companyId) return res.status(400).json({ error: 'company_id is required' });
  const access = await enforceCompanyAccess({ req, res, companyId });
  if (!access) return;
  const report = await getAttributionReport({
    companyId,
    websiteId,
    from: typeof req.query.from === 'string' ? req.query.from : null,
    to: typeof req.query.to === 'string' ? req.query.to : null,
  });
  return res.status(200).json(report);
}
