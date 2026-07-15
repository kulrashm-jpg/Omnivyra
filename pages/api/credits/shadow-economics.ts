import { createApiRoute as __createApiRoute } from '../../../lib/platform/routeFactory';
/**
 * GET /api/credits/shadow-economics?org_id=<id>&days=<7..365>
 *
 * Phase 1 — Economic Observability (READ-ONLY). Returns the shadow economic
 * report: re-derived actual provider cost per activity/module/model + shadow
 * settlement diagnostics (reserved vs actual-cost) + coverage + pipeline health.
 * Reuses existing pricing; never writes / never changes billing. Auth: withOrgAccess.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { withOrgAccess } from '../../../backend/middleware/withOrgAccess';
import { logger } from '../../../backend/services/logger';
import { getShadowEconomicReport } from '@/backend/services/economicObservability/shadowEconomicService';
import type { ShadowEconomicReport } from '@/backend/services/economicObservability/economicObservabilityTypes';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).end();

  const orgId = req.query.org_id as string;
  if (!orgId) return res.status(400).json({ error: 'org_id required' });

  const daysParam = parseInt((req.query.days as string) ?? '90', 10);
  const days = Number.isFinite(daysParam) && daysParam > 0 ? Math.min(daysParam, 365) : 90;

  try {
    const report: ShadowEconomicReport = await getShadowEconomicReport(orgId, days);
    res.setHeader('Cache-Control', 'private, max-age=120, stale-while-revalidate=300');
    return res.status(200).json(report);
  } catch (err: any) {
    logger.error('shadow_economics_failed', { orgId, message: err?.message ?? 'unknown' });
    return res.status(500).json({ error: err?.message ?? 'shadow_economics_failed' });
  }
}

export default __createApiRoute(withOrgAccess(handler), { route: '/api/credits/shadow-economics' });
