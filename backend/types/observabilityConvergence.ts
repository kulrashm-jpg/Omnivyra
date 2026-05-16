export const OBSERVABILITY_PROJECTION_KINDS = [
  'runtime',
  'rollout',
  'sla',
  'semantic',
  'replay',
  'safeguards',
  'governance',
  'unified',
] as const;
export type ObservabilityProjectionKind = (typeof OBSERVABILITY_PROJECTION_KINDS)[number];

export const OBSERVABILITY_UNIFIED_HEALTH_STATES = ['healthy', 'degraded', 'critical', 'unknown'] as const;
export type ObservabilityUnifiedHealthState = (typeof OBSERVABILITY_UNIFIED_HEALTH_STATES)[number];

export const OBSERVABILITY_DEFAULT_WINDOW_HOURS = 24;
export const OBSERVABILITY_MAX_WINDOW_HOURS = 24 * 30;

export type ConvergenceTimelinePoint = {
  bucket: string;
  state: ObservabilityUnifiedHealthState;
  detail: string;
};

export type ResilienceOverlay = {
  overlay_kind: string;
  severity: 'info' | 'warn' | 'critical';
  detail: string;
};

export type ObservabilityConvergenceProjection = {
  id: string;
  organization_id: string;
  projection_kind: ObservabilityProjectionKind;
  unified_health_state: ObservabilityUnifiedHealthState;
  timeline: ConvergenceTimelinePoint[];
  drift_detected: boolean;
  resilience_overlays: ResilienceOverlay[];
  derivation_explanation: string | null;
  bounded_window_start: string;
  bounded_window_end: string;
  generated_by: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
};
