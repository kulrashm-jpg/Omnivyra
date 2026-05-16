export const PRODUCTION_CERTIFICATION_KINDS = [
  'operational_readiness',
  'governance_readiness',
  'deployment_readiness',
  'sla_readiness',
  'resilience_certification',
  'audit_readiness',
] as const;
export type ProductionCertificationKind = (typeof PRODUCTION_CERTIFICATION_KINDS)[number];

export const PRODUCTION_CERTIFICATION_STATUSES = ['complete', 'partial', 'failed'] as const;
export type ProductionCertificationStatus = (typeof PRODUCTION_CERTIFICATION_STATUSES)[number];

export type CertificationComponent = {
  component_kind: string;
  weight: number;
  observed_score: number;
  passed: boolean;
  detail: string;
};

export type CertificationEvidenceRef = {
  source_kind: string;
  source_id: string;
  detail: string;
};

export type ProductionCertificationReport = {
  id: string;
  organization_id: string;
  certification_kind: ProductionCertificationKind;
  certification_score: number;
  components: CertificationComponent[];
  evidence_refs: CertificationEvidenceRef[];
  derivation_explanation: string | null;
  status: ProductionCertificationStatus;
  generated_by: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
};
