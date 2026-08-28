/**
 * BLOCK-3 — who owns the persisted planner session.
 *
 * ── The finding ────────────────────────────────────────────────────────────
 * The store kept ONE localStorage slot per company,
 * `omnivyra_planner_session_<companyId>`, and both the restore (on mount) and
 * the persist (on every state change) were UNCONDITIONAL — only the
 * server-draft bootstrap and the autosave consulted `serverDraft.enabled`.
 * Every entry mode therefore shared that slot, including the explicit
 * `?campaignId=` entry, which opens a DIFFERENT entity from the one the slot
 * describes.
 *
 * Proven in both directions (plannerSessionScoping.dom.test.tsx): opening a
 * campaign inherited the open draft's spine, strategy and assignments, and
 * then wrote its own state back over that draft's cache. BLOCK-2 made this
 * routine, because finalize now lands on a bookmarkable
 * `/campaign-planner?campaignId=<id>&tab=board`.
 *
 * ── Why the company-scoped key is nonetheless CORRECT for the draft ────────
 * The snapshot belongs to the DRAFT, and a draft is 1:1 with (company, user)
 * by construction: `/api/campaigns/planner-draft` resumes the newest open
 * `status='draft'` row for that pair rather than forking a second one, so
 * direct mode cannot produce two concurrent drafts for one company. The
 * company slot therefore describes exactly one draft — and the draft id does
 * not exist yet at first-entry restore, so keying on it is impossible for the
 * one path that needs the cache most.
 *
 * Re-keying to `<draftId>` would trade a real defect for a worse one. The
 * defect is not the company scope; it is that a NON-draft entry shares it.
 *
 * ── The model ──────────────────────────────────────────────────────────────
 * Two identities, and each path uses the one it actually has at mount:
 *
 *   direct / recommendation / opportunity / turbo → the session IS the draft.
 *       Company-scoped slot. The draft id is unknown at restore; the company
 *       id is not.
 *
 *   explicit `?campaignId=` → the session is a VIEW of a server-owned
 *       campaign. No local slot at all. Its canonical state lives in
 *       `campaign_versions` and is hydrated by PlanLoader via retrieve-plan,
 *       and the draft autosave seam is disabled in this mode anyway — so
 *       local edits were never reaching the server. Caching them under the
 *       draft's key was not a benefit that is being removed; it was the
 *       contamination.
 *
 * This preserves SPEC-001 I-2 (browser storage is CACHE ONLY, never
 * canonical): dropping a cache can never lose canonical state.
 *
 * Pure and deterministic: same inputs → same key. No I/O.
 */

export const PLANNER_STORAGE_KEY_PREFIX = 'omnivyra_planner_session_';

/**
 * The localStorage slot for this planner entry, or `null` when the entry must
 * not use one.
 *
 * `null` means: do not restore, and do not persist. It does NOT mean "wipe" —
 * a caller switching to a null key keeps whatever it already has in memory,
 * which is what makes BLOCK-2's post-finalize handoff work: the planner moves
 * from `?mode=direct` to `?campaignId=<the campaign just finalized>` in the
 * same mounted tree, and the session it just built stays intact.
 */
export function resolvePlannerStorageKey(input: {
  companyId?: string | null;
  /** Present only for an explicit existing-campaign entry (`?campaignId=`). */
  campaignId?: string | null;
}): string | null {
  const campaignId = typeof input.campaignId === 'string' ? input.campaignId.trim() : '';
  if (campaignId) {
    // An existing campaign is server-owned. It has no business reading or
    // writing the draft's cache.
    return null;
  }
  const companyId = typeof input.companyId === 'string' && input.companyId.trim()
    ? input.companyId.trim()
    : 'default';
  return `${PLANNER_STORAGE_KEY_PREFIX}${companyId}`;
}

/** True when this entry owns the company's draft slot. */
export function plannerEntryOwnsDraftCache(input: {
  companyId?: string | null;
  campaignId?: string | null;
}): boolean {
  return resolvePlannerStorageKey(input) !== null;
}
