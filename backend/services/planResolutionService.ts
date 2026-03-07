/**
 * Plan resolution: resolve effective limits for an organization.
 * Merges plan defaults with organization overrides. No enforcement; declarative only.
 */

import { supabase } from '../db/supabaseClient';

/** Plan-based max campaign duration (weeks). Fallback when not in plan_limits. */
export const PLAN_MAX_DURATION_WEEKS: Record<string, number> = {
  starter: 4,
  growth: 6,
  pro: 8,
  enterprise: 12,
};

export const ABSOLUTE_MAX_DURATION_WEEKS = 12;

export type ResolvedPlanLimits = {
  plan_key: string | null;
  limits: {
    llm_tokens: number | null;
    external_api_calls: number | null;
    automation_executions: number | null;
  };
  max_campaign_duration_weeks: number | null;
};

/**
 * Resolve plan and effective limits for an organization.
 * Override > plan default. No assignment → plan_key null, all limits null.
 */
export async function resolveOrganizationPlanLimits(
  organizationId: string
): Promise<ResolvedPlanLimits> {
  const empty: ResolvedPlanLimits = {
    plan_key: null,
    limits: { llm_tokens: null, external_api_calls: null, automation_executions: null },
    max_campaign_duration_weeks: null,
  };

  const { data: assignment, error: assignError } = await supabase
    .from('organization_plan_assignments')
    .select('plan_id')
    .eq('organization_id', organizationId)
    .maybeSingle();

  if (assignError || !assignment?.plan_id) {
    return empty;
  }

  const planId = assignment.plan_id;

  const { data: planRow, error: planError } = await supabase
    .from('pricing_plans')
    .select('plan_key')
    .eq('id', planId)
    .maybeSingle();

  if (planError || !planRow?.plan_key) {
    return { ...empty, plan_key: null };
  }

  const { data: limitRows, error: limitsError } = await supabase
    .from('plan_limits')
    .select('resource_key, limit_value')
    .eq('plan_id', planId);

  const planLimits: Record<string, number | null> = {};
  if (!limitsError && limitRows) {
    for (const row of limitRows) {
      const key = String(row.resource_key);
      const val = (row as { limit_value?: number | null }).limit_value;
      planLimits[key] = val != null ? Number(val) : null;
    }
  }

  const { data: overrideRows, error: overridesError } = await supabase
    .from('organization_plan_overrides')
    .select('resource_key, monthly_limit')
    .eq('organization_id', organizationId);

  const overrides: Record<string, number | null> = {};
  if (!overridesError && overrideRows) {
    for (const row of overrideRows) {
      const key = String(row.resource_key);
      overrides[key] = row.monthly_limit != null ? Number(row.monthly_limit) : null;
    }
  }

  const limits = {
    llm_tokens: overrides.llm_tokens ?? planLimits.llm_tokens ?? null,
    external_api_calls: overrides.external_api_calls ?? planLimits.external_api_calls ?? null,
    automation_executions:
      overrides.automation_executions ?? planLimits.automation_executions ?? null,
  };

  const planKey = String(planRow.plan_key).toLowerCase();
  const fromDb =
    overrides.max_campaign_duration_weeks ?? planLimits.max_campaign_duration_weeks ?? null;
  const max_campaign_duration_weeks =
    fromDb != null
      ? Math.min(ABSOLUTE_MAX_DURATION_WEEKS, Math.max(1, Math.floor(Number(fromDb))))
      : (planKey && PLAN_MAX_DURATION_WEEKS[planKey]) ?? null;

  return {
    plan_key: planRow.plan_key,
    limits,
    max_campaign_duration_weeks,
  };
}
