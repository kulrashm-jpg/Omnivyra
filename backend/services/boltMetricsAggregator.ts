/**
 * Aggregates AI metrics from audit_logs for a bolt run.
 * Populates ai_calls_total, ai_tokens_input, ai_tokens_output, distribution_batches, variant_batches,
 * ai_cost_usd, and per-stage costs: stage_distribution_cost, stage_blueprint_cost, stage_variant_cost,
 * stage_campaign_plan_cost.
 */

import { supabase } from '../db/supabaseClient';
import { calculateAiCost } from './usageLedgerService';

/** Operation / context_type → stage for cost allocation */
const STAGE_MAP: Record<string, string> = {
  generateCampaignPlan: 'campaign_plan',
  campaign_plan: 'campaign_plan',
  generateDailyDistributionPlan: 'distribution_batch',
  daily_distribution_plan: 'distribution_batch',
  generateContentBlueprint: 'content_blueprint',
  content_blueprint: 'content_blueprint',
  generatePlatformVariants: 'variant_generation',
  platform_variants: 'variant_generation',
};

export type BoltAiMetrics = {
  ai_calls_total: number;
  ai_tokens_input: number;
  ai_tokens_output: number;
  distribution_batches: number;
  variant_batches: number;
  ai_cost_usd: number;
  stage_campaign_plan_cost: number;
  stage_distribution_cost: number;
  stage_blueprint_cost: number;
  stage_variant_cost: number;
};

export async function aggregateBoltAiMetrics(boltRunId: string): Promise<BoltAiMetrics> {
  const { data: logs, error } = await supabase
    .from('audit_logs')
    .select('metadata, created_at')
    .eq('action', 'AI_GATEWAY_CALL')
    .filter('metadata->>bolt_run_id', 'eq', boltRunId)
    .gte('created_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
    .order('created_at', { ascending: true });

  if (error || !logs) {
    return {
      ai_calls_total: 0,
      ai_tokens_input: 0,
      ai_tokens_output: 0,
      distribution_batches: 0,
      variant_batches: 0,
      ai_cost_usd: 0,
      stage_campaign_plan_cost: 0,
      stage_distribution_cost: 0,
      stage_blueprint_cost: 0,
      stage_variant_cost: 0,
    };
  }

  const metrics: BoltAiMetrics = {
    ai_calls_total: 0,
    ai_tokens_input: 0,
    ai_tokens_output: 0,
    distribution_batches: 0,
    variant_batches: 0,
    ai_cost_usd: 0,
    stage_campaign_plan_cost: 0,
    stage_distribution_cost: 0,
    stage_blueprint_cost: 0,
    stage_variant_cost: 0,
  };

  for (const row of logs) {
    const meta = (row as { metadata?: Record<string, unknown> })?.metadata;
    if (!meta) continue;

    metrics.ai_calls_total += 1;
    const usage = meta.token_usage as { prompt_tokens?: number; completion_tokens?: number } | null;
    const inT = usage ? Number(usage.prompt_tokens) || 0 : 0;
    const outT = usage ? Number(usage.completion_tokens) || 0 : 0;
    const model = String(meta.model ?? 'gpt-4o-mini');
    const cost = calculateAiCost(inT, outT, model);

    if (usage) {
      metrics.ai_tokens_input += inT;
      metrics.ai_tokens_output += outT;
    }
    metrics.ai_cost_usd += cost;

    const op = String(meta.operation ?? '');
    const contextType = String(meta.context_type ?? '');
    const stage = STAGE_MAP[op] ?? STAGE_MAP[contextType] ?? null;

    if (op === 'generateDailyDistributionPlan' || contextType === 'daily_distribution_plan') {
      metrics.distribution_batches += 1;
    }
    if (op === 'generatePlatformVariants' || contextType === 'platform_variants') {
      metrics.variant_batches += 1;
    }

    if (stage && cost > 0) {
      if (stage === 'campaign_plan') metrics.stage_campaign_plan_cost += cost;
      else if (stage === 'distribution_batch') metrics.stage_distribution_cost += cost;
      else if (stage === 'content_blueprint') metrics.stage_blueprint_cost += cost;
      else if (stage === 'variant_generation') metrics.stage_variant_cost += cost;
    }
  }

  return metrics;
}
