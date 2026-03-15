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
import { getSupabaseUserFromRequest } from '../../../../backend/services/supabaseAuthService';
import { isPlatformSuperAdmin, isSuperAdmin, getUserRole } from '../../../../backend/services/rbacService';
import {
  getOrgCreditSummary,
  grantCredits,
  adjustCredits,
  updateOrgCreditRate,
} from '../../../../backend/services/consumptionAnalyticsService';

async function assertSuperAdmin(req: NextApiRequest, res: NextApiResponse): Promise<string | null> {
  const auth = await getSupabaseUserFromRequest(req);
  if (auth.error || !auth.user) { res.status(401).json({ error: 'UNAUTHORIZED' }); return null; }
  const userId = auth.user.id;
  if ((await isPlatformSuperAdmin(userId)) || (await isSuperAdmin(userId))) return userId;
  res.status(403).json({ error: 'SUPER_ADMIN_REQUIRED' });
  return null;
}

async function assertCompanyAccess(
  req: NextApiRequest,
  res: NextApiResponse,
  companyId: string
): Promise<{ userId: string; isSA: boolean } | null> {
  const auth = await getSupabaseUserFromRequest(req);
  if (auth.error || !auth.user) { res.status(401).json({ error: 'UNAUTHORIZED' }); return null; }
  const userId = auth.user.id;
  if ((await isPlatformSuperAdmin(userId)) || (await isSuperAdmin(userId))) return { userId, isSA: true };
  const { role } = await getUserRole(userId, companyId);
  if (!role) { res.status(403).json({ error: 'FORBIDDEN' }); return null; }
  return { userId, isSA: false };
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
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
        return res.status(200).json({ ok: true, action: 'grant', credits });
      }

      if (action === 'adjust') {
        if (typeof credits !== 'number') return res.status(400).json({ error: 'credits must be a number (positive or negative)' });
        if (!note) return res.status(400).json({ error: 'note required for adjustments' });
        const result = await adjustCredits({ organizationId: companyId, credits, note, performedBy: userId });
        if (!result.ok) return res.status(500).json({ error: result.error });
        return res.status(200).json({ ok: true, action: 'adjust', credits });
      }

      if (action === 'set_rate') {
        if (typeof creditRateUsd !== 'number' || creditRateUsd < 0) {
          return res.status(400).json({ error: 'creditRateUsd must be a non-negative number' });
        }
        const result = await updateOrgCreditRate({ organizationId: companyId, creditRateUsd, performedBy: userId });
        if (!result.ok) return res.status(500).json({ error: result.error });
        return res.status(200).json({ ok: true, action: 'set_rate', creditRateUsd });
      }

      return res.status(400).json({ error: `Unknown action: ${action}. Valid: grant, adjust, set_rate` });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err: any) {
    console.error('[api/admin/credits]', err?.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
