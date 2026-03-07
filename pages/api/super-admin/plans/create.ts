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

const RESOURCE_KEYS = [
  'llm_tokens',
  'external_api_calls',
  'automation_executions',
  'max_campaign_duration_weeks',
  'max_topics',
  'max_competitors',
  'max_regions',
  'max_products',
  'max_keywords',
  'enable_api_presets',
  'enable_custom_templates',
];

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (!(await requireSuperAdmin(req, res))) return;

  const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {};
  const planKey = body.plan_key ?? body.planKey;
  const name = body.name;
  const description = body.description ?? null;
  const monthlyPrice = body.monthly_price ?? body.monthlyPrice ?? null;
  const limits = body.limits && typeof body.limits === 'object' ? body.limits : {};

  if (!planKey || !name) {
    return res.status(400).json({ error: 'plan_key and name are required' });
  }

  try {
    const { data: existingPlan } = await supabase
      .from('pricing_plans')
      .select('id')
      .eq('plan_key', planKey)
      .maybeSingle();

    const now = new Date().toISOString();
    let planId: string;

    if (existingPlan?.id) {
      planId = existingPlan.id;
      await supabase
        .from('pricing_plans')
        .update({
          name,
          description,
          monthly_price: monthlyPrice,
          updated_at: now,
        })
        .eq('id', planId);
    } else {
      const { data: inserted, error: insertErr } = await supabase
        .from('pricing_plans')
        .insert({
          plan_key: planKey,
          name,
          description,
          monthly_price: monthlyPrice,
          currency: 'USD',
          is_active: true,
          created_at: now,
          updated_at: now,
        })
        .select('id')
        .single();
      if (insertErr) return res.status(500).json({ error: insertErr.message });
      planId = inserted.id;
    }

    const keysToUpsert = [...new Set([...RESOURCE_KEYS, ...Object.keys(limits)])];
    for (const resourceKey of keysToUpsert) {
      const value = limits[resourceKey];
      if (value === undefined) continue;
      const limitValue = value != null ? Number(value) : null;

      const { error: upsertErr } = await supabase.from('plan_limits').upsert(
        {
          plan_id: planId,
          resource_key: resourceKey,
          limit_value: limitValue,
          created_at: now,
        },
        { onConflict: 'plan_id,resource_key' }
      );
      if (upsertErr) return res.status(500).json({ error: upsertErr.message });
    }

    return res.status(200).json({ success: true, plan_id: planId, plan_key: planKey });
  } catch (err: any) {
    return res.status(500).json({ error: err?.message ?? 'Internal server error' });
  }
}
