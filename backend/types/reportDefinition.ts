export const REPORT_KINDS = [
  'opportunity_trends',
  'source_roi',
  'escalation_summary',
  'competitor_intel',
  'operational_health',
  'sla_report',
  'governance_audit',
] as const;
export type ReportKind = (typeof REPORT_KINDS)[number];

export const REPORT_EXECUTION_STATUSES = [
  'queued',
  'processing',
  'complete',
  'failed',
  'cancelled',
] as const;
export type ReportExecutionStatus = (typeof REPORT_EXECUTION_STATUSES)[number];

export const REPORT_MAX_INLINE_BYTES = 262144;

export type ReportDefinition = {
  id: string;
  organization_id: string;
  report_kind: ReportKind;
  name: string;
  description: string | null;
  filter_payload: Record<string, unknown>;
  schedule_cron: string | null;
  enabled: boolean;
  owner_user_id: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};

export type ReportExecution = {
  id: string;
  organization_id: string;
  report_definition_id: string | null;
  report_kind: ReportKind;
  status: ReportExecutionStatus;
  payload_inline: Record<string, unknown> | null;
  filter_payload: Record<string, unknown>;
  row_count: number | null;
  byte_size: number | null;
  failure_reason: string | null;
  requested_by: string | null;
  completed_at: string | null;
  created_at: string;
};
