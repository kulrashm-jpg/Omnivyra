import { createApiRoute as __createApiRoute } from '../../../lib/platform/routeFactory';
/**
 * GET /api/enterprise-governance/readiness
 *
 * Production readiness scoring + deployment-gating envelope.
 * Returns:
 *   - overall pass/warn/fail rollup
 *   - 0..100 readiness score + A..F grade
 *   - per-check status with actionable remediation
 *
 * Use cases:
 *   - load balancer / monitoring probe (HTTP 503 on fail)
 *   - pre-deploy smoke test (CI gate)
 *   - operator dashboard widget
 *
 * Auth: super-admin / company-admin (surfaces internal diagnostics).
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { withRBAC } from '../../../backend/middleware/withRBAC';
import { Role } from '../../../backend/services/rbacService';
import { computeReadinessReport } from '../../../backend/services/creator/enterpriseGovernanceReadinessVerifier';

const ALLOWED_ROLES = [Role.SUPER_ADMIN, Role.COMPANY_ADMIN];

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  try {
    const report = computeReadinessReport();
    const statusCode = report.overall === 'fail' ? 503 : 200;
    return res.status(statusCode).json(report);
  } catch (err) {
    console.error('[enterprise-governance/readiness]', err);
    return res.status(500).json({
      error: err instanceof Error ? err.message : 'failed to compute readiness',
    });
  }
}

export default __createApiRoute(withRBAC(handler, ALLOWED_ROLES), { route: '/api/enterprise-governance/readiness' });
