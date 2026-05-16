export const MIGRATION_DRY_RUN_KINDS = [
  'schema',
  'data_backfill',
  'config',
  'feature_flag',
  'retention',
  'custom',
] as const;
export type MigrationDryRunKind = (typeof MIGRATION_DRY_RUN_KINDS)[number];

export const MIGRATION_DRY_RUN_STATUSES = [
  'previewed',
  'verified',
  'blocked',
  'executed',
  'failed',
  'rolled_back',
  'cancelled',
] as const;
export type MigrationDryRunStatus = (typeof MIGRATION_DRY_RUN_STATUSES)[number];

export type MigrationDependencyCheck = {
  check_kind: string;
  passed: boolean;
  detail: string;
};

export type MigrationRollbackPlan = {
  steps: Array<{ step_index: number; step_kind: string; detail: string }>;
  bounded: boolean;
  estimated_runtime_minutes: number;
};

export type MigrationExecutionAuditEntry = {
  entry_index: number;
  entry_kind: 'preview' | 'verify' | 'execute' | 'rollback' | 'note';
  actor_user_id: string | null;
  detail: string;
  created_at: string;
};

export type MigrationDryRun = {
  id: string;
  organization_id: string;
  migration_kind: MigrationDryRunKind;
  migration_identifier: string;
  status: MigrationDryRunStatus;
  dependency_checks: MigrationDependencyCheck[];
  rollback_plan: MigrationRollbackPlan;
  execution_audit: MigrationExecutionAuditEntry[];
  health_verdict: string | null;
  requested_by: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};
