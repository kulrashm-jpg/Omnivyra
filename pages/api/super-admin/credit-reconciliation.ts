/**
 * GET /api/super-admin/credit-reconciliation
 *
 * Returns the wallet ↔ ledger drift report for either a single org
 * (?orgId=…) or every org. Drifted entries are returned with full
 * observed/expected/delta data so an operator can see exactly which
 * field is off and by how much without a second round-trip.
 *
 * This is the canonical operator UI for verifying that the financial
 * system is internally consistent. If drift is detected, route the
 * follow-up through the orphan-hold reaper or a manual ops adjustment.
 *
 * Auth: SUPER_ADMIN_DASHBOARD_VIEW (platform-tier capability).
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { requireAdminRateLimit } from '../../../backend/services/requestAccessService';
import { requireCapability } from '../../../backend/security/requireCapability';
import { SUPER_ADMIN_DASHBOARD_VIEW } from '../../../shared/contracts/security';
import {
  reconcileAll,
  reconcileOrg,
} from '../../../backend/services/creditReconciliation';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (!(await requireAdminRateLimit(req, res, 'rl:super-admin:credit-reconciliation', 30, 60))) return;

  const guard = await requireCapability(req, res, {
    capability: SUPER_ADMIN_DASHBOARD_VIEW,
    reason: 'super-admin credit reconciliation report',
  });
  if (guard.ok !== true) return;

  const orgId = typeof req.query.orgId === 'string' ? req.query.orgId : null;

  try {
    if (orgId) {
      const report = await reconcileOrg(orgId);
      return res.status(200).json({ ok: true, report });
    }

    const limit = typeof req.query.limit === 'string' ? Number(req.query.limit) : undefined;
    const summary = await reconcileAll({
      limit: Number.isFinite(limit) && (limit as number) > 0 ? (limit as number) : undefined,
    });
    return res.status(200).json({ ok: true, summary });
  } catch (err) {
    return res.status(500).json({
      ok:    false,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
