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
  // BETA-012 (RULE 4): guard the throwing service call so a DB failure returns JSON, not a raw 500.
  try {
    const score = await computeWebsiteHealthScore({ companyId, websiteId });
    return res.status(200).json({ score });
  } catch (err: any) {
    console.error('[website-intelligence/health-score] error:', err?.message);
    return res.status(500).json({ error: 'Failed to compute website health score', code: 'HEALTH_SCORE_FAILED' });
  }
}
