/**
 * POST /api/super-admin/companies/transfer-ownership
 *
 * Transfer admin ownership of an organization from one user to another.
 * Both must be active members of the org.
 *
 * Body: {
 *   orgId:         string,
 *   fromUserId:    string,
 *   toUserId:      string,
 *   reason:        string,
 *   demoteToRole?: string,    // default: 'CONTENT_CREATOR'
 * }
 *
 * Auth: IDENTITY_ADMIN_ASSIGN (platform-tier capability with phishing-
 * resistant step-up policy — see StepUpPolicyRegistry).
 *
 * Idempotent: a re-click after a successful transfer returns
 * `idempotent: true` without mutating.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { requireCapability } from '../../../../backend/security/requireCapability';
import { IDENTITY_ADMIN_ASSIGN } from '../../../../shared/contracts/security';
import { transferOwnership, type TransferResult } from '../../../../backend/services/orgOwnershipRecoveryService';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body ?? {});
  const orgId        = typeof body.orgId        === 'string' ? body.orgId        : null;
  const fromUserId   = typeof body.fromUserId   === 'string' ? body.fromUserId   : null;
  const toUserId     = typeof body.toUserId     === 'string' ? body.toUserId     : null;
  const reason       = typeof body.reason       === 'string' ? body.reason       : null;
  const demoteToRole = typeof body.demoteToRole === 'string' ? body.demoteToRole : undefined;

  if (!orgId)      return res.status(400).json({ error: 'orgId is required' });
  if (!fromUserId) return res.status(400).json({ error: 'fromUserId is required' });
  if (!toUserId)   return res.status(400).json({ error: 'toUserId is required' });
  if (!reason)     return res.status(400).json({ error: 'reason is required' });

  const guard = await requireCapability(req, res, {
    capability:     IDENTITY_ADMIN_ASSIGN,
    reason:         `super-admin transfers ownership of ${orgId} from ${fromUserId} to ${toUserId}`,
    resourceId:     orgId,
    organizationId: orgId,
  });
  if (guard.ok !== true) return;

  const result: TransferResult = await transferOwnership({
    orgId,
    fromUserId,
    toUserId,
    performedBy: guard.principal.userId,
    reason,
    demoteToRole,
  });

  if (result.ok !== true) {
    const status = mapReasonToStatus(result.reason);
    return res.status(status).json({ ok: false, code: result.reason, detail: result.detail });
  }

  return res.status(200).json({
    ok:               true,
    demotedFromRole:  result.demotedFromRole,
    promotedToRole:   result.promotedToRole,
    idempotent:       result.idempotent,
  });
}

function mapReasonToStatus(reason: string): number {
  switch (reason) {
    case 'NO_ORG':            return 404;
    case 'NO_TARGET_USER':    return 404;
    case 'TARGET_USER_DELETED': return 410;
    case 'NO_MEMBERSHIP':     return 404;
    case 'STALE_MEMBERSHIP':  return 409;
    case 'NO_FROM_ROLE':      return 409;
    case 'ORG_INACTIVE':      return 409;
    case 'DB_ERROR':          return 500;
    default:                  return 400;
  }
}
