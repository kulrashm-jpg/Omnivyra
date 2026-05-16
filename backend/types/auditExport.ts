export const AUDIT_EXPORT_TYPES = [
  'lifecycle_history',
  'moderation_decisions',
  'escalations',
  'execution_traces',
  'identity_actions',
  'governance_history',
  'source_health_history',
] as const;
export type AuditExportType = (typeof AUDIT_EXPORT_TYPES)[number];

export const AUDIT_EXPORT_FORMATS = ['json', 'csv'] as const;
export type AuditExportFormat = (typeof AUDIT_EXPORT_FORMATS)[number];

export const AUDIT_EXPORT_STATUSES = ['queued', 'processing', 'complete', 'failed', 'cancelled'] as const;
export type AuditExportStatus = (typeof AUDIT_EXPORT_STATUSES)[number];

// Hard upper bound — Phase 7 keeps exports inline in the DB row to keep
// the storage surface tight. A future phase will swap to off-DB storage
// for larger exports.
export const AUDIT_EXPORT_MAX_ROWS = 5000 as const;

export type AuditExportJob = {
  id: string;
  organization_id: string;
  export_type: AuditExportType;
  format: AuditExportFormat;
  status: AuditExportStatus;
  filter_criteria: Record<string, unknown>;
  row_count: number | null;
  byte_size: number | null;
  storage_ref: string | null;
  payload_inline: Record<string, unknown> | null;
  failure_reason: string | null;
  requested_by: string | null;
  completed_at: string | null;
  created_at: string;
};
