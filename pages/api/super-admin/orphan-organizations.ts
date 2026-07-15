import { createApiRoute as __createApiRoute } from '../../../lib/platform/routeFactory';
/**
 * GET /api/super-admin/orphan-organizations
 *
 * Operator-grade visibility into orgs that today require manual SQL to
 * repair: HEADLESS (no admin), ABANDONED (no members), DELETED_OWNER,
 * SUSPENDED_WITH_ACTIVITY. Read-only.
 *
 * Auth: SUPER_ADMIN_DASHBOARD_VIEW (platform-tier capability).
 *
 * Repair is operator-driven and out of this endpoint's scope. The
 * response gives an operator the exact orgs + classification + counts
 * they need to choose a remedy:
 *   - HEADLESS:                  promote one of the existing members
 *                                to COMPANY_ADMIN
 *   - ABANDONED:                 archive the company or invite a new
 *                                admin manually
 *   - DELETED_OWNER:             undelete a user OR promote another
 *                                member if any exist
 *   - SUSPENDED_WITH_ACTIVITY:   pause the active campaigns or
 *                                un-suspend the org
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { requireAdminRateLimit } from '../../../backend/services/requestAccessService';
import { requireCapability } from '../../../backend/security/requireCapability';
import { SUPER_ADMIN_DASHBOARD_VIEW } from '../../../shared/contracts/security';
import { detectOrphans } from '../../../backend/services/orphanOrgDetector';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  if (!(await requireAdminRateLimit(req, res, 'rl:super-admin:orphan-orgs', 30, 60))) return;

  const guard = await requireCapability(req, res, {
    capability: SUPER_ADMIN_DASHBOARD_VIEW,
    reason:     'super-admin orphan-organizations report',
  });
  if (guard.ok !== true) return;

  const limitParam = typeof req.query.limit === 'string' ? Number(req.query.limit) : NaN;
  const limit = Number.isFinite(limitParam) && limitParam > 0 ? limitParam : undefined;

  try {
    const entries = await detectOrphans({ limit });
    return res.status(200).json({
      ok: true,
      total: entries.length,
      entries,
    });
  } catch (err) {
    return res.status(500).json({
      ok:    false,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/super-admin/orphan-organizations' });
