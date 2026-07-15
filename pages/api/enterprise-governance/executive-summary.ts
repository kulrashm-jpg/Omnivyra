import { createApiRoute as __createApiRoute } from '../../../lib/platform/routeFactory';
/**
 * GET /api/enterprise-governance/executive-summary
 *
 * Single-pane executive rollup for leadership / ops review.
 * Read-only, RBAC-gated.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { withRBAC } from '../../../backend/middleware/withRBAC';
import { Role } from '../../../backend/services/rbacService';
import { requireCompanyContext } from '../../../backend/services/companyContextGuardService';
import { computeExecutiveSummary } from '../../../backend/services/creator/enterpriseGovernanceExecutiveSummary';

const ALLOWED_ROLES = [
  Role.SUPER_ADMIN,
  Role.COMPANY_ADMIN,
  Role.CONTENT_REVIEWER,
  Role.CONTENT_PUBLISHER,
];

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  try {
    const ctx = await requireCompanyContext({ req, res });
    if (!ctx) return;
    const summary = computeExecutiveSummary(ctx.companyId);
    return res.status(200).json(summary);
  } catch (err) {
    console.error('[enterprise-governance/executive-summary]', err);
    return res.status(500).json({
      error: err instanceof Error ? err.message : 'failed to compute executive summary',
    });
  }
}

export default __createApiRoute(withRBAC(handler, ALLOWED_ROLES), { route: '/api/enterprise-governance/executive-summary' });
