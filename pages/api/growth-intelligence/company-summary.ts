/**
 * GET /api/growth-intelligence/company-summary
 * Company-level Growth Intelligence - aggregates metrics across all campaigns.
 * Phase-1 Read-Only. Reuses getGrowthIntelligenceSummary.
 * Auth: RBAC COMPANY_ADMIN, VIEW_ONLY, CONTENT_*
 *
 * Performance: Limits to latest 50 campaigns if company has more.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../../backend/db/supabaseClient';
import { withRBAC } from '../../../backend/middleware/withRBAC';
import { Role } from '../../../backend/services/rbacService';
import { getDecisionReportView } from '../../../backend/services/decisionReportService';
import { requireCompanyContext } from '../../../backend/services/companyContextGuardService';
import { runInApiReadContext } from '../../../backend/services/intelligenceExecutionContext';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  const companyId = (req.query.companyId as string)?.trim?.();
  if (!companyId) {
    return res.status(400).json({ success: false, error: 'companyId is required' });
  }

  try {
    const companyContext = await requireCompanyContext({ req, res, companyId });
    if (!companyContext) return;

    const reportView = await runInApiReadContext('growthCompanySummaryApi', async () =>
      getDecisionReportView({
        companyId: companyContext.companyId,
        reportTier: 'growth',
        entityType: 'global',
        entityId: null,
        sourceService: 'growthIntelligenceService',
      })
    );
    return res.status(200).json({ success: true, data: reportView });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to fetch company growth summary';
    return res.status(500).json({ success: false, error: message });
  }
}

export default withRBAC(handler, [
  Role.COMPANY_ADMIN,
  Role.VIEW_ONLY,
  Role.CONTENT_CREATOR,
  Role.CONTENT_REVIEWER,
  Role.CONTENT_PUBLISHER,
  Role.SUPER_ADMIN,
]);
