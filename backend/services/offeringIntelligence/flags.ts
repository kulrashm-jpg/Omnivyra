/**
 * Offering Understanding rollout flags — BOTH DEFAULT OFF (shadow-only). Flag keys continuous with
 * the certified OFFERING-UNDERSTANDING-001 work (`offering-understanding[/-authoritative]`).
 */

export function isOfferingUnderstandingEnabled(): boolean {
  return process.env.OFFERING_UNDERSTANDING_ENABLED === 'true';
}
export function isOfferingProjectionAuthoritative(): boolean {
  return process.env.OFFERING_UNDERSTANDING_AUTHORITATIVE === 'true';
}
