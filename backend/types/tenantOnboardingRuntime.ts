export const TENANT_ONBOARDING_RUNTIME_STAGES = [
  'workspace_setup',
  'rbac_verification',
  'governance_verification',
  'connector_readiness',
  'semantic_readiness',
  'retention_setup',
  'final_acknowledgement',
] as const;
export type TenantOnboardingRuntimeStageKind = (typeof TENANT_ONBOARDING_RUNTIME_STAGES)[number];

export const TENANT_ONBOARDING_RUNTIME_STATUSES = [
  'pending',
  'in_progress',
  'blocked',
  'complete',
  'skipped',
] as const;
export type TenantOnboardingRuntimeStatus = (typeof TENANT_ONBOARDING_RUNTIME_STATUSES)[number];

export type TenantOnboardingRuntimeStage = {
  id: string;
  organization_id: string;
  stage_kind: TenantOnboardingRuntimeStageKind;
  status: TenantOnboardingRuntimeStatus;
  readiness_score: number;
  evidence: Record<string, unknown>;
  progression_explanation: string | null;
  acknowledged_by: string | null;
  acknowledged_at: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};
