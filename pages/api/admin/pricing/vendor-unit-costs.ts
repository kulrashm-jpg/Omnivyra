import { createApiRoute as __createApiRoute } from '../../../../lib/platform/routeFactory';
import type { NextApiRequest, NextApiResponse } from 'next';
import { requireCapability } from '../../../../backend/security/requireCapability';
import { SUPER_ADMIN_DASHBOARD_VIEW } from '../../../../shared/contracts/security';
import { supabase } from '../../../../backend/db/supabaseClient';
import { REQUIRED_IMAGE_SKUS, imageUnitFor } from '../../../../backend/services/billing/imageCredits';

/**
 * GET /api/admin/pricing/vendor-unit-costs. READ-ONLY, platform view capability.
 *
 * What Omnivyra pays each provider per unit (llm_model_pricing rows of kind
 * 'unit') and the pricing rules applied on top - the active action_pricing_config
 * rows for prospect_enrichment (data vendors, mode B) and image_generation
 * (image credits, owner ruling 2026-11-11). Also lists the image SKUs the owner
 * must price, each marked set or missing: until a SKU is set, image generation
 * for it refuses (fail closed).
 *
 * WRITES stay on the existing, audited POST /api/admin/pricing/update (target
 * 'model', kind 'unit'), which requires BILLING_PLAN_MANAGE + step-up - one
 * write path for every price in the platform.
 */
const RULE_ACTIONS = ['prospect_enrichment', 'image_generation'] as const;

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const guard = await requireCapability(req, res, {
    capability: SUPER_ADMIN_DASHBOARD_VIEW,
    reason: 'read provider unit costs and pricing rules',
  });
  if (guard.ok !== true) return;

  const [units, actions] = await Promise.all([
    supabase.from('llm_model_pricing')
      .select('provider, model_name, input_per_1k_usd, effective_from, notes')
      .eq('kind', 'unit').eq('is_active', true).order('provider', { ascending: true }),
    supabase.from('action_pricing_config')
      .select('action_key, cost_multiplier, minimum_charge_usd, ceiling_usd, effective_from')
      .in('action_key', [...RULE_ACTIONS]).eq('is_active', true)
      .order('effective_from', { ascending: false }),
  ]);
  if (units.error || actions.error || !Array.isArray(units.data) || !Array.isArray(actions.data)) {
    return res.status(500).json({ error: 'VENDOR_UNIT_COSTS_READ_FAILED' });
  }
  const unitRows = units.data as Array<Record<string, unknown>>;
  const ruleFor = (key: string) => (actions.data as Array<Record<string, unknown>>).find((r) => r.action_key === key) ?? null;
  const priced = new Set(unitRows.map((r) => `${String(r.provider).toLowerCase()}|${String(r.model_name).toLowerCase()}`));

  return res.status(200).json({
    vendorUnitCosts: unitRows.map((r) => ({
      provider: r.provider,
      unit: r.model_name,
      usdPerUnit: Number(r.input_per_1k_usd) / 1000,
      effectiveFrom: r.effective_from,
      notes: r.notes ?? null,
    })),
    // Kept for the existing data-vendor section.
    pricingRule: ruleFor('prospect_enrichment'),
    pricingRules: Object.fromEntries(RULE_ACTIONS.map((k) => [k, ruleFor(k)])),
    requiredImageSkus: REQUIRED_IMAGE_SKUS.map((k) => {
      const unit = imageUnitFor(k.model, k.size, k.quality);
      return { ...k, unit, priced: priced.has(`${k.provider}|${unit}`) };
    }),
  });
}

export default __createApiRoute(handler, { route: '/api/admin/pricing/vendor-unit-costs' });
