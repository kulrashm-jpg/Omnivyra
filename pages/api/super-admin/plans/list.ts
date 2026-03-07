import { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../../../backend/db/supabaseClient';
import { getSupabaseUserFromRequest } from '../../../../backend/services/supabaseAuthService';
import { isPlatformSuperAdmin } from '../../../../backend/services/rbacService';

const requireSuperAdmin = async (
  req: NextApiRequest,
  res: NextApiResponse
): Promise<boolean> => {
  if (req.cookies?.super_admin_session === '1') return true;
  const { user, error } = await getSupabaseUserFromRequest(req);
  if (!error && user?.id && (await isPlatformSuperAdmin(user.id))) return true;
  res.status(403).json({ error: 'NOT_AUTHORIZED' });
  return false;
};

/**
 * GET /api/super-admin/plans/list
 * Returns all active pricing plans with their limits (llm_tokens, external_api_calls, automation_executions, max_campaign_duration_weeks).
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (!(await requireSuperAdmin(req, res))) return;

  try {
    const { data: plans, error: plansErr } = await supabase
      .from('pricing_plans')
      .select('id, plan_key, name, description, monthly_price, currency, is_active, created_at, updated_at')
      .eq('is_active', true)
      .order('plan_key');

    if (plansErr) {
      return res.status(500).json({ error: plansErr.message });
    }

    if (!plans || plans.length === 0) {
      return res.status(200).json({ plans: [], limitsByPlan: {} });
    }

    const planIds = plans.map((p) => p.id);
    const { data: limitRows, error: limitsErr } = await supabase
      .from('plan_limits')
      .select('plan_id, resource_key, limit_value')
      .in('plan_id', planIds);

    if (limitsErr) {
      return res.status(500).json({ error: limitsErr.message });
    }

    const limitsByPlan: Record<string, Record<string, number | null>> = {};
    for (const plan of plans) {
      limitsByPlan[plan.id] = {};
    }
    for (const row of limitRows || []) {
      const planId = String(row.plan_id);
      const val = (row as { limit_value?: number | null }).limit_value;
      if (limitsByPlan[planId]) {
        limitsByPlan[planId][row.resource_key] =
          val != null ? Number(val) : null;
      }
    }

    return res.status(200).json({
      plans,
      limitsByPlan,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal server error';
    return res.status(500).json({ error: message });
  }
}
