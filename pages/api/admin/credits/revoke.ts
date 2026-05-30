/**
 * POST /api/admin/credits/revoke
 *
 * Operator-initiated revocation of previously-granted free or incentive
 * credits. Routes through:
 *   1. Approval-chain check (revoke is `admin_refund` action; always 2-sigs by threshold)
 *   2. creditRevoke.revokeCredit RPC
 *   3. recordAdminFinancialOperation for audit
 *
 * Body:
 *   {
 *     organizationId:  string,
 *     credits:         number,         // positive integer
 *     category:        'free' | 'incentive',
 *     reason:          string,
 *     originalGrantIdempotencyKey?: string,
 *     metadata?:       object,
 *   }
 *
 * Paid revocation is intentionally NOT supported via this endpoint
 * (per Phase 1 governance audit §3). Use the future refund flow when shipped.
 *
 * Auth: SUPER_ADMIN.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import {
  isPlatformSuperAdmin,
  isSuperAdmin,
} from '../../../../backend/services/rbacService';
import {
  requireAdminRateLimit,
  requireAuthenticatedInternalUser,
} from '../../../../backend/services/requestAccessService';
import { recordAdminAudit } from '../../../../backend/services/adminAuditService';
import { withIdempotency } from '../../../../backend/middleware/withIdempotency';
import { billingOk, billingFail } from '../../../../backend/services/billing/billingApiResponse';
import { logger } from '../../../../backend/services/logger';
import {
  proposeApproval,
  markApprovalExecuted,
  recordAdminFinancialOperation,
} from '../../../../backend/services/billing';
import { revokeCredit } from '../../../../backend/services/creditRevoke';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!(await requireAdminRateLimit(req, res, 'rl:admin:credits_revoke', 10, 60))) return;

  const user = await requireAuthenticatedInternalUser(req, res);
  if (!user) return;
  if (!(await isPlatformSuperAdmin(user.id)) && !(await isSuperAdmin(user.id))) {
    return res.status(403).json({ error: 'SUPER_ADMIN_REQUIRED' });
  }

  const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {});
  const { organizationId, credits, category, reason, originalGrantIdempotencyKey, metadata } = body as {
    organizationId?: string;
    credits?:        number;
    category?:       'free' | 'incentive';
    reason?:         string;
    originalGrantIdempotencyKey?: string;
    metadata?:       Record<string, unknown>;
  };

  if (!organizationId)                              return res.status(400).json({ error: 'organizationId required' });
  if (!Number.isInteger(credits) || (credits as number) <= 0) {
    return res.status(400).json({ error: 'credits must be a positive integer' });
  }
  if (category !== 'free' && category !== 'incentive') {
    return res.status(400).json({ error: "category must be 'free' or 'incentive' (paid revoke disallowed)" });
  }
  if (!reason?.trim()) return res.status(400).json({ error: 'reason required' });

  // ── Approval-chain gate ────────────────────────────────────────────────
  let proposalId: string | null = null;
  try {
    const proposal = await proposeApproval({
      actionType: 'admin_refund',
      proposedBy: user.id,
      payload: {
        organizationId,
        amountCredits: credits,
        category,
        reason: reason.trim(),
        metadata: { ...(metadata ?? {}), originalGrantIdempotencyKey },
      },
    });
    if (proposal.ok === false) return res.status(400).json({ error: proposal.message, code: proposal.code });
    proposalId = proposal.approvalId;
    if (!proposal.autoApproved) {
      return billingOk(res, 202, {
        status: 'pending_approval',
        message: `Revocation requires ${proposal.requiredApprovals} approval signatures. Sign via /api/admin/credits/approvals/sign.`,
        legacy: {
          status: 'pending_approval',
          approvalId: proposal.approvalId,
          requiredApprovals: proposal.requiredApprovals,
        },
      });
    }
  } catch (err: any) {
    logger.error('admin_credit_revoke_approval_failed', { actor: user.id, message: err?.message });
    return billingFail(res, 500, { rawMessage: err?.message, legacyCode: 'APPROVAL_WORKFLOW_FAILED' });
  }

  // ── Execute revocation ─────────────────────────────────────────────────
  let revokeResult: Awaited<ReturnType<typeof revokeCredit>>;
  try {
    revokeResult = await revokeCredit({
      orgId:       organizationId,
      amount:      credits as number,
      category:    category as 'free' | 'incentive',
      reason:      reason.trim(),
      performedBy: user.id,
      originalGrantIdempotencyKey,
    });
  } catch (err: any) {
    logger.error('admin_credit_revoke_failed', { actor: user.id, message: err?.message });
    return billingFail(res, 500, { rawMessage: err?.message ?? 'Revocation failed', legacyCode: 'LEDGER_FAILED' });
  }

  if (revokeResult.success === false) {
    return billingFail(res, 400, {
      rawMessage: `Revoke failed: ${revokeResult.reason}`,
      legacyCode: revokeResult.reason,
      actionableMessage: revokeResult.detail
        ? `Revoke rejected: ${revokeResult.detail}`
        : `Revoke rejected (${revokeResult.reason}). Verify the org has sufficient revocable balance in that category.`,
      retryable: false,
    });
  }

  const ledgerIdem = revokeResult.idempotencyKey;

  await recordAdminAudit({
    actorUserId:    user.id,
    action:         'ADMIN_CREDITS_REVOKE',
    targetType:     'organization',
    targetId:       organizationId,
    metadata:       {
      credits,
      category,
      reason,
      approvalId: proposalId,
      revoked:    revokeResult.revoked,
      requested:  revokeResult.requested,
      ...(metadata ?? {}),
    },
    idempotencyKey: ledgerIdem,
  });

  if (proposalId) {
    try {
      await markApprovalExecuted({
        approvalId:             proposalId,
        executedIdempotencyKey: ledgerIdem,
        actorUserId:            user.id,
      });
    } catch (err: any) {
      logger.error('admin_credit_revoke_approval_close_failed', { actor: user.id, message: err?.message });
    }
  }

  await recordAdminFinancialOperation({
    module:               'http:admin_credits_revoke',
    actorUserId:          user.id,
    organizationId,
    action:               'admin_revoke',
    amountCredits:        -(credits as number),  // signed: negative = clawback
    reason:               reason.trim(),
    approvalId:           proposalId ?? undefined,
    ledgerIdempotencyKey: ledgerIdem,
    metadata:             { category, ...(metadata ?? {}) },
  });

  return billingOk(res, 200, {
    status: 'succeeded',
    message: `Credits revoked successfully (${revokeResult.revoked} of ${revokeResult.requested} requested).`,
    legacy: {
      revoked:        revokeResult.revoked,
      requested:      revokeResult.requested,
      idempotencyKey: ledgerIdem,
      approvalId:     proposalId,
    },
  });
}

export default withIdempotency(handler, { scope: 'admin-credits-revoke', methods: ['POST'] });
