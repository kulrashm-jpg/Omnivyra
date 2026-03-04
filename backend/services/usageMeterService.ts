/**
 * Real-time usage meter: atomic monthly counters.
 * Not billing. Not enforcement. Does not block execution or depend on ledger success.
 */

import { supabase } from '../db/supabaseClient';
import { evaluateUsageThresholds } from './usageAlertService';

function currentYearMonth(): { year: number; month: number } {
  const now = new Date();
  return { year: now.getUTCFullYear(), month: now.getUTCMonth() + 1 };
}

/**
 * Increment the monthly meter for the given organization. Fire-and-forget; never throws.
 */
export async function incrementUsageMeter(params: {
  organization_id: string;
  source_type: 'llm' | 'external_api' | 'automation_execution';
  input_tokens?: number;
  output_tokens?: number;
  total_tokens?: number;
  total_cost?: number;
}): Promise<void> {
  try {
    const { year, month } = currentYearMonth();
    const orgId = params.organization_id;

    let p_llm_input = 0;
    let p_llm_output = 0;
    let p_llm_total = 0;
    let p_external_api_calls = 0;
    let p_automation_executions = 0;
    let p_total_cost = 0;

    if (params.source_type === 'llm') {
      p_llm_input = params.input_tokens ?? 0;
      p_llm_output = params.output_tokens ?? 0;
      p_llm_total = params.total_tokens ?? 0;
      p_total_cost = params.total_cost ?? 0;
    } else if (params.source_type === 'external_api') {
      p_external_api_calls = 1;
      p_total_cost = params.total_cost ?? 0;
    } else if (params.source_type === 'automation_execution') {
      p_automation_executions = 1;
    }

    await supabase.rpc('increment_usage_meter', {
      p_organization_id: orgId,
      p_year: year,
      p_month: month,
      p_llm_input_tokens: p_llm_input,
      p_llm_output_tokens: p_llm_output,
      p_llm_total_tokens: p_llm_total,
      p_external_api_calls: p_external_api_calls,
      p_automation_executions: p_automation_executions,
      p_total_cost: p_total_cost,
    });
    void evaluateUsageThresholds(orgId);
  } catch (error: any) {
    console.error('[usageMeter] increment failed', error?.message ?? error);
  }
}
