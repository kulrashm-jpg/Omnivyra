export const SAFEGUARD_KINDS = [
  'execution_circuit_breaker',
  'connector_degradation',
  'queue_congestion',
  'semantic_overload',
  'replay_overload',
  'operational_freeze',
] as const;
export type SafeguardKind = (typeof SAFEGUARD_KINDS)[number];

export const SAFEGUARD_STATES = ['armed', 'tripped', 'recovering', 'overridden', 'disabled'] as const;
export type SafeguardState = (typeof SAFEGUARD_STATES)[number];

export const SAFEGUARD_TRIGGER_KINDS = ['tripped', 'overridden', 'recovered', 'disabled', 're_armed'] as const;
export type SafeguardTriggerKind = (typeof SAFEGUARD_TRIGGER_KINDS)[number];

export const SAFEGUARD_DEFAULT_THRESHOLDS: Record<SafeguardKind, number> = {
  execution_circuit_breaker: 10,
  connector_degradation: 0.25,
  queue_congestion: 200,
  semantic_overload: 100,
  replay_overload: 50,
  operational_freeze: 1,
};

export type ProductionSafeguardState = {
  id: string;
  organization_id: string;
  safeguard_kind: SafeguardKind;
  state: SafeguardState;
  threshold_value: number;
  observed_value: number;
  triggered_at: string | null;
  recovered_at: string | null;
  last_override_by: string | null;
  last_override_at: string | null;
  rationale: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};

export type ProductionSafeguardTrigger = {
  id: string;
  organization_id: string;
  safeguard_state_id: string;
  trigger_kind: SafeguardTriggerKind;
  observed_value: number;
  threshold_value: number;
  acted_by: string | null;
  rationale: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
};
