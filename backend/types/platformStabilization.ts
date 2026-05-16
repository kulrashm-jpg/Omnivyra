export const STABILIZATION_FREEZE_MODES = ['soft', 'hard', 'emergency_pause', 'degradation_only'] as const;
export type StabilizationFreezeMode = (typeof STABILIZATION_FREEZE_MODES)[number];

export const STABILIZATION_FREEZE_SCOPES = [
  'platform',
  'rollouts',
  'migrations',
  'semantic',
  'replay',
  'connectors',
  'executions',
] as const;
export type StabilizationFreezeScope = (typeof STABILIZATION_FREEZE_SCOPES)[number];

export const STABILIZATION_WINDOW_STATES = ['planned', 'active', 'closed', 'cancelled', 'expired'] as const;
export type StabilizationWindowState = (typeof STABILIZATION_WINDOW_STATES)[number];

export const STABILIZATION_EVENT_KINDS = [
  'planned',
  'activated',
  'extended',
  'closed',
  'cancelled',
  'expired',
  'freeze_applied',
  'freeze_released',
] as const;
export type StabilizationEventKind = (typeof STABILIZATION_EVENT_KINDS)[number];

export type PlatformStabilizationWindow = {
  id: string;
  organization_id: string;
  window_name: string;
  freeze_mode: StabilizationFreezeMode;
  freeze_scope: StabilizationFreezeScope;
  state: StabilizationWindowState;
  scheduled_start: string;
  scheduled_end: string;
  activated_at: string | null;
  closed_at: string | null;
  activated_by: string | null;
  closed_by: string | null;
  rationale: string | null;
  bounded_scope: string[];
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};

export type PlatformStabilizationEvent = {
  id: string;
  organization_id: string;
  window_id: string;
  event_kind: StabilizationEventKind;
  previous_state: StabilizationWindowState | null;
  new_state: StabilizationWindowState;
  actor_user_id: string | null;
  rationale: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
};
