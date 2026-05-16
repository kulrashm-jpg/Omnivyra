export const SLA_KINDS = [
  'execution_latency',
  'projection_latency',
  'moderation_latency',
  'replay_recovery_latency',
  'realtime_delivery_latency',
  'connector_reliability',
] as const;
export type SlaKind = (typeof SLA_KINDS)[number];

export const SLA_SEVERITIES = ['warn', 'breach', 'critical'] as const;
export type SlaSeverity = (typeof SLA_SEVERITIES)[number];

// Default targets — deterministic, explainable, conservative. Tunable per-org
// via a future migration; Phase 8 ships the constants.
export const SLA_DEFAULT_THRESHOLDS: Record<SlaKind, { warn: number; breach: number; unit: 'ms' | 'pct' | 'percent_complete' }> = {
  execution_latency:        { warn: 60_000, breach: 180_000, unit: 'ms' },
  projection_latency:       { warn: 30_000, breach: 120_000, unit: 'ms' },
  moderation_latency:       { warn: 1_000, breach: 5_000, unit: 'ms' },
  replay_recovery_latency:  { warn: 600_000, breach: 3_600_000, unit: 'ms' },
  realtime_delivery_latency:{ warn: 5_000, breach: 30_000, unit: 'ms' },
  connector_reliability:    { warn: 0.95, breach: 0.85, unit: 'percent_complete' },
};

export type SlaBreach = {
  id: string;
  organization_id: string;
  sla_kind: SlaKind;
  severity: SlaSeverity;
  observed_value: number;
  threshold_value: number;
  window_start: string;
  window_end: string;
  rationale: string | null;
  acknowledged_at: string | null;
  acknowledged_by: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
};

export const SLA_DEFAULT_WINDOW_HOURS = 24;
