/**
 * Phase B rollout flags — BOTH DEFAULT OFF. The canonical Lead Understanding platform runs in
 * SHADOW only until explicitly enabled; the authoritative flip is a separate, later gate.
 */

/** Shadow computation gate. Default OFF ⇒ `computeLeadUnderstandingShadow` returns null. */
export function isLeadUnderstandingEnabled(): boolean {
  return process.env.LEAD_UNDERSTANDING_ENABLED === 'true';
}

/** Authoritative projection gate. Default OFF ⇒ consumers keep reading the legacy read layer. */
export function isLeadProjectionAuthoritative(): boolean {
  return process.env.LEAD_UNDERSTANDING_AUTHORITATIVE === 'true';
}
