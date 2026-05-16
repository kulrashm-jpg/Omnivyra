import type { NextApiRequest, NextApiResponse } from 'next';
import { getActiveProperty } from '../../../backend/services/analyticsIntegrationService';
import { runIngestionForCompany } from '../../../backend/services/ingestionScheduler';
import { getLatestCompletedRun } from '../../../backend/services/ingestionRunService';
import { resolveOmnivyraWebsiteCompany } from '../../../backend/services/omnivyraWebsiteCompanyService';
import { requireSuperAdminGaAccess } from '../../../backend/services/superAdminGaAccess';

const MAX_WAIT_MS = 15_000;
const POLL_INTERVAL_MS = 1_000;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({
      status: 'error',
      code: 'GA_METHOD_NOT_ALLOWED',
      message: 'Method not allowed',
    });
  }

  if (!(await requireSuperAdminGaAccess(req, res))) return;

  const company = await resolveOmnivyraWebsiteCompany();
  if (!company) {
    return res.status(404).json({
      status: 'error',
      code: 'OMNIVYRA_WEBSITE_COMPANY_NOT_FOUND',
      message: 'No Omnivyra website company is configured.',
    });
  }

  const activeProperty = await getActiveProperty(company.id);
  if (!activeProperty) {
    return res.status(400).json({
      status: 'error',
      code: 'GA_NO_ACTIVE_PROPERTY',
      message: 'No active GA4 property is selected for the Omnivyra website.',
    });
  }

  const requestStart = new Date();

  void runIngestionForCompany({
    companyId: company.id,
    sources: ['ga4'],
    force: true,
    reason: 'super_admin_ga_refresh',
  }).catch((error) => {
    console.error('[SUPER-ADMIN-GA-SYNC] background run threw', {
      companyId: company.id,
      propertyId: activeProperty.property_id,
      message: error instanceof Error ? error.message : String(error),
    });
  });

  const deadline = Date.now() + MAX_WAIT_MS;
  while (Date.now() < deadline) {
    const latestCompleted = await getLatestCompletedRun(company.id, 'ga4').catch(() => null);
    if (latestCompleted?.completed_at && new Date(latestCompleted.completed_at) > requestStart) {
      return res.status(200).json({
        status: 'synced',
        company_id: company.id,
        property_id: activeProperty.property_id,
        last_synced_at: latestCompleted.completed_at,
        records_written: latestCompleted.records_inserted,
        events_written: latestCompleted.events_inserted ?? null,
      });
    }
    await sleep(POLL_INTERVAL_MS);
  }

  return res.status(202).json({
    status: 'started',
    company_id: company.id,
    property_id: activeProperty.property_id,
    message: 'Google Analytics refresh is running in the background.',
  });
}
