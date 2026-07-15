import { createApiRoute as __createApiRoute } from '../../../../lib/platform/routeFactory';
/**
 * POST /api/super-admin/companies/archive-abandoned
 *
 * Soft-archive an abandoned organization. By default, requires zero
 * active members; pass `force: true` to override.
 *
 * Body: { orgId: string, reason: string, force?: boolean }
 *
 * Auth: ORGANIZATION_DELETE.
 *
 * Idempotent: re-clicking against an already-archived org returns
 * `idempotent: true` without mutating.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { requireCapability } from '../../../../backend/security/requireCapability';
import { ORGANIZATION_DELETE } from '../../../../shared/contracts/security';
import { archiveAbandonedOrg, type ArchiveResult } from '../../../../backend/services/orgOwnershipRecoveryService';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body ?? {});
  const orgId  = typeof body.orgId  === 'string' ? body.orgId  : null;
  const reason = typeof body.reason === 'string' ? body.reason : null;
  const force  = body.force === true;

  if (!orgId)  return res.status(400).json({ error: 'orgId is required' });
  if (!reason) return res.status(400).json({ error: 'reason is required' });

  const guard = await requireCapability(req, res, {
    capability:     ORGANIZATION_DELETE,
    reason:         `super-admin archives abandoned org ${orgId} (force=${force})`,
    resourceId:     orgId,
    organizationId: orgId,
  });
  if (guard.ok !== true) return;

  const result: ArchiveResult = await archiveAbandonedOrg({
    orgId,
    performedBy: guard.principal.userId,
    reason,
    force,
  });

  if (result.ok !== true) {
    const status =
      result.reason === 'NO_ORG'         ? 404 :
      result.reason === 'NOT_ABANDONED'  ? 409 :
      result.reason === 'DB_ERROR'       ? 500 :
      400;
    return res.status(status).json({ ok: false, code: result.reason, detail: result.detail });
  }

  return res.status(200).json({
    ok:             true,
    previousStatus: result.previousStatus,
    idempotent:     result.idempotent,
  });
}

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/super-admin/companies/archive-abandoned' });
