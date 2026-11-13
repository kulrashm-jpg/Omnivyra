/**
 * Field provenance for company profiles (product ruling via e9, 2026-11-13):
 * a user's MANUAL edit is never overwritten by AI refine or by OLDER approved guidance.
 *
 * Existing mechanism, reused: company_profiles.user_locked_fields = "the user edited this field".
 * Added (no migration, same JSON):
 *   - report_settings.field_edited_at = { [field]: ISO time } - WHEN the user last changed a locked field, so a
 *     guidance approval NEWER than the edit can still apply (approval is user intent too).
 *   - nested lock keys such as 'market_pulse.solution_domains' for fields that live inside report_settings.
 *
 * `valuesDiffer` compares by CONTENT (stable JSON, empty == empty), so re-saving an unchanged list or object does
 * not re-stamp it. e1's D2 ("did the user actually delete something") reuses it.
 */

/** Nested lock key for the Market Pulse solution domains a user can edit (refine writes the AI value otherwise). */
export const MARKET_PULSE_SOLUTION_DOMAINS_LOCK = 'market_pulse.solution_domains';

function isEmpty(v: unknown): boolean {
  if (v === undefined || v === null) return true;
  if (typeof v === 'string') return v.trim() === '';
  if (Array.isArray(v)) return v.length === 0;
  if (typeof v === 'object') return Object.keys(v as object).length === 0;
  return false;
}

/**
 * Canonical JSON: object keys sorted (recursively); strings trimmed; arrays keep their order. Empty array elements
 * and empty object values are DROPPED at every depth (05 review 2026-11-13): a blank row added then removed, or an
 * `undefined` slot, is not an edit. Where "same" vs "differ" is ambiguous this errs toward SAME, because a spurious
 * stamp silently blocks currently-approved guidance for that field.
 */
function canonical(v: unknown): unknown {
  if (Array.isArray(v)) return v.filter((x) => !isEmpty(x)).map(canonical);
  if (v && typeof v === 'object') {
    return Object.keys(v as Record<string, unknown>).sort().reduce<Record<string, unknown>>((acc, k) => {
      const child = (v as Record<string, unknown>)[k];
      if (!isEmpty(child)) acc[k] = canonical(child);
      return acc;
    }, {});
  }
  if (typeof v === 'string') return v.trim();
  return v;
}

/** True when `a` and `b` differ by CONTENT. All empties (null, undefined, '', [], {}) are equal to each other. */
export function valuesDiffer(a: unknown, b: unknown): boolean {
  const norm = (v: unknown) => { const c = canonical(v); return isEmpty(c) ? null : c; };
  return JSON.stringify(norm(a)) !== JSON.stringify(norm(b));
}

/**
 * Whether approved/edited strategic guidance may write `field`:
 *  - field not user-locked                        -> yes (it is empty or AI-sourced)
 *  - locked, guidance updated AFTER the edit time -> yes (newer user intent)
 *  - locked, no edit time recorded (legacy lock)  -> NO  (the manual edit wins)
 *  - locked, guidance older or same as the edit   -> NO
 *
 * BOTH clocks are load-bearing and MUST be server-generated: `fieldEditedAt` is stamped by saveProfile (nowIso), and
 * `guidanceUpdatedAt` (user_guidance.messaging[section].updated_at) is assigned by normalizeUserGuidedIntelligence,
 * which never reads a client-supplied value. A new guidance-write path must do the same: a forward-dated client
 * timestamp would let guidance beat every manual edit with no error anywhere.
 */
export function guidanceMayOverwrite(
  field: string,
  guidanceUpdatedAt: string | null | undefined,
  lockedFields: ReadonlyArray<string> | null | undefined,
  fieldEditedAt: Readonly<Record<string, string>> | null | undefined,
): boolean {
  if (!(lockedFields ?? []).includes(field)) return true;
  const editedAt = fieldEditedAt?.[field];
  if (!editedAt || !guidanceUpdatedAt) return false;
  const g = Date.parse(guidanceUpdatedAt);
  const e = Date.parse(editedAt);
  if (!Number.isFinite(g) || !Number.isFinite(e)) return false;
  return g > e;
}

/**
 * Edit-time stamps for one USER save: every key in `lockedKeysThisSave` whose value CHANGED by content gets `nowIso`;
 * unchanged keys keep their previous stamp. `changed` = at least one stamp was written.
 */
export function computeEditStamps(params: {
  lockedKeysThisSave: ReadonlyArray<string>;
  next: (key: string) => unknown;
  prev: (key: string) => unknown;
  prevEditedAt: Readonly<Record<string, string>> | null | undefined;
  nowIso: string;
}): { editedAt: Record<string, string>; changed: boolean } {
  const editedAt: Record<string, string> = { ...(params.prevEditedAt ?? {}) };
  let changed = false;
  for (const key of params.lockedKeysThisSave) {
    if (valuesDiffer(params.next(key), params.prev(key))) { editedAt[key] = params.nowIso; changed = true; }
  }
  return { editedAt, changed };
}

/**
 * A USER save that actually changes Market Pulse solution domains locks them against refine. Deliberately EMPTYING
 * the list is a change too (05 review 2026-11-13): deletion is the strongest input a user gives, not "no input".
 */
export function shouldLockMarketPulseDomains(source: string, nextDomains: unknown, prevDomains: unknown): boolean {
  return source === 'user' && Array.isArray(nextDomains) && valuesDiffer(nextDomains, prevDomains);
}

/** Refine's solution_domains: a user-locked value is kept (an emptied list included); otherwise the AI classification. */
export function resolveRefinedSolutionDomains(
  locked: ReadonlySet<string>,
  userDomains: string[] | null | undefined,
  aiDomains: string[] | null | undefined,
): string[] | null | undefined {
  if (locked.has(MARKET_PULSE_SOLUTION_DOMAINS_LOCK) && Array.isArray(userDomains)) return userDomains;
  return aiDomains;
}
