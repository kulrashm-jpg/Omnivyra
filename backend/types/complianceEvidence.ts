export const COMPLIANCE_EVIDENCE_KINDS = [
  'governance_traceability',
  'retention_audit',
  'replay_audit',
  'access_audit',
  'operational_change_log',
  'consent_log',
  'full_bundle',
] as const;
export type ComplianceEvidenceKind = (typeof COMPLIANCE_EVIDENCE_KINDS)[number];

export const COMPLIANCE_TARGETS = ['soc2', 'iso27001', 'generic'] as const;
export type ComplianceTarget = (typeof COMPLIANCE_TARGETS)[number];

export const COMPLIANCE_EXPORT_STATUSES = ['complete', 'partial', 'failed', 'cancelled'] as const;
export type ComplianceExportStatus = (typeof COMPLIANCE_EXPORT_STATUSES)[number];

export const COMPLIANCE_MAX_INLINE_BYTES = 524288;
export const COMPLIANCE_DEFAULT_LOOKBACK_DAYS = 90;

export type ComplianceEvidenceExport = {
  id: string;
  organization_id: string;
  evidence_kind: ComplianceEvidenceKind;
  certification_target: ComplianceTarget;
  window_start: string;
  window_end: string;
  row_count: number;
  byte_size: number;
  payload_inline: Record<string, unknown> | null;
  payload_hash: string;
  status: ComplianceExportStatus;
  failure_reason: string | null;
  generated_by: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
};
