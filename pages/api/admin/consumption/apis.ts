/**
 * GET /api/admin/consumption/apis
 * External API call consumption.
 *
 * Query params:
 *   companyId  – required unless super_admin all-orgs view
 *   year, month – optional, defaults to current month
 */

import { NextApiRequest, NextApiResponse } from 'next';
import { getSupabaseUserFromRequest } from '../../../../backend/services/supabaseAuthService';
import { isPlatformSuperAdmin, isSuperAdmin, getUserRole } from '../../../../backend/services/rbacService';
import {
  getApiConsumption,
  getAllOrgsConsumption,
  ConsumptionTier,
} from '../../../../backend/services/consumptionAnalyticsService';

async function resolveTier(
  req: NextApiRequest,
  res: NextApiResponse,
  companyId?: string
): Promise<{ tier: ConsumptionTier; orgId: string | null } | null> {
  // Super admin cookie session (username/password login — no Supabase token)
  if (req.cookies?.super_admin_session === '1') {
    return { tier: 'super_admin', orgId: companyId ?? null };
  }

  const auth = await getSupabaseUserFromRequest(req);
  if (auth.error || !auth.user) { res.status(401).json({ error: 'UNAUTHORIZED' }); return null; }
  const userId = auth.user.id;

  if ((await isPlatformSuperAdmin(userId)) || (await isSuperAdmin(userId))) {
    return { tier: 'super_admin', orgId: companyId ?? null };
  }
  if (!companyId) { res.status(400).json({ error: 'companyId required' }); return null; }
  const { role } = await getUserRole(userId, companyId);
  if (!role) { res.status(403).json({ error: 'FORBIDDEN' }); return null; }
  const tier: ConsumptionTier = role === 'COMPANY_ADMIN' || role === 'ADMIN' ? 'company_admin' : 'user';
  return { tier, orgId: companyId };
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const companyId = req.query.companyId as string | undefined;
    const year = req.query.year ? parseInt(req.query.year as string, 10) : undefined;
    const month = req.query.month ? parseInt(req.query.month as string, 10) : undefined;

    const context = await resolveTier(req, res, companyId);
    if (!context) return;

    const { tier, orgId } = context;

    // Super admin without companyId → all-orgs summary (API stats from same table)
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
