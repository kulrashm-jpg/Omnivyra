import type { NextApiRequest, NextApiResponse } from 'next';
import { saveSelectedProperty } from '../../../backend/services/analyticsIntegrationService';
import { resolveOmnivyraWebsiteCompany } from '../../../backend/services/omnivyraWebsiteCompanyService';
import { requireSuperAdminGaAccess } from '../../../backend/services/superAdminGaAccess';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({
      status: 'error',
      code: 'GA_METHOD_NOT_ALLOWED',
      message: 'Method not allowed',
    });
  }

  const access = await requireSuperAdminGaAccess(req, res);
  if (!access) return;

  const propertyId = typeof req.body?.propertyId === 'string' ? req.body.propertyId : '';
  if (!propertyId) {
    return res.status(400).json({
      status: 'error',
      code: 'GA_MISSING_PROPERTY_ID',
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
    const property = await saveSelectedProperty(company.id, propertyId);
    return res.status(200).json({
      status: 'connected',
      initial_sync: 'started',
      property,
    });
  } catch (error) {
    const rawMessage = error instanceof Error ? error.message : 'Failed to select Google Analytics property';
    const normalized = rawMessage.toLowerCase();

    if (normalized.includes('integration not found')) {
      return res.status(404).json({
        status: 'error',
        code: 'GA_INTEGRATION_NOT_FOUND',
        message: 'No GA4 integration exists yet for this company. Connect Google Analytics first.',
      });
    }

    if (normalized.includes('does not belong to this company')) {
      return res.status(400).json({
        status: 'error',
        code: 'GA_PROPERTY_NOT_OWNED',
        message: 'The selected GA4 property is not associated with the current integration.',
      });
    }

    return res.status(500).json({
      status: 'error',
      code: 'GA_SELECT_PROPERTY_FAILED',
      message: rawMessage,
    });
  }
}
