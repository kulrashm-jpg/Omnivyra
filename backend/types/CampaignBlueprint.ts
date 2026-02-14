/**
 * Canonical weekly plan model for unifying all planning flows.
 * Strategic blueprint level only — no daily structure.
 */

export interface CampaignBlueprint {
  campaign_id: string;
  duration_weeks: number;
  weeks: CampaignBlueprintWeek[];
}

export interface CampaignBlueprintWeek {
  week_number: number;
  phase_label: string;
  primary_objective: string;
  platform_allocation: Record<string, number>;
  content_type_mix: string[];
  cta_type: string;
  weekly_kpi_focus: string;
}
