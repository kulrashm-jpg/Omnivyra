export const GOVERNANCE_CONVERGENCE_SCOPES = [
  'overall',
  'rollout',
  'safeguards',
  'sla',
  'resilience',
  'operational_risk',
  'governance_drift',
] as const;
export type GovernanceConvergenceScope = (typeof GOVERNANCE_CONVERGENCE_SCOPES)[number];

export type ConvergenceComponent = {
  component_kind: string;
  weight: number;
  observed_score: number;
  passed: boolean;
  detail: string;
};

export type RiskOverlay = {
  overlay_kind: string;
  severity: 'info' | 'warn' | 'critical';
  detail: string;
};

export type GovernanceConvergenceScore = {
  id: string;
  organization_id: string;
  scope_kind: GovernanceConvergenceScope;
  convergence_score: number;
  drift_score: number;
  risk_overlays: RiskOverlay[];
  contributing_components: ConvergenceComponent[];
  derivation_explanation: string | null;
  generated_by: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
};
