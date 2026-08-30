import { createApiRoute as __createApiRoute } from '../../../lib/platform/routeFactory';
/**
 * GET /api/governance/verify-snapshot
 * Stage 30 — Verify snapshot integrity.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { withRBAC } from '../../../backend/middleware/withRBAC';
import { Role } from '../../../backend/services/rbacService';
import { verifySnapshotIntegrity } from '../../../backend/services/GovernanceSnapshotService';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const snapshotId = (req.query.snapshotId as string)?.trim?.();
  if (!snapshotId) {
    return res.status(400).json({ error: 'snapshotId is required' });
  }

  /*
   * GOVERNANCE-SEC-002 — constrain the lookup to the company withRBAC authorized.
   *
   * The snapshot was selected by `id` alone, with no tenant predicate, so a
   * COMPANY_ADMIN of one company could verify another company's snapshot and
   * tell an existing-but-invalid snapshot from an absent one. Surfaced by the
   * WITHRBAC-STRUCT-002 service tracer: the route file has no tenant sink of its
   * own, so the route-level rules could not see it.
   *
   * req.rbac.companyId is the company the wrapper actually authorized
   * (WITHRBAC-STRUCT-001). Passing it into the service makes it part of the
   * query, so a foreign snapshot is never read and answers exactly as a
   * nonexistent one does — the oracle closes without a new error shape.
   *
   * SUPER_ADMIN passes null and keeps platform-wide verification, which is the
   * behaviour this route already had.
   */
  const rbac = (req as any)?.rbac as { role?: Role; companyId?: string } | undefined;
  if (!rbac?.companyId) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  const tenantConstraint = rbac.role === Role.SUPER_ADMIN ? null : rbac.companyId;

  const result = await verifySnapshotIntegrity(snapshotId, tenantConstraint);
  return res.status(200).json(result);
}

export default __createApiRoute(withRBAC(handler, [Role.COMPANY_ADMIN, Role.SUPER_ADMIN]), { route: '/api/governance/verify-snapshot' });
