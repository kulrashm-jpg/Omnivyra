import type { NextApiRequest, NextApiResponse } from 'next';
import { enforceCompanyAccess } from '../../../backend/services/userContextService';
import { computeWebsiteHealthScore } from '../../../backend/services/websiteHealthScoreService';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const { company_id, website_id } = req.body || {};
  if (!company_id || !website_id) return res.status(400).json({ error: 'company_id and website_id are required' });
  const companyId = String(company_id);
  const websiteId = String(website_id);
  const access = await enforceCompanyAccess({ req, res, companyId });
  if (!access) return;
  const score = await computeWebsiteHealthScore({ companyId, websiteId });
  return res.status(200).json({ score });
}
