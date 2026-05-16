export type FeatureFlag = {
  id: string;
  organization_id: string;
  flag_key: string;
  enabled: boolean;
  rollout_cohort: string | null;
  rollout_percent: number | null;
  rationale: string | null;
  activated_by: string | null;
  activated_at: string | null;
  reverted_at: string | null;
  reverted_by: string | null;
  metadata: Record<string, unknown>;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

// Phase 8 reserves a set of well-known flag keys for staged Phase 8/9 rollout.
// New keys can be added freely — no enum constraint in the DB.
export const KNOWN_FEATURE_FLAGS = [
  'semantic_indexing.enabled',
  'distributed_execution.enabled',
  'cost_governance.hard_block',
  'sla_monitoring.enabled',
  'realtime_subscriptions.client',
  'intelligence_dashboards.enabled',
  // Phase 2 billing rollout flags (mirror of BILLING_FLAGS in backend/services/billing/billingFeatureFlags.ts)
  'billing.orchestrator_enforced',
  'billing.ai_enforced',
  'billing.reservations_required',
  'billing.reconciliation_blocking',
  'billing.dual_approval_required',
  'billing.refine_variant_enabled',
] as const;
export type KnownFeatureFlag = (typeof KNOWN_FEATURE_FLAGS)[number];
