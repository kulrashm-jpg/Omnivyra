/**
 * GET /api/admin/consumption/llm
 * LLM token and cost consumption.
 *
 * Query params:
 *   companyId  – required for company_admin / user views; optional for super_admin (returns all-orgs if omitted)
 *   year       – optional, defaults to current month
 *   month      – optional, defaults to current month
 *   page, limit – for all-orgs pagination (super_admin only)
 *
 * Role visibility:
 *   super_admin   → full cost + by_user + all orgs overview when companyId omitted
 *   company_admin → cost + by_operation + by_campaign for own org
 *   user          → token counts only (no costs) for own org
 */

import { NextApiRequest, NextApiResponse } from 'next';
import { getSupabaseUserFromRequest } from '../../../../backend/services/supabaseAuthService';
import { isPlatformSuperAdmin, isSuperAdmin, getUserRole } from '../../../../backend/services/rbacService';
import {
  getLlmConsumption,
  getAllOrgsConsumption,
  ConsumptionTier,
} from '../../../../backend/services/consumptionAnalyticsService';
import { supabase } from '../../../../backend/db/supabaseClient';

async function resolveTier(
  req: NextApiRequest,
  res: NextApiResponse,
  companyId?: string
): Promise<{ tier: ConsumptionTier; userId: string; orgId: string | null } | null> {
  const auth = await getSupabaseUserFromRequest(req);
  if (auth.error || !auth.user) {
    res.status(401).json({ error: 'UNAUTHORIZED' });
    return null;
  }
  const userId = auth.user.id;

  if ((await isPlatformSuperAdmin(userId)) || (await isSuperAdmin(userId))) {
    return { tier: 'super_admin', userId, orgId: companyId ?? null };
  }

  if (!companyId) {
    res.status(400).json({ error: 'companyId required' });
    return null;
  }

  const { role } = await getUserRole(userId, companyId);
  if (!role) {
    res.status(403).json({ error: 'FORBIDDEN' });
    return null;
  }

  const tier: ConsumptionTier =
    role === 'COMPANY_ADMIN' || role === 'ADMIN' ? 'company_admin' : 'user';
  return { tier, userId, orgId: companyId };
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

    // Super admin with no companyId → return all-orgs overview
    if (tier === 'super_admin' && !orgId) {
      const rows = await getAllOrgsConsumption({ year, month });
      return res.status(200).json({ tier, scope: 'all_orgs', data: rows });
    }

    if (!orgId) return res.status(400).json({ error: 'companyId required' });

    const data = await getLlmConsumption(orgId, tier, { year, month });
    return res.status(200).json({ tier, scope: 'single_org', data });
  } catch (err: any) {
    console.error('[api/admin/consumption/llm]', err?.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
