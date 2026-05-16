export const MONITORING_RUN_STATUSES = [
  'planned',
  'blocked',
  'skipped',
  'running',
  'completed',
  'failed',
] as const;
export type MonitoringRunStatus = (typeof MONITORING_RUN_STATUSES)[number];

export const MONITORING_BLOCK_REASONS = [
  'consent_blocked',
  'scope_blocked',
  'budget_blocked',
  'cooldown_blocked',
  'duplicate_run',
  'runaway_protection',
  'mode_manual_only',
  'source_not_ready',
  'capability_disabled',
] as const;
export type MonitoringBlockReason = (typeof MONITORING_BLOCK_REASONS)[number];

export type MonitoringRun = {
  id: string;
  organization_id: string;
  configuration_id: string | null;
  planned_at: string;
  status: MonitoringRunStatus;
  block_reason: MonitoringBlockReason | null;
  started_at: string | null;
  completed_at: string | null;
  credit_spent: number;
  signal_count: number;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};
