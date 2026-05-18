import type { NextApiRequest, NextApiResponse } from 'next';
import { enforceCompanyAccess } from '../../../../backend/services/userContextService';
import { assertWebsiteCompanyAccess, getWebsiteConnections } from '../../../../backend/services/websiteService';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const companyId = typeof req.query.company_id === 'string' ? req.query.company_id : null;
  const websiteId = typeof req.query.id === 'string' ? req.query.id : null;
  if (!companyId) return res.status(400).json({ error: 'company_id is required' });
  if (!websiteId) return res.status(400).json({ error: 'website id is required' });

  const access = await enforceCompanyAccess({ req, res, companyId });
  if (!access) return;
  await assertWebsiteCompanyAccess(companyId, websiteId);

  if (req.method === 'GET') {
    const connections = await getWebsiteConnections(websiteId);
    return res.status(200).json({ connections });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
