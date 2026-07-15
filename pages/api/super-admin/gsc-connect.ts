import { createApiRoute as __createApiRoute } from '../../../lib/platform/routeFactory';
import type { NextApiRequest, NextApiResponse } from 'next';
import { getBaseUrl } from '../../../backend/auth/getBaseUrl';
import { connectGoogleSearchConsole } from '../../../backend/services/analyticsIntegrationService';
import { resolveOmnivyraWebsiteCompany } from '../../../backend/services/omnivyraWebsiteCompanyService';
import { requireSuperAdminGaAccess } from '../../../backend/services/superAdminGaAccess';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({
      status: 'error',
      code: 'GSC_METHOD_NOT_ALLOWED',
      message: 'Method not allowed',
    });
  }

  const access = await requireSuperAdminGaAccess(req, res);
  if (!access) return;

  const company = await resolveOmnivyraWebsiteCompany();
  if (!company) {
    return res.status(404).json({
      status: 'error',
      code: 'OMNIVYRA_WEBSITE_COMPANY_NOT_FOUND',
      message: 'No Omnivyra website company is configured. Set companies.website_domain to omnivyra.com on the active tenant.',
    });
  }

  try {
    const { authorizationUrl } = await connectGoogleSearchConsole(company.id, {
      userId: access.userId ?? undefined,
      returnTo: '/super-admin/dashboard',
      requestBaseUrl: getBaseUrl(req),
    });

    return res.status(200).json({ status: 'ok', authorizationUrl });
  } catch (error) {
    const rawMessage = error instanceof Error ? error.message : 'Failed to connect Search Console';
    const normalized = rawMessage.toLowerCase();

    if (normalized.includes('google analytics is not enabled')) {
      return res.status(400).json({
        status: 'error',
        code: 'GOOGLE_PROVIDER_DISABLED',
        message: 'Google data provider is disabled in Super Admin APIs configuration.',
      });
    }

    if (normalized.includes('oauth credentials are not configured')) {
      return res.status(400).json({
        status: 'error',
        code: 'GOOGLE_PROVIDER_NOT_CONFIGURED',
        message: 'Google OAuth client ID and secret are not configured in Super Admin APIs configuration.',
      });
    }

    if (normalized.includes('request base url is required')) {
      return res.status(400).json({
        status: 'error',
        code: 'GSC_BASE_URL_MISSING',
        message: 'App base URL is not available for Search Console OAuth.',
      });
    }

    return res.status(500).json({
      status: 'error',
      code: 'GSC_CONNECT_FAILED',
      message: rawMessage || 'Failed to connect Search Console',
    });
  }
}

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/super-admin/gsc-connect' });
