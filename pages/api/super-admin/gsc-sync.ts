import type { NextApiRequest, NextApiResponse } from 'next';
import { getActiveSearchConsoleProperty } from '../../../backend/services/analyticsIntegrationService';
import { runOmnivyraGscIngestion } from '../../../backend/services/omnivyraGscAnalyticsService';
import { resolveOmnivyraWebsiteCompany } from '../../../backend/services/omnivyraWebsiteCompanyService';
import { requireSuperAdminGaAccess } from '../../../backend/services/superAdminGaAccess';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
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
      message: 'No Omnivyra website company is configured.',
    });
  }

  const activeProperty = await getActiveSearchConsoleProperty(company.id);
  if (!activeProperty) {
    return res.status(400).json({
      status: 'error',
      code: 'GSC_NO_ACTIVE_PROPERTY',
      message: 'Select a Search Console property before syncing.',
    });
  }

  try {
    const result = await runOmnivyraGscIngestion({ forceBackfill: true });
    return res.status(result.status === 'failed' ? 502 : 200).json({
      status: result.status === 'completed' ? 'synced' : result.status,
      code: result.status === 'completed' ? 'GSC_SYNCED' : 'GSC_SYNC_PARTIAL',
      message: result.status === 'completed'
        ? 'Search Console data synced for the Omnivyra website.'
        : 'Search Console sync completed with degraded or partial data.',
      property_id: activeProperty.property_id,
      last_synced_at: new Date().toISOString(),
      records_written: result.rows_ingested,
      rows_fetched: result.rows_fetched,
      retries: result.retries,
      error_message: result.error_message,
    });
  } catch (error: any) {
    return res.status(502).json({
      status: 'error',
      code: 'GSC_SYNC_FAILED',
      message: error?.message || 'Search Console sync failed',
      property_id: activeProperty.property_id,
    });
  }
}
