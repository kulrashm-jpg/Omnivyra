export const SAFETY_RAIL_KINDS = [
  'execution_safety',
  'replay_safety',
  'semantic_indexing_safety',
  'connector_degradation',
  'rollout_freeze',
  'runtime_overload',
  'operator_ack_gate',
] as const;
export type SafetyRailKind = (typeof SAFETY_RAIL_KINDS)[number];

export const SAFETY_RAIL_STATES = ['green', 'warn', 'triggered', 'overridden', 'frozen', 'disabled'] as const;
export type SafetyRailState = (typeof SAFETY_RAIL_STATES)[number];

export const SAFETY_RAIL_EVENT_KINDS = [
  'threshold_triggered',
  'override_applied',
  'acknowledged',
  'frozen',
  'recovered',
  're_armed',
  'disabled',
] as const;
export type SafetyRailEventKind = (typeof SAFETY_RAIL_EVENT_KINDS)[number];

export const SAFETY_RAIL_DEFAULT_THRESHOLDS: Record<SafetyRailKind, number> = {
  execution_safety: 25,
  replay_safety: 100,
  semantic_indexing_safety: 200,
  connector_degradation: 0.25,
  rollout_freeze: 1,
  runtime_overload: 300,
  operator_ack_gate: 1,
};

export type OperationalSafetyRail = {
  id: string;
  organization_id: string;
  rail_kind: SafetyRailKind;
  state: SafetyRailState;
  threshold_value: number;
  observed_value: number;
  acknowledgement_required: boolean;
  acknowledged_by: string | null;
  acknowledged_at: string | null;
  override_rationale: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};

export type OperationalSafetyRailEvent = {
  id: string;
  organization_id: string;
  rail_id: string;
  event_kind: SafetyRailEventKind;
  previous_state: SafetyRailState | null;
  new_state: SafetyRailState;
  observed_value: number;
  threshold_value: number;
  actor_user_id: string | null;
  rationale: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
};
