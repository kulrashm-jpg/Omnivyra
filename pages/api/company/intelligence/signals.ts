/**
 * Company Intelligence Signals API
 * Phase-4: Dashboard-ready aggregated signals by category
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { withRBAC } from '../../../../backend/middleware/withRBAC';
import { Role } from '../../../../backend/services/rbacService';
import { buildDashboardSignals } from '../../../../backend/services/companyIntelligenceDashboardService';

const ALLOWED_ROLES = [
  Role.COMPANY_ADMIN,
  Role.ADMIN,
  Role.SUPER_ADMIN,
  Role.CONTENT_CREATOR,
  Role.CONTENT_PLANNER,
];

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const companyId = (req.query.companyId as string)?.trim();
  if (!companyId) {
    return res.status(400).json({ error: 'companyId required' });
  }

  const rawWindowHours = req.query.windowHours;
  const windowHoursParsed =
    rawWindowHours != null ? parseInt(String(rawWindowHours), 10) : 168;
  if (Number.isNaN(windowHoursParsed) || windowHoursParsed < 1) {
    return res.status(400).json({ error: 'windowHours must be a positive number' });
  }
  if (windowHoursParsed > 720) {
    return res.status(400).json({ error: 'windowHours max is 720 (30 days)' });
  }
  const windowHours = windowHoursParsed;

  try {
    const dashboard = await buildDashboardSignals(companyId, windowHours);
    return res.status(200).json(dashboard);
  } catch (err) {
    const message = (err as Error)?.message ?? 'Failed to fetch dashboard signals';
    console.error('[company/intelligence/signals]', message);
    return res.status(500).json({ error: message });
  }
}

export default withRBAC(handler, ALLOWED_ROLES);
