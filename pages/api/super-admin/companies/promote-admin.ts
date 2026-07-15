import { createApiRoute as __createApiRoute } from '../../../../lib/platform/routeFactory';
/**
 * POST /api/super-admin/companies/promote-admin
 *
 * Promote an existing active member to COMPANY_ADMIN. Used to repair
 * HEADLESS or DELETED_OWNER orgs without demoting anyone.
 *
 * Body: { orgId: string, userId: string, reason: string }
 *
 * Auth: IDENTITY_ADMIN_ASSIGN.
 *
 * Idempotent: a re-click against an already-admin user returns
 * `idempotent: true` without mutating.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { requireCapability } from '../../../../backend/security/requireCapability';
import { IDENTITY_ADMIN_ASSIGN } from '../../../../shared/contracts/security';
import { promoteMemberToAdmin, type PromoteResult } from '../../../../backend/services/orgOwnershipRecoveryService';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body ?? {});
  const orgId  = typeof body.orgId  === 'string' ? body.orgId  : null;
  const userId = typeof body.userId === 'string' ? body.userId : null;
  const reason = typeof body.reason === 'string' ? body.reason : null;

  if (!orgId)  return res.status(400).json({ error: 'orgId is required' });
  if (!userId) return res.status(400).json({ error: 'userId is required' });
  if (!reason) return res.status(400).json({ error: 'reason is required' });

  const guard = await requireCapability(req, res, {
    capability:     IDENTITY_ADMIN_ASSIGN,
    reason:         `super-admin promotes ${userId} to COMPANY_ADMIN of ${orgId}`,
    resourceId:     orgId,
    organizationId: orgId,
  });
  if (guard.ok !== true) return;

  const result: PromoteResult = await promoteMemberToAdmin({
    orgId,
    userId,
    performedBy: guard.principal.userId,
    reason,
  });

  if (result.ok !== true) {
    const status =
      result.reason === 'NO_ORG'              ? 404 :
      result.reason === 'NO_TARGET_USER'      ? 404 :
      result.reason === 'TARGET_USER_DELETED' ? 410 :
      result.reason === 'NO_MEMBERSHIP'       ? 404 :
      result.reason === 'STALE_MEMBERSHIP'    ? 409 :
      result.reason === 'ORG_INACTIVE'        ? 409 :
      result.reason === 'DB_ERROR'            ? 500 :
      400;
    return res.status(status).json({ ok: false, code: result.reason, detail: result.detail });
  }

  return res.status(200).json({
    ok:           true,
    previousRole: result.previousRole,
    newRole:      result.newRole,
    idempotent:   result.idempotent,
  });
}

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/super-admin/companies/promote-admin' });
