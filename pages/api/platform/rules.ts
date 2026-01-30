import type { NextApiRequest, NextApiResponse } from 'next';
import { ensureFallbackPlatformRules, getRulesForPlatform } from '../../../backend/services/platformRulesService';
import { enforceCompanyAccess } from '../../../backend/services/userContextService';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { companyId, platform, contentType } = req.body || {};
    const access = await enforceCompanyAccess({ req, res, companyId });
    if (!access) return;
    if (!platform || !contentType) {
      return res.status(400).json({ error: 'platform and contentType are required' });
    }
    await ensureFallbackPlatformRules();
    const rule = await getRulesForPlatform({ platform, contentType });
    return res.status(200).json(rule);
  } catch (error: any) {
    return res.status(500).json({ error: error?.message || 'Failed to load platform rules' });
  }
}
