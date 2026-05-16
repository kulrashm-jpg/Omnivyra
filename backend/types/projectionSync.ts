export const PROJECTION_KINDS = [
  'opportunity_feed',
  'graph',
  'alerts',
  'clusters',
  'lifecycle',
] as const;
export type ProjectionKind = (typeof PROJECTION_KINDS)[number];

export const PROJECTION_PAYLOAD_VERSION = 1 as const;

export type ProjectionSyncState = {
  id: string;
  organization_id: string;
  projection_kind: ProjectionKind;
  cursor_position: string | null;
  last_replayed_at: string | null;
  last_synced_at: string | null;
  pending_retry_count: number;
  payload_version: number;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};

export const MAX_PROJECTION_RETRIES = 5 as const;
