export const RESILIENCE_ADVISORY_PLAN_KINDS = [
  'recovery',
  'replay',
  'stabilization',
  'rollback_preparation',
  'partition_recovery',
] as const;
export type ResilienceAdvisoryPlanKind = (typeof RESILIENCE_ADVISORY_PLAN_KINDS)[number];

export const RESILIENCE_ADVISORY_STATUSES = ['advisory', 'acknowledged', 'superseded', 'expired'] as const;
export type ResilienceAdvisoryStatus = (typeof RESILIENCE_ADVISORY_STATUSES)[number];

export const RESILIENCE_ADVISORY_DEFAULT_BATCH_SIZE = 100 as const;
export const RESILIENCE_ADVISORY_MAX_BATCH_SIZE = 10000 as const;

export type AdvisoryStep = {
  step_index: number;
  step_kind: string;
  detail: string;
  bounded_batch_size?: number;
  external_api_hint?: string;
};

export type AdvisoryEvidenceRef = {
  source_kind: string;
  source_id: string;
  detail: string;
};

export type ResilienceAdvisoryPlan = {
  id: string;
  organization_id: string;
  plan_kind: ResilienceAdvisoryPlanKind;
  trigger_summary: string;
  recommended_steps: AdvisoryStep[];
  bounded_batch_size: number;
  evidence_refs: AdvisoryEvidenceRef[];
  derivation_explanation: string | null;
  status: ResilienceAdvisoryStatus;
  acknowledged_by: string | null;
  acknowledged_at: string | null;
  generated_by: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};
