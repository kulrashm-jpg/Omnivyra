export const RESILIENCE_VALIDATION_KINDS = [
  'replay_integrity',
  'semantic_consistency',
  'projection_consistency',
  'partition_health',
  'connector_resilience',
  'failover_readiness',
] as const;
export type ResilienceValidationKind = (typeof RESILIENCE_VALIDATION_KINDS)[number];

export const RESILIENCE_VALIDATION_STATUSES = ['complete', 'partial', 'failed', 'cancelled'] as const;
export type ResilienceValidationStatus = (typeof RESILIENCE_VALIDATION_STATUSES)[number];

export const RESILIENCE_DEFAULT_LOOKBACK_HOURS = 24 as const;

export type ResilienceObservedResult = {
  check_kind: string;
  passed: boolean;
  observed_value: number | string | null;
  expected_value: number | string | null;
  detail: string;
};

export type ResilienceValidationRun = {
  id: string;
  organization_id: string;
  validation_kind: ResilienceValidationKind;
  status: ResilienceValidationStatus;
  observed_results: ResilienceObservedResult[];
  failure_explanation: string | null;
  bounded_window_start: string;
  bounded_window_end: string;
  initiated_by: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
};
