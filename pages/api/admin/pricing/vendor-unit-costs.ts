import { createApiRoute as __createApiRoute } from '../../../../lib/platform/routeFactory';
import type { NextApiRequest, NextApiResponse } from 'next';
import { isPlatformSuperAdmin, isSuperAdmin } from '../../../../backend/services/rbacService';
import { requireAuthenticatedInternalUser } from '../../../../backend/services/requestAccessService';
import { supabase } from '../../../../backend/db/supabaseClient';

/**
 * GET /api/admin/pricing/vendor-unit-costs. READ-ONLY, super-admin.
 *
 * Mode B (owner, 2026-11-10): what Omnivyra pays each DATA VENDOR per unit
 * (llm_model_pricing rows of kind 'unit'), and the pricing rule applied on top
 * (the active `prospect_enrichment` action_pricing_config row: cost_multiplier,
 * minimum, ceiling). WRITES stay on the existing, audited
 * POST /api/admin/pricing/update (target 'model', kind 'unit'), so there is one
 * write path for every price in the platform.
 */
async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const user = await requireAuthenticatedInternalUser(req, res);
  if (!user) return;
  if (!(await isPlatformSuperAdmin(user.id)) && !(await isSuperAdmin(user.id))) {
    return res.status(403).json({ error: 'SUPER_ADMIN_REQUIRED' });
  }
  const [units, action] = await Promise.all([
    supabase.from('llm_model_pricing')
      .select('provider, model_name, input_per_1k_usd, effective_from, notes')
      .eq('kind', 'unit').eq('is_active', true).order('provider', { ascending: true }),
    supabase.from('action_pricing_config')
      .select('action_key, cost_multiplier, minimum_charge_usd, ceiling_usd, effective_from')
      .eq('action_key', 'prospect_enrichment').eq('is_active', true)
      .order('effective_from', { ascending: false }).limit(1),
  ]);
  if (units.error || action.error) {
    return res.status(500).json({ error: 'VENDOR_UNIT_COSTS_READ_FAILED' });
  }
  return res.status(200).json({
    vendorUnitCosts: (units.data ?? []).map((r: Record<string, unknown>) => ({
      provider: r.provider,
      unit: r.model_name,
      usdPerUnit: Number(r.input_per_1k_usd) / 1000,
      effectiveFrom: r.effective_from,
      notes: r.notes ?? null,
    })),
    pricingRule: (action.data ?? [])[0] ?? null,
  });
}

export default __createApiRoute(handler, { route: '/api/admin/pricing/vendor-unit-costs' });
