/**
 * GET /api/super-admin/runtime-pressure
 *
 * Operator-grade visibility into the platform's current runtime
 * pressure: in-flight concurrency leases, retry-rate per scope, active
 * scheduler locks (with stale-lock detection), and recent DLQ pressure.
 *
 * Read-only. Severity-classified so monitoring can threshold on the
 * `overall` field.
 *
 * Query parameters:
 *   topN            — concurrency / retry-rate row cap (default 25, max 200)
 *   dlqWindowHours  — window for DLQ rollup (default 1)
 *
 * Auth: SUPER_ADMIN_DASHBOARD_VIEW (platform-tier capability).
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { requireAdminRateLimit } from '../../../backend/services/requestAccessService';
import { requireCapability } from '../../../backend/security/requireCapability';
import { SUPER_ADMIN_DASHBOARD_VIEW } from '../../../shared/contracts/security';
import { reportRuntimePressure } from '../../../backend/services/runtimePressureMonitor';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  if (!(await requireAdminRateLimit(req, res, 'rl:super-admin:runtime-pressure', 60, 60))) return;

  const guard = await requireCapability(req, res, {
    capability: SUPER_ADMIN_DASHBOARD_VIEW,
    reason:     'super-admin runtime-pressure report',
  });
  if (guard.ok !== true) return;

  const topNParam = typeof req.query.topN === 'string' ? Number(req.query.topN) : NaN;
  const dlqWindowParam = typeof req.query.dlqWindowHours === 'string' ? Number(req.query.dlqWindowHours) : NaN;

  try {
    const report = await reportRuntimePressure({
      topN:           Number.isFinite(topNParam) && topNParam > 0 ? topNParam : undefined,
      dlqWindowHours: Number.isFinite(dlqWindowParam) && dlqWindowParam > 0 ? dlqWindowParam : undefined,
    });
    return res.status(200).json({ ok: true, report });
  } catch (err) {
    return res.status(500).json({
      ok:    false,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
