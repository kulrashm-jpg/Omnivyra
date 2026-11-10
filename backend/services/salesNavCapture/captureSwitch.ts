/**
 * The Sales Navigator EXTENSION capture switch. Owner decision P-1, 2026-11-10.
 *
 * A CODE CONSTANT, NOT AN ENVIRONMENT FLAG, ON PURPOSE. It follows the R-3
 * precedent (`extensionIngestionSuspension.ts`): capturing Sales Navigator
 * pages through a browser extension conflicts with recorded positions —
 * R-3/F-1, D22-B4 §4 and the LinkedIn User Agreement quoted in
 * `WP8_LINKEDIN_FEASIBILITY_DECISION.md`. Turning it on therefore needs:
 *
 *   1. the owner's WRITTEN acceptance of the LinkedIn-terms risk (F-1), and
 *   2. confirmation, from owner-provided redacted page captures, that the
 *      `lead_key` the extension extracts is stable across two lists, a search
 *      and a second seat (the key is PROVISIONAL until then), and
 *   3. a reviewed code change flipping this value.
 *
 * An environment variable would let a deploy setting do what only a reviewed
 * change may do. This module does NOT touch the R-3 constant; the two are
 * independent switches over independent surfaces.
 */
export const SALESNAV_EXTENSION_CAPTURE_ENABLED: boolean = false;

/**
 * `lead_key` stability is unverified (contract agreed with Outreach, 2026-11-10).
 * Carried in every response so neither side can forget it.
 */
export const SALESNAV_LEAD_KEY_PROVISIONAL: boolean = true;
