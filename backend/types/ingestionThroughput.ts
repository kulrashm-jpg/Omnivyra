export const THROUGHPUT_SCOPES = ['org', 'platform', 'source', 'connector'] as const;
export type ThroughputScope = (typeof THROUGHPUT_SCOPES)[number];

export type IngestionThroughputState = {
  id: string;
  organization_id: string;
  scope: ThroughputScope;
  bucket: string;
  window_start: string;
  window_end: string;
  consumed_count: number;
  consumed_credits: number;
  cap_count: number | null;
  cap_credits: number | null;
  burst_count: number | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};

// Default rolling-window length when callers omit it. Phase 8 uses 1-hour
// windows; tunable per-call via the service.
export const DEFAULT_THROUGHPUT_WINDOW_MS = 60 * 60 * 1000;

// Conservative per-org defaults — explicit caps override these via the
// caller's `policyCaps` argument.
export const DEFAULT_ORG_HOURLY_COUNT_CAP = 600;
export const DEFAULT_ORG_HOURLY_CREDIT_CAP = 5_000;
