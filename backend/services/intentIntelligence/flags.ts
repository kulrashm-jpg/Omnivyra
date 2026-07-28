/**
 * Intent Understanding rollout flags — BOTH DEFAULT OFF (shadow-only). Mirrors the Lead/Company/
 * Offering/Visitor/Journey flag convention; consumed by nothing in production until an operator flips
 * them.
 */
export function isIntentUnderstandingEnabled(): boolean {
  return process.env.INTENT_UNDERSTANDING_ENABLED === 'true';
}
export function isIntentProjectionAuthoritative(): boolean {
  return process.env.INTENT_UNDERSTANDING_AUTHORITATIVE === 'true';
}
