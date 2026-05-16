export const ONBOARDING_TEMPLATE_KINDS = [
  'industry_preset',
  'source_recommendation',
  'governance_baseline',
  'connector_activation',
  'rbac_starter',
  'retention_preset',
] as const;
export type OnboardingTemplateKind = (typeof ONBOARDING_TEMPLATE_KINDS)[number];

export const ONBOARDING_APPLICATION_STATUSES = [
  'previewed',
  'approved',
  'applied',
  'rolled_back',
  'failed',
  'cancelled',
] as const;
export type OnboardingApplicationStatus = (typeof ONBOARDING_APPLICATION_STATUSES)[number];

export type EnterpriseOnboardingTemplate = {
  id: string;
  organization_id: string | null;
  template_kind: OnboardingTemplateKind;
  name: string;
  industry: string | null;
  description: string | null;
  payload: Record<string, unknown>;
  recommended_explanation: string | null;
  shared: boolean;
  owner_user_id: string | null;
  created_at: string;
  updated_at: string;
};

export type EnterpriseOnboardingApplication = {
  id: string;
  organization_id: string;
  template_id: string | null;
  template_kind: OnboardingTemplateKind;
  status: OnboardingApplicationStatus;
  approved_by: string | null;
  approved_at: string | null;
  applied_at: string | null;
  preview_payload: Record<string, unknown>;
  applied_payload: Record<string, unknown>;
  failure_reason: string | null;
  metadata: Record<string, unknown>;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};
