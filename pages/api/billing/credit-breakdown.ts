/**
 * GET /api/billing/credit-breakdown?org_id=<id>
 *
 * Read-only separate-accountability view of the credit wallet: plan / bonus /
 * top-up buckets, each with spendable balance, validity (never-expires for
 * top-ups), and consumption rank (plan first → top-up last). Mutates nothing.
 * Auth: withOrgAccess.
 */
import type { NextApiRequest, NextApiResponse } from 'next';
import { withOrgAccess } from '../../../backend/middleware/withOrgAccess';
import { logger } from '../../../backend/services/logger';
import { getCreditAccountability } from '@/backend/services/creditAccountabilityService';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).end();
  const orgId = req.query.org_id as string;
  if (!orgId) return res.status(400).json({ error: 'org_id required' });

  try {
    const breakdown = await getCreditAccountability(orgId);
    if (!breakdown) return res.status(200).json({ buckets: [], totalAvailable: 0, consumptionOrder: ['plan', 'bonus', 'topup'], summary: 'No wallet yet.' });
    res.setHeader('Cache-Control', 'private, max-age=15');
    return res.status(200).json(breakdown);
  } catch (err: any) {
    logger.error('credit_breakdown_failed', { orgId, message: err?.message ?? 'unknown' });
    return res.status(500).json({ error: err?.message ?? 'credit_breakdown_failed' });
  }
}

export default withOrgAccess(handler);
