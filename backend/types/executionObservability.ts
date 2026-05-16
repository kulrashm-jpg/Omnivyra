export const TRACE_KINDS = [
  'execution',
  'projection',
  'moderation',
  'rate_limit',
  'connector_health',
  'source_health',
] as const;
export type TraceKind = (typeof TRACE_KINDS)[number];

export const TRACE_STATUSES = ['ok', 'warn', 'error'] as const;
export type TraceStatus = (typeof TRACE_STATUSES)[number];

export type ExecutionObservabilityRecord = {
  id: string;
  organization_id: string;
  listening_execution_id: string | null;
  trace_kind: TraceKind;
  stage: string;
  status: TraceStatus;
  duration_ms: number | null;
  payload: Record<string, unknown>;
  created_at: string;
};
