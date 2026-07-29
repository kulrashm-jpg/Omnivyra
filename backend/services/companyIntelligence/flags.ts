/**
 * Company Understanding rollout flags — BOTH DEFAULT OFF (shadow-only). Flag keys are continuous
 * with the certified COMPANY-PROFILE-ONTOLOGY-001 work (`company-understanding` /
 * `company-understanding-authoritative`) so adoption does not introduce a new flag namespace.
 */

export function isCompanyUnderstandingEnabled(): boolean {
  return process.env.COMPANY_UNDERSTANDING_ENABLED === 'true';
}
export function isCompanyProjectionAuthoritative(): boolean {
  return process.env.COMPANY_UNDERSTANDING_AUTHORITATIVE === 'true';
}
