import { createApiRoute as __createApiRoute } from '../../../lib/platform/routeFactory';
import type { NextApiRequest, NextApiResponse } from 'next';
import { enforceCompanyAccess } from '../../../backend/services/userContextService';
import { enforceRole, Role } from '../../../backend/services/rbacService';
import { runSecurityResponse, liftQuarantine } from '../../../backend/services/intelligence/securityResponseEngine';

/**
 * Automated security response (safety-gated).
 *   POST { action:'run', allow_destructive? }      → dry-run unless gated.
 *   POST { action:'lift_quarantine', connection_id} → operator override.
 * RBAC: COMPANY_ADMIN / SUPER_ADMIN. Tenant-scoped. Append-only audited.
 */
async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const companyId =
    typeof req.body?.company_id === 'string' ? req.body.company_id :
    typeof req.query.company_id === 'string' ? req.query.company_id : null;
  if (!companyId) return res.status(400).json({ error: 'company_id is required' });

  const access = await enforceCompanyAccess({ req, res, companyId });
  if (!access) return;
  const roleGate = await enforceRole({
    req, res, companyId,
    allowedRoles: [Role.COMPANY_ADMIN, Role.SUPER_ADMIN],
  });
  if (!roleGate) return;

  const action = req.body?.action;
  try {
    if (action === 'lift_quarantine') {
      const connectionId = typeof req.body?.connection_id === 'string' ? req.body.connection_id : null;
      if (!connectionId) return res.status(400).json({ error: 'connection_id is required' });
      const r = await liftQuarantine({ companyId, connectionId, actorUserId: roleGate.userId });
      return res.status(200).json(r);
    }
    // default: run
    const result = await runSecurityResponse({
      companyId,
      actorUserId: roleGate.userId,
      allowDestructive: req.body?.allow_destructive === true,
    });
    return res.status(200).json(result);
  } catch (err) {
    return res.status(500).json({ error: err instanceof Error ? err.message : 'Security response failed' });
  }
}

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/website-intelligence/security-response' });
