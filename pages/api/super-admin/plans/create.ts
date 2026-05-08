import { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../../../backend/db/supabaseClient';
import { requireCapability } from '../../../../backend/security/requireCapability';
import { BILLING_PLAN_MANAGE } from '../../../../shared/contracts/security';

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

  // Phase: Platform Authority Isolation. billing.plan.manage is a
  // SUPER_ADMIN-only platform-tier capability; replaces the previous
  // BILLING_MANAGE gate (per-tenant) which COMPANY_ADMINs would have
  // satisfied for plan creation that affects ALL orgs.
  const guard = await requireCapability(req, res, {
    capability: BILLING_PLAN_MANAGE,
    reason: 'super-admin creates / updates a pricing plan',
  });
  if (guard.ok !== true) return;

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
