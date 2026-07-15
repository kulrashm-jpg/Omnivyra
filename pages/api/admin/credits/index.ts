import { createApiRoute as __createApiRoute } from '../../../../lib/platform/routeFactory';

/**
 * /api/admin/credits
 *
 * GET  ?companyId=<id>         → fetch credit summary for an org (super_admin) or own org (company_admin)
 * POST { action, companyId, … } → super_admin only: grant / adjust / set-rate
 *
 * POST body shapes:
 *   { action: 'grant',    companyId, credits, usdEquivalent?, note? }
 *   { action: 'adjust',   companyId, credits (signed), note }
 *   { action: 'set_rate', companyId, creditRateUsd }
 */

import { NextApiRequest, NextApiResponse } from 'next';
import { isPlatformSuperAdmin, isSuperAdmin, getUserRole } from '../../../../backend/services/rbacService';
import { getOrgCreditSummary } from '../../../../backend/services/creditReadService';
import { requireAdminRateLimit, requireAuthenticatedInternalUser } from '../../../../backend/services/requestAccessService';
import { recordAdminAudit } from '../../../../backend/services/adminAuditService';
import { logger } from '../../../../backend/services/logger';
import { withIdempotency } from '../../../../backend/middleware/withIdempotency';
import {
  proposeApproval,
  markApprovalExecuted,
  recordAdminFinancialOperation,
} from '../../../../backend/services/billing';

async function assertSuperAdmin(req: NextApiRequest, res: NextApiResponse): Promise<string | null> {
  const user = await requireAuthenticatedInternalUser(req, res);
  if (!user) return null;
  const userId = user.id;
  if ((await isPlatformSuperAdmin(userId)) || (await isSuperAdmin(userId))) return userId;
  res.status(403).json({ error: 'SUPER_ADMIN_REQUIRED' });
  return null;
}

async function assertCompanyAccess(
  req: NextApiRequest,
  res: NextApiResponse,
  companyId: string
): Promise<{ userId: string; isSA: boolean } | null> {
  const user = await requireAuthenticatedInternalUser(req, res);
  if (!user) return null;
  const userId = user.id;
  if ((await isPlatformSuperAdmin(userId)) || (await isSuperAdmin(userId))) return { userId, isSA: true };
  const { role } = await getUserRole(userId, companyId);
  if (!role) { res.status(403).json({ error: 'FORBIDDEN' }); return null; }
  return { userId, isSA: false };
}

async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    if (!(await requireAdminRateLimit(req, res, 'rl:admin:credits', 40, 60))) return;
    if (req.method === 'GET') {
      const companyId = req.query.companyId as string | undefined;
      if (!companyId) return res.status(400).json({ error: 'companyId required' });

      const ctx = await assertCompanyAccess(req, res, companyId);
      if (!ctx) return;

      const summary = await getOrgCreditSummary(companyId);
      if (!summary) return res.status(200).json({ companyId, credits: null, message: 'No credit account yet' });

      // Non-super-admins see balance and transactions but not the credit_rate (internal pricing)
      if (!ctx.isSA) {
        const { credit_rate_usd: _hidden, ...safe } = summary;
        return res.status(200).json({ companyId, credits: safe });
      }

      return res.status(200).json({ companyId, credits: summary });
    }

    if (req.method === 'POST') {
      const userId = await assertSuperAdmin(req, res);
      if (!userId) return;

      const { action, companyId, credits, usdEquivalent, note, creditRateUsd } = req.body ?? {};
      if (!companyId) return res.status(400).json({ error: 'companyId required' });

      if (action === 'grant') {
        if (typeof credits !== 'number' || credits <= 0) {
          return res.status(400).json({ error: 'credits must be a positive number' });
        }
        // Approval-chain gate (C-4)
        const proposal = await proposeApproval({
          actionType: 'admin_grant',
          proposedBy: userId,
          payload: {
            organizationId: companyId,
            amountCredits:  credits,
            category:       'paid',
            reason:         note ?? 'admin grant (legacy endpoint)',
            metadata:       { usdEquivalent: usdEquivalent ?? null },
          },
        });
        if (proposal.ok === false) return res.status(400).json({ error: proposal.message, code: proposal.code });
        if (!proposal.autoApproved) {
          return res.status(202).json({
            ok: true,
            status: 'pending_approval',
            approvalId: proposal.approvalId,
            requiredApprovals: proposal.requiredApprovals,
            message: 'Grant requires additional approval. Sign via /api/admin/credits/approvals/sign.',
          });
        }

        const { grantCredits } = await import('../../../../backend/services/consumptionAnalyticsService');
        const result = await grantCredits({ organizationId: companyId, credits, usdEquivalent, note, performedBy: userId });
        if (result.ok === false) return res.status(500).json({ error: result.error });
        const ledgerIdem = String(req.headers['idempotency-key'] ?? `${proposal.approvalId}:exec`);
        await recordAdminAudit({
          actorUserId: userId,
          action: 'ADMIN_CREDITS_GRANT',
          targetType: 'organization',
          targetId: companyId,
          metadata: { credits, usdEquivalent: usdEquivalent ?? null, note: note ?? null, approvalId: proposal.approvalId },
          idempotencyKey: ledgerIdem,
        });
        await markApprovalExecuted({
          approvalId:             proposal.approvalId,
          executedIdempotencyKey: ledgerIdem,
          actorUserId:            userId,
        });
        await recordAdminFinancialOperation({
          module:               'http:admin_credits_legacy_grant',
          actorUserId:          userId,
          organizationId:       companyId,
          action:               'admin_grant',
          amountCredits:        credits,
          reason:               note ?? undefined,
          approvalId:           proposal.approvalId,
          ledgerIdempotencyKey: ledgerIdem,
        });
        return res.status(200).json({ ok: true, action: 'grant', credits, approvalId: proposal.approvalId });
      }

      if (action === 'adjust') {
        if (typeof credits !== 'number') return res.status(400).json({ error: 'credits must be a number (positive or negative)' });
        if (!note) return res.status(400).json({ error: 'note required for adjustments' });
        const proposal = await proposeApproval({
          actionType: 'admin_adjust',
          proposedBy: userId,
          payload: {
            organizationId: companyId,
            amountCredits:  credits,
            reason:         note,
          },
        });
        if (proposal.ok === false) return res.status(400).json({ error: proposal.message, code: proposal.code });
        if (!proposal.autoApproved) {
          return res.status(202).json({
            ok: true,
            status: 'pending_approval',
            approvalId: proposal.approvalId,
            requiredApprovals: proposal.requiredApprovals,
            message: 'Adjustment requires additional approval. Sign via /api/admin/credits/approvals/sign.',
          });
        }

        const { adjustCredits } = await import('../../../../backend/services/consumptionAnalyticsService');
        const result = await adjustCredits({ organizationId: companyId, credits, note, performedBy: userId });
        if (result.ok === false) return res.status(500).json({ error: result.error });
        const ledgerIdem = String(req.headers['idempotency-key'] ?? `${proposal.approvalId}:exec`);
        await recordAdminAudit({
          actorUserId: userId,
          action: 'ADMIN_CREDITS_ADJUST',
          targetType: 'organization',
          targetId: companyId,
          metadata: { credits, note, approvalId: proposal.approvalId },
          idempotencyKey: ledgerIdem,
        });
        await markApprovalExecuted({
          approvalId:             proposal.approvalId,
          executedIdempotencyKey: ledgerIdem,
          actorUserId:            userId,
        });
        await recordAdminFinancialOperation({
          module:               'http:admin_credits_legacy_adjust',
          actorUserId:          userId,
          organizationId:       companyId,
          action:               'admin_adjust',
          amountCredits:        credits,
          reason:               note,
          approvalId:           proposal.approvalId,
          ledgerIdempotencyKey: ledgerIdem,
        });
        return res.status(200).json({ ok: true, action: 'adjust', credits, approvalId: proposal.approvalId });
      }

      if (action === 'set_rate') {
        if (typeof creditRateUsd !== 'number' || creditRateUsd < 0) {
          return res.status(400).json({ error: 'creditRateUsd must be a non-negative number' });
        }
        // Rate changes always require 2 approvers (governance §10 / threshold seed)
        const proposal = await proposeApproval({
          actionType: 'admin_rate_change',
          proposedBy: userId,
          payload: {
            organizationId:   companyId,
            newCreditRateUsd: creditRateUsd,
            reason:           note ?? 'credit_rate_usd change',
          },
        });
        if (proposal.ok === false) return res.status(400).json({ error: proposal.message, code: proposal.code });
        if (!proposal.autoApproved) {
          return res.status(202).json({
            ok: true,
            status: 'pending_approval',
            approvalId: proposal.approvalId,
            requiredApprovals: proposal.requiredApprovals,
            message: 'Rate change requires additional approval. Sign via /api/admin/credits/approvals/sign.',
          });
        }

        const { updateOrgCreditRate } = await import('../../../../backend/services/consumptionAnalyticsService');
        const result = await updateOrgCreditRate({ organizationId: companyId, creditRateUsd, performedBy: userId });
        if (result.ok === false) return res.status(500).json({ error: result.error });
        const ledgerIdem = String(req.headers['idempotency-key'] ?? `${proposal.approvalId}:exec`);
        await recordAdminAudit({
          actorUserId: userId,
          action: 'ADMIN_CREDITS_SET_RATE',
          targetType: 'organization',
          targetId: companyId,
          metadata: { creditRateUsd, approvalId: proposal.approvalId },
          idempotencyKey: ledgerIdem,
        });
        await markApprovalExecuted({
          approvalId:             proposal.approvalId,
          executedIdempotencyKey: ledgerIdem,
          actorUserId:            userId,
        });
        await recordAdminFinancialOperation({
          module:               'http:admin_credits_set_rate',
          actorUserId:          userId,
          organizationId:       companyId,
          action:               'admin_rate_change',
          reason:               note ?? undefined,
          approvalId:           proposal.approvalId,
          ledgerIdempotencyKey: ledgerIdem,
        });
        return res.status(200).json({ ok: true, action: 'set_rate', creditRateUsd, approvalId: proposal.approvalId });
      }

      return res.status(400).json({ error: `Unknown action: ${action}. Valid: grant, adjust, set_rate` });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err: any) {
    logger.error('admin_credits_failed', { message: err?.message ?? 'unknown' });
    return res.status(500).json({ error: 'Internal server error' });
  }
}

export default __createApiRoute(withIdempotency(handler, { scope: 'admin-credits', methods: ['POST'] }), { route: '/api/admin/credits' });
