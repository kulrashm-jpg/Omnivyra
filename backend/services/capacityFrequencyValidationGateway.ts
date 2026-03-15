/**
 * STAGE 2B — Unified Validation Gate.
 * Single entry point for capacity + frequency validation. Reuses capacityExpectationValidator
 * and (indirectly) logic aligned with deterministicWeeklySkeleton; supports optional
 * blueprint to validate strategy blueprints (e.g. from recommendations).
 */

import {
  validateCapacityVsExpectation,
  type CapacityValidationResult,
} from './capacityExpectationValidator';
import { balanceWorkload } from './workloadBalancerService';
import { buildPlanningAdjustmentsSummary } from './planningAdjustmentSummaryService';

export type { CapacityValidationResult };

export interface ValidateCapacityAndFrequencyInput {
  weekly_capacity?: unknown;
  available_content?: unknown;
  exclusive_campaigns?: unknown;
  platform_content_requests?: unknown;
  cross_platform_sharing?: unknown;
  content_repurposing?: unknown;
  /** Campaign duration in weeks. Supply = available + (capacity × weeks). Default 1 when missing. */
  campaign_duration_weeks?: number | null;
  campaign_intent?: string | null;
  content_types?: string[] | null;
  enable_workload_balancing?: boolean;
  blueprint?: {
    weeks?: Array<{
      platform_allocation?: Record<string, number>;
      content_type_mix?: string[];
      execution_items?: any[];
    }>;
  } | null;
  message?: string;
  override_confirmed?: boolean;
}

function normalizePlatformKey(raw: string): string {
  const n = String(raw ?? '').trim().toLowerCase();
  if (n === 'twitter') return 'x';
  return n;
}

function resolveCrossPlatformSharing(value: unknown): boolean {
  if (value == null) return true;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'object' && !Array.isArray(value)) {
    const obj = value as Record<string, unknown>;
    if (typeof obj.enabled === 'boolean') return obj.enabled;
    if (obj.enabled === undefined && (obj as any).mode === 'unique') return false;
  }
  return true;
}

/**
 * Derive platform_content_requests from a blueprint (first week with data).
 * Used to validate strategy blueprints when explicit platform_content_requests is not provided.
 */
function derivePlatformContentRequestsFromBlueprint(blueprint: ValidateCapacityAndFrequencyInput['blueprint']): Array<{ platform: string; content_type: string; count_per_week: number }> {
  const weeks = blueprint?.weeks ?? [];
  if (weeks.length === 0) return [];

  const first = weeks[0];
  if (!first) return [];

  const rows: Array<{ platform: string; content_type: string; count_per_week: number }> = [];

  if (Array.isArray(first.execution_items) && first.execution_items.length > 0) {
    for (const it of first.execution_items) {
      const content_type = String(it?.content_type ?? it?.contentType ?? 'post').trim().toLowerCase();
      const platform_counts = it?.platform_counts ?? {};
      const selected_platforms = Array.isArray(it?.selected_platforms) ? it.selected_platforms : Object.keys(platform_counts);
      const count_per_week = Number(it?.count_per_week ?? it?.countPerWeek ?? 0) || 0;
      if (count_per_week <= 0) continue;
      if (selected_platforms.length > 0) {
        const perPlatform: Record<string, number> =
          Object.keys(platform_counts).length > 0
            ? platform_counts
            : selected_platforms.reduce(
                (acc: Record<string, number>, p) => ({
                  ...acc,
                  [normalizePlatformKey(p)]: count_per_week,
                }),
                {}
              );
        for (const [p, c] of Object.entries(perPlatform)) {
          const platform = normalizePlatformKey(p);
          const n = Math.max(0, Math.floor(Number(c) || 0));
          if (platform && n > 0) rows.push({ platform, content_type, count_per_week: n });
        }
      } else {
        rows.push({ platform: 'linkedin', content_type, count_per_week });
      }
    }
    return rows;
  }

  const platform_allocation = first.platform_allocation ?? {};
  const content_type_mix = Array.isArray(first.content_type_mix) && first.content_type_mix.length > 0
    ? first.content_type_mix
    : ['post'];
  for (const [p, count] of Object.entries(platform_allocation)) {
    const platform = normalizePlatformKey(p);
    const n = Math.max(0, Math.floor(Number(count) || 0));
    if (!platform || n <= 0) continue;
    const typeCount = Math.max(1, Math.floor(n / content_type_mix.length));
    for (const ct of content_type_mix) {
      const content_type = String(ct).trim().toLowerCase();
      if (content_type) rows.push({ platform, content_type, count_per_week: typeCount });
    }
  }
  return rows;
}

/**
 * Single validation entry point. Reuses capacityExpectationValidator; when blueprint
 * is provided and platform_content_requests is empty, derives demand from blueprint.
 * When invalid and balancing enabled, tries balanceWorkload before returning invalid.
 * Output matches existing validation_result format (CapacityValidationResult).
 */
export function validateCapacityAndFrequency(
  input: ValidateCapacityAndFrequencyInput
): CapacityValidationResult | null {
  let platform_content_requests: unknown = input.platform_content_requests;
  if (
    (platform_content_requests == null ||
      (Array.isArray(platform_content_requests) && platform_content_requests.length === 0) ||
      (typeof platform_content_requests === 'object' &&
        !Array.isArray(platform_content_requests) &&
        Object.keys(platform_content_requests as Record<string, unknown>).length === 0)) &&
    input.blueprint?.weeks?.length
  ) {
    const derived = derivePlatformContentRequestsFromBlueprint(input.blueprint);
    if (derived.length > 0) {
      platform_content_requests = derived;
    }
  }

  const sharingEnabled = resolveCrossPlatformSharing(input.cross_platform_sharing);
  const repurposingEnabled = input.content_repurposing != null
    ? Boolean((input.content_repurposing as any)?.enabled ?? input.content_repurposing)
    : sharingEnabled;
  const result = validateCapacityVsExpectation({
    available_content: input.available_content,
    weekly_capacity: input.weekly_capacity,
    exclusive_campaigns: input.exclusive_campaigns,
    platform_content_requests,
    cross_platform_sharing: input.cross_platform_sharing,
    content_repurposing: repurposingEnabled ? { enabled: true } : input.content_repurposing,
    campaign_duration_weeks: input.campaign_duration_weeks,
    message: input.message,
    override_confirmed: input.override_confirmed,
  });

  if (
    result &&
    result.status === 'invalid' &&
    !result.override_confirmed &&
    input.enable_workload_balancing !== false
  ) {
    const balanced = balanceWorkload({
      platform_content_requests,
      weekly_capacity_total: result.weekly_capacity_total,
      available_content_total: result.available_content_total,
      effective_capacity_total: result.effective_capacity_total,
      exclusive_campaigns_total: result.exclusive_campaigns_total,
      cross_platform_sharing: input.cross_platform_sharing,
      campaign_intent: input.campaign_intent ?? undefined,
      content_types: input.content_types ?? undefined,
    });
    if (balanced && balanced.adjustments_made && balanced.balanced_total <= result.supply_total) {
      const recheck = validateCapacityVsExpectation({
        available_content: input.available_content,
        weekly_capacity: input.weekly_capacity,
        exclusive_campaigns: input.exclusive_campaigns,
        platform_content_requests: balanced.balanced_requests,
        cross_platform_sharing: input.cross_platform_sharing,
        content_repurposing: repurposingEnabled ? { enabled: true } : input.content_repurposing,
        campaign_duration_weeks: input.campaign_duration_weeks,
        message: input.message,
        override_confirmed: input.override_confirmed,
      });
      if (recheck && recheck.status === 'valid') {
        const planning_adjustments_summary = buildPlanningAdjustmentsSummary({
          original_platform_content_requests: platform_content_requests,
          balanced_requests: balanced.balanced_requests,
        });
        return {
          ...recheck,
          status: 'balanced',
          requested_total: balanced.original_requested_total,
          balanced_requests: balanced.balanced_requests,
          planning_adjustment_reason: balanced.reason,
          planning_adjustments_summary,
        };
      }
    }
  }

  return result;
}
