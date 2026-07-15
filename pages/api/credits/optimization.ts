import { createApiRoute as __createApiRoute } from '../../../lib/platform/routeFactory';
/**
 * GET /api/credits/optimization?org_id=<id>&days=<7..90>
 *
 * Phase 11–19 — Consumption Optimization Intelligence report: automation
 * consumption visibility, deterministic optimization opportunities + savings,
 * consumption drivers, what-if scenarios, runway optimization, and upgrade
 * advice. READ-ONLY. Auth: withOrgAccess.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { withOrgAccess } from '../../../backend/middleware/withOrgAccess';
import { logger } from '../../../backend/services/logger';
import { getConsumptionOptimizationReport } from '@/backend/services/creditAdvisor/consumptionOptimizationAdvisorService';
import type { ConsumptionOptimizationReport } from '@/backend/services/creditAdvisor/creditAdvisorTypes';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).end();

  const orgId = req.query.org_id as string;
  if (!orgId) return res.status(400).json({ error: 'org_id required' });

  const daysParam = parseInt((req.query.days as string) ?? '30', 10);
  const days = Number.isFinite(daysParam) && daysParam > 0 ? Math.min(daysParam, 90) : 30;

  try {
    const report: ConsumptionOptimizationReport = await getConsumptionOptimizationReport(orgId, days);
    res.setHeader('Cache-Control', 'private, max-age=60, stale-while-revalidate=120');
    return res.status(200).json(report);
  } catch (err: any) {
    logger.error('credit_optimization_failed', { orgId, message: err?.message ?? 'unknown' });
    return res.status(500).json({ error: err?.message ?? 'optimization_failed' });
  }
}

export default __createApiRoute(withOrgAccess(handler), { route: '/api/credits/optimization' });
