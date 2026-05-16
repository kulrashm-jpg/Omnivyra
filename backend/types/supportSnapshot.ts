export const SUPPORT_SNAPSHOT_KINDS = [
  'support_bundle',
  'issue_reproduction',
  'tenant_diagnostic',
  'execution_replay_ref',
  'incident_bundle',
  'operational_trace',
] as const;
export type SupportSnapshotKind = (typeof SUPPORT_SNAPSHOT_KINDS)[number];

export const SUPPORT_SNAPSHOT_STATUSES = ['complete', 'partial', 'failed', 'cancelled'] as const;
export type SupportSnapshotStatus = (typeof SUPPORT_SNAPSHOT_STATUSES)[number];

export const SUPPORT_SNAPSHOT_MAX_INLINE_BYTES = 1024 * 1024;

export type SupportRedaction = {
  field_path: string;
  redaction_kind: 'masked' | 'omitted' | 'hashed';
  detail: string;
};

export type SupportSnapshot = {
  id: string;
  organization_id: string;
  snapshot_kind: SupportSnapshotKind;
  scope_description: string | null;
  payload_inline: Record<string, unknown> | null;
  payload_hash: string;
  row_count: number;
  byte_size: number;
  redaction_applied: SupportRedaction[];
  linked_incident_id: string | null;
  linked_replay_id: string | null;
  status: SupportSnapshotStatus;
  failure_reason: string | null;
  generated_by: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
};
