import { createApiRoute as __createApiRoute } from '../../../lib/platform/routeFactory';
import type { NextApiRequest, NextApiResponse } from 'next';
import { enforceCompanyAccess } from '@/backend/services/userContextService';
import {
  getEngagementPlatformPreferences,
  upsertEngagementPlatformPreference,
} from '@/backend/services/engagementPlatformPreferenceService';
import { normalizePlatform } from '@/utils/platformIcons';

type SuccessResponse =
  | {
      success: true;
      preferences: Array<{ platform: string; enabled: boolean }>;
    }
  | {
      success: true;
      preference: { platform: string; enabled: boolean };
    };

type ErrorResponse = {
  error: string;
};

function getCompanyId(req: NextApiRequest) {
  return (
    (req.query.organization_id as string | undefined) ??
    (req.query.organizationId as string | undefined) ??
    (req.query.companyId as string | undefined) ??
    (typeof req.body === 'object' ? req.body?.organization_id ?? req.body?.organizationId ?? req.body?.companyId : undefined)
  )?.trim();
}

async function handler(
  req: NextApiRequest,
  res: NextApiResponse<SuccessResponse | ErrorResponse>
) {
  const companyId = getCompanyId(req);
  if (!companyId) {
    return res.status(400).json({ error: 'organization_id, organizationId, or companyId is required' });
  }

  const access = await enforceCompanyAccess({
    req,
    res,
    companyId,
    requireCampaignId: false,
  });
  if (!access) return;

  if (req.method === 'GET') {
    const preferences = await getEngagementPlatformPreferences(companyId, access.userId);
    return res.status(200).json({
      success: true,
      preferences: preferences.map((preference) => ({
        platform: preference.platform,
        enabled: preference.enabled,
      })),
    });
  }

  if (req.method === 'PATCH') {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body ?? {};
    const platform = normalizePlatform(body.platform);
    const enabled = body.enabled;

    if (!platform) {
      return res.status(400).json({ error: 'platform is required' });
    }

    if (typeof enabled !== 'boolean') {
      return res.status(400).json({ error: 'enabled must be a boolean' });
    }

    const preference = await upsertEngagementPlatformPreference({
      companyId,
      userId: access.userId,
      platform,
      enabled,
    });

    if (!preference) {
      return res.status(500).json({ error: 'Failed to save platform preference' });
    }

    return res.status(200).json({
      success: true,
      preference: {
        platform: preference.platform,
        enabled: preference.enabled,
      },
    });
  }

  res.setHeader('Allow', 'GET, PATCH');
  return res.status(405).json({ error: 'Method not allowed' });
}

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/engagement/platform-preferences' });
