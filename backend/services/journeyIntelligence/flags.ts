/**
 * Journey Understanding rollout flags — BOTH DEFAULT OFF (shadow-only). Mirrors the Lead/Company/
 * Offering/Visitor flag convention; consumed by nothing in production until an operator flips them.
 */
export function isJourneyUnderstandingEnabled(): boolean {
  return process.env.JOURNEY_UNDERSTANDING_ENABLED === 'true';
}
export function isJourneyProjectionAuthoritative(): boolean {
  return process.env.JOURNEY_UNDERSTANDING_AUTHORITATIVE === 'true';
}
