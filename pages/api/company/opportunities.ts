/**
 * GET /api/company/opportunities
 * Fetches trend signals, engagement health, strategic insights, inbox signals
 * and returns OpportunityReport from Opportunity Detection Engine.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { withRBAC } from '../../../backend/middleware/withRBAC';
import { Role } from '../../../backend/services/rbacService';
import { getDecisionReportView } from '../../../backend/services/decisionReportService';
import { requireCompanyContext } from '../../../backend/services/companyContextGuardService';
import { runInApiReadContext } from '../../../backend/services/intelligenceExecutionContext';

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

  try {
    const companyContext = await requireCompanyContext({ req, res, companyId });
    if (!companyContext) return;

    const reportView = await runInApiReadContext('companyOpportunitiesApi', async () =>
      getDecisionReportView({
        companyId: companyContext.companyId,
        reportTier: 'growth',
        entityType: 'global',
        entityId: null,
        sourceService: 'opportunityDetectionService',
      })
    );

    return res.status(200).json(reportView);
  } catch (err) {
    console.error('[company/opportunities]', err);
    return res.status(500).json({
      error: 'Failed to detect opportunities',
      details: err instanceof Error ? err.message : String(err),
    });
  }
}

export default withRBAC(handler, ALLOWED_ROLES);
