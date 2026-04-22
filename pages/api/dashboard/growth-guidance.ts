import type { NextApiRequest, NextApiResponse } from 'next';
import { enforceCompanyAccess, resolveUserContext } from '../../../backend/services/userContextService';
import { generateGrowthGuidanceAlertsWithActions } from '../../../backend/services/growthGuidanceService';

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const user = await resolveUserContext(req);
  const companyId =
    typeof req.query.companyId === 'string' ? req.query.companyId :
    typeof req.query.company_id === 'string' ? req.query.company_id :
    user.defaultCompanyId || null;

  if (!companyId) {
    return res.status(400).json({ error: 'companyId required' });
  }

  const access = await enforceCompanyAccess({ req, res, companyId });
  if (!access) return;

  try {
    const guidance = await generateGrowthGuidanceAlertsWithActions(companyId);
    return res.status(200).json({
      companyId,
      generatedAt: new Date().toISOString(),
      readiness: guidance.readiness,
      executionMetrics: guidance.executionMetrics,
      alerts: guidance.alerts,
    });
  } catch (error) {
    console.error('[dashboard/growth-guidance]', error);
    return res.status(500).json({
      error: 'Failed to load growth guidance',
      details: error instanceof Error ? error.message : String(error),
    });
  }
}
