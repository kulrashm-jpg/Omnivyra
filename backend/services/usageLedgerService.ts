/**
 * Usage Ledger Service — append-only financial telemetry.
 * Logs LLM usage, external API usage, automation execution.
 * Never throws. Never blocks. Never updates existing rows.
 */

import { supabase } from '../db/supabaseClient';

const PROVIDER_PRICING: Record<
  string,
  Record<string, { input_per_1k: number; output_per_1k: number }>
> = {
  openai: {
    'gpt-4o-mini': { input_per_1k: 0.0003, output_per_1k: 0.0006 },
    'gpt-4o': { input_per_1k: 0.005, output_per_1k: 0.015 },
  },
  anthropic: {
    'claude-3-5-sonnet': { input_per_1k: 0.003, output_per_1k: 0.015 },
  },
};

/**
 * Calculate estimated AI cost in USD from token counts and model.
 * Uses current OpenAI pricing (gpt-4o-mini, gpt-4o).
 */
export function calculateAiCost(
  tokensInput: number,
  tokensOutput: number,
  modelName: string
): number {
  const result = resolveLlmCost('openai', modelName, tokensInput, tokensOutput);
  return result.total_cost ?? 0;
}

/**
 * Resolve cost from pricing map. Returns null if provider/model unknown.
 */
export function resolveLlmCost(
  providerName: string,
  modelName: string,
  inputTokens: number,
  outputTokens: number
): { unit_cost: number | null; total_cost: number | null; pricing_snapshot: any } {
  const provider = providerName ? String(providerName).toLowerCase() : '';
  const model = modelName ? String(modelName).toLowerCase() : '';
  const pricing = PROVIDER_PRICING[provider]?.[model];
  if (!pricing || (inputTokens == null && outputTokens == null)) {
    return { unit_cost: null, total_cost: null, pricing_snapshot: null };
  }
  const inT = Number(inputTokens) || 0;
  const outT = Number(outputTokens) || 0;
  const inputCost = (inT / 1000) * pricing.input_per_1k;
  const outputCost = (outT / 1000) * pricing.output_per_1k;
  const totalCost = inputCost + outputCost;
  const totalTokens = inT + outT;
  const unitCost = totalTokens > 0 ? totalCost / totalTokens : null;
  return {
    unit_cost: unitCost,
    total_cost: totalCost,
    pricing_snapshot: pricing,
  };
}

export async function logUsageEvent(params: {
  organization_id: string;
  campaign_id?: string | null;
  user_id?: string | null;

  source_type: 'llm' | 'external_api' | 'automation_execution';

  provider_name?: string | null;
  model_name?: string | null;
  model_version?: string | null;

  source_name: string;
  process_type: string;

  input_tokens?: number | null;
  output_tokens?: number | null;
  total_tokens?: number | null;

  latency_ms?: number | null;
  error_flag?: boolean;
  error_type?: string | null;

  unit_cost?: number | null;
  total_cost?: number | null;

  pricing_snapshot?: any;
  metadata?: any;
}): Promise<void> {
  try {
    await supabase.from('usage_events').insert({
      organization_id: params.organization_id,
      campaign_id: params.campaign_id ?? null,
      user_id: params.user_id ?? null,
      source_type: params.source_type,
      provider_name: params.provider_name ?? null,
      model_name: params.model_name ?? null,
      model_version: params.model_version ?? null,
      source_name: params.source_name,
      process_type: params.process_type,
      input_tokens: params.input_tokens ?? null,
      output_tokens: params.output_tokens ?? null,
      total_tokens: params.total_tokens ?? null,
      latency_ms: params.latency_ms ?? null,
      error_flag: params.error_flag === true,
      error_type: params.error_type ?? null,
      unit_cost: params.unit_cost ?? null,
      total_cost: params.total_cost ?? null,
      pricing_snapshot: params.pricing_snapshot ?? null,
      metadata: params.metadata ?? null,
    });
  } catch (error: any) {
    console.error('[usageLedger] insert failed', error?.message ?? error);
  }
}
