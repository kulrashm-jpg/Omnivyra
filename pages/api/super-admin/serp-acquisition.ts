import type { NextApiRequest, NextApiResponse } from 'next';
import { requireSuperAdminGaAccess } from '../../../backend/services/superAdminGaAccess';
import { resolveOmnivyraWebsiteCompany } from '../../../backend/services/omnivyraWebsiteCompanyService';
import { getAnalyticsEnterpriseSnapshot, refreshAnalyticsEnterpriseSnapshot } from '../../../backend/services/analyticsEnterpriseSnapshotService';
import {
  createConfiguredSerpApiProvider,
  createManualSerpProvider,
  runSerpAcquisition,
  runQueuedSerpAcquisition,
  seedSerpQueryQueue,
  getConfiguredSerpProviderHealth,
  type SerpProviderResult,
} from '../../../backend/services/serpAcquisitionService';
import { bootstrapCompetitorDataset } from '../../../backend/services/competitiveDatasetBootstrapService';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed', code: 'METHOD_NOT_ALLOWED' });
  }

  const access = await requireSuperAdminGaAccess(req, res);
  if (!access) return;

  const company = await resolveOmnivyraWebsiteCompany();
  if (!company) {
    return res.status(404).json({ error: 'Omnivyra website company not found', code: 'COMPANY_NOT_FOUND' });
  }

  const body = req.body ?? {};
  const manualRows = Array.isArray(body.manual_results) ? body.manual_results as SerpProviderResult[] : [];
  const provider = manualRows.length ? createManualSerpProvider(manualRows) : createConfiguredSerpApiProvider();
  if (!provider) {
    return res.status(400).json({
      error: 'No compliant SERP provider configured and no manual_results payload supplied.',
      code: 'SERP_PROVIDER_NOT_CONFIGURED',
    });
  }

  const snapshot = await getAnalyticsEnterpriseSnapshot(company.id);
  const [bootstrap, seeding] = await Promise.all([
    bootstrapCompetitorDataset({ companyId: company.id, gsc: snapshot.gsc_intelligence }),
    seedSerpQueryQueue({ companyId: company.id, gsc: snapshot.gsc_intelligence, limit: Number(body.seed_limit ?? 20) }),
  ]);
  const result = body.use_queue === true
    ? await runQueuedSerpAcquisition({
      companyId: company.id,
      provider,
      maxQueries: Number(body.max_queries ?? 8),
    })
    : await runSerpAcquisition({
      companyId: company.id,
      gsc: snapshot.gsc_intelligence,
      provider,
      maxQueries: Number(body.max_queries ?? 8),
    });
  const refreshed = await refreshAnalyticsEnterpriseSnapshot(company.id);
  return res.status(200).json({
    bootstrap,
    seeding,
    result,
    provider_health: getConfiguredSerpProviderHealth(),
    external_competitive_status: refreshed.external_competitive_intelligence.status,
    serp_snapshot_count: refreshed.external_competitive_intelligence.freshness.serp_snapshot_count,
    competitor_domain_count: refreshed.external_competitive_intelligence.freshness.competitor_domain_count,
  });
}
