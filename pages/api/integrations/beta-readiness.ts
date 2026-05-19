import type { NextApiRequest, NextApiResponse } from 'next';
import { enforceCompanyAccess } from '../../../backend/services/userContextService';
import { enforceRole, Role } from '../../../backend/services/rbacService';
import { buildBetaReadinessReport } from '../../../backend/services/cms/betaReadinessService';

/**
 * READ-ONLY beta-readiness report for a company. No mutation, no provider
 * calls — safe to poll. GET /api/integrations/beta-readiness?company_id=...
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const companyId =
    typeof req.query.company_id === 'string' ? req.query.company_id : null;
  if (!companyId) return res.status(400).json({ error: 'company_id is required' });

  const access = await enforceCompanyAccess({ req, res, companyId });
  if (!access) return;

  const roleGate = await enforceRole({
    req, res, companyId,
    allowedRoles: [Role.COMPANY_ADMIN, Role.SUPER_ADMIN],
  });
  if (!roleGate) return;

  try {
    const report = await buildBetaReadinessReport(companyId);
    return res.status(200).json(report);
  } catch (err) {
    return res.status(500).json({
      error: err instanceof Error ? err.message : 'Failed to build beta-readiness report',
    });
  }
}
