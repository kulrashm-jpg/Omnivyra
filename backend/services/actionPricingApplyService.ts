import { ownedDbTable } from '../db/writeOwner';
/**
 * Action Pricing Apply Service
 *
 * Shared helper for writing a new active row to action_pricing_config.
 * Used by:
 *   - POST /api/admin/pricing/update  (direct admin-authored change)
 *   - POST /api/admin/pricing/apply   (promotes a queued recommendation)
 *
 * The versioning pattern is always: deactivate prior active row, insert
 * new active row with effective_from. Callers that want validation against
 * known action_keys should do that at the API boundary before calling.
 */

import { supabase } from '../db/supabaseClient';
import { refreshPricingCache } from './pricingService';
import { logger } from './logger';

export interface ApplyActionPricingOpts {
  actionKey: string;
  costMultiplier: number;
  minimumChargeUsd?: number;
  ceilingUsd?: number | null;
  notes?: string;
  effectiveFrom?: string;
}

export interface ApplyActionPricingResult {
  id: string;
}

export async function applyActionPricingChange(
  opts: ApplyActionPricingOpts,
): Promise<ApplyActionPricingResult> {
  const effective = opts.effectiveFrom ?? new Date().toISOString();

  const { error: deactivateErr } = await ownedDbTable('action_pricing_config')
    .update({ is_active: false })
    .eq('action_key', opts.actionKey)
    .eq('is_active', true);
  if (deactivateErr) {
    logger.error('action_pricing_deactivate_failed', { message: deactivateErr.message });
    throw new Error(`Failed to deactivate prior row: ${deactivateErr.message}`);
  }

  const { data, error: insertErr } = await ownedDbTable('action_pricing_config')
    .insert({
      action_key:      opts.actionKey,
      cost_multiplier: opts.costMultiplier,
      minimum_charge_usd: opts.minimumChargeUsd ?? 0,
      ceiling_usd: opts.ceilingUsd ?? null,
      effective_from:  effective,
      is_active:       true,
      notes:           opts.notes ?? null,
    })
    .select('id')
    .single();

  if (insertErr || !data) {
    logger.error('action_pricing_insert_failed', { message: insertErr?.message });
    throw new Error(`Failed to insert pricing row: ${insertErr?.message ?? 'no-data'}`);
  }

  await refreshPricingCache();
  return { id: (data as any).id as string };
}
