
/**
 * GET /api/admin/consumption/llm
 * LLM token and cost consumption.
 *
 * Query params:
 *   companyId  â€“ required for company_admin / user views; optional for super_admin (returns all-orgs if omitted)
 *   year       â€“ optional, defaults to current month
 *   month      â€“ optional, defaults to current month
 *   page, limit â€“ for all-orgs pagination (super_admin only)
 *
 * Role visibility:
 *   super_admin   â†’ full cost + by_user + all orgs overview when companyId omitted
 *   company_admin â†’ cost + by_operation + by_campaign for own org
 *   user          â†’ token counts only (no costs) for own org
 */

import { NextApiRequest, NextApiResponse } from 'next';
import { requireAdminScope } from '../../../../backend/services/requestAccessService';
import { Role } from '../../../../backend/services/rbacPrimitives';
import {
  getLlmConsumption,
  getAllOrgsConsumption,
  ConsumptionTier,
} from '../../../../backend/services/consumptionAnalyticsService';
import { applyAuthGuard } from '@/backend/middleware/applyAuthGuard';
import { createServiceRoleMigrationProxy } from '../../../../backend/db/supabaseClient';
const supabase = createServiceRoleMigrationProxy('AUTO_MIGRATION_REQUIRED');

async function resolveTier(
  req: NextApiRequest,
  res: NextApiResponse,
  companyId?: string
): Promise<{ tier: ConsumptionTier; userId: string; orgId: string | null } | null> {
  const ctx = await requireAdminScope(req, res, 'consumption:llm', { companyId });
  if (!ctx) return null;
  if (process.env.NODE_ENV !== 'production') {
    console.warn('[ADMIN_SCOPE]', '/api/admin/consumption/llm', 'consumption:llm');
  }
  if (ctx.role === Role.SUPER_ADMIN) {
    return { tier: 'super_admin', userId: ctx.id, orgId: companyId ?? null };
  }
  const tier: ConsumptionTier = ctx.role === Role.COMPANY_ADMIN ? 'company_admin' : 'user';
  return { tier, userId: ctx.id, orgId: companyId ?? null };
}

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const companyId = req.query.companyId as string | undefined;
    const year = req.query.year ? parseInt(req.query.year as string, 10) : undefined;
    const month = req.query.month ? parseInt(req.query.month as string, 10) : undefined;

    const context = await resolveTier(req, res, companyId);
    if (!context) return;

    const { tier, orgId } = context;

    // Super admin with no companyId â†’ return all-orgs overview
    if (tier === 'super_admin' && !orgId) {
      const rows = await getAllOrgsConsumption({ year, month });
      return res.status(200).json({ tier, scope: 'all_orgs', data: rows });
    }

    if (!orgId) return res.status(400).json({ error: 'companyId required' });

    const data = await getLlmConsumption(orgId, tier, { year, month });
    return res.status(200).json({ tier, scope: 'single_org', data });
  } catch (err: any) {
    console.error('[api/admin/consumption/llm]', err?.message, err?.stack);
    const msg = process.env.NODE_ENV !== 'production' ? (err?.message ?? 'Unknown error') : 'Internal server error';
    return res.status(500).json({ error: msg });
  }
}

export default applyAuthGuard({
  requiresAuth: true,
  requiredRole: 'SUPER_ADMIN',
  allowSuperAdminOverride: true,
})(handler);
