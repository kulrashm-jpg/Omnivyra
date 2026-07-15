import { createApiRoute as __createApiRoute } from '../../../lib/platform/routeFactory';
/**
 * GET /api/credits/advisor-impact?org_id=<id>&action=<key>&multiplier=<n>&variant=<label>
 *
 * Phase 7 — pre-execution impact: estimated credit cost of an action and the
 * percentage of the org's remaining balance it would consume. READ-ONLY: reuses
 * the existing fixed-cost catalog resolver; never reserves or deducts credits.
 *
 * Auth: withOrgAccess.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { withOrgAccess } from '../../../backend/middleware/withOrgAccess';
import { logger } from '../../../backend/services/logger';
import { estimateEnhancedImpact } from '@/backend/services/creditAdvisor/preExecutionImpactService';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).end();

  const orgId = req.query.org_id as string;
  const action = req.query.action as string;
  if (!orgId) return res.status(400).json({ error: 'org_id required' });
  if (!action) return res.status(400).json({ error: 'action required' });

  const multParam = parseInt((req.query.multiplier as string) ?? '1', 10);
  const multiplier = Number.isFinite(multParam) && multParam > 0 ? multParam : 1;
  const variant = (req.query.variant as string) || null;

  try {
    const impact = await estimateEnhancedImpact(orgId, action, multiplier, variant);
    res.setHeader('Cache-Control', 'private, max-age=30');
    return res.status(200).json(impact);
  } catch (err: any) {
    logger.error('credit_advisor_impact_failed', { orgId, action, message: err?.message ?? 'unknown' });
    return res.status(500).json({ error: err?.message ?? 'impact_failed' });
  }
}

export default __createApiRoute(withOrgAccess(handler), { route: '/api/credits/advisor-impact' });
