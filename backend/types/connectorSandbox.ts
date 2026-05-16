export const SANDBOX_EXECUTION_STATUSES = [
  'queued',
  'running',
  'complete',
  'failed',
  'quota_exceeded',
  'timed_out',
  'cancelled',
] as const;
export type SandboxExecutionStatus = (typeof SANDBOX_EXECUTION_STATUSES)[number];

export const SANDBOX_MAX_EXECUTION_SECONDS = 600 as const;
export const SANDBOX_DEFAULT_EXECUTION_SECONDS = 60 as const;
export const SANDBOX_DEFAULT_INGESTION_CEILING = 500 as const;
export const SANDBOX_DEFAULT_COST_CEILING = 1000 as const;

export type ConnectorSandboxPolicy = {
  id: string;
  organization_id: string;
  marketplace_connector_id: string;
  capability_restrictions: string[];
  max_execution_seconds: number;
  max_ingestion_items: number;
  max_cost_units: number;
  network_allowlist: string[];
  metadata: Record<string, unknown>;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
};

export type SandboxEnforcementDecision = {
  rule: string;
  observed: number;
  ceiling: number;
  passed: boolean;
  note: string;
};

export type ConnectorSandboxExecution = {
  id: string;
  organization_id: string;
  marketplace_connector_id: string;
  capability_invoked: string;
  status: SandboxExecutionStatus;
  duration_ms: number | null;
  items_ingested: number;
  cost_units: number;
  enforcement_decisions: SandboxEnforcementDecision[];
  initiated_by: string | null;
  started_at: string | null;
  completed_at: string | null;
  failure_reason: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
};
