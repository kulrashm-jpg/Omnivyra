/**
 * GET /api/credits/executive?org_id=<id>&days=<7..90>
 *
 * Phase 23–32 — compact executive intelligence for the proactive popup +
 * command-center banner: runway, health, largest driver, automation runway
 * impact, frequency optimizations, top-3 actions, upgrade advice, and the
 * smart-display signals. READ-ONLY. Auth: withOrgAccess.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { withOrgAccess } from '../../../backend/middleware/withOrgAccess';
import { logger } from '../../../backend/services/logger';
import { getExecutiveIntelligence } from '@/backend/services/creditAdvisor/executiveIntelligenceService';
import type { ExecutiveIntelligenceReport } from '@/backend/services/creditAdvisor/creditAdvisorTypes';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).end();

  const orgId = req.query.org_id as string;
  if (!orgId) return res.status(400).json({ error: 'org_id required' });

  const daysParam = parseInt((req.query.days as string) ?? '30', 10);
  const days = Number.isFinite(daysParam) && daysParam > 0 ? Math.min(daysParam, 90) : 30;

  try {
    const report: ExecutiveIntelligenceReport = await getExecutiveIntelligence(orgId, days);
    res.setHeader('Cache-Control', 'private, max-age=60, stale-while-revalidate=120');
    return res.status(200).json(report);
  } catch (err: any) {
    logger.error('credit_executive_failed', { orgId, message: err?.message ?? 'unknown' });
    return res.status(500).json({ error: err?.message ?? 'executive_failed' });
  }
}

export default withOrgAccess(handler);
