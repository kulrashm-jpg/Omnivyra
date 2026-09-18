/**
 * LinkedIn "pinned version is sunset" signal.
 *
 * WHY THIS EXISTS
 * ---------------
 * LinkedIn's REST API is versioned through the `LinkedIn-Version` header
 * (YYYYMM). When the pinned version passes its sunset date EVERY call fails at
 * once — publishing, media upload and reconciliation together. It is the only
 * LinkedIn failure with a single unambiguous operator fix (bump the pin), so it
 * must never be reported as something else.
 *
 * Both call sites previously detected it by HTTP status 426 alone. The
 * 2026-09-16 outage did not present that way: the recorded signal was the body
 * message "Requested version 20250701 is not active" (see the incident note in
 * backend/tests/unit/linkedinApiVersionFreshness.test.ts and the comments on
 * LINKEDIN_API_VERSION in linkedinAdapter.ts / linkedinMediaUpload.ts). With a
 * status-only check that message fell through to the generic handler — in the
 * adapter it became LINKEDIN_API_ERROR, and in reconciliation it was captured
 * by the earlier 401/403 branch and reported as an AUTH problem, sending the
 * operator to reconnect accounts when no credential was wrong at all.
 *
 * This predicate is deliberately narrow: it matches only an explicit statement
 * that a requested/numbered API version is not active, so it cannot swallow
 * unrelated 4xx responses.
 */

/**
 * True when a LinkedIn error payload says the requested API version is not
 * active. Accepts the raw body text or an already-extracted message.
 */
export function isLinkedInVersionSunsetSignal(message: unknown): boolean {
  const text = String(message ?? '');
  if (!text) return false;
  // "Requested version 20250701 is not active"
  if (/requested\s+version\b[^\n]{0,80}?\bis\s+not\s+active/i.test(text)) return true;
  // Defensive variant: "version 202507 is not active" / "API version ... not active"
  if (/\bversion\s+\d{6,8}\b[^\n]{0,40}?\bnot\s+active/i.test(text)) return true;
  return false;
}
