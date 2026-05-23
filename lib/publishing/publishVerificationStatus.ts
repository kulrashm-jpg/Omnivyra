// Advisory Verification Status Model
//
// Deterministic, advisory-only verification statuses for shadow snapshot
// verification. These statuses describe verification outcomes — they NEVER
// gate runtime, block publishing, or mutate anything.

export type PublishVerificationStatus =
  | 'verification_clean'
  | 'verification_warning'
  | 'verification_risk'
  | 'verification_invalid';

export type PublishVerificationSeverity = 'clean' | 'warning' | 'risk' | 'invalid';

export const PUBLISH_VERIFICATION_STATUSES: readonly PublishVerificationStatus[] = [
  'verification_clean',
  'verification_warning',
  'verification_risk',
  'verification_invalid',
];

export interface PublishVerificationFinding {
  code: string;
  severity: PublishVerificationSeverity;
  message: string;
}

const SEVERITY_TO_STATUS: Record<PublishVerificationSeverity, PublishVerificationStatus> = {
  clean: 'verification_clean',
  warning: 'verification_warning',
  risk: 'verification_risk',
  invalid: 'verification_invalid',
};

const STATUS_RANK: Record<PublishVerificationStatus, number> = {
  verification_clean: 0,
  verification_warning: 1,
  verification_risk: 2,
  verification_invalid: 3,
};

export function rankVerificationStatus(status: PublishVerificationStatus): number {
  return STATUS_RANK[status];
}

export function isCleanVerificationStatus(status: PublishVerificationStatus): boolean {
  return status === 'verification_clean';
}

// Worst-severity-wins aggregation across a finding set.
export function deriveVerificationStatus(
  findings: readonly PublishVerificationFinding[],
): PublishVerificationStatus {
  let status: PublishVerificationStatus = 'verification_clean';
  for (const finding of findings) {
    const candidate = SEVERITY_TO_STATUS[finding.severity];
    if (STATUS_RANK[candidate] > STATUS_RANK[status]) status = candidate;
  }
  return status;
}

// Worst-severity-wins aggregation across multiple statuses.
export function worstVerificationStatus(
  statuses: readonly PublishVerificationStatus[],
): PublishVerificationStatus {
  let status: PublishVerificationStatus = 'verification_clean';
  for (const candidate of statuses) {
    if (STATUS_RANK[candidate] > STATUS_RANK[status]) status = candidate;
  }
  return status;
}
