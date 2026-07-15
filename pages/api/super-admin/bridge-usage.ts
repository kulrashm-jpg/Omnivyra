import { createApiRoute as __createApiRoute } from '../../../lib/platform/routeFactory';
/**
 * GET /api/super-admin/bridge-usage
 *
 * Reports every action satisfied via the legacy super-admin cookie
 * bridge in the lookback window, rolled up by capability and ranked by
 * frequency. Used to drive migration of the remaining bridge-dependent
 * routes before the bridge's hard expiry on 2026-08-05.
 *
 * Query parameters:
 *   windowHours — lookback window in hours (default: 720 = 30 days)
 *   rowLimit    — cap on raw audit rows scanned (default: 5000, max: 50000)
 *
 * Auth: SUPER_ADMIN_DASHBOARD_VIEW.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { requireAdminRateLimit } from '../../../backend/services/requestAccessService';
import { requireCapability } from '../../../backend/security/requireCapability';
import { SUPER_ADMIN_DASHBOARD_VIEW } from '../../../shared/contracts/security';
import { reportBridgeUsage } from '../../../backend/services/bridgeUsageMonitor';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  if (!(await requireAdminRateLimit(req, res, 'rl:super-admin:bridge-usage', 30, 60))) return;

  const guard = await requireCapability(req, res, {
    capability: SUPER_ADMIN_DASHBOARD_VIEW,
    reason:     'super-admin bridge usage report',
  });
  if (guard.ok !== true) return;

  const windowHoursParam = typeof req.query.windowHours === 'string' ? Number(req.query.windowHours) : NaN;
  const rowLimitParam    = typeof req.query.rowLimit    === 'string' ? Number(req.query.rowLimit)    : NaN;

  try {
    const report = await reportBridgeUsage({
      windowHours: Number.isFinite(windowHoursParam) && windowHoursParam > 0 ? windowHoursParam : undefined,
      rowLimit:    Number.isFinite(rowLimitParam) && rowLimitParam > 0 ? rowLimitParam : undefined,
    });
    return res.status(200).json({ ok: true, report });
  } catch (err) {
    return res.status(500).json({
      ok:    false,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/super-admin/bridge-usage' });
