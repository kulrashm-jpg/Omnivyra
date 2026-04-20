
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
import {
  getOrgCreditSummary,
  grantCredits,
  adjustCredits,
  updateOrgCreditRate,
} from '../../../../backend/services/consumptionAnalyticsService';
import { requireAdminRateLimit, requireAuthenticatedInternalUser } from '../../../../backend/services/requestAccessService';
import { recordAdminAudit } from '../../../../backend/services/adminAuditService';
import { logger } from '../../../../backend/services/logger';
import { withIdempotency } from '../../../../backend/middleware/withIdempotency';

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
        const result = await grantCredits({ organizationId: companyId, credits, usdEquivalent, note, performedBy: userId });
        if (!result.ok) return res.status(500).json({ error: result.error });
        await recordAdminAudit({
          actorUserId: userId,
          action: 'ADMIN_CREDITS_GRANT',
          targetType: 'organization',
          targetId: companyId,
          metadata: { credits, usdEquivalent: usdEquivalent ?? null, note: note ?? null },
          idempotencyKey: String(req.headers['idempotency-key'] ?? ''),
        });
        return res.status(200).json({ ok: true, action: 'grant', credits });
      }

      if (action === 'adjust') {
        if (typeof credits !== 'number') return res.status(400).json({ error: 'credits must be a number (positive or negative)' });
        if (!note) return res.status(400).json({ error: 'note required for adjustments' });
        const result = await adjustCredits({ organizationId: companyId, credits, note, performedBy: userId });
        if (!result.ok) return res.status(500).json({ error: result.error });
        await recordAdminAudit({
          actorUserId: userId,
          action: 'ADMIN_CREDITS_ADJUST',
          targetType: 'organization',
          targetId: companyId,
          metadata: { credits, note },
          idempotencyKey: String(req.headers['idempotency-key'] ?? ''),
        });
        return res.status(200).json({ ok: true, action: 'adjust', credits });
      }

      if (action === 'set_rate') {
        if (typeof creditRateUsd !== 'number' || creditRateUsd < 0) {
          return res.status(400).json({ error: 'creditRateUsd must be a non-negative number' });
        }
        const result = await updateOrgCreditRate({ organizationId: companyId, creditRateUsd, performedBy: userId });
        if (!result.ok) return res.status(500).json({ error: result.error });
        await recordAdminAudit({
          actorUserId: userId,
          action: 'ADMIN_CREDITS_SET_RATE',
          targetType: 'organization',
          targetId: companyId,
          metadata: { creditRateUsd },
          idempotencyKey: String(req.headers['idempotency-key'] ?? ''),
        });
        return res.status(200).json({ ok: true, action: 'set_rate', creditRateUsd });
      }

      return res.status(400).json({ error: `Unknown action: ${action}. Valid: grant, adjust, set_rate` });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err: any) {
    logger.error('admin_credits_failed', { message: err?.message ?? 'unknown' });
    return res.status(500).json({ error: 'Internal server error' });
  }
}

export default withIdempotency(handler, { scope: 'admin-credits', methods: ['POST'] });
