export const DR_PLAN_KINDS = [
  'projection_rebuild',
  'queue_recovery',
  'semantic_index_rebuild',
  'partition_recovery',
  'failover_validation',
  'full_recovery',
] as const;
export type DrPlanKind = (typeof DR_PLAN_KINDS)[number];

export const DR_EXECUTION_STATUSES = [
  'planned',
  'approved',
  'executing',
  'complete',
  'failed',
  'cancelled',
  'rolled_back',
] as const;
export type DrExecutionStatus = (typeof DR_EXECUTION_STATUSES)[number];

export const DR_DEFAULT_BATCH_SIZE = 100 as const;
export const DR_MAX_BATCH_SIZE = 10000 as const;

export type DrStep = {
  step_index: number;
  step_kind: string;
  description: string;
  bounded_batch_size?: number;
};

export type DrStepResult = {
  step_index: number;
  step_kind: string;
  status: 'complete' | 'partial' | 'failed' | 'skipped';
  processed: number;
  detail: string | null;
  duration_ms: number;
};

export type DisasterRecoveryPlan = {
  id: string;
  organization_id: string;
  plan_kind: DrPlanKind;
  name: string;
  description: string | null;
  ordered_steps: DrStep[];
  expected_runtime_minutes: number;
  bounded_batch_size: number;
  owner_user_id: string | null;
  enabled: boolean;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};

export type DisasterRecoveryExecution = {
  id: string;
  organization_id: string;
  plan_id: string | null;
  plan_kind: DrPlanKind;
  status: DrExecutionStatus;
  step_results: DrStepResult[];
  initiated_by: string | null;
  approved_by: string | null;
  approved_at: string | null;
  started_at: string | null;
  completed_at: string | null;
  failure_reason: string | null;
  observability: Record<string, unknown>;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};
