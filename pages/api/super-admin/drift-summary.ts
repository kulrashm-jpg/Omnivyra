import { createApiRoute as __createApiRoute } from '../../../lib/platform/routeFactory';
/**
 * GET /api/super-admin/drift-summary
 *
 * Single aggregate of every operational drift indicator. Returns
 * severity-classified counts so monitoring can threshold on `overall`,
 * and the indicator detail strings so an operator can read it at a
 * glance.
 *
 * Query parameters:
 *   windowHours          — lookback window in hours (default: 24)
 *   reconciliationLimit  — cap on orgs scanned for ledger drift
 *                          (default: 200; cheaper than the full
 *                          /api/cron/credit-reconciliation sweep)
 *
 * Auth: SUPER_ADMIN_DASHBOARD_VIEW.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { requireAdminRateLimit } from '../../../backend/services/requestAccessService';
import { requireCapability } from '../../../backend/security/requireCapability';
import { SUPER_ADMIN_DASHBOARD_VIEW } from '../../../shared/contracts/security';
import { summarizeDrift } from '../../../backend/services/driftSummary';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  if (!(await requireAdminRateLimit(req, res, 'rl:super-admin:drift-summary', 30, 60))) return;

  const guard = await requireCapability(req, res, {
    capability: SUPER_ADMIN_DASHBOARD_VIEW,
    reason:     'super-admin drift summary',
  });
  if (guard.ok !== true) return;

  const windowHoursParam = typeof req.query.windowHours === 'string' ? Number(req.query.windowHours) : NaN;
  const reconLimitParam  = typeof req.query.reconciliationLimit === 'string' ? Number(req.query.reconciliationLimit) : NaN;

  try {
    const summary = await summarizeDrift({
      windowHours:         Number.isFinite(windowHoursParam) && windowHoursParam > 0 ? windowHoursParam : undefined,
      reconciliationLimit: Number.isFinite(reconLimitParam) && reconLimitParam > 0 ? reconLimitParam : undefined,
    });
    return res.status(200).json({ ok: true, summary });
  } catch (err) {
    return res.status(500).json({
      ok:    false,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/super-admin/drift-summary' });
