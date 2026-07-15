import { createApiRoute as __createApiRoute } from '../../../lib/platform/routeFactory';
import type { NextApiRequest, NextApiResponse } from 'next';
import { resolveOmnivyraWebsiteCompany } from '../../../backend/services/omnivyraWebsiteCompanyService';
import { getAnalyticsEnterpriseSnapshot, refreshAnalyticsEnterpriseSnapshot } from '../../../backend/services/analyticsEnterpriseSnapshotService';
import {
  createConfiguredSerpApiProvider,
  getConfiguredSerpProviderHealth,
  runQueuedSerpAcquisition,
  seedSerpQueryQueue,
} from '../../../backend/services/serpAcquisitionService';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed', code: 'METHOD_NOT_ALLOWED' });
  }

  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || req.headers.authorization !== `Bearer ${cronSecret}`) {
    return res.status(401).json({ error: 'Unauthorized', code: 'UNAUTHORIZED' });
  }

  const provider = createConfiguredSerpApiProvider();
  if (!provider) {
    return res.status(200).json({
      ok: false,
      status: 'provider_not_configured',
      provider_health: getConfiguredSerpProviderHealth(),
      message: 'No compliant SERP provider is configured; no acquisition was attempted.',
    });
  }

  const company = await resolveOmnivyraWebsiteCompany();
  if (!company) {
    return res.status(404).json({ error: 'Omnivyra website company not found', code: 'COMPANY_NOT_FOUND' });
  }

  const snapshot = await getAnalyticsEnterpriseSnapshot(company.id);
  const seeding = await seedSerpQueryQueue({
    companyId: company.id,
    gsc: snapshot.gsc_intelligence,
    limit: Number(req.query.seed_limit ?? process.env.SERP_SEED_LIMIT ?? 20),
  });
  const acquisition = await runQueuedSerpAcquisition({
    companyId: company.id,
    provider,
    maxQueries: Number(req.query.max_queries ?? process.env.SERP_MAX_QUERIES_PER_RUN ?? 8),
  });
  const refreshed = await refreshAnalyticsEnterpriseSnapshot(company.id);

  return res.status(200).json({
    ok: acquisition.status === 'completed' || acquisition.status === 'partial' || acquisition.status === 'skipped',
    seeding,
    acquisition,
    provider_health: getConfiguredSerpProviderHealth(),
    external_competitive_status: refreshed.external_competitive_intelligence.status,
    serp_snapshot_count: refreshed.external_competitive_intelligence.freshness.serp_snapshot_count,
    competitor_domain_count: refreshed.external_competitive_intelligence.freshness.competitor_domain_count,
  });
}

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/cron/serp-acquisition' });
