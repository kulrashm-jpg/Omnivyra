/**
 * Usage threshold alerting: record when org crosses 80%, 95%, or 100% of plan limit.
 * Does not block execution. Does not modify meter or ledger. Signal only.
 */

import { supabase } from '../db/supabaseClient';
import { resolveOrganizationPlanLimits } from './planResolutionService';

const THRESHOLDS = [100, 95, 80] as const;

function currentYearMonth(): { year: number; month: number } {
  const now = new Date();
  return { year: now.getUTCFullYear(), month: now.getUTCMonth() + 1 };
}

function thresholdForPercent(percent: number): number | null {
  if (percent >= 100) return 100;
  if (percent >= 95) return 95;
  if (percent >= 80) return 80;
  return null;
}

/**
 * Evaluate usage vs plan limits and insert threshold alerts once per threshold per resource per month.
 * Never throws. Fire-and-forget safe.
 */
export async function evaluateUsageThresholds(organizationId: string): Promise<void> {
  try {
    const { year, month } = currentYearMonth();

    const { data: meterRow } = await supabase
      .from('usage_meter_monthly')
      .select('llm_total_tokens, external_api_calls, automation_executions')
      .eq('organization_id', organizationId)
      .eq('year', year)
      .eq('month', month)
      .maybeSingle();

    const resolved = await resolveOrganizationPlanLimits(organizationId);
    const limits = resolved.limits;

    const resources: Array<{
      resource_key: string;
      usage: number;
      limit: number | null;
    }> = [
      {
        resource_key: 'llm_tokens',
        usage: Number(meterRow?.llm_total_tokens ?? 0),
        limit: limits.llm_tokens,
      },
      {
        resource_key: 'external_api_calls',
        usage: Number(meterRow?.external_api_calls ?? 0),
        limit: limits.external_api_calls,
      },
      {
        resource_key: 'automation_executions',
        usage: Number(meterRow?.automation_executions ?? 0),
        limit: limits.automation_executions,
      },
    ];

    for (const { resource_key, usage, limit } of resources) {
      if (limit == null || limit <= 0) continue;

      const percent = (usage / limit) * 100;
      const threshold = thresholdForPercent(percent);
      if (threshold == null) continue;

      const { data: existing } = await supabase
        .from('usage_threshold_alerts')
        .select('id')
        .eq('organization_id', organizationId)
        .eq('resource_key', resource_key)
        .eq('year', year)
        .eq('month', month)
        .eq('threshold_percent', threshold)
        .maybeSingle();

      if (existing?.id) continue;

      await supabase.from('usage_threshold_alerts').insert({
        organization_id: organizationId,
        resource_key,
        year,
        month,
        threshold_percent: threshold,
        triggered_at: new Date().toISOString(),
      });
    }
  } catch (error: any) {
    console.error('[usageAlert] evaluateUsageThresholds failed', error?.message ?? error);
  }
}
