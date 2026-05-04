import type { NextApiRequest, NextApiResponse } from 'next';
import { saveSelectedProperty } from '../../../backend/services/analyticsIntegrationService';
import { resolveOmnivyraWebsiteCompany } from '../../../backend/services/omnivyraWebsiteCompanyService';
import { requireAdminScope } from '../../../backend/services/requestAccessService';
import { applyAuthGuard } from '@/backend/middleware/applyAuthGuard';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const ctx = await requireAdminScope(req, res, 'config:analytics');
  if (!ctx) return;
  if (process.env.NODE_ENV !== 'production') {
    console.warn('[ADMIN_SCOPE]', '/api/super-admin/ga-select-property', 'config:analytics');
  }

  const propertyId = typeof req.body?.propertyId === 'string' ? req.body.propertyId : '';
  if (!propertyId) {
    return res.status(400).json({ status: 'error', message: 'propertyId is required' });
  }

  const company = await resolveOmnivyraWebsiteCompany();
  if (!company) {
    return res.status(404).json({ error: 'OMNIVYRA_WEBSITE_COMPANY_NOT_FOUND' });
  }

  try {
    const property = await saveSelectedProperty(company.id, propertyId);
    return res.status(200).json({
      status: 'connected',
      initial_sync: 'started',
      property,
    });
  } catch (error) {
    return res.status(500).json({ status: 'error', message: 'Failed to select Google Analytics property' });
  }
}

export default applyAuthGuard({
  requiresAuth: true,
  requiredRole: 'SUPER_ADMIN',
  allowSuperAdminOverride: true,
})(handler);
