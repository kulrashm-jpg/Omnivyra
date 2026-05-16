export const COST_CATEGORIES = [
  'embedding',
  'execution',
  'connector',
  'realtime',
  'storage',
  'semantic_indexing',
] as const;
export type CostCategory = (typeof COST_CATEGORIES)[number];

export const COST_DECISIONS = ['allowed', 'warned', 'denied', 'overage_approved'] as const;
export type CostDecision = (typeof COST_DECISIONS)[number];

export type CostBudget = {
  id: string;
  organization_id: string;
  category: CostCategory;
  monthly_soft_ceiling: number;
  monthly_hard_ceiling: number;
  alert_threshold_percent: number;
  enabled: boolean;
  metadata: Record<string, unknown>;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export type CostEvent = {
  id: string;
  organization_id: string;
  category: CostCategory;
  units: number;
  attribution_kind: string | null;
  attribution_ref: string | null;
  decision: CostDecision;
  reasons: string[];
  metadata: Record<string, unknown>;
  created_at: string;
};

// 30-day rolling window matches the existing Phase 2 budget concept.
export const COST_BUDGET_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;
