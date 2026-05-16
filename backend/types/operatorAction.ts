export const OPERATOR_ACTION_KINDS = [
  'pause',
  'resume',
  'throttle',
  'unthrottle',
  'recover',
  'rollback',
  'flag_activated',
  'flag_reverted',
  'budget_overage_approved',
] as const;
export type OperatorActionKind = (typeof OPERATOR_ACTION_KINDS)[number];

export const OPERATOR_TARGET_KINDS = [
  'connector',
  'org',
  'partition',
  'feature_flag',
  'cost_budget',
  'semantic_indexing_job',
  'replay_operation',
] as const;
export type OperatorTargetKind = (typeof OPERATOR_TARGET_KINDS)[number];

export type OperatorAction = {
  id: string;
  organization_id: string;
  action_kind: OperatorActionKind;
  target_kind: OperatorTargetKind | string;
  target_ref: string | null;
  payload: Record<string, unknown>;
  rationale: string | null;
  actor_user_id: string | null;
  created_at: string;
};
