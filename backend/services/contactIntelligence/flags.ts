/**
 * Contact Understanding rollout flags — BOTH DEFAULT OFF (shadow-only). Mirrors the Lead/Company/
 * Offering/Visitor/Journey/Intent/Qualification flag convention; consumed by nothing in production
 * until an operator flips them.
 */
export function isContactUnderstandingEnabled(): boolean {
  return process.env.CONTACT_UNDERSTANDING_ENABLED === 'true';
}
export function isContactProjectionAuthoritative(): boolean {
  return process.env.CONTACT_UNDERSTANDING_AUTHORITATIVE === 'true';
}
