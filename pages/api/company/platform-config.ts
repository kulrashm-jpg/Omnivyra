/**
 * GET /api/company/platform-config
 * Returns company-configured platforms with allowed content types per platform.
 * Used by campaign planner PlatformContentMatrix.
 * Sources: (1) company profile social_links, (2) external API configs (social-platforms page).
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { enforceCompanyAccess } from '../../../backend/services/userContextService';
import { getCompanyPlatformConfig } from '../../../backend/services/companyPlatformService';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const companyId = (req.query.companyId as string)?.trim();
  if (!companyId) {
    return res.status(400).json({ error: 'companyId is required' });
  }

  const access = await enforceCompanyAccess({
    req,
    res,
    companyId,
    requireCampaignId: false,
  });
  if (!access) return;

  try {
    const result = await getCompanyPlatformConfig(companyId);
    return res.status(200).json(result);
  } catch (err) {
    console.error('[company/platform-config]', err);
    return res.status(500).json({
      error: err instanceof Error ? err.message : 'Failed to load platform config',
    });
  }
}
