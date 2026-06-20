/**
 * Economic Observability — Phase 1 (READ-ONLY shadow layer).
 *
 * Types for re-deriving ACTUAL economic cost from already-captured telemetry
 * (usage_events tokens + the existing llm_model_pricing table) and computing
 * SHADOW settlement diagnostics — WITHOUT changing billing, pricing, credits,
 * reservations, settlement, or the live write path. Nothing here mutates state.
 */

/** How the actual cost figure was derived (transparency, no false precision). */
export type CostDerivation =
  | 'persisted_total_cost' // usage_events.total_cost_usd present
  | 'persisted_unit_cost' // unit_cost × total_tokens
  | 'derived_io_pricing' // input/output tokens × llm_model_pricing
  | 'derived_blended' // total_tokens × blended rate
  | 'unavailable';

export interface ShadowEconomicRecord {
  organization_id: string;
  user_id: string | null;
  campaign_id: string | null;
  process_type: string | null;
  action_key: string | null;
  module: string;
  model: string | null;
  source_type: string | null;
  total_tokens: number;
  /** Re-derived provider COGS in USD (read-only; never persisted to billing). */
  actual_economic_cost_usd: number | null;
  cost_derivation: CostDerivation;
  /** Fixed credits this activity WOULD reserve (credit_cost_config). */
  estimated_reserved_credits: number | null;
  /** Credits a cost-metered settlement WOULD charge (cost ÷ credit_rate_usd). */
  shadow_settlement_credits: number | null;
  /** reserved − shadow_settlement (positive = reserved more than actual cost). */
  difference_from_reserved: number | null;
  /** ledger hold this usage links to, if any (informational only). */
  ledger_hold_transaction_id: string | null;
  created_at: string;
}

export interface ShadowGroupAggregate {
  key: string;
  label: string;
  events: number;
  total_tokens: number;
  actual_economic_cost_usd: number;
  estimated_reserved_credits: number;
  shadow_settlement_credits: number;
  difference_from_reserved: number;
  /** reserved / shadow_settlement — >1 = reserved exceeds actual cost. */
  reserve_to_cost_ratio: number | null;
}

export interface CoverageStats {
  total_events: number;
  with_tokens: number;
  with_persisted_cost: number;
  with_derived_cost: number;
  cost_coverage_pct: number; // events with any actual cost / total
  token_coverage_pct: number;
  attribution: {
    org_pct: number;
    user_pct: number;
    campaign_pct: number;
    activity_pct: number; // process_type or action_key present
    hold_linked_pct: number;
  };
}

export interface ShadowEconomicReport {
  organization_id: string | null; // null = all orgs (admin/diagnostic)
  generated_at: string;
  window_days: number;
  coverage: CoverageStats;
  by_module: ShadowGroupAggregate[];
  by_activity: ShadowGroupAggregate[]; // process_type
  by_model: ShadowGroupAggregate[];
  totals: {
    events: number;
    total_tokens: number;
    actual_economic_cost_usd: number;
    estimated_reserved_credits: number;
    shadow_settlement_credits: number;
    difference_from_reserved: number;
  };
  /** A few concrete shadow-settlement examples (Section F of the brief). */
  examples: ShadowEconomicRecord[];
  /** Pipeline freshness diagnostics. */
  pipeline: {
    newest_event_at: string | null;
    events_last_30d: number;
    stale: boolean;
  };
  notes: string[];
}
