/**
 * Canonical weekly plan model for unifying all planning flows.
 * Strategic blueprint level only — no daily structure.
 */

export interface CampaignBlueprint {
  campaign_id: string;
  duration_weeks: number;
  weeks: CampaignBlueprintWeek[];
}

export interface PlatformContentBreakdownItem {
  type: string;
  count: number;
  topic?: string;
  topics?: string[];
  platforms?: string[];
}

/** Dynamic extras per week: summary, objectives, days_to_post, etc. Keys added at runtime. */
export type WeekExtras = Record<string, unknown>;

export interface CampaignBlueprintWeek {
  week_number: number;
  phase_label: string;
  primary_objective: string;
  topics_to_cover?: string[];
  platform_allocation: Record<string, number>;
  content_type_mix: string[];
  cta_type: string;
  weekly_kpi_focus: string;
  platform_content_breakdown?: Record<string, PlatformContentBreakdownItem[]>;
  platform_topics?: Record<string, string[]>;
  /** Flexible key-value store for AI/UI additions: summary, objectives, days_to_post, etc. */
  week_extras?: WeekExtras;
}
