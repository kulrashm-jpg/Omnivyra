import type { NextApiRequest, NextApiResponse } from 'next';
import { enforceCompanyAccess } from '../../../backend/services/userContextService';
import { enforceRole, Role } from '../../../backend/services/rbacService';
import { probeWorkerLiveness } from '../../../backend/services/intelligence/workerLivenessService';

/**
 * Active worker liveness probe (observational; no worker execution).
 * GET /api/website-intelligence/worker-liveness?company_id=...
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const companyId = typeof req.query.company_id === 'string' ? req.query.company_id : null;
  if (!companyId) return res.status(400).json({ error: 'company_id is required' });

  const access = await enforceCompanyAccess({ req, res, companyId });
  if (!access) return;
  const roleGate = await enforceRole({
    req, res, companyId, allowedRoles: [Role.COMPANY_ADMIN, Role.SUPER_ADMIN],
  });
  if (!roleGate) return;

  try {
    return res.status(200).json(await probeWorkerLiveness(companyId));
  } catch (err) {
    return res.status(500).json({ error: err instanceof Error ? err.message : 'Liveness probe failed' });
  }
}
