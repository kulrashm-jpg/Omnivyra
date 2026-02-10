import { NextApiRequest, NextApiResponse } from 'next';
import { withRBAC } from '../../../backend/middleware/withRBAC';
import { Role } from '../../../backend/services/rbacService';
import { runOpportunitySlotsScheduler } from '../../../backend/services/opportunitySlotsScheduler';

/**
 * POST /api/opportunities/refresh-slots
 * Runs the opportunity slots scheduled task:
 * - Reopens items where scheduled_for <= now() (status=NEW, slot_state=ACTIVE)
 * - For each company and type, calls fillOpportunitySlots(companyId, type)
 * Allowed: SUPER_ADMIN, or Authorization: Bearer <CRON_SECRET> for Vercel Cron.
 */
async function runRefresh(req: NextApiRequest, res: NextApiResponse) {
  try {
    const result = await runOpportunitySlotsScheduler();
    return res.status(200).json(result);
  } catch (error: any) {
    console.error('Opportunity refresh-slots error:', error);
    return res.status(500).json({ error: error?.message || 'Failed to run opportunity slots' });
  }
}

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = req.headers.authorization;
  if (cronSecret && authHeader === `Bearer ${cronSecret}`) {
    return runRefresh(req, res);
  }
  return withRBAC(runRefresh, [Role.SUPER_ADMIN])(req, res);
}

export default handler;
