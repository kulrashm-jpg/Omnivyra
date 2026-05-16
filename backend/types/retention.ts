export const RETENTION_TARGETS = [
  'raw_ingested_content',
  'moderation_decisions',
  'opportunity_feed_items',
  'lifecycle_history',
  'observability_traces',
  'alerts',
  'projection_sync_state',
  'graph_edges',
  'listening_executions',
  'listening_signal_dedup',
] as const;
export type RetentionTarget = (typeof RETENTION_TARGETS)[number];

export const RETENTION_ARCHIVAL_MODES = ['soft_delete', 'hard_delete'] as const;
export type RetentionArchivalMode = (typeof RETENTION_ARCHIVAL_MODES)[number];

export type RetentionPolicy = {
  id: string;
  organization_id: string;
  target_kind: RetentionTarget;
  retain_days: number;
  archival_mode: RetentionArchivalMode;
  enabled: boolean;
  metadata: Record<string, unknown>;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export type RetentionExecutionMode = 'dry_run' | 'execute';

export type RetentionExecution = {
  id: string;
  organization_id: string;
  retention_policy_id: string;
  execution_mode: RetentionExecutionMode;
  rows_scanned: number;
  rows_affected: number;
  cutoff_at: string;
  status: 'completed' | 'partial' | 'failed';
  detail: string | null;
  initiated_by: string | null;
  created_at: string;
};

// Tables that retention policies may target. The service maps target_kind →
// table name, the time column, and (when soft-deleting) the soft-delete
// column. Phase 7 retention is dry-run-default and only hard-deletes when
// the policy explicitly opts in.
export const RETENTION_TARGET_BINDINGS: Record<
  RetentionTarget,
  { table: string; time_column: string; soft_delete_column: string | null }
> = {
  raw_ingested_content: { table: 'listening_signal_dedup', time_column: 'first_seen_at', soft_delete_column: null },
  moderation_decisions: { table: 'moderation_decisions', time_column: 'created_at', soft_delete_column: null },
  opportunity_feed_items: { table: 'opportunity_feed_items', time_column: 'created_at', soft_delete_column: null },
  lifecycle_history: { table: 'opportunity_lifecycle_states', time_column: 'transitioned_at', soft_delete_column: null },
  observability_traces: { table: 'execution_observability_records', time_column: 'created_at', soft_delete_column: null },
  alerts: { table: 'alerts', time_column: 'created_at', soft_delete_column: null },
  projection_sync_state: { table: 'projection_sync_state', time_column: 'updated_at', soft_delete_column: null },
  graph_edges: { table: 'opportunity_graph_edges', time_column: 'created_at', soft_delete_column: null },
  listening_executions: { table: 'listening_executions', time_column: 'created_at', soft_delete_column: null },
  listening_signal_dedup: { table: 'listening_signal_dedup', time_column: 'first_seen_at', soft_delete_column: null },
};

// Tables that are append-only audit trails — retention service refuses to
// execute hard_delete against these even if a policy targets them.
export const APPEND_ONLY_TARGETS: Set<RetentionTarget> = new Set<RetentionTarget>([
  'lifecycle_history',
  'moderation_decisions',
]);
