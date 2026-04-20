
/**
 * GET /api/engagement/integrations
 * Returns connected social platforms for the company.
 * Source of truth is token-backed platform connections, not generic platform capability.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { enforceCompanyAccess } from '../../../backend/services/userContextService';
import { normalizePlatform } from '../../../utils/platformIcons';
import { getPlatformsWithTokensForOrg } from '../../../backend/services/platformTokenService';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const organizationId = (req.query.organization_id ?? req.query.organizationId ?? req.query.companyId) as string | undefined;
  const companyId = organizationId?.trim();
  if (!companyId) {
    return res.status(400).json({ error: 'organization_id, organizationId, or companyId is required' });
  }

  try {
    const access = await enforceCompanyAccess({
      req,
      res,
      companyId,
      requireCampaignId: false,
    });
    if (!access) return;

    const platforms = (await getPlatformsWithTokensForOrg(companyId))
      .map((platform) => normalizePlatform(platform))
      .filter(Boolean);

    return res.status(200).json({ platforms });
  } catch (err) {
    console.error('[engagement/integrations]', err);
    return res.status(500).json({
      error: (err as Error)?.message ?? 'Failed to fetch integrations',
    });
  }
}
