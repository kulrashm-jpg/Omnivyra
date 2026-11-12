import { ownedDbRpc } from '../db/writeOwner';
/**
 * Action Pricing Apply Service
 *
 * THE one write path for a new active row in action_pricing_config.
 * Used by:
 *   - POST /api/admin/pricing/update  (direct admin-authored change)
 *   - POST /api/admin/pricing/apply   (promotes a queued recommendation)
 *
 * Billing defect B-1 (2026-11-10): this used to run two separately committed
 * statements -- deactivate the prior active row, then insert the new one WITHOUT
 * the NOT NULL source_type -- so the insert always failed AFTER the deactivate
 * had committed, leaving the action with no active row (every later pricing
 * lookup of it then throws). The write is now ONE call to the database function
 * apply_action_pricing_change (migration 20270210000000), which locks the
 * action's active row, carries source_type from it (or requires it), and
 * deactivates-then-inserts in a single transaction: a failure changes nothing.
 *
 * Callers that want validation against known action_keys should do that at the
 * API boundary before calling. source_type is validated by the table's CHECK.
 */

import { refreshPricingCache } from './pricingService';
import { logger } from './logger';

export interface ApplyActionPricingOpts {
  actionKey: string;
  costMultiplier: number;
  minimumChargeUsd?: number;
  ceilingUsd?: number | null;
  notes?: string;
  effectiveFrom?: string;
  /**
   * Optional. When omitted, the function carries it from the action's current
   * active row; when the action has no active row it MUST be supplied.
   */
  sourceType?: string;
}

export interface ApplyActionPricingResult {
  id: string;
}

/**
 * A refusal the caller caused (bad input), as opposed to a platform failure.
 * Maps to HTTP 400 at the API boundary.
 *   22023 -- the function's named refusals (missing action_key / cost_multiplier,
 *            or no source_type and no active row to carry it from)
 *   23514 -- a CHECK violation (e.g. a source_type the table does not allow)
 */
export class ActionPricingInputError extends Error {
  constructor(message: string, public readonly pgCode: string) {
    super(message);
    this.name = 'ActionPricingInputError';
  }
}

const INPUT_ERROR_CODES = new Set(['22023', '23514']);

/**
 * One versioned-apply database function call, shared by the action and model
 * paths: maps input refusals to ActionPricingInputError, treats a blank answer
 * as failure, and refreshes the pricing cache only after success.
 */
async function callVersionedApply(
  fn: 'apply_action_pricing_change' | 'apply_model_pricing_change',
  args: Record<string, unknown>,
): Promise<ApplyActionPricingResult> {
  const { data, error } = await ownedDbRpc(fn, args);

  if (error) {
    const code = String((error as { code?: unknown }).code ?? '');
    logger.error('pricing_versioned_apply_failed', { fn, code, message: error.message });
    if (INPUT_ERROR_CODES.has(code)) {
      throw new ActionPricingInputError(error.message, code);
    }
    throw new Error(`Failed to apply pricing change: ${error.message}`);
  }
  // A blank answer is not success (postgrest-js can turn a blank response into
  // {data: null, error: null}): the function always returns the new row's id.
  if (typeof data !== 'string' || data.length === 0) {
    logger.error('pricing_versioned_apply_no_id', { fn, data_type: typeof data });
    throw new Error('Failed to apply pricing change: the database returned no row id');
  }

  await refreshPricingCache();
  return { id: data };
}

export async function applyActionPricingChange(
  opts: ApplyActionPricingOpts,
): Promise<ApplyActionPricingResult> {
  return callVersionedApply('apply_action_pricing_change', {
    p_action_key:         opts.actionKey,
    p_cost_multiplier:    opts.costMultiplier,
    p_minimum_charge_usd: opts.minimumChargeUsd ?? 0,
    p_ceiling_usd:        opts.ceilingUsd ?? null,
    p_effective_from:     opts.effectiveFrom ?? new Date().toISOString(),
    p_notes:              opts.notes ?? null,
    p_source_type:        opts.sourceType ?? null,
  });
}

export interface ApplyModelPricingOpts {
  provider: string;
  modelName: string;
  kind: string;
  inputPer1kUsd: number;
  outputPer1kUsd: number;
  effectiveFrom?: string;
  notes?: string;
  /** Optional: carried from the active row when omitted (the old writer wiped them). */
  maxContextTokens?: number | null;
  maxOutputTokens?: number | null;
}

/**
 * THE versioned write for llm_model_pricing (B-1 follow-up, migration
 * 20270210000001): one call to apply_model_pricing_change, which locks the
 * (provider, model_name, kind) active row and deactivates-then-inserts in one
 * transaction, carrying the token limits from it.
 */
export async function applyModelPricingChange(
  opts: ApplyModelPricingOpts,
): Promise<ApplyActionPricingResult> {
  return callVersionedApply('apply_model_pricing_change', {
    p_provider:           opts.provider,
    p_model_name:         opts.modelName,
    p_kind:               opts.kind,
    p_input_per_1k_usd:   opts.inputPer1kUsd,
    p_output_per_1k_usd:  opts.outputPer1kUsd,
    p_effective_from:     opts.effectiveFrom ?? new Date().toISOString(),
    p_notes:              opts.notes ?? null,
    p_max_context_tokens: opts.maxContextTokens ?? null,
    p_max_output_tokens:  opts.maxOutputTokens ?? null,
  });
}
