export const EXECUTION_MODES = ['ON_DEMAND', 'SCHEDULED'] as const;
export type ExecutionMode = (typeof EXECUTION_MODES)[number];

export const EXECUTION_STATUSES = [
  'planned',
  'queued',
  'running',
  'completed',
  'partial',
  'failed',
  'cancelled',
  'blocked_by_moderation',
] as const;
export type ExecutionStatus = (typeof EXECUTION_STATUSES)[number];

export type ListeningExecution = {
  id: string;
  organization_id: string;
  listening_source_id: string;
  configuration_id: string | null;
  monitoring_run_id: string | null;
  execution_mode: ExecutionMode;
  execution_status: ExecutionStatus;
  planned_at: string;
  queued_at: string | null;
  started_at: string | null;
  completed_at: string | null;
  failed_at: string | null;
  cancelled_at: string | null;
  retry_count: number;
  estimated_credit_cost: number;
  actual_credit_cost: number;
  moderation_status:
    | 'pending'
    | 'approved'
    | 'flagged'
    | 'blocked'
    | 'requires_review'
    | null;
  ingestion_stats: {
    posts_fetched?: number;
    comments_fetched?: number;
    pages_fetched?: number;
    rate_limit_pauses?: number;
    fetch_duration_ms?: number;
  };
  signal_stats: {
    signals_detected?: number;
    signals_persisted?: number;
    signals_deduplicated?: number;
    signals_moderation_blocked?: number;
    signals_moderation_flagged?: number;
  };
  error_metadata: Record<string, unknown> | null;
  bullmq_job_id: string | null;
  created_by: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};

export const TERMINAL_EXECUTION_STATUSES: ExecutionStatus[] = [
  'completed',
  'partial',
  'failed',
  'cancelled',
  'blocked_by_moderation',
];

export const ACTIVE_EXECUTION_STATUSES: ExecutionStatus[] = ['planned', 'queued', 'running'];

export function isTerminalExecutionStatus(s: ExecutionStatus): boolean {
  return TERMINAL_EXECUTION_STATUSES.includes(s);
}
