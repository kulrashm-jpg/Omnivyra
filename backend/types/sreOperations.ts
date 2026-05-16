export const SRE_SNAPSHOT_KINDS = [
  'runtime_dependency_health',
  'queue_saturation',
  'projection_lag_heatmap',
  'semantic_backlog_heatmap',
  'replay_backlog',
  'connector_degradation_map',
] as const;
export type SreSnapshotKind = (typeof SRE_SNAPSHOT_KINDS)[number];

export const SRE_HEALTH_STATES = ['healthy', 'degraded', 'critical', 'unknown'] as const;
export type SreHealthState = (typeof SRE_HEALTH_STATES)[number];

export type HeatmapCell = {
  label: string;
  value: number;
  state: SreHealthState;
  note?: string;
};

export type SreHealthSnapshot = {
  id: string;
  organization_id: string;
  snapshot_kind: SreSnapshotKind;
  health_state: SreHealthState;
  measures: Record<string, number>;
  heatmap: HeatmapCell[];
  derivation_explanation: string | null;
  generated_by: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
};
