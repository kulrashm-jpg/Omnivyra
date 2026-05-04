
/**
 * GET /api/admin/consumption/apis
 * External API call consumption.
 *
 * Query params:
 *   companyId  â€“ required unless super_admin all-orgs view
 *   year, month â€“ optional, defaults to current month
 */

import { NextApiRequest, NextApiResponse } from 'next';
import { requireAdminScope } from '../../../../backend/services/requestAccessService';
import { Role } from '../../../../backend/services/rbacPrimitives';
import {
  getApiConsumption,
  getAllOrgsConsumption,
  ConsumptionTier,
} from '../../../../backend/services/consumptionAnalyticsService';
import { applyAuthGuard } from '@/backend/middleware/applyAuthGuard';

async function resolveTier(
  req: NextApiRequest,
  res: NextApiResponse,
  companyId?: string
): Promise<{ tier: ConsumptionTier; orgId: string | null } | null> {
  const ctx = await requireAdminScope(req, res, 'consumption:apis', { companyId });
  if (!ctx) return null;
  if (process.env.NODE_ENV !== 'production') {
    console.warn('[ADMIN_SCOPE]', '/api/admin/consumption/apis', 'consumption:apis');
  }
  if (ctx.role === Role.SUPER_ADMIN) {
    return { tier: 'super_admin', orgId: companyId ?? null };
  }
  // Non-super-admin scope already enforced companyId; downgrade tier by role.
  const tier: ConsumptionTier = ctx.role === Role.COMPANY_ADMIN ? 'company_admin' : 'user';
  return { tier, orgId: companyId ?? null };
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

    // Super admin without companyId â†’ all-orgs summary (API stats from same table)
    if (tier === 'super_admin' && !orgId) {
      const rows = await getAllOrgsConsumption({ year, month });
      // Filter to API-relevant fields
      const apiRows = rows.map(r => ({
        organization_id: r.organization_id,
        org_name: r.org_name,
        api_calls: r.api_calls,
        api_cost_usd: r.api_cost_usd,
        credit_balance: r.credit_balance,
      }));
      return res.status(200).json({ tier, scope: 'all_orgs', data: apiRows });
    }

    if (!orgId) return res.status(400).json({ error: 'companyId required' });

    const data = await getApiConsumption(orgId, tier, { year, month });
    return res.status(200).json({ tier, scope: 'single_org', data });
  } catch (err: any) {
    console.error('[api/admin/consumption/apis]', err?.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

export default applyAuthGuard({
  requiresAuth: true,
  requiredRole: 'SUPER_ADMIN',
  allowSuperAdminOverride: true,
})(handler);
