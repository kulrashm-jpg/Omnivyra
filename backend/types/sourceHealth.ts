export const SOURCE_HEALTH_STATES = ['healthy', 'degraded', 'unstable', 'silenced'] as const;
export type SourceHealthState = (typeof SOURCE_HEALTH_STATES)[number];

export type SourceHealthRecord = {
  id: string;
  organization_id: string;
  listening_source_id: string;
  health_state: SourceHealthState;
  rationale: string | null;
  inputs: Record<string, unknown>;
  computed_at: string;
};

// Deterministic thresholds. Tunable in a later phase against historical
// execution data; never self-tuned.
export const SOURCE_HEALTH_THRESHOLDS = {
  unhealthy_failure_rate: 0.5,
  unstable_failure_rate: 0.25,
  unstable_rate_limit_rate: 0.25,
  degraded_partial_rate: 0.25,
  degraded_moderation_rate: 0.4,
  silenced_zero_executions_days: 30,
} as const;
