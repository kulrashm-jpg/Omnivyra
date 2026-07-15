import { createApiRoute as __createApiRoute } from '../../../../lib/platform/routeFactory';
/**
 * POST /api/admin/credits/grant
 *
 * Super-admin-only endpoint to manually grant additional free credits to an
 * organization after the initial one-time grant. Used as an extension lever
 * when a customer needs more free credits beyond the onboarding allotment.
 *
 * Body:
 *   {
 *     organizationId:  string,
 *     credits:         number,   // positive integer
 *     reason:          string,   // required — human-readable note
 *     reasonType:      one of ADMIN_GRANT_REASON_TYPES
 *     expiryDays?:     number,   // default 14; 0 = no expiry
 *     allowOverLimit?: boolean,  // escalation override for the 3/24h guard
 *     clientKey?:      string,   // caller-supplied idempotency scope
 *     metadata?:       object,
 *   }
 *
 * Auth: Super-admin token via requireAuthenticatedInternalUser + RBAC check.
 * Idempotency: withIdempotency middleware (Idempotency-Key header) + minute-
 *              bucketed ledger key inside grantAdminCreditExtension.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { isPlatformSuperAdmin, isSuperAdmin } from '../../../../backend/services/rbacService';
import {
  requireAdminRateLimit,
  requireAuthenticatedInternalUser,
} from '../../../../backend/services/requestAccessService';
import { recordAdminAudit } from '../../../../backend/services/adminAuditService';
import {
  ADMIN_GRANT_REASON_TYPES,
  type AdminGrantResult,
  type AdminGrantReasonType,
} from '../../../../backend/services/creditAdminGrantContract';
import { withIdempotency } from '../../../../backend/middleware/withIdempotency';
import { billingOk, billingFail } from '../../../../backend/services/billing/billingApiResponse';
import { logger } from '../../../../backend/services/logger';
import {
  proposeApproval,
  markApprovalExecuted,
  recordAdminFinancialOperation,
} from '../../../../backend/services/billing';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  if (!(await requireAdminRateLimit(req, res, 'rl:admin:credits_grant', 20, 60))) return;

  const user = await requireAuthenticatedInternalUser(req, res);
  if (!user) return;
  if (!(await isPlatformSuperAdmin(user.id)) && !(await isSuperAdmin(user.id))) {
    return res.status(403).json({ error: 'SUPER_ADMIN_REQUIRED' });
  }

  const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {});
  const {
    organizationId,
    credits,
    reason,
    reasonType,
    expiryDays,
    allowOverLimit,
    clientKey,
    metadata,
  } = body as {
    organizationId?: string;
    credits?:        number;
    reason?:         string;
    reasonType?:     string;
    expiryDays?:     number;
    allowOverLimit?: boolean;
    clientKey?:      string;
    metadata?:       Record<string, unknown>;
  };

  if (!organizationId || typeof organizationId !== 'string') {
    return res.status(400).json({ error: 'organizationId (string) required' });
  }
  if (!reason || typeof reason !== 'string' || !reason.trim()) {
    return res.status(400).json({ error: 'reason (non-empty string) required' });
  }
  if (!reasonType || !(ADMIN_GRANT_REASON_TYPES as readonly string[]).includes(reasonType)) {
    return res.status(400).json({
      error: `reasonType must be one of: ${ADMIN_GRANT_REASON_TYPES.join(', ')}`,
      code:  'INVALID_REASON_TYPE',
    });
  }
  if (!Number.isInteger(credits) || (credits as number) <= 0) {
    return res.status(400).json({ error: 'credits must be a positive integer' });
  }
  if (expiryDays !== undefined && (!Number.isFinite(expiryDays) || expiryDays < 0)) {
    return res.status(400).json({ error: 'expiryDays must be a non-negative number' });
  }

  // ── Approval-chain gate (C-4) ────────────────────────────────────────────
  // For low-amount grants (<5K credits by default), threshold lookup returns
  // 1 required approval and the proposal auto-approves; behavior is identical
  // to pre-C-4. Above threshold, an approval row is created and we return
  // 202 to indicate "pending sign-off" — the client must call the signing
  // endpoint with a second super-admin.
  let proposalId: string | null = null;
  try {
    const proposal = await proposeApproval({
      actionType: 'admin_grant',
      proposedBy: user.id,
      clientRequestId: clientKey,
      payload: {
        organizationId,
        amountCredits: credits as number,
        category:      'free',
        reason:        reason.trim(),
        reasonType,
        expiryDays,
        metadata,
      },
    });
    if (proposal.ok === false) {
      return res.status(400).json({ error: proposal.message, code: proposal.code });
    }
    proposalId = proposal.approvalId;
    if (!proposal.autoApproved) {
      return billingOk(res, 202, {
        status: 'pending_approval',
        message: `Grant requires ${proposal.requiredApprovals} approval signatures. Have another super-admin sign via /api/admin/credits/approvals/sign.`,
        legacy: {
          status: 'pending_approval',
          approvalId: proposal.approvalId,
          requiredApprovals: proposal.requiredApprovals,
        },
      });
    }
  } catch (err: any) {
    logger.error('admin_grant_approval_failed', { actor: user.id, message: err?.message });
    return billingFail(res, 500, { rawMessage: err?.message, legacyCode: 'APPROVAL_WORKFLOW_FAILED' });
  }

  let result: AdminGrantResult;
  try {
    const { grantAdminCreditExtension } = await import('../../../../backend/services/creditAdminGrantService');
    result = await grantAdminCreditExtension({
      organizationId,
      credits:     credits as number,
      reason:      reason.trim(),
      reasonType:  reasonType as AdminGrantReasonType,
      actorUserId: user.id,
      expiryDays,
      allowOverLimit,
      clientKey,
      metadata,
    });
  } catch (err: any) {
    logger.error('admin_credit_grant_failed', { actor: user.id, message: err?.message });
    return billingFail(res, 500, { rawMessage: err?.message, legacyCode: 'INTERNAL' });
  }

  if (result.ok === false) {
    const failure = result as Extract<AdminGrantResult, { ok: false }>;
    const statusCode =
      failure.code === 'LEDGER_FAILED'         ? 500 :
      failure.code === 'GRANT_LIMIT_EXCEEDED'  ? 429 :
                                                 400;
    return billingFail(res, statusCode, { rawMessage: failure.error, legacyCode: failure.code });
  }

  try {
    await recordAdminAudit({
      actorUserId:    user.id,
      action:         'ADMIN_CREDITS_EXTEND_FREE',
      targetType:     'organization',
      targetId:       organizationId,
      metadata:       {
        credits,
        reason,
        reasonType,
        expiresAt: result.expiresAt,
        approvalId: proposalId,
        ...(metadata ?? {}),
      },
      idempotencyKey: result.idempotencyKey,
    });
  } catch (err: any) {
    logger.error('admin_credit_grant_audit_failed', { actor: user.id, message: err?.message });
  }

  // Close the approval row + emit structured financial audit (C-4 + governance §5)
  if (proposalId) {
    try {
      await markApprovalExecuted({
        approvalId:             proposalId,
        executedIdempotencyKey: result.idempotencyKey,
        actorUserId:            user.id,
      });
    } catch (err: any) {
      logger.error('admin_grant_approval_close_failed', { actor: user.id, message: err?.message });
    }
  }
  await recordAdminFinancialOperation({
    module:               'http:admin_credits_grant',
    actorUserId:          user.id,
    organizationId,
    action:               'admin_grant',
    amountCredits:        credits as number,
    reasonType,
    reason:               reason.trim(),
    approvalId:           proposalId ?? undefined,
    ledgerIdempotencyKey: result.idempotencyKey,
    metadata:             metadata ?? {},
  });

  return billingOk(res, 200, {
    status: 'succeeded',
    message: `Credits granted successfully (${result.credits} credits).`,
    legacy: {
      credits:        result.credits,
      expiresAt:      result.expiresAt,
      idempotencyKey: result.idempotencyKey,
      approvalId:     proposalId,
    },
  });
}

export default __createApiRoute(withIdempotency(handler, { scope: 'admin-credits-grant', methods: ['POST'] }), { route: '/api/admin/credits/grant' });
