import { createApiRoute as __createApiRoute } from '../../../lib/platform/routeFactory';
import { NextApiRequest, NextApiResponse } from 'next';
import { withRBAC } from '../../../backend/middleware/withRBAC';
import { Role } from '../../../backend/services/rbacService';
import { runOpportunitySlotsScheduler } from '../../../backend/services/opportunitySlotsScheduler';
import { bearerAuthorization } from '../../../lib/httpAuthHeaders';
import { constantTimeEqual } from '../../../backend/security/constantTimeEqual';
import { requireActivePlatformSuperAdmin } from '../../../backend/security/requireActivePlatformSuperAdmin';

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

// Closure-015C (P1): the scheduler runs for EVERY company. withRBAC([SUPER_ADMIN]) also
// admits an INVITED company-scoped SUPER_ADMIN membership; only an active platform
// super admin (or the cron secret, above) may run it.
async function runRefreshAsPlatformSuperAdmin(req: NextApiRequest, res: NextApiResponse) {
  if (!(await requireActivePlatformSuperAdmin(req, res, 'opportunities.refresh_slots'))) return;
  return runRefresh(req, res);
}

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = req.headers.authorization;
  // SEC-C4: constant-time comparison (no prefix-timing oracle).
  if (cronSecret && constantTimeEqual(authHeader, bearerAuthorization(cronSecret))) {
    return runRefresh(req, res);
  }
  return withRBAC(runRefreshAsPlatformSuperAdmin, [Role.SUPER_ADMIN])(req, res);
}

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/opportunities/refresh-slots' });
