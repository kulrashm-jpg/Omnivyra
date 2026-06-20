/**
 * GET /api/credits/advisor?org_id=<id>&days=<7..90>
 *
 * Read-only Credit Advisor report: wallet overview, burn-rate metrics,
 * forecast/runway, attribution (module/activity/variant/user), deterministic
 * optimization recommendations, and the 0–100 credit health score.
 *
 * Auth: withOrgAccess (caller must be a member of org_id). READ-ONLY — never
 * mutates any billing state.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { withOrgAccess } from '../../../backend/middleware/withOrgAccess';
import { logger } from '../../../backend/services/logger';
import { getCreditAdvisorReport } from '@/backend/services/creditAdvisor/creditAdvisorService';
import type { CreditAdvisorReport } from '@/backend/services/creditAdvisor/creditAdvisorTypes';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).end();

  const orgId = req.query.org_id as string;
  if (!orgId) return res.status(400).json({ error: 'org_id required' });

  const daysParam = parseInt((req.query.days as string) ?? '30', 10);
  const days = Number.isFinite(daysParam) && daysParam > 0 ? Math.min(daysParam, 90) : 30;

  try {
    const report: CreditAdvisorReport = await getCreditAdvisorReport(orgId, days);
    res.setHeader('Cache-Control', 'private, max-age=60, stale-while-revalidate=120');
    return res.status(200).json(report);
  } catch (err: any) {
    logger.error('credit_advisor_failed', { orgId, message: err?.message ?? 'unknown' });
    return res.status(500).json({ error: err?.message ?? 'advisor_failed' });
  }
}

export default withOrgAccess(handler);
