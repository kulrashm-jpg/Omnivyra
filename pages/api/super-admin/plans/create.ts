import { NextApiRequest, NextApiResponse } from 'next';
import { createServiceRoleMigrationProxy } from '../../../../backend/db/supabaseClient';
const supabase = createServiceRoleMigrationProxy('AUTO_MIGRATION_REQUIRED');
import { requireAdminScope } from '../../../../backend/services/requestAccessService';
import { applyAuthGuard } from '@/backend/middleware/applyAuthGuard';

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

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const ctx = await requireAdminScope(req, res, 'plans:create');
  if (!ctx) return;
  if (process.env.NODE_ENV !== 'production') {
    console.warn('[ADMIN_SCOPE]', '/api/super-admin/plans/create', 'plans:create');
  }

  const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {};
  const planKey        = body.plan_key ?? body.planKey;
  const name           = body.name;
  const description    = body.description ?? null;
  const monthlyPrice   = body.monthly_price ?? body.monthlyPrice ?? null;
  const creditsIncluded = body.credits_included ?? body.creditsIncluded ?? 0;
  const validityDays   = body.validity_days ?? body.validityDays ?? null;
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
          monthly_price:    monthlyPrice,
          credits_included: creditsIncluded,
          validity_days:    validityDays,
          updated_at:       now,
        })
        .eq('id', planId);
    } else {
      const { data: inserted, error: insertErr } = await supabase
        .from('pricing_plans')
        .insert({
          plan_key:         planKey,
          name,
          description,
          monthly_price:    monthlyPrice,
          credits_included: creditsIncluded,
          validity_days:    validityDays,
          currency:         'USD',
          is_active:        true,
          created_at:       now,
          updated_at:       now,
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

export default applyAuthGuard({
  requiresAuth: true,
  requiredRole: 'SUPER_ADMIN',
  allowSuperAdminOverride: true,
})(handler);
