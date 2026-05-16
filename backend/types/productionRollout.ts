export const ROLLOUT_KINDS = [
  'tenant_activation',
  'connector_rollout',
  'semantic_rollout',
  'feature_rollout',
  'runtime_upgrade',
  'full_production',
] as const;
export type RolloutKind = (typeof ROLLOUT_KINDS)[number];

export const ROLLOUT_PLAN_STATUSES = [
  'drafted',
  'approved',
  'executing',
  'complete',
  'failed',
  'rolled_back',
  'cancelled',
] as const;
export type RolloutPlanStatus = (typeof ROLLOUT_PLAN_STATUSES)[number];

export const ROLLOUT_STAGE_STATUSES = [
  'pending',
  'executing',
  'verified',
  'failed',
  'rolled_back',
  'skipped',
] as const;
export type RolloutStageStatus = (typeof ROLLOUT_STAGE_STATUSES)[number];

export const ROLLOUT_DEFAULT_BATCH_SIZE = 50 as const;
export const ROLLOUT_MAX_BATCH_SIZE = 10000 as const;

export type RolloutStage = {
  stage_index: number;
  stage_kind: string;
  description: string;
  bounded_batch_size?: number;
  dependencies?: string[];
};

export type ProductionRolloutPlan = {
  id: string;
  organization_id: string;
  plan_name: string;
  rollout_kind: RolloutKind;
  description: string | null;
  ordered_stages: RolloutStage[];
  dependency_metadata: Record<string, unknown>;
  status: RolloutPlanStatus;
  bounded_batch_size: number;
  owner_user_id: string | null;
  approved_by: string | null;
  approved_at: string | null;
  rolled_back_at: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};

export type ProductionRolloutStageExecution = {
  id: string;
  organization_id: string;
  plan_id: string;
  stage_index: number;
  stage_kind: string;
  status: RolloutStageStatus;
  checkpoint_payload: Record<string, unknown>;
  verified_at: string | null;
  verified_by: string | null;
  failure_reason: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};
