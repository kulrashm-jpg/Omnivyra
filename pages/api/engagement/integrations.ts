import { createApiRoute as __createApiRoute } from '../../../lib/platform/routeFactory';

/**
 * GET /api/engagement/integrations
 * Returns connected social platforms for the company.
 * Source of truth is connected accounts only, matching Company Admin's
 * "Connected" state. Configured-but-not-connected platforms stay hidden.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { enforceCompanyAccess } from '../../../backend/services/userContextService';
import { normalizePlatform } from '../../../utils/platformIcons';
import {
  getPlatformsWithActiveSocialAccountsForOrg,
  getPlatformsWithTokensForOrg,
} from '../../../backend/services/platformTokenService';

async function handler(req: NextApiRequest, res: NextApiResponse) {
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

    const [tokenPlatforms, activeSocialPlatforms] = await Promise.all([
      getPlatformsWithTokensForOrg(companyId).catch(() => [] as string[]),
      getPlatformsWithActiveSocialAccountsForOrg(companyId).catch(() => [] as string[]),
    ]);

    const platforms = Array.from(
      new Set(
        [
          ...activeSocialPlatforms,
          ...tokenPlatforms,
        ]
          .flatMap((platform) => {
            const normalized = normalizePlatform(platform);
            if (normalized === 'meta') return ['facebook', 'instagram', 'threads', 'whatsapp'];
            return normalized ? [normalized] : [];
          })
          .flatMap((platform) => platform === 'instagram' ? ['instagram', 'threads'] : [platform])
          .filter(Boolean)
      )
    ).sort();

    return res.status(200).json({ platforms });
  } catch (err) {
    console.error('[engagement/integrations]', err);
    return res.status(500).json({
      error: (err as Error)?.message ?? 'Failed to fetch integrations',
    });
  }
}

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/engagement/integrations' });
