import { createApiRoute as __createApiRoute } from '../../../lib/platform/routeFactory';
import type { NextApiRequest, NextApiResponse } from 'next';
import { saveSelectedSearchConsoleProperty } from '../../../backend/services/analyticsIntegrationService';
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

  const propertyId = typeof req.body?.propertyId === 'string' ? req.body.propertyId : '';
  if (!propertyId) {
    return res.status(400).json({
      status: 'error',
      code: 'GSC_MISSING_PROPERTY_ID',
      message: 'propertyId is required',
    });
  }

  const company = await resolveOmnivyraWebsiteCompany();
  if (!company) {
    return res.status(404).json({
      status: 'error',
      code: 'OMNIVYRA_WEBSITE_COMPANY_NOT_FOUND',
      message: 'No Omnivyra website company is configured.',
    });
  }

  try {
    const property = await saveSelectedSearchConsoleProperty(company.id, propertyId);
    return res.status(200).json({
      status: 'connected',
      initial_sync: 'started',
      property,
    });
  } catch (error) {
    const rawMessage = error instanceof Error ? error.message : 'Failed to select Search Console property';
    const normalized = rawMessage.toLowerCase();

    if (normalized.includes('integration not found')) {
      return res.status(404).json({
        status: 'error',
        code: 'GSC_INTEGRATION_NOT_FOUND',
        message: 'No Search Console integration exists yet for this company. Connect Search Console first.',
      });
    }

    if (normalized.includes('does not belong to this company')) {
      return res.status(400).json({
        status: 'error',
        code: 'GSC_PROPERTY_NOT_OWNED',
        message: 'The selected Search Console property is not associated with the current integration.',
      });
    }

    return res.status(500).json({
      status: 'error',
      code: 'GSC_SELECT_PROPERTY_FAILED',
      message: rawMessage,
    });
  }
}

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/super-admin/gsc-select-property' });
