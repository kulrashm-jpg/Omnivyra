import { supabase } from '../db/supabaseClient';
import { logger } from './logger';
import { ownedDbTable } from '../db/writeOwner';
import { resolveMonetizationFeature } from '../../shared/monetization/featureRegistry';

// Phase 8A — activity economy catalog. Re-exported here so callers resolve
// activity economics through the same pricing-resolution surface as
// resolveActivityCreditRange. The catalog is pure/inert (no DB, no charging).
export {
  resolveActivityEconomics,
  getActivityClass,
  ACTIVITY_CLASS_ECONOMICS,
  ACTIVITY_CLASS_MAP,
} from './activityEconomyCatalog';
export type {
  ActivityClass,
  ActivityClassEconomics,
  ResolvedActivityEconomics,
} from './activityEconomyCatalog';

export type PricingKind = 'completion' | 'embedding';

export interface ModelPricingRow {
  provider: string;
  model_name: string;
  kind: PricingKind;
  input_per_1k_usd: number;
  output_per_1k_usd: number;
  effective_from: string;
  max_context_tokens: number | null;
  max_output_tokens:  number | null;
}

export interface ActionPricingRow {
  action_key: string;
  cost_multiplier: number;
  minimum_charge_usd: number;
  ceiling_usd: number | null;
  effective_from: string;
}

export interface ResolvedLlmCost {
  provider: string;
  model: string;
  input_tokens: number;
  output_tokens: number;
  input_cost_usd: number;
  output_cost_usd: number;
  total_cost_usd: number;
  cost_multiplier: number;
  final_price_usd: number;
  credits: number;
  pricing_snapshot: Record<string, unknown>;
}

export interface ResolvedEmbeddingCost {
  provider: string;
  model: string;
  input_tokens: number;
  output_tokens: number;
  input_cost_usd: number;
  output_cost_usd: number;
  total_cost_usd: number;
  cost_multiplier: number;
  final_price_usd: number;
  credits: number;
  pricing_snapshot: Record<string, unknown>;
}

export interface ResolveLlmCostInput {
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  actionKey: string;
  orgId: string;
  timestamp?: string | Date;
  /**
   * When false, skip the action's ceiling_usd clamp. Used by HOLD sizing where
   * we want a true upper bound (model max_tokens × multiplier), not the action
   * ceiling. Floor at minimum_charge_usd still applies. Default: true.
   */
  applyCeiling?: boolean;
}

export interface ResolveEmbeddingCostInput {
  provider: string;
  model: string;
  totalTokens: number;
  actionKey: string;
  orgId: string;
  timestamp?: string | Date;
}

export interface ActionPricingView {
  action_key: string;
  cost_multiplier: number;
  minimum_charge_usd: number;
  ceiling_usd: number | null;
  effective_from: string;
}

function normalizeTimestamp(timestamp?: string | Date): string {
  if (!timestamp) return new Date().toISOString();
  return timestamp instanceof Date ? timestamp.toISOString() : new Date(timestamp).toISOString();
}

function requireNonEmpty(value: string | null | undefined, field: string): string {
  const normalized = String(value ?? '').trim();
  if (!normalized) {
    throw new Error(`[pricingService] ${field} is required`);
  }
  return normalized;
}

function parsePositiveRate(raw: unknown, orgId: string): number {
  const rate = Number(raw);
  if (!Number.isFinite(rate) || rate <= 0) {
    throw new Error(`[pricingService] Missing valid credit_rate_usd for org ${orgId}`);
  }
  return rate;
}

async function fetchModelPricingRow(
  provider: string,
  model: string,
  kind: PricingKind,
  effectiveAt: string,
): Promise<ModelPricingRow> {
  const { data, error } = await ownedDbTable('llm_model_pricing')
    .select('provider, model_name, kind, input_per_1k_usd, output_per_1k_usd, effective_from, max_context_tokens, max_output_tokens')
    .eq('provider', provider)
    .eq('model_name', model)
    .eq('kind', kind)
    .eq('is_active', true)
    .lte('effective_from', effectiveAt)
    .order('effective_from', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(`[pricingService] Model pricing lookup failed for ${provider}/${model}/${kind}: ${error.message}`);
  }
  if (!data) {
    throw new PricingMissingError(provider, model, kind);
  }

  const row = data as any;
  return {
    provider:           String(row.provider),
    model_name:         String(row.model_name),
    kind:               row.kind as PricingKind,
    input_per_1k_usd:   Number(row.input_per_1k_usd  ?? 0),
    output_per_1k_usd:  Number(row.output_per_1k_usd ?? 0),
    effective_from:     String(row.effective_from),
    max_context_tokens: row.max_context_tokens == null ? null : Number(row.max_context_tokens),
    max_output_tokens:  row.max_output_tokens  == null ? null : Number(row.max_output_tokens),
  };
}

async function fetchActionPricingRow(
  actionKey: string,
  effectiveAt: string,
): Promise<ActionPricingRow> {
  const { data, error } = await ownedDbTable('action_pricing_config')
    .select('action_key, cost_multiplier, minimum_charge_usd, ceiling_usd, effective_from')
    .eq('action_key', actionKey)
    .eq('is_active', true)
    .lte('effective_from', effectiveAt)
    .order('effective_from', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(`[pricingService] Action pricing lookup failed for ${actionKey}: ${error.message}`);
  }
  if (!data) {
    throw new Error(`[pricingService] Missing action_pricing_config row for actionKey='${actionKey}'`);
  }

  return {
    action_key: String((data as any).action_key),
    cost_multiplier: Number((data as any).cost_multiplier ?? 0),
    minimum_charge_usd: Number((data as any).minimum_charge_usd ?? 0),
    ceiling_usd: (data as any).ceiling_usd == null ? null : Number((data as any).ceiling_usd),
    effective_from: String((data as any).effective_from),
  };
}

async function fetchCreditRateUsd(orgId: string): Promise<number> {
  const { data, error } = await ownedDbTable('organization_credits')
    .select('credit_rate_usd')
    .eq('organization_id', orgId)
    .maybeSingle();

  if (error) {
    throw new Error(`[pricingService] credit_rate_usd lookup failed for org ${orgId}: ${error.message}`);
  }

  return parsePositiveRate((data as any)?.credit_rate_usd, orgId);
}

function applyPricingLayer(
  baseCostUsd: number,
  actionRow:   ActionPricingRow,
  applyCeiling = true,
): number {
  let priceUsd = baseCostUsd * actionRow.cost_multiplier;
  if (priceUsd < actionRow.minimum_charge_usd) {
    priceUsd = actionRow.minimum_charge_usd;
  }
  if (applyCeiling && actionRow.ceiling_usd != null && priceUsd > actionRow.ceiling_usd) {
    priceUsd = actionRow.ceiling_usd;
  }
  return priceUsd;
}

export async function refreshPricingCache(): Promise<void> {
  return;
}

export function primePricingCache(): void {
  return;
}

export class PricingMissingError extends Error {
  constructor(
    public readonly provider: string,
    public readonly model: string,
    public readonly kind: PricingKind,
  ) {
    super(`No active pricing for provider='${provider}' model='${model}' kind='${kind}'.`);
    this.name = 'PricingMissingError';
  }
}

export async function assertModelPricingExists(
  provider: string,
  model: string,
  kind: PricingKind,
  timestamp?: string | Date,
): Promise<void> {
  await fetchModelPricingRow(
    requireNonEmpty(provider, 'provider').toLowerCase(),
    requireNonEmpty(model, 'model').toLowerCase(),
    kind,
    normalizeTimestamp(timestamp),
  );
}

/**
 * Lightweight pre-flight USD estimator — returns BASE model cost only (no
 * action multiplier, no minimum, no ceiling, no credit conversion).
 *
 * Use this for budget projection / job cost estimation where we need a
 * representative "what will this call cost us at the provider" number
 * WITHOUT needing an actionKey or orgId. Real billing must go through
 * resolveLlmCost so margin + floor + ceiling apply.
 */
export async function estimateLlmCostUsd(
  provider: string,
  model: string,
  inputTokens: number,
  outputTokens: number,
  timestamp?: string | Date,
): Promise<number> {
  const row = await fetchModelPricingRow(
    requireNonEmpty(provider, 'provider').toLowerCase(),
    requireNonEmpty(model, 'model').toLowerCase(),
    'completion',
    normalizeTimestamp(timestamp),
  );
  const inT = Number(inputTokens ?? 0);
  const outT = Number(outputTokens ?? 0);
  return (inT / 1000) * row.input_per_1k_usd + (outT / 1000) * row.output_per_1k_usd;
}

/**
 * Upper-bound credit estimate for the HOLD phase of a token-priced action.
 *
 * Returns ceil(ceiling_usd / credit_rate_usd) — i.e. the most credits this
 * action could possibly charge given its configured ceiling. Used by
 * executeWithCredits to reserve a conservative amount BEFORE the LLM runs;
 * the unused portion is returned to the wallet via apply_credit_partial_confirm.
 *
 * If the action has no ceiling configured, falls back to 5× minimum_charge_usd
 * so we never HOLD 0 on a token-priced action.
 */
export async function estimateHoldCeilingCredits(
  actionKey: string,
  orgId: string,
  timestamp?: string | Date,
): Promise<number> {
  const key = requireNonEmpty(actionKey, 'actionKey');
  const org = requireNonEmpty(orgId, 'orgId');
  const effectiveAt = normalizeTimestamp(timestamp);

  const [actionRow, creditRateUsd] = await Promise.all([
    fetchActionPricingRow(key, effectiveAt),
    fetchCreditRateUsd(org),
  ]);

  const ceilingUsd = actionRow.ceiling_usd ?? (actionRow.minimum_charge_usd * 5);
  const effectiveCeilingUsd = Math.max(ceilingUsd, actionRow.minimum_charge_usd);
  return Math.max(1, Math.ceil(effectiveCeilingUsd / creditRateUsd));
}

export interface ActivityCreditRange {
  actionKey: string;
  /** Floor charge — the "starting estimate" the user is anchored on at HOLD. */
  minCredits: number;
  /** Ceiling — the most this activity can settle at (what HOLD actually reserves). */
  maxCredits: number;
  /** Number surfaced to the user up front (== min for token-priced; flat fee for fixed). */
  expectedCredits: number;
  /** true → actual settles against usage and MAY RISE from min toward max. */
  tokenPriced: boolean;
  source: 'action_pricing_config' | 'credit_cost_config';
}

/**
 * Flat credit_cost_config fee for an action, or null if the action has no fixed
 * row. Mirrors getCreditCost()'s feature-registry key remap but read-only and
 * non-throwing on absence (so resolveActivityCreditRange can fall through).
 */
async function fetchFlatCreditCost(actionKey: string): Promise<number | null> {
  const feature = resolveMonetizationFeature({ action_key: actionKey });
  const costConfigKey = feature?.feature.pricing_keys.credit_cost_config ?? actionKey;
  const { data, error } = await supabase
    .from('credit_cost_config')
    .select('credits')
    .eq('action_type', costConfigKey)
    .maybeSingle();
  if (error) {
    throw new Error(`[pricingService] credit_cost_config lookup failed for ${costConfigKey}: ${error.message}`);
  }
  return data && typeof (data as any).credits === 'number' ? Number((data as any).credits) : null;
}

/**
 * Catalog-derived credit RANGE for an activity — read-only, never mutates
 * credits. Powers pre-activity cost preview and the provisional ("may rise")
 * UI notation.
 *
 * Token-priced actions (action_pricing_config): a true min–max band. floor =
 * minimum_charge_usd, ceiling = ceiling_usd (or 5× floor fallback), both
 * converted at the org's credit_rate_usd — deliberately the SAME math as
 * estimateHoldCeilingCredits so the displayed max equals what executeWithCredits
 * actually HOLDs. expected = floor (the starting estimate; actual may rise).
 *
 * Fixed-fee actions (credit_cost_config): a flat charge — min = max = expected,
 * tokenPriced=false (no upward reconciliation).
 *
 * Throws only when the action exists in NEITHER catalog (unknown activity).
 */
export async function resolveActivityCreditRange(
  actionKey: string,
  orgId: string,
  timestamp?: string | Date,
): Promise<ActivityCreditRange> {
  const key = requireNonEmpty(actionKey, 'actionKey');
  const org = requireNonEmpty(orgId, 'orgId');
  const effectiveAt = normalizeTimestamp(timestamp);

  // Token-priced path first: a genuine min–max band.
  const [actionRow, creditRateUsd] = await Promise.all([
    fetchActionPricingRow(key, effectiveAt).catch(() => null),
    fetchCreditRateUsd(org),
  ]);

  if (actionRow) {
    const floorUsd = actionRow.minimum_charge_usd;
    const ceilingUsd = Math.max(
      actionRow.ceiling_usd ?? (actionRow.minimum_charge_usd * 5),
      floorUsd,
    );
    const minCredits = Math.max(1, Math.ceil(floorUsd / creditRateUsd));
    const maxCredits = Math.max(minCredits, Math.ceil(ceilingUsd / creditRateUsd));
    return {
      actionKey: key,
      minCredits,
      maxCredits,
      expectedCredits: minCredits,
      tokenPriced: true,
      source: 'action_pricing_config',
    };
  }

  // Fixed-fee fallback: flat credit_cost_config row.
  const flat = await fetchFlatCreditCost(key);
  if (flat != null) {
    return {
      actionKey: key,
      minCredits: flat,
      maxCredits: flat,
      expectedCredits: flat,
      tokenPriced: false,
      source: 'credit_cost_config',
    };
  }

  throw new Error(`[pricingService] No credit catalog entry for activity '${key}'`);
}

/**
 * Validate that requested max tokens fit within the model's hard limits.
 * Throws a detailed error so callers can surface a 400 before HOLD. Models
 * without configured limits pass through (null is treated as "unknown — trust
 * caller"); we log a warning but don't reject so a missing DB row doesn't
 * take down the flow.
 */
export async function validateModelLimits(input: {
  provider:        string;
  model:           string;
  maxInputTokens:  number;
  maxOutputTokens: number;
  timestamp?:      string | Date;
}): Promise<void> {
  const provider = requireNonEmpty(input.provider, 'provider').toLowerCase();
  const model    = requireNonEmpty(input.model, 'model').toLowerCase();
  const maxIn    = Number(input.maxInputTokens);
  const maxOut   = Number(input.maxOutputTokens);
  if (!Number.isFinite(maxIn)  || maxIn  < 0) throw new Error('[validateModelLimits] maxInputTokens must be a non-negative finite number');
  if (!Number.isFinite(maxOut) || maxOut < 0) throw new Error('[validateModelLimits] maxOutputTokens must be a non-negative finite number');

  const row = await fetchModelPricingRow(provider, model, 'completion', normalizeTimestamp(input.timestamp));

  if (row.max_output_tokens != null && maxOut > row.max_output_tokens) {
    throw new Error(
      `[validateModelLimits] maxOutputTokens=${maxOut} exceeds model ${provider}/${model} max_output_tokens=${row.max_output_tokens}`,
    );
  }
  if (row.max_context_tokens != null && (maxIn + maxOut) > row.max_context_tokens) {
    throw new Error(
      `[validateModelLimits] maxInputTokens+maxOutputTokens=${maxIn + maxOut} exceeds model ${provider}/${model} max_context_tokens=${row.max_context_tokens}`,
    );
  }
  if (row.max_context_tokens == null || row.max_output_tokens == null) {
    logger.warn('validate_model_limits_unconfigured', { provider, model });
  }
}

/**
 * Dynamic HOLD credit estimate for a token-priced LLM action.
 *
 * Thin wrapper over resolveLlmCost — reuses the single pricing-math
 * implementation. HOLD uses applyCeiling=false because the ceiling is a
 * post-hoc SETTLEMENT cap, not a pre-flight reservation cap; the HOLD must
 * cover the true worst case so apply_credit_partial_confirm can release
 * the delta deterministically.
 *
 * Also validates model max-token limits before HOLD so a hopeless request
 * is rejected at the boundary instead of failing at the provider.
 *
 * Returns the resolved cost breakdown; callers typically use `.credits`.
 */
export async function estimateLlmHoldCredits(input: {
  provider:        string;
  model:           string;
  maxInputTokens:  number;
  maxOutputTokens: number;
  actionKey:       string;
  orgId:           string;
  timestamp?:      string | Date;
}): Promise<ResolvedLlmCost> {
  await validateModelLimits({
    provider:        input.provider,
    model:           input.model,
    maxInputTokens:  input.maxInputTokens,
    maxOutputTokens: input.maxOutputTokens,
    timestamp:       input.timestamp,
  });
  return resolveLlmCost({
    provider:     input.provider,
    model:        input.model,
    inputTokens:  input.maxInputTokens,
    outputTokens: input.maxOutputTokens,
    actionKey:    input.actionKey,
    orgId:        input.orgId,
    timestamp:    input.timestamp,
    applyCeiling: false,    // HOLD must NOT be capped by the ceiling
  });
}

export async function resolveLlmCost(input: ResolveLlmCostInput): Promise<ResolvedLlmCost> {
  const provider = requireNonEmpty(input.provider, 'provider').toLowerCase();
  const model = requireNonEmpty(input.model, 'model').toLowerCase();
  const actionKey = requireNonEmpty(input.actionKey, 'actionKey');
  const orgId = requireNonEmpty(input.orgId, 'orgId');
  const effectiveAt = normalizeTimestamp(input.timestamp);

  const [modelRow, actionRow, creditRateUsd] = await Promise.all([
    fetchModelPricingRow(provider, model, 'completion', effectiveAt),
    fetchActionPricingRow(actionKey, effectiveAt),
    fetchCreditRateUsd(orgId),
  ]);

  const inputTokens = Number(input.inputTokens ?? 0);
  const outputTokens = Number(input.outputTokens ?? 0);
  const inputCostUsd = (inputTokens / 1000) * modelRow.input_per_1k_usd;
  const outputCostUsd = (outputTokens / 1000) * modelRow.output_per_1k_usd;
  const totalCostUsd = inputCostUsd + outputCostUsd;
  const applyCeiling  = input.applyCeiling !== false;
  const finalPriceUsd = applyPricingLayer(totalCostUsd, actionRow, applyCeiling);
  const credits = Math.ceil(finalPriceUsd / creditRateUsd);

  return {
    provider,
    model,
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    input_cost_usd: inputCostUsd,
    output_cost_usd: outputCostUsd,
    total_cost_usd: totalCostUsd,
    cost_multiplier: actionRow.cost_multiplier,
    final_price_usd: finalPriceUsd,
    credits,
    pricing_snapshot: {
      provider,
      model,
      kind: 'completion',
      action_key: actionKey,
      effective_at: effectiveAt,
      model_pricing_effective_from: modelRow.effective_from,
      action_pricing_effective_from: actionRow.effective_from,
      input_per_1k_usd: modelRow.input_per_1k_usd,
      output_per_1k_usd: modelRow.output_per_1k_usd,
      minimum_charge_usd: actionRow.minimum_charge_usd,
      ceiling_usd: actionRow.ceiling_usd,
      ceiling_applied: applyCeiling,
      credit_rate_usd: creditRateUsd,
      final_price_usd: finalPriceUsd,
      credits,
    },
  };
}

export async function resolveEmbeddingCost(input: ResolveEmbeddingCostInput): Promise<ResolvedEmbeddingCost> {
  const provider = requireNonEmpty(input.provider, 'provider').toLowerCase();
  const model = requireNonEmpty(input.model, 'model').toLowerCase();
  const actionKey = requireNonEmpty(input.actionKey, 'actionKey');
  const orgId = requireNonEmpty(input.orgId, 'orgId');
  const effectiveAt = normalizeTimestamp(input.timestamp);

  const [modelRow, actionRow, creditRateUsd] = await Promise.all([
    fetchModelPricingRow(provider, model, 'embedding', effectiveAt),
    fetchActionPricingRow(actionKey, effectiveAt),
    fetchCreditRateUsd(orgId),
  ]);

  const inputTokens = Number(input.totalTokens ?? 0);
  const inputCostUsd = (inputTokens / 1000) * modelRow.input_per_1k_usd;
  const totalCostUsd = inputCostUsd;
  const finalPriceUsd = applyPricingLayer(totalCostUsd, actionRow);
  const credits = Math.ceil(finalPriceUsd / creditRateUsd);

  return {
    provider,
    model,
    input_tokens: inputTokens,
    output_tokens: 0,
    input_cost_usd: inputCostUsd,
    output_cost_usd: 0,
    total_cost_usd: totalCostUsd,
    cost_multiplier: actionRow.cost_multiplier,
    final_price_usd: finalPriceUsd,
    credits,
    pricing_snapshot: {
      provider,
      model,
      kind: 'embedding',
      action_key: actionKey,
      effective_at: effectiveAt,
      model_pricing_effective_from: modelRow.effective_from,
      action_pricing_effective_from: actionRow.effective_from,
      input_per_1k_usd: modelRow.input_per_1k_usd,
      minimum_charge_usd: actionRow.minimum_charge_usd,
      ceiling_usd: actionRow.ceiling_usd,
      credit_rate_usd: creditRateUsd,
      final_price_usd: finalPriceUsd,
      credits,
    },
  };
}

export async function getActionPricing(actionKey: string, timestamp?: string | Date): Promise<ActionPricingView> {
  const row = await fetchActionPricingRow(
    requireNonEmpty(actionKey, 'actionKey'),
    normalizeTimestamp(timestamp),
  );

  return {
    action_key: row.action_key,
    cost_multiplier: row.cost_multiplier,
    minimum_charge_usd: row.minimum_charge_usd,
    ceiling_usd: row.ceiling_usd,
    effective_from: row.effective_from,
  };
}

export type AnomalyType =
  | 'pricing_missing'
  | 'cost_exceeds_request_threshold'
  | 'cost_exceeds_weekly_limit'
  | 'cost_credit_mismatch'
  | 'unknown_action_key'
  | 'structural_leak';

export interface RecordAnomalyOpts {
  organizationId?: string | null;
  type: AnomalyType;
  severity?: 'info' | 'warn' | 'critical';
  apiCostUsd?: number | null;
  creditsValueUsd?: number | null;
  processType?: string | null;
  actionKey?: string | null;
  modelName?: string | null;
  metadata?: Record<string, unknown>;
}

const ANOMALY_TO_ALERT_TYPE: Record<AnomalyType, 'high_cost' | 'negative_margin' | 'leak_detected' | 'pricing_missing' | 'weekly_over_limit' | null> = {
  pricing_missing: 'pricing_missing',
  cost_exceeds_request_threshold: 'high_cost',
  cost_exceeds_weekly_limit: 'weekly_over_limit',
  cost_credit_mismatch: 'negative_margin',
  unknown_action_key: null,
  structural_leak: 'leak_detected',
};

export async function recordCostAnomaly(opts: RecordAnomalyOpts): Promise<void> {
  try {
    await ownedDbTable('cost_anomalies').insert({
      organization_id: opts.organizationId ?? null,
      anomaly_type: opts.type,
      severity: opts.severity ?? 'warn',
      api_cost_usd: opts.apiCostUsd ?? null,
      credits_value_usd: opts.creditsValueUsd ?? null,
      process_type: opts.processType ?? null,
      action_key: opts.actionKey ?? null,
      model_name: opts.modelName ?? null,
      metadata: opts.metadata ?? {},
    });

    if ((opts.severity ?? 'warn') === 'critical') {
      const alertType = ANOMALY_TO_ALERT_TYPE[opts.type];
      if (alertType) {
        const { createAlert } = await import('./alertService');
        await createAlert({
          type: alertType,
          organizationId: opts.organizationId ?? null,
          severity: 'critical',
          message: buildAlertMessage(opts),
          metadata: {
            anomaly_type: opts.type,
            action_key: opts.actionKey,
            model_name: opts.modelName,
            api_cost_usd: opts.apiCostUsd,
            ...opts.metadata,
          },
          dedupKey: `${opts.type}:${opts.actionKey ?? ''}:${opts.modelName ?? ''}`,
        });
      }
    }
  } catch (err: any) {
    logger.warn('cost_anomaly_insert_failed', { type: opts.type, message: err?.message });
  }
}

function buildAlertMessage(opts: RecordAnomalyOpts): string {
  const action = opts.actionKey ? ` action=${opts.actionKey}` : '';
  const model = opts.modelName ? ` model=${opts.modelName}` : '';
  switch (opts.type) {
    case 'pricing_missing':
      return `Pricing missing for LLM call${action}${model}`;
    case 'cost_exceeds_request_threshold':
      return `Single request exceeded cost threshold: $${opts.apiCostUsd}${action}${model}`;
    case 'cost_exceeds_weekly_limit':
      return `Weekly org cost exceeded limit: $${opts.apiCostUsd}`;
    case 'cost_credit_mismatch':
      return `Negative margin: api_cost=$${opts.apiCostUsd} credits_value=$${opts.creditsValueUsd}`;
    case 'structural_leak':
      return `Structural leak detected${action}${model}`;
    default:
      return `Cost anomaly: ${opts.type}`;
  }
}
