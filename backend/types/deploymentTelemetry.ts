export const DEPLOYMENT_SNAPSHOT_KINDS = [
  'rollout_progress',
  'migration_progress',
  'connector_rollout',
  'semantic_rollout',
  'replay_drift',
  'deployment_health_overview',
] as const;
export type DeploymentSnapshotKind = (typeof DEPLOYMENT_SNAPSHOT_KINDS)[number];

export const DEPLOYMENT_HEALTH_STATES = ['healthy', 'degraded', 'critical', 'unknown'] as const;
export type DeploymentHealthState = (typeof DEPLOYMENT_HEALTH_STATES)[number];

export const DEPLOYMENT_TELEMETRY_RETENTION_DAYS = 90 as const;

export type DeploymentTelemetrySnapshot = {
  id: string;
  organization_id: string;
  snapshot_kind: DeploymentSnapshotKind;
  health_state: DeploymentHealthState;
  measures: Record<string, number>;
  derivation_explanation: string | null;
  generated_by: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
};
