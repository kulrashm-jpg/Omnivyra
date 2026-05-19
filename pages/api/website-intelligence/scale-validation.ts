import type { NextApiRequest, NextApiResponse } from 'next';
import { enforceCompanyAccess } from '../../../backend/services/userContextService';
import { enforceRole, Role } from '../../../backend/services/rbacService';
import { runEnterpriseValidationSuite } from '../../../backend/services/intelligence/enterpriseValidationHarness';
import { recordComplianceAudit } from '../../../backend/services/audit/complianceAuditService';

/**
 * Enterprise scale validation — PURE IN-MEMORY simulation. No production
 * mutation; the only persistence is an append-only audit summary of the run.
 * RBAC-gated. POST /api/website-intelligence/scale-validation { company_id, seed? }
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
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

  const seed = Number.isFinite(Number(req.body?.seed)) ? Number(req.body.seed) : 1337;

  try {
    const report = runEnterpriseValidationSuite(seed);
    // Append-only audit summary (the simulators themselves never write).
    await recordComplianceAudit({
      companyId,
      actor: { userId: roleGate.userId, type: 'user', label: 'scale-validation' },
      action: 'scale_validation.run',
      resourceType: 'enterprise_validation',
      resourceId: companyId,
      entityLineage: ['company', 'enterprise_validation'],
      outcome: report.overallPassed ? 'success' : 'failure',
      detail: { seed, summary: report.summary },
    }).catch(() => undefined);

    return res.status(200).json(report);
  } catch (err) {
    return res.status(500).json({
      error: err instanceof Error ? err.message : 'Validation suite failed',
    });
  }
}
