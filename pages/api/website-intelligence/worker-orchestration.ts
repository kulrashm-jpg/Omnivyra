import { createApiRoute as __createApiRoute } from '../../../lib/platform/routeFactory';
import type { NextApiRequest, NextApiResponse } from 'next';
import { enforceCompanyAccess } from '../../../backend/services/userContextService';
import { enforceRole, Role } from '../../../backend/services/rbacService';
import {
  getWorkerHealth,
  runOrchestratedWorkers,
  type OrchestratedWorker,
} from '../../../backend/services/intelligence/workerOrchestrationService';

const WORKERS: OrchestratedWorker[] = ['replay', 'oauth_refresh', 'security_response'];

/**
 * Worker orchestration.
 *   GET  → worker health (heartbeats, last error).
 *   POST → run an atomic-leased coordinated worker pass (distributed-safe).
 * RBAC: COMPANY_ADMIN / SUPER_ADMIN. Tenant-scoped.
 */
async function handler(req: NextApiRequest, res: NextApiResponse) {
  const companyId =
    typeof req.query.company_id === 'string' ? req.query.company_id :
    typeof req.body?.company_id === 'string' ? req.body.company_id : null;
  if (!companyId) return res.status(400).json({ error: 'company_id is required' });

  const access = await enforceCompanyAccess({ req, res, companyId });
  if (!access) return;
  const roleGate = await enforceRole({
    req, res, companyId,
    allowedRoles: [Role.COMPANY_ADMIN, Role.SUPER_ADMIN],
  });
  if (!roleGate) return;

  try {
    if (req.method === 'GET') {
      return res.status(200).json({ workers: await getWorkerHealth(companyId) });
    }
    if (req.method === 'POST') {
      const requested = Array.isArray(req.body?.workers)
        ? (req.body.workers as string[]).filter((w): w is OrchestratedWorker => (WORKERS as string[]).includes(w))
        : undefined;
      const result = await runOrchestratedWorkers({
        companyId,
        workers: requested && requested.length > 0 ? requested : undefined,
        actorUserId: roleGate.userId,
      });
      return res.status(200).json(result);
    }
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    return res.status(500).json({ error: err instanceof Error ? err.message : 'Worker orchestration failed' });
  }
}

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/website-intelligence/worker-orchestration' });
