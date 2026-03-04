/**
 * Plan-based hard enforcement (feature-flagged).
 * Uses usage_meter_monthly and resolveOrganizationPlanLimits. No ledger/alert coupling.
 */

import { supabase } from '../db/supabaseClient';
import { resolveOrganizationPlanLimits } from './planResolutionService';

export type EnforcementResult =
  | { allowed: true }
  | {
      allowed: false;
      resource_key: string;
      limit: number;
      current_usage: number;
      allowed_until: number;
      grace_percent: number;
    };

function currentYearMonth(): { year: number; month: number } {
  const now = new Date();
  return { year: now.getUTCFullYear(), month: now.getUTCMonth() + 1 };
}

function getMeterUsage(
  meterRow: { llm_total_tokens?: number | null; external_api_calls?: number | null; automation_executions?: number | null } | null,
  resourceKey: string
): number {
  if (!meterRow) return 0;
  switch (resourceKey) {
    case 'llm_tokens':
      return Number(meterRow.llm_total_tokens ?? 0);
    case 'external_api_calls':
      return Number(meterRow.external_api_calls ?? 0);
    case 'automation_executions':
      return Number(meterRow.automation_executions ?? 0);
    default:
      return 0;
  }
}

function getLimit(limits: { llm_tokens: number | null; external_api_calls: number | null; automation_executions: number | null }, resourceKey: string): number | null {
  switch (resourceKey) {
    case 'llm_tokens':
      return limits.llm_tokens;
    case 'external_api_calls':
      return limits.external_api_calls;
    case 'automation_executions':
      return limits.automation_executions;
    default:
      return null;
  }
}

export async function checkUsageBeforeExecution(params: {
  organization_id: string;
  resource_key: 'llm_tokens' | 'external_api_calls' | 'automation_executions';
  projected_increment?: number;
}): Promise<EnforcementResult> {
  try {
    const resolved = await resolveOrganizationPlanLimits(params.organization_id);
    const limit = getLimit(resolved.limits, params.resource_key);

    if (resolved.plan_key == null || limit == null) {
      return { allowed: true };
    }

    const { data: assignment } = await supabase
      .from('organization_plan_assignments')
      .select('plan_id')
      .eq('organization_id', params.organization_id)
      .maybeSingle();

    if (!assignment?.plan_id) return { allowed: true };

    const { data: planRow } = await supabase
      .from('pricing_plans')
      .select('enforcement_enabled, allow_overage, grace_percent')
      .eq('id', assignment.plan_id)
      .maybeSingle();

    const enforcementEnabled = planRow?.enforcement_enabled === true;
    const allowOverage = planRow?.allow_overage === true;
    const gracePercent = Number(planRow?.grace_percent ?? 0) || 0;

    if (!enforcementEnabled) return { allowed: true };

    const { year, month } = currentYearMonth();
    const { data: meterRow } = await supabase
      .from('usage_meter_monthly')
      .select('llm_total_tokens, external_api_calls, automation_executions')
      .eq('organization_id', params.organization_id)
      .eq('year', year)
      .eq('month', month)
      .maybeSingle();

    const currentUsage = getMeterUsage(meterRow, params.resource_key);
    const projected = params.projected_increment ?? 0;
    const allowedUntil = limit * (1 + gracePercent / 100);

    if (currentUsage + projected <= allowedUntil) {
      return { allowed: true };
    }
    if (allowOverage) {
      return { allowed: true };
    }

    return {
      allowed: false,
      resource_key: params.resource_key,
      limit,
      current_usage: currentUsage,
      allowed_until: allowedUntil,
      grace_percent: gracePercent,
    };
  } catch (error: any) {
    console.error('[usageEnforcement] checkUsageBeforeExecution failed', error?.message ?? error);
    return { allowed: true };
  }
}
