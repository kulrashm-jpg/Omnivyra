/**
 * Credit Advisor — shared types.
 *
 * READ-ONLY consumption-intelligence layer built on top of the existing
 * credit ledger / usage tables. This module NEVER writes, deducts, grants,
 * refunds, or mutates any billing state. See creditAdvisorService.ts header
 * for the safety contract (Phase 9).
 */

export type RiskLevel = 'Healthy' | 'Monitor' | 'At Risk' | 'Critical';

export type HealthBand = 'Excellent' | 'Healthy' | 'Monitor' | 'At Risk' | 'Critical';

export type TrendDirection = 'up' | 'down' | 'flat';

/** Canonical product modules surfaced to the operator. */
export type ModuleLabel =
  | 'Content'
  | 'Campaigns'
  | 'Creator'
  | 'Intelligence'
  | 'Engagement'
  | 'Reports'
  | 'Automation'
  | 'External'
  | 'Internal'
  | 'Other';

export interface WalletOverview {
  /** Spendable now = (free+paid+incentive) − reserved. */
  remaining: number;
  /** Lifetime credits granted/purchased (best available "allocated" proxy). */
  allocated: number;
  /** Lifetime credits consumed. */
  consumed_lifetime: number;
  free: number;
  paid: number;
  incentive: number;
  reserved: number;
  /** USD per 1 credit (for cost display). */
  credit_rate_usd: number;
  /** True when no wallet row exists for the org. */
  missing: boolean;
}

export interface ConsumptionMetrics {
  credits_used_today: number;
  credits_used_3d: number;
  credits_used_7d: number;
  credits_used_30d: number;
  credits_remaining: number;
  /** Stable 30-day average. */
  daily_burn_rate: number;
  weekly_burn_rate: number;
  monthly_burn_rate: number;
  /** Recent 7-day average — used for trend vs the 30-day rate. */
  recent_daily_burn_rate: number;
  burn_trend: TrendDirection;
  /** Per-day credit consumption series for charting. */
  daily: Array<{ date: string; credits: number }>;
  /** Window the metrics were computed over. */
  window_days: number;
  events: number;
}

export interface ForecastResult {
  /** remaining / daily_burn_rate. null when burn is ~0 (no runway pressure). */
  days_remaining: number | null;
  /** ISO date of projected exhaustion, or null. */
  projected_exhaustion_date: string | null;
  /** Consumption expected by end of the calendar month. */
  projected_month_end_consumption: number;
  /** Balance expected by end of the calendar month (floored at 0 logically). */
  projected_month_end_balance: number;
  subscription_exhaustion_risk: RiskLevel;
  days_left_in_month: number;
}

export interface AttributionRow {
  key: string;
  label: string;
  credits: number;
  percentage: number;
  trend: TrendDirection;
}

export interface AttributionResult {
  total_credits: number;
  by_module: AttributionRow[];
  by_activity: AttributionRow[];
  by_variant: AttributionRow[];
  by_user: AttributionRow[];
  window_days: number;
}

export type RecommendationSeverity = 'info' | 'warn' | 'critical';

export interface Recommendation {
  /** Rule id: A | B | C | D | E. */
  rule: string;
  category: string;
  severity: RecommendationSeverity;
  title: string;
  detail: string;
  /** Quantified impact, e.g. "Campaigns = 47% of spend". */
  impact?: string;
}

export interface HealthScoreResult {
  score: number; // 0..100
  band: HealthBand;
  factors: {
    runway: number;
    remaining: number;
    concentration: number;
    forecast: number;
    utilization: number;
  };
}

export interface PreExecutionImpact {
  action: string;
  variant?: string | null;
  estimated_credits: number | null;
  /** estimated_credits / remaining, as a percentage. null when unknown. */
  pct_of_remaining: number | null;
  remaining: number;
  resolvable: boolean;
  note?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Hardening — recency-aware forecasting, confidence, spike, coverage
// ─────────────────────────────────────────────────────────────────────────────

export interface BurnWindows {
  burn_3d: number;
  burn_7d: number;
  burn_30d: number;
  weighted: number;
  weights: { d3: number; d7: number; d30: number };
}

export interface RunwayEstimate {
  days: number | null;
  daily_burn: number;
  basis: string;
}

export interface MultiRunway {
  /** Highest burn signal — most cautious. */
  conservative: RunwayEstimate;
  /** Recency-weighted blend. */
  balanced: RunwayEstimate;
  /** 30-day average — the original/optimistic figure. */
  aggressive: RunwayEstimate;
}

export interface ForecastExplanation {
  headline_days: number | null;
  headline_basis: string;
  recent_days: number | null;
  recent_basis: string;
  note: string;
}

export interface ForecastStrategy {
  windows: BurnWindows;
  runways: MultiRunway;
  explanation: ForecastExplanation;
}

export interface SpikeDriver {
  label: string;
  credits: number;
  percentage: number;
}

export interface SpikeIntelligence {
  detected: boolean;
  magnitude: number; // recent rate / baseline rate
  duration_days: number;
  baseline_daily: number;
  recent_daily: number;
  primary_drivers: SpikeDriver[];
  estimated_impact_days: number | null; // runway lost vs the optimistic view
}

export type ConfidenceLevel = 'Very High' | 'High' | 'Medium' | 'Low' | 'Very Low';

export interface ForecastConfidence {
  level: ConfidenceLevel;
  score: number; // 0..100
  factors: {
    usage_history: number;
    attribution_coverage: number;
    data_volume: number;
    recent_volatility: number;
  };
  limited_data: boolean;
  message: string;
}

export interface AttributionCoverage {
  coverage_pct: number;
  other_pct: number;
  by_module: AttributionRow[];
  top_gaps: Array<{ action: string; credits: number; percentage: number }>;
}

export interface CreditAdvisorReport {
  organization_id: string;
  generated_at: string;
  overview: WalletOverview;
  metrics: ConsumptionMetrics;
  forecast: ForecastResult;
  forecast_strategy: ForecastStrategy;
  confidence: ForecastConfidence;
  spike: SpikeIntelligence;
  coverage: AttributionCoverage;
  attribution: AttributionResult;
  recommendations: Recommendation[];
  health: HealthScoreResult;
}

// ─────────────────────────────────────────────────────────────────────────────
// Phase 2 — Consumption Optimization Intelligence (Phases 11–22)
// ─────────────────────────────────────────────────────────────────────────────

export type ConsumptionClass = 'Low' | 'Medium' | 'High' | 'Very High';
export type AutomationStatus = 'active' | 'idle' | 'disabled_by_default';
export type Priority = 'Low' | 'Medium' | 'High';

export interface AutomationConsumptionRow {
  id: string;
  name: string;
  module: ModuleLabel;
  status: AutomationStatus;
  cadence_label: string;
  estimated_monthly_credits: number;
  estimated_monthly_cost_usd: number;
  classification: ConsumptionClass;
}

export interface AutomationConsumptionReport {
  rows: AutomationConsumptionRow[];
  total_monthly_credits: number;
  total_monthly_cost_usd: number;
  window_days: number;
}

export interface SavingsEstimate {
  current_monthly_credits: number;
  optimized_monthly_credits: number;
  potential_savings_credits: number;
  potential_savings_pct: number;
  potential_monthly_savings_credits: number;
  potential_annual_savings_credits: number;
}

export interface OptimizationOpportunity {
  /** Rule id: A | B | C | D | E. */
  rule: string;
  module: ModuleLabel;
  category: string;
  title: string;
  detail: string;
  recommendation: string;
  priority: Priority;
  savings: SavingsEstimate;
}

export interface ConsumptionDriver {
  module: ModuleLabel;
  credits: number;
  percentage: number;
  trend: TrendDirection;
  /** Monthly-extrapolated credits for this driver. */
  projected_monthly_credits: number;
}

export interface ScenarioInput {
  id: string;
  label: string;
}

export interface ScenarioResult {
  scenario: string;
  label: string;
  projected_credits_saved_monthly: number;
  current_runway_days: number | null;
  projected_runway_days: number | null;
  runway_increase_days: number | null;
  current_month_end_balance: number;
  projected_month_end_balance: number;
}

export interface RunwayOptimization {
  current_runway_days: number | null;
  optimized_runway_days: number | null;
  additional_days_gained: number | null;
  current_daily_burn: number;
  optimized_daily_burn: number;
  monthly_credits_saved: number;
  applied_opportunities: string[];
}

export type UpgradeCategory =
  | 'No Upgrade Needed'
  | 'Optimization Recommended'
  | 'Upgrade Recommended'
  | 'Immediate Upgrade Recommended';

export interface UpgradeAdvice {
  current_plan: string;
  projected_exhaustion_date: string | null;
  days_remaining: number | null;
  optimization_potential_monthly_credits: number;
  category: UpgradeCategory;
  reasoning: string;
}

export interface OptimizationAlternative {
  alternative_action: string;
  alternative_label: string;
  estimated_credits: number | null;
  estimated_savings_credits: number | null;
}

export interface EnhancedPreExecutionImpact extends PreExecutionImpact {
  /** Estimated days of runway this single action consumes. */
  runway_impact_days: number | null;
  /** estimated_credits / allocated, as a percentage. */
  pct_of_allocation: number | null;
  alternatives: OptimizationAlternative[];
}

export interface ConsumptionOptimizationReport {
  organization_id: string;
  generated_at: string;
  automations: AutomationConsumptionReport;
  opportunities: OptimizationOpportunity[];
  drivers: ConsumptionDriver[];
  runway: RunwayOptimization;
  upgrade: UpgradeAdvice;
  scenarios: ScenarioResult[];
  total_potential_monthly_savings: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Phase 3 — Proactive Runway Intelligence & Executive Popup (Phases 23–36)
// ─────────────────────────────────────────────────────────────────────────────

/** Deep-link target section within the Credit Advisor page. */
export type DeepLinkSection = 'automation' | 'runway' | 'simulator' | 'opportunities' | 'overview';

export interface ExecutiveSummary {
  credits_remaining: number;
  runway_days: number | null;
  projected_exhaustion_date: string | null;
  health_band: HealthBand;
  risk: RiskLevel;
  largest_driver: { module: ModuleLabel; percentage: number } | null;
  optimization_potential_credits: number;
  optimization_runway_gain_days: number | null;
}

export interface AutomationRunwayRow {
  id: string;
  name: string;
  monthly_credits: number;
  pct_of_consumption: number;
  /** Days of runway this automation consumes (≈ runway gained if removed). */
  runway_days_lost: number | null;
  classification: ConsumptionClass;
}

export interface FrequencyOptimization {
  id: string;
  name: string;
  current_frequency: string;
  recommended_frequency: string;
  current_monthly_credits: number;
  optimized_monthly_credits: number;
  potential_savings_credits: number;
  runway_gain_days: number | null;
  tradeoff: string;
  deep_link: DeepLinkSection;
}

export interface TopAction {
  rank: number;
  title: string;
  savings_credits: number;
  runway_gain_days: number | null;
  tradeoff?: string;
  deep_link: DeepLinkSection;
}

export interface ExecutiveDisplaySignals {
  risk: RiskLevel;
  runway_days: number | null;
  exhaustion_within_30d: boolean;
  /** Optimization potential as % of monthly burn (0..100). */
  opportunity_pct: number;
  consumption_spike: boolean;
  healthy_and_low_opportunity: boolean;
  /** Server's base recommendation to show (client adds dismissal + spike-vs-last). */
  base_should_show: boolean;
  /** Compact state fingerprint; the client shows again when this changes. */
  signature: string;
}

export interface ExecutiveBanner {
  health_band: HealthBand;
  risk: RiskLevel;
  runway_days: number | null;
  largest_driver: { module: ModuleLabel; percentage: number } | null;
  top_recommendation: TopAction | null;
}

export interface ExecutiveIntelligenceReport {
  organization_id: string;
  generated_at: string;
  summary: ExecutiveSummary;
  automation_runway: AutomationRunwayRow[];
  frequency_optimizations: FrequencyOptimization[];
  top_actions: TopAction[];
  upgrade: UpgradeAdvice;
  banner: ExecutiveBanner;
  display: ExecutiveDisplaySignals;
}
