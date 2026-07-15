import { createApiRoute as __createApiRoute } from '../../../lib/platform/routeFactory';
import type { NextApiRequest, NextApiResponse } from 'next';
import { enforceCompanyAccess } from '../../../backend/services/userContextService';
import { enforceRole, Role } from '../../../backend/services/rbacService';
import {
  detectRotationCandidates,
  runCredentialRotation,
} from '../../../backend/services/intelligence/credentialRotationService';

/**
 * Credential rotation.
 *   GET  → rotation candidates (read-only detection).
 *   POST → run; dry-run unless { approve:true } (no silent destructive rotate).
 * RBAC: COMPANY_ADMIN / SUPER_ADMIN. Tenant-scoped. Append-only audited.
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
      return res.status(200).json({ candidates: await detectRotationCandidates(companyId) });
    }
    if (req.method === 'POST') {
      const report = await runCredentialRotation({
        companyId,
        actorUserId: roleGate.userId,
        approve: req.body?.approve === true,
        connectionId: typeof req.body?.connection_id === 'string' ? req.body.connection_id : undefined,
      });
      return res.status(200).json(report);
    }
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    return res.status(500).json({ error: err instanceof Error ? err.message : 'Credential rotation failed' });
  }
}

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/website-intelligence/credential-rotation' });
