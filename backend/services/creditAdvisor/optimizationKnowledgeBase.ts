/**
 * Credit Advisor — Optimization Knowledge Base.
 *
 * The SINGLE deterministic source of truth for Phase 2 optimization
 * intelligence. Everything here is a fixed constant table — NO AI, NO LLM,
 * NO generative logic. Savings ratios are heuristic but fixed and documented
 * (basis: OMNIVYRA_COST_ECONOMICS_MODEL.md), and are applied to ACTUAL observed
 * consumption so they never fabricate spend that isn't there.
 */

import type {
  ConsumptionClass,
  ModuleLabel,
  Priority,
} from './creditAdvisorTypes';

// ── Automation registry (Phase 12) ──────────────────────────────────────────
// Recurring background processes, their cadence (from backend/scheduler/cron.ts
// + vercel.json), the module they bill into, and their relative weight within
// that module's spend. Weights are used to apportion observed module credits to
// individual automations when per-action separation isn't available.

export interface AutomationDef {
  id: string;
  name: string;
  module: ModuleLabel;
  cadence_label: string;
  runs_per_month: number;
  /** Share of the module's automated spend attributable to this automation (0..1). */
  module_weight: number;
  /** 'disabled_by_default' for processes shipped OFF (e.g. reconciliation). */
  default_off?: boolean;
  // ── Frequency optimization (Phase 27/29) — present only when a safe,
  //    lower-frequency alternative exists.
  frequency_label?: string;
  recommended_frequency_label?: string;
  /** Fraction of this automation's spend saved by the lower frequency (0..1). */
  frequency_savings_ratio?: number;
  /** Plain-language tradeoff of the lower frequency. */
  frequency_tradeoff?: string;
}

export const AUTOMATION_REGISTRY: AutomationDef[] = [
  { id: 'conversation_triage', name: 'Conversation Triage', module: 'Engagement', cadence_label: 'every 3 min', runs_per_month: 14_400, module_weight: 0.45, frequency_label: 'Every 3 min', recommended_frequency_label: 'Every 15 min', frequency_savings_ratio: 0.6, frequency_tradeoff: 'Slightly slower reply triage' },
  { id: 'conversation_memory', name: 'Conversation Memory', module: 'Engagement', cadence_label: 'every 5 min (gated)', runs_per_month: 8_640, module_weight: 0.15 },
  { id: 'engagement_polling', name: 'Engagement Monitoring (polling)', module: 'Engagement', cadence_label: 'every 10 min', runs_per_month: 4_320, module_weight: 0.25, frequency_label: 'Every 10 min', recommended_frequency_label: 'Every 30 min', frequency_savings_ratio: 0.5, frequency_tradeoff: 'Slower comment ingestion' },
  { id: 'inbox_analysis', name: 'Inbox / Comment Analysis', module: 'Engagement', cadence_label: 'per inbound comment', runs_per_month: 4_320, module_weight: 0.15 },
  { id: 'scheduled_lead_discovery', name: 'Scheduled Lead Discovery', module: 'Intelligence', cadence_label: '07:00 & 18:00 daily', runs_per_month: 60, module_weight: 0.6, frequency_label: 'Twice daily', recommended_frequency_label: 'Daily', frequency_savings_ratio: 0.5, frequency_tradeoff: 'Leads surfaced once a day instead of twice' },
  { id: 'active_leads_monitoring', name: 'Active Leads Monitoring', module: 'Intelligence', cadence_label: 'continuous listening', runs_per_month: 720, module_weight: 0.25, frequency_label: 'Continuous', recommended_frequency_label: 'Core platforms only', frequency_savings_ratio: 0.4, frequency_tradeoff: 'Narrower listening coverage' },
  { id: 'market_pulse_automation', name: 'Market Pulse Automation', module: 'Intelligence', cadence_label: 'daily', runs_per_month: 30, module_weight: 0.15, frequency_label: 'Daily', recommended_frequency_label: 'Weekly', frequency_savings_ratio: 0.7, frequency_tradeoff: 'Less frequent trend updates' },
  { id: 'intelligence_polling', name: 'Intelligence Polling', module: 'Intelligence', cadence_label: 'every 2h', runs_per_month: 360, module_weight: 0.0 },
  { id: 'analytics_ingestion', name: 'Analytics Ingestion', module: 'Reports', cadence_label: 'daily', runs_per_month: 30, module_weight: 0.5 },
  { id: 'scheduled_reports', name: 'Scheduled Reports', module: 'Reports', cadence_label: 'daily/weekly', runs_per_month: 30, module_weight: 0.5, frequency_label: 'Daily', recommended_frequency_label: 'Weekly', frequency_savings_ratio: 0.5, frequency_tradeoff: 'Less frequent scheduled reports' },
  { id: 'signal_processing', name: 'Signal Processing', module: 'Intelligence', cadence_label: 'every 30 min', runs_per_month: 1_440, module_weight: 0.0 },
  { id: 'social_polling', name: 'Social Polling', module: 'Engagement', cadence_label: 'every 10 min', runs_per_month: 4_320, module_weight: 0.0 },
  { id: 'reconcile_publishes', name: 'Publish Reconciliation', module: 'Automation', cadence_label: 'every 10 min', runs_per_month: 4_320, module_weight: 0.0, default_off: true },
];

// ── Consumption classification thresholds (Phase 12) ─────────────────────────
export function classifyMonthlyCredits(credits: number): ConsumptionClass {
  if (credits >= 500) return 'Very High';
  if (credits >= 200) return 'High';
  if (credits >= 50) return 'Medium';
  return 'Low';
}

// ── Optimization levers (Phase 13) ──────────────────────────────────────────
// Each lever: which module it targets, the fraction of that module's spend it
// can realistically remove (savings_ratio), the minimum monthly spend that makes
// it worth surfacing, and fixed copy. Ratios are documented heuristics.

export interface OptimizationLever {
  rule: string; // A..E
  module: ModuleLabel;
  category: string;
  /** Fraction of the module's monthly credits this lever can save (0..1). */
  savings_ratio: number;
  /** Don't surface unless the module's monthly spend exceeds this. */
  min_monthly_credits: number;
  /** Optional extra gate: only when "deep/heavy" variants are detected. */
  requires_deep?: boolean;
  title: string;
  detail: string;
  recommendation: string;
}

export const OPTIMIZATION_LEVERS: OptimizationLever[] = [
  {
    rule: 'A',
    module: 'Campaigns',
    category: 'Campaign Optimization',
    savings_ratio: 0.3, // trimming duration/platforms scales spend ~linearly
    min_monthly_credits: 50,
    title: 'Campaigns are a large, reducible cost',
    detail:
      'Campaign cost scales with frequency × duration × platforms. Long durations and high platform counts multiply the per-item content fan-out.',
    recommendation:
      'Shorten campaign durations, reduce platform counts, or split into smaller campaigns. ~30% of campaign spend is typically recoverable.',
  },
  {
    rule: 'B',
    module: 'Intelligence',
    category: 'Market Pulse Optimization',
    savings_ratio: 0.65, // deep multi-region → standard single-region
    min_monthly_credits: 30,
    requires_deep: true,
    title: 'Deep / multi-region scans dominate intelligence spend',
    detail:
      'Deep and multi-region Market Pulse scans cost one LLM call per region; a standard single-region scan is a fraction of that.',
    recommendation:
      'Use standard scans for routine monitoring and reserve deep/multi-region scans for periodic reviews. Reduce scan frequency where coverage is redundant.',
  },
  {
    rule: 'C',
    module: 'Intelligence',
    category: 'Active Leads Optimization',
    savings_ratio: 0.45, // cost scales with platforms × regions × posts
    min_monthly_credits: 50,
    title: 'Lead discovery coverage is broad',
    detail:
      'Lead qualification runs one LLM call per discovered post, multiplied by platforms × regions × scan frequency.',
    recommendation:
      'Narrow region/platform coverage to your core markets and reduce discovery schedule frequency. Coverage reductions translate ~proportionally into savings.',
  },
  {
    rule: 'D',
    module: 'Creator',
    category: 'Creator Optimization',
    savings_ratio: 0.3, // regeneration + image gen is the driver
    min_monthly_credits: 30,
    title: 'Creator assets carry regeneration / image-gen cost',
    detail:
      'Image and banner assets each trigger a paid image generation; repeated regeneration multiplies it. Carousel/deck/infographic do not generate images.',
    recommendation:
      'Reduce image-asset regeneration and prefer non-image creator formats (carousel/deck/infographic) where they fit. ~30% of creator spend is typically recoverable.',
  },
  {
    rule: 'E',
    module: 'Content',
    category: 'Content Optimization',
    savings_ratio: 0.5, // deep/long variants ~3x standard
    min_monthly_credits: 30,
    requires_deep: true,
    title: 'Deep / long-form variants drive content spend',
    detail:
      'Long-form and deep variants generate more sections and run more quality-repair passes than standard variants — roughly 3× the tokens.',
    recommendation:
      'Use standard/medium variants for routine content and reserve long-form/deep variants for pillar pieces. Switching routine pieces saves ~50% of their cost.',
  },
];

// ── What-if scenarios (Phase 16) ────────────────────────────────────────────
// Each scenario removes a deterministic fraction of a module's monthly spend.

export interface ScenarioDef {
  id: string;
  label: string;
  module: ModuleLabel;
  /** Fraction of the module's monthly spend removed by this scenario (0..1). */
  reduction_ratio: number;
}

export const SCENARIO_DEFS: ScenarioDef[] = [
  { id: 'disable_market_pulse', label: 'Disable Market Pulse automation', module: 'Intelligence', reduction_ratio: 0.2 },
  { id: 'reduce_campaign_duration', label: 'Reduce campaign duration ~30%', module: 'Campaigns', reduction_ratio: 0.3 },
  { id: 'reduce_platforms', label: 'Reduce campaign platforms ~25%', module: 'Campaigns', reduction_ratio: 0.25 },
  { id: 'reduce_lead_regions', label: 'Reduce Active Leads region/platform coverage ~50%', module: 'Intelligence', reduction_ratio: 0.45 },
  { id: 'reduce_creator_usage', label: 'Reduce creator image/regeneration ~30%', module: 'Creator', reduction_ratio: 0.3 },
  { id: 'standard_content_variants', label: 'Use standard instead of deep content variants', module: 'Content', reduction_ratio: 0.4 },
];

// ── Pre-execution alternatives (Phase 20) ───────────────────────────────────
// Maps a "heavy" action to a cheaper alternative for the impact preview.
export interface AlternativeDef {
  alternative_action: string;
  alternative_label: string;
}

export const ACTION_ALTERNATIVES: Record<string, AlternativeDef> = {
  deep_analysis: { alternative_action: 'insight_generation', alternative_label: 'Standard insight scan' },
  full_strategy: { alternative_action: 'campaign_optimization', alternative_label: 'Targeted optimization pass' },
  market_positioning: { alternative_action: 'market_insight_manual', alternative_label: 'Standard market insight' },
  content_generation: { alternative_action: 'content_basic', alternative_label: 'Standard (shorter) content' },
};

// ── Priority helper (Phase 13) ──────────────────────────────────────────────
export function priorityForSavings(monthlySavings: number): Priority {
  if (monthlySavings >= 200) return 'High';
  if (monthlySavings >= 50) return 'Medium';
  return 'Low';
}
