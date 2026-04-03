import type { NextApiRequest, NextApiResponse } from 'next';
import { withRBAC } from '../../../backend/middleware/withRBAC';
import { Role } from '../../../backend/services/rbacService';
import { resolveUserContext } from '../../../backend/services/userContextService';
import { requireCompanyContext } from '../../../backend/services/companyContextGuardService';
import { runInApiReadContext } from '../../../backend/services/intelligenceExecutionContext';
import { listDecisionFeatureView } from '../../../backend/services/insightViewService';

const ALLOWED_ROLES = [
  Role.COMPANY_ADMIN,
  Role.VIEW_ONLY,
  Role.CONTENT_CREATOR,
  Role.CONTENT_REVIEWER,
  Role.CONTENT_PUBLISHER,
  Role.SUPER_ADMIN,
];

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const user = await resolveUserContext(req);
    const companyId = (req.query.companyId as string)?.trim() || user.defaultCompanyId;
    const companyContext = await requireCompanyContext({ req, res, companyId });
    if (!companyContext) return;

    const limit = Math.min(100, Math.max(1, parseInt(String(req.query.limit ?? 25), 10) || 25));
    const items = await runInApiReadContext('leadInsightsApi', async () =>
      listDecisionFeatureView({
        viewName: 'lead_intelligence_view',
        companyId: companyContext.companyId,
        limit,
        status: ['open'],
      })
    );

    return res.status(200).json({ items });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to fetch lead intelligence';
    return res.status(500).json({ error: message });
  }
}

export default withRBAC(handler, ALLOWED_ROLES);
