import { createApiRoute as __createApiRoute } from '../../../lib/platform/routeFactory';
import type { NextApiRequest, NextApiResponse } from 'next';
import { enforceCompanyAccess } from '../../../backend/services/userContextService';
import { enforceRole, Role } from '../../../backend/services/rbacService';
import {
  captureOptimizationSnapshot,
  getOptimizationHistory,
} from '../../../backend/services/intelligence/marketingOptimizationMemoryService';

/**
 * GET → optimization history; POST → capture one snapshot (low write amp).
 */
async function handler(req: NextApiRequest, res: NextApiResponse) {
  const companyId =
    typeof req.query.company_id === 'string' ? req.query.company_id :
    typeof req.body?.company_id === 'string' ? req.body.company_id : null;
  if (!companyId) return res.status(400).json({ error: 'company_id is required' });
  const access = await enforceCompanyAccess({ req, res, companyId });
  if (!access) return;
  const roleGate = await enforceRole({ req, res, companyId, allowedRoles: [Role.COMPANY_ADMIN, Role.SUPER_ADMIN] });
  if (!roleGate) return;
  try {
    if (req.method === 'POST') return res.status(200).json(await captureOptimizationSnapshot(companyId));
    if (req.method === 'GET') return res.status(200).json(await getOptimizationHistory(companyId));
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    return res.status(500).json({ error: err instanceof Error ? err.message : 'Failed' });
  }
}

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/website-intelligence/optimization-history' });
