/**
 * GET /api/billing/center?org_id=<id>
 *
 * Read-only billing center payload: current plan, credit pools (plan/bonus/
 * top-up with validity + spend order), billing history, invoices, payment
 * methods. Mutates nothing. Auth: withOrgAccess.
 */
import type { NextApiRequest, NextApiResponse } from 'next';
import { withOrgAccess } from '../../../backend/middleware/withOrgAccess';
import { logger } from '../../../backend/services/logger';
import { getBillingCenter } from '@/backend/services/billingCenterService';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).end();
  const orgId = req.query.org_id as string;
  if (!orgId) return res.status(400).json({ error: 'org_id required' });

  try {
    const center = await getBillingCenter(orgId);
    res.setHeader('Cache-Control', 'private, max-age=15');
    return res.status(200).json(center);
  } catch (err: any) {
    logger.error('billing_center_failed', { orgId, message: err?.message ?? 'unknown' });
    return res.status(500).json({ error: err?.message ?? 'billing_center_failed' });
  }
}

export default withOrgAccess(handler);
