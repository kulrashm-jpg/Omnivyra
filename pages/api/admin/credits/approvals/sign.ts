/**
 * POST /api/admin/credits/approvals/sign
 *
 * Second super-admin signs (approves or rejects) a pending credit-action
 * approval. When the configured threshold (N-of-M) is met, the approval
 * transitions to status='approved' and the originating endpoint becomes
 * eligible to execute. The proposer is forbidden from signing their own
 * request (segregation of duties; enforced at DB function level).
 *
 * Body:
 *   { approvalId: string, decision: 'approve' | 'reject', comment?: string }
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
import { signApproval } from '../../../../../backend/services/billing';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  if (!(await requireAdminRateLimit(req, res, 'rl:admin:credits_approvals_sign', 30, 60))) return;

  const user = await requireAuthenticatedInternalUser(req, res);
  if (!user) return;
  if (!(await isPlatformSuperAdmin(user.id)) && !(await isSuperAdmin(user.id))) {
    return res.status(403).json({ error: 'SUPER_ADMIN_REQUIRED' });
  }

  const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {});
  const { approvalId, decision, comment } = body as {
    approvalId?: string;
    decision?:   'approve' | 'reject';
    comment?:    string;
  };

  if (!approvalId || typeof approvalId !== 'string') {
    return res.status(400).json({ error: 'approvalId (string) required' });
  }
  if (decision !== 'approve' && decision !== 'reject') {
    return res.status(400).json({ error: "decision must be 'approve' or 'reject'" });
  }

  try {
    const result = await signApproval({
      approvalId,
      approverId: user.id,
      decision,
      comment,
    });

    if (!result.ok) {
      const status =
        result.code === 'NOT_FOUND'           ? 404 :
        result.code === 'SELF_SIGN_BLOCKED'   ? 403 :
        result.code === 'EXPIRED'             ? 410 :
        result.code === 'ALREADY_EXECUTED'    ? 409 :
        result.code === 'NOT_ACTIONABLE'      ? 409 :
                                                400;
      return res.status(status).json({ error: result.message, code: result.code });
    }

    await recordAdminAudit({
      actorUserId:    user.id,
      action:         'ADMIN_CREDITS_APPROVAL_SIGN',
      targetType:     'credit_action_approval',
      targetId:       approvalId,
      metadata:       {
        decision,
        comment: comment ?? null,
        statusAfter: result.status,
        approveCount: result.approveCount,
        rejectCount: result.rejectCount,
        requiredApprovals: result.requiredApprovals,
      },
      idempotencyKey: String(req.headers['idempotency-key'] ?? ''),
    });

    return res.status(200).json({
      ok:                true,
      approvalId,
      status:            result.status,
      approveCount:      result.approveCount,
      rejectCount:       result.rejectCount,
      requiredApprovals: result.requiredApprovals,
    });
  } catch (err: any) {
    logger.error('admin_credit_approval_sign_failed', { actor: user.id, message: err?.message });
    return res.status(500).json({ error: 'Internal server error' });
  }
}

export default withIdempotency(handler, { scope: 'admin-credits-approvals-sign', methods: ['POST'] });
