import { createApiRoute as __createApiRoute } from '../../../lib/platform/routeFactory';
/**
 * GET /api/enterprise-governance/summary
 *
 * Operational dashboard surface for enterprise creative governance.
 * Returns a single bounded envelope combining:
 *   - campaign health summary (per campaign or company-wide)
 *   - approval cycle timing
 *   - governance analytics
 *   - operational diagnostics (store sizes, distributed health)
 *   - recent governance event tail
 *
 * RBAC-gated to admin / company-admin / content-reviewer roles.
 * Read-only.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { withRBAC } from '../../../backend/middleware/withRBAC';
import { Role } from '../../../backend/services/rbacService';
import { requireCompanyContext } from '../../../backend/services/companyContextGuardService';
import {
  getCampaignHealthSummary,
  getApprovalCycleTiming,
  getGovernanceAnalytics,
  getOperationalDiagnostics,
} from '../../../backend/services/creator/creativeOpsDashboard';
import { listRecentGovernanceEvents } from '../../../backend/services/creator/enterpriseGovernanceEvents';
import { persistenceDiagnostics } from '../../../backend/services/creator/enterpriseGovernanceRedisPersistence';
import { lockingDiagnostics } from '../../../backend/services/creator/enterpriseGovernanceLocking';
import { integrationHealth } from '../../../backend/services/creator/enterpriseGovernanceIntegration';

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
    const queryCompanyId = (req.query.companyId as string)?.trim();
    const campaignId = (req.query.campaignId as string)?.trim() || null;
    const ctx = await requireCompanyContext({ req, res, companyId: queryCompanyId });
    if (!ctx) return;

    const eventLimit = Math.max(1, Math.min(200, Number(req.query.eventLimit) || 50));

    const [health, timing, governance, diagnostics] = [
      getCampaignHealthSummary(ctx.companyId, campaignId),
      getApprovalCycleTiming(ctx.companyId),
      getGovernanceAnalytics(ctx.companyId),
      getOperationalDiagnostics(),
    ];
    const recentEvents = listRecentGovernanceEvents({ companyId: ctx.companyId, limit: eventLimit });

    return res.status(200).json({
      companyId: ctx.companyId,
      campaignId,
      computedAt: new Date().toISOString(),
      health,
      timing,
      governance,
      diagnostics: {
        ...diagnostics,
        persistence: persistenceDiagnostics(),
        locking: lockingDiagnostics(),
        integration: integrationHealth(),
      },
      recentEvents,
    });
  } catch (err) {
    console.error('[enterprise-governance/summary]', err);
    return res.status(500).json({
      error: err instanceof Error ? err.message : 'Failed to load enterprise governance summary',
    });
  }
}

export default __createApiRoute(withRBAC(handler, ALLOWED_ROLES), { route: '/api/enterprise-governance/summary' });
