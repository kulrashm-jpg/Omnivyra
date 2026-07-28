/**
 * Qualification Understanding rollout flags — BOTH DEFAULT OFF (shadow-only). Mirrors the Lead/Company/
 * Offering/Visitor/Journey/Intent flag convention; consumed by nothing in production until an operator
 * flips them.
 */
export function isQualificationUnderstandingEnabled(): boolean {
  return process.env.QUALIFICATION_UNDERSTANDING_ENABLED === 'true';
}
export function isQualificationProjectionAuthoritative(): boolean {
  return process.env.QUALIFICATION_UNDERSTANDING_AUTHORITATIVE === 'true';
}
