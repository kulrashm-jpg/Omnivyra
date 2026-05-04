import { applyAuthGuard } from '@/backend/middleware/applyAuthGuard';
import type { NextApiRequest, NextApiResponse } from 'next';
import { enforceCompanyAccess } from '@/backend/services/userContextService';
import { issueExtensionSessionToken } from '@/backend/services/extensionSessionService';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const organizationId =
    (req.query.organization_id ?? req.query.organizationId ?? req.query.companyId) as string | undefined;
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

    const expiresAt = Date.now() + 12 * 60 * 60 * 1000;
    const sessionToken = issueExtensionSessionToken({
      userId: access.userId,
      orgId: companyId,
      expiresAt,
    });

    return res.status(200).json({
      success: true,
      data: {
        sessionToken,
        userId: access.userId,
        orgId: companyId,
        expiresAt,
      },
    });
  } catch (error) {
    console.error('[extension/session]', error);
    return res.status(500).json({
      error: (error as Error)?.message ?? 'Failed to create extension session',
    });
  }
}

export default applyAuthGuard({
  requiresAuth: true,
})(handler);

