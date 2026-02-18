/**
 * Adapter layer for converting various weekly plan sources into canonical CampaignBlueprint.
 * No data loss — normalizes into unified shape for downstream consumers.
 */

import type { CampaignBlueprint, CampaignBlueprintWeek } from '../types/CampaignBlueprint';

/** Parsed plan from parseAiPlanToWeeks (Flow B) — has weeks array with week, phase_label, etc. */
type StructuredPlanInput = {
  weeks?: Array<{
    week: number;
    phase_label?: string;
    primary_objective?: string;
    platform_allocation?: Record<string, number>;
    content_type_mix?: string[];
    cta_type?: string;
    weekly_kpi_focus?: string;
    theme?: string;
    daily?: any[];
  }>;
};

/**
 * Convert output from parseAiPlanToWeeks (Flow B) to canonical CampaignBlueprint.
 */
export function fromStructuredPlan(plan: any): CampaignBlueprint {
  const weeks = plan?.weeks ?? [];
  const campaignId = typeof plan?.campaign_id === 'string' ? plan.campaign_id : '';

  const blueprintWeeks: CampaignBlueprintWeek[] = weeks.map((w: any) => ({
    week_number: w.week ?? 0,
    phase_label: String(w.phase_label ?? w.theme ?? `Week ${w.week ?? 0}`),
    primary_objective: String(w.primary_objective ?? w.theme ?? ''),
    topics_to_cover: Array.isArray(w.topics_to_cover) ? [...w.topics_to_cover] : undefined,
    platform_allocation: typeof w.platform_allocation === 'object' && w.platform_allocation
      ? { ...w.platform_allocation }
      : {},
    content_type_mix: Array.isArray(w.content_type_mix) ? [...w.content_type_mix] : ['post'],
    cta_type: String(w.cta_type ?? 'None'),
    weekly_kpi_focus: String(w.weekly_kpi_focus ?? 'Reach growth'),
    platform_content_breakdown: w.platform_content_breakdown,
    platform_topics: w.platform_topics,
    week_extras: (w.week_extras && typeof w.week_extras === 'object') ? { ...w.week_extras } : undefined,
  }));

  return {
    campaign_id: campaignId,
    duration_weeks: blueprintWeeks.length || 12,
    weeks: blueprintWeeks,
  };
}

/**
 * Convert campaign_snapshot.weekly_plan (Flow A) to canonical CampaignBlueprint.
 * Maps: week_number, theme, platforms + frequency_per_platform, content_types, objective.
 */
export function fromRecommendationPlan(
  snapshotWeeklyPlan: any[],
  campaignId: string = ''
): CampaignBlueprint {
  if (!Array.isArray(snapshotWeeklyPlan) || snapshotWeeklyPlan.length === 0) {
    return {
      campaign_id: campaignId,
      duration_weeks: 12,
      weeks: [],
    };
  }

  const blueprintWeeks: CampaignBlueprintWeek[] = snapshotWeeklyPlan.map((week: any) => {
    const platforms = week.platforms ?? [];
    const frequency = week.frequency_per_platform ?? {};
    const platform_allocation: Record<string, number> = {};
    for (const p of platforms) {
      const key = String(p).toLowerCase().trim();
      if (key && key !== 'twitter') {
        platform_allocation[key === 'x' ? 'x' : key] = frequency[p] ?? frequency[key] ?? 1;
      } else if (key === 'twitter') {
        platform_allocation.x = frequency.twitter ?? frequency.x ?? 1;
      }
    }
    if (Object.keys(platform_allocation).length === 0 && platforms.length > 0) {
      platforms.forEach((p: string) => {
        const key = String(p).toLowerCase();
        platform_allocation[key === 'twitter' ? 'x' : key] = 1;
      });
    }

    const contentTypes = week.content_types;
    let content_type_mix: string[] = ['post'];
    if (contentTypes && typeof contentTypes === 'object') {
      const all = Object.values(contentTypes).flat();
      if (Array.isArray(all) && all.length > 0) {
        content_type_mix = [...new Set(all.map((t: any) => String(t)))];
      }
    }

    const objective = week.campaign_objective ?? week.objective ?? 'engagement';
    const kpi =
      objective === 'leads' || objective === 'conversions'
        ? 'Leads generated'
        : objective === 'engagement'
          ? 'Engagement rate'
          : 'Reach growth';

    return {
      week_number: week.week_number ?? 0,
      phase_label: String(week.theme ?? week.phase_label ?? ''),
      primary_objective: String(week.theme ?? week.primary_objective ?? objective),
      platform_allocation,
      content_type_mix,
      cta_type: week.cta_type ?? (objective === 'conversions' ? 'Direct Conversion CTA' : 'Soft CTA'),
      weekly_kpi_focus: kpi,
    };
  });

  return {
    campaign_id: campaignId,
    duration_weeks: blueprintWeeks.length || 12,
    weeks: blueprintWeeks,
  };
}

/**
 * Convert weekly_content_refinements rows (Flow C) to canonical CampaignBlueprint.
 * Infers platform_allocation from content_plan when possible; otherwise uses { linkedin: 1 }.
 */
export function fromLegacyRefinements(
  refinements: any[],
  campaignId: string = ''
): CampaignBlueprint {
  if (!Array.isArray(refinements) || refinements.length === 0) {
    return {
      campaign_id: campaignId,
      duration_weeks: 12,
      weeks: [],
    };
  }

  const sorted = [...refinements].sort(
    (a, b) => (a.week_number ?? 0) - (b.week_number ?? 0)
  );

  const blueprintWeeks: CampaignBlueprintWeek[] = sorted.map((r: any) => {
    let platform_allocation: Record<string, number> = { linkedin: 1 };

    const contentPlan = r.content_plan;
    if (contentPlan && typeof contentPlan === 'object') {
      if (typeof contentPlan.platform_allocation === 'object' && contentPlan.platform_allocation) {
        platform_allocation = { ...contentPlan.platform_allocation };
      } else if (Array.isArray(contentPlan.platforms)) {
        const inferred: Record<string, number> = {};
        for (const p of contentPlan.platforms) {
          const key = String(p).toLowerCase();
          if (key) inferred[key] = (inferred[key] ?? 0) + 1;
        }
        if (Object.keys(inferred).length > 0) {
          platform_allocation = inferred;
        } else {
          console.warn(
            '[campaignBlueprintAdapter] fromLegacyRefinements: No allocation in content_plan, using default { linkedin: 1 } for week',
            r.week_number
          );
        }
      }
    } else {
      console.warn(
        '[campaignBlueprintAdapter] fromLegacyRefinements: No content_plan, using default { linkedin: 1 } for week',
        r.week_number
      );
    }

    return {
      week_number: r.week_number ?? 0,
      phase_label: String(r.theme ?? r.focus_area ?? `Week ${r.week_number ?? 0}`),
      primary_objective: String(r.theme ?? r.focus_area ?? ''),
      platform_allocation,
      content_type_mix: Array.isArray(r.content_types) ? [...r.content_types] : ['post'],
      cta_type: 'Soft CTA',
      weekly_kpi_focus: 'Reach growth',
    };
  });

  return {
    campaign_id: campaignId,
    duration_weeks: blueprintWeeks.length || 12,
    weeks: blueprintWeeks,
  };
}

/**
 * Convert a CampaignBlueprintWeek to the legacy week shape expected by buildPlatformExecutionPlan,
 * validateCampaignHealth, and optimizeWeekPlan (WeekPlanItem compatible).
 */
export function blueprintWeekToLegacyWeekPlan(
  week: CampaignBlueprintWeek,
  themeFallback?: string
): {
  week_number: number;
  theme: string;
  platforms: string[];
  content_types: Record<string, string[]>;
  frequency_per_platform?: Record<string, number>;
  campaign_objective?: string;
  [key: string]: any;
} {
  const theme = week.phase_label || week.primary_objective || themeFallback || `Week ${week.week_number}`;
  const platform_allocation = week.platform_allocation || {};
  const platforms = Object.keys(platform_allocation).filter(Boolean);
  const contentTypeMix = week.content_type_mix?.length ? week.content_type_mix : ['post'];
  const content_types: Record<string, string[]> = {};
  for (const p of platforms) {
    content_types[p] = contentTypeMix;
  }
  const frequency_per_platform = { ...platform_allocation };
  if (platforms.length === 0) {
    return {
      week_number: week.week_number,
      theme,
      platforms: ['linkedin'],
      content_types: { linkedin: ['post'] },
      frequency_per_platform: { linkedin: 1 },
    };
  }
  return {
    week_number: week.week_number,
    theme,
    platforms,
    content_types,
    frequency_per_platform,
  };
}

/** Legacy refinement row shape for weekly_content_refinements insert */
export type LegacyRefinementRow = {
  campaign_id: string;
  week_number: number;
  theme: string;
  focus_area: string;
  ai_suggestions?: any[];
  refinement_status?: string;
};

/**
 * Convert blueprint weeks to legacy refinement rows for weekly_content_refinements.
 * Used when deriving legacy storage from blueprint.
 */
export function blueprintWeeksToLegacyRefinements(
  weeks: CampaignBlueprintWeek[],
  campaignId: string,
  options?: { suggestions?: (w: CampaignBlueprintWeek, idx: number) => any[] }
): LegacyRefinementRow[] {
  return weeks.map((w, idx) => ({
    campaign_id: campaignId,
    week_number: w.week_number,
    theme: w.phase_label,
    focus_area: w.primary_objective || w.phase_label,
    ai_suggestions: options?.suggestions?.(w, idx) ?? [],
    refinement_status: 'ai_enhanced',
  }));
}
