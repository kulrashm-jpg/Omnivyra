import type { NextApiRequest, NextApiResponse } from 'next';
import { enforceCompanyAccess } from '../../../backend/services/userContextService';
import { enforceRole, Role } from '../../../backend/services/rbacService';
import { buildOAuthDiagnostics } from '../../../backend/services/intelligence/oauthDiagnosticsService';
import { refreshConnectionToken } from '../../../backend/services/intelligence/oauthRefreshService';

/**
 * OAuth lifecycle.
 *   GET  → read-only OAuth diagnostics (token health/age/drift).
 *   POST → trigger a REAL refresh for one connection (env-gated; honest
 *          state if the provider has no refresh / app not configured).
 * RBAC-gated, tenant-scoped.
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
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

  if (req.method === 'GET') {
    const diagnostics = await buildOAuthDiagnostics(companyId);
    return res.status(200).json(diagnostics);
  }

  if (req.method === 'POST') {
    const connectionId = typeof req.body?.connection_id === 'string' ? req.body.connection_id : null;
    if (!connectionId) return res.status(400).json({ error: 'connection_id is required' });
    const result = await refreshConnectionToken(connectionId, companyId);
    return res.status(200).json(result);
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
