import { createApiRoute as __createApiRoute } from '../../../../../lib/platform/routeFactory';
/**
 * POST /api/admin/credits/approvals/cancel
 *
 * Proposer cancels a pending approval. Once executed, an approval is frozen
 * (DB trigger); cancellation only applies to status='pending'.
 *
 * Body: { approvalId: string, reason: string }
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import {
  isPlatformSuperAdmin,
  isSuperAdmin,
} from '../../../../../backend/services/rbacService';
import {
  requireAdminRateLimit,
  requireAuthenticatedInternalUser,
} from '../../../../../backend/services/requestAccessService';
import { recordAdminAudit } from '../../../../../backend/services/adminAuditService';
import { withIdempotency } from '../../../../../backend/middleware/withIdempotency';
import { logger } from '../../../../../backend/services/logger';
import { cancelApproval } from '../../../../../backend/services/billing/approvalCancellationService';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!(await requireAdminRateLimit(req, res, 'rl:admin:credits_approvals_cancel', 30, 60))) return;

  const user = await requireAuthenticatedInternalUser(req, res);
  if (!user) return;
  if (!(await isPlatformSuperAdmin(user.id)) && !(await isSuperAdmin(user.id))) {
    return res.status(403).json({ error: 'SUPER_ADMIN_REQUIRED' });
  }

  const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {});
  const { approvalId, reason } = body as { approvalId?: string; reason?: string };

  if (!approvalId)        return res.status(400).json({ error: 'approvalId required' });
  if (!reason?.trim())    return res.status(400).json({ error: 'reason required' });

  try {
    const result = await cancelApproval({
      approvalId,
      actorUserId: user.id,
      reason: reason.trim(),
    });
    if (result.ok === false) {
      const status =
        result.code === 'NOT_FOUND'        ? 404 :
        result.code === 'ALREADY_EXECUTED' ? 409 :
        result.code === 'NOT_PENDING'      ? 409 :
        result.code === 'NOT_ALLOWED'      ? 403 :
                                              400;
      return res.status(status).json({ error: result.message, code: result.code });
    }

    await recordAdminAudit({
      actorUserId: user.id,
      action: 'ADMIN_CREDITS_APPROVAL_CANCEL',
      targetType: 'credit_action_approval',
      targetId: approvalId,
      metadata: { reason },
      idempotencyKey: String(req.headers['idempotency-key'] ?? ''),
    });

    return res.status(200).json({ ok: true, approvalId, status: 'cancelled' });
  } catch (err: any) {
    logger.error('admin_credit_approval_cancel_failed', { actor: user.id, message: err?.message });
    return res.status(500).json({ error: 'Internal server error' });
  }
}

export default __createApiRoute(withIdempotency(handler, { scope: 'admin-credits-approvals-cancel', methods: ['POST'] }), { route: '/api/admin/credits/approvals/cancel' });
