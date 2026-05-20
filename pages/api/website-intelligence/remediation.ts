import type { NextApiRequest, NextApiResponse } from 'next';
import { enforceCompanyAccess } from '../../../backend/services/userContextService';
import { enforceRole, Role } from '../../../backend/services/rbacService';
import {
  buildRemediationReport,
  executeAdvisory,
  generateAdvisories,
  transitionAdvisory,
} from '../../../backend/services/intelligence/remediationOrchestrationService';

/**
 * Safe remediation orchestration.
 *   GET   → list advisories + queue (read-only).
 *   POST { action:'generate' }                  → derive new advisories.
 *   POST { action:'approve'|'dismiss', advisory_id }
 *   POST { action:'execute', advisory_id }      → reversible execution only.
 * RBAC + tenant-scoped. NO autonomous destructive actions.
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const companyId =
    typeof req.query.company_id === 'string' ? req.query.company_id :
    typeof req.body?.company_id === 'string' ? req.body.company_id : null;
  if (!companyId) return res.status(400).json({ error: 'company_id is required' });

  const access = await enforceCompanyAccess({ req, res, companyId });
  if (!access) return;
  const roleGate = await enforceRole({
    req, res, companyId, allowedRoles: [Role.COMPANY_ADMIN, Role.SUPER_ADMIN],
  });
  if (!roleGate) return;

  try {
    if (req.method === 'GET') {
      return res.status(200).json(await buildRemediationReport(companyId));
    }
    if (req.method === 'POST') {
      const action = req.body?.action;
      if (action === 'generate') {
        const advisories = await generateAdvisories(companyId);
        return res.status(200).json({ advisories });
      }
      const advisoryId = typeof req.body?.advisory_id === 'string' ? req.body.advisory_id : null;
      if (!advisoryId) return res.status(400).json({ error: 'advisory_id is required' });
      if (action === 'approve' || action === 'dismiss') {
        return res.status(200).json(await transitionAdvisory({
          companyId, advisoryId, to: action, actorUserId: roleGate.userId, note: req.body?.note,
        }));
      }
      if (action === 'execute') {
        return res.status(200).json(await executeAdvisory({ companyId, advisoryId, actorUserId: roleGate.userId }));
      }
      return res.status(400).json({ error: 'invalid action' });
    }
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    return res.status(500).json({ error: err instanceof Error ? err.message : 'Remediation failed' });
  }
}
