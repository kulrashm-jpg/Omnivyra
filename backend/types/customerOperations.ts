export const CUSTOMER_OPS_SCORE_KINDS = [
  'tenant_readiness',
  'rollout_cohort',
  'onboarding_completion',
  'operational_maturity',
  'tenant_health',
  'support_escalation_readiness',
] as const;
export type CustomerOpsScoreKind = (typeof CUSTOMER_OPS_SCORE_KINDS)[number];

export type CustomerOpsComponent = {
  component_kind: string;
  weight: number;
  observed_score: number;
  passed: boolean;
  detail: string;
};

export type CustomerOperationsScore = {
  id: string;
  organization_id: string;
  score_kind: CustomerOpsScoreKind;
  score_value: number;
  components: CustomerOpsComponent[];
  rationale: string | null;
  generated_by: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
};
