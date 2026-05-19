import type { NextApiRequest, NextApiResponse } from 'next';
import { enforceCompanyAccess } from '../../../backend/services/userContextService';
import { enforceRole, Role } from '../../../backend/services/rbacService';
import { buildEnterpriseReadinessReport } from '../../../backend/services/intelligence/enterpriseReadinessService';
import { buildOAuthDiagnostics } from '../../../backend/services/intelligence/oauthDiagnosticsService';
import { getSelfHealHistory } from '../../../backend/services/intelligence/selfHealOrchestrator';

/**
 * READ-ONLY enterprise readiness + OAuth diagnostics + self-heal history.
 * No mutation. GET /api/website-intelligence/enterprise-readiness?company_id=
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const companyId = typeof req.query.company_id === 'string' ? req.query.company_id : null;
  if (!companyId) return res.status(400).json({ error: 'company_id is required' });

  const access = await enforceCompanyAccess({ req, res, companyId });
  if (!access) return;
  const roleGate = await enforceRole({
    req, res, companyId,
    allowedRoles: [Role.COMPANY_ADMIN, Role.SUPER_ADMIN],
  });
  if (!roleGate) return;

  try {
    const [report, oauth] = await Promise.all([
      buildEnterpriseReadinessReport(companyId),
      buildOAuthDiagnostics(companyId),
    ]);
    return res.status(200).json({
      ...report,
      oauthDiagnostics: oauth,
      selfHealHistory: getSelfHealHistory(companyId),
    });
  } catch (err) {
    return res.status(500).json({
      error: err instanceof Error ? err.message : 'Failed to build enterprise readiness report',
    });
  }
}
