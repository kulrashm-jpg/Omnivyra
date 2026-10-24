import { createApiRoute as __createApiRoute } from '../../../lib/platform/routeFactory';
import type { NextApiRequest, NextApiResponse } from 'next';
import { requireSuperAdminGaWriteAccess } from '../../../backend/services/superAdminGaAccess';
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
import { validateManualSerpResults } from '../../../backend/services/serp/manualSerpResultsValidation';
import { bootstrapCompetitorDataset } from '../../../backend/services/competitiveDatasetBootstrapService';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed', code: 'METHOD_NOT_ALLOWED' });
  }

  const access = await requireSuperAdminGaWriteAccess(req, res, 'analytics.serp.acquire');
  if (!access) return;

  const body = req.body ?? {};
  // Closure-009: caller-supplied SERP rows are validated against the
  // established contract before any read or write (they used to be cast
  // straight to SerpProviderResult[] and persisted as observations).
  const manual = validateManualSerpResults(body.manual_results);
  if (manual.ok === false) {
    return res.status(400).json({ error: manual.error, code: 'INVALID_MANUAL_RESULTS' });
  }
  const manualRows: SerpProviderResult[] = manual.rows;

  const company = await resolveOmnivyraWebsiteCompany();
  if (!company) {
    return res.status(404).json({ error: 'Omnivyra website company not found', code: 'COMPANY_NOT_FOUND' });
  }

  const provider = manualRows.length ? createManualSerpProvider(manualRows) : await createConfiguredSerpApiProvider();
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
    provider_health: await getConfiguredSerpProviderHealth(),
    external_competitive_status: refreshed.external_competitive_intelligence.status,
    serp_snapshot_count: refreshed.external_competitive_intelligence.freshness.serp_snapshot_count,
    competitor_domain_count: refreshed.external_competitive_intelligence.freshness.competitor_domain_count,
  });
}

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/super-admin/serp-acquisition' });
