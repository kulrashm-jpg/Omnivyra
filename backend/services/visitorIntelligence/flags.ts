/**
 * Visitor Understanding rollout flags — BOTH DEFAULT OFF (shadow-only). Mirrors the Lead/Company/
 * Offering flag convention; consumed by nothing in production until an operator flips them.
 */
export function isVisitorUnderstandingEnabled(): boolean {
  return process.env.VISITOR_UNDERSTANDING_ENABLED === 'true';
}
export function isVisitorProjectionAuthoritative(): boolean {
  return process.env.VISITOR_UNDERSTANDING_AUTHORITATIVE === 'true';
}
