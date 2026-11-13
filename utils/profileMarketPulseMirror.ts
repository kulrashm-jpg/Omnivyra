/**
 * Company-profile ↔ Market Pulse mirrors (UI step 6.4; approved field-merge plan S3/S6,
 * 05 PASS, 55's conditions):
 *
 * - S3 "What you offer": one list. It is written to products_services_list +
 *   products_services, AND mirrored into report_settings.market_pulse.core_offerings
 *   (the Market Pulse engine reads only that).
 * - S6 "Growth priorities": the text column stays canonical (a STRING, read as text by
 *   marketPulseIntelligenceService); only market_pulse.growth_priorities (string[]) is
 *   mirrored.
 *
 * 55's mirror conditions:
 *   1. The mirrors stay string[] of SHORT terms: one phrase per item, no paragraphs.
 *   2. Case-insensitive de-dupe, EXISTING Market-Pulse entries FIRST, then new profile
 *      items. Only the first 8 are sent to the AI prompt; all are used for scoring.
 *   3. profile.growth_priorities stays a string.
 * 05's points: the paragraph filter keys on length (primary), or a line break, or 2+
 * sentence terminators followed by a space + capital (a single "Dr." / "U.S." is fine).
 * Items held back are disclosed in the UI, never silently dropped. The profile stores
 * keep EVERY non-empty value; the mirror is a filtered projection.
 */
import { splitToList } from '../pages/company-profile.types';

/** Only the first N mirrored items are sent to the AI prompt (55); all are used for scoring. */
export const MARKET_PULSE_AI_CAP = 8;
/** Longest item mirrored into Market Pulse. Near real data (a 79-char offering exists): disclose, don't hide. */
export const MIRROR_MAX_CHARS = 80;

const key = (s: string) => s.trim().toLowerCase();

/** Case-insensitive de-dupe; keeps the first spelling seen; drops blanks. */
export function dedupe(items: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of items) {
    const item = String(raw ?? '').trim();
    if (!item) continue;
    const k = key(item);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(item);
  }
  return out;
}

/** Why an item can't be mirrored into Market Pulse (null = it can). */
export function mirrorBlockReason(item: string): 'too_long' | 'paragraph' | null {
  const s = item.trim();
  if (s.length > MIRROR_MAX_CHARS) return 'too_long';
  if (/[\r\n]/.test(s)) return 'paragraph';
  // Two or more sentence ends, each followed by a space and a capital letter.
  if ((s.match(/[.!?]\s+[A-Z]/g) ?? []).length >= 2) return 'paragraph';
  return null;
}

/** S3 view: one offerings list = union of products_services_list, core_offerings, split(products_services). */
export function unionOfferings(
  productsServicesList: readonly string[] | null | undefined,
  coreOfferings: readonly string[] | null | undefined,
  productsServicesText: string | null | undefined,
): string[] {
  return dedupe([...(productsServicesList ?? []), ...(coreOfferings ?? []), ...splitToList(productsServicesText ?? '')]);
}

/**
 * Build a Market Pulse mirror array: existing MP entries FIRST (55), then profile items
 * that pass the shape filter, de-duped case-insensitively. Returns the items that were
 * held back (and why) so the UI can disclose them.
 */
export function buildMirror(
  existingMarketPulse: readonly string[] | null | undefined,
  profileItems: readonly string[],
): { mirror: string[]; heldBack: Array<{ item: string; reason: 'too_long' | 'paragraph' }> } {
  const heldBack: Array<{ item: string; reason: 'too_long' | 'paragraph' }> = [];
  const accepted: string[] = [];
  for (const item of dedupe(profileItems)) {
    const reason = mirrorBlockReason(item);
    if (reason) heldBack.push({ item, reason });
    else accepted.push(item);
  }
  return { mirror: dedupe([...(existingMarketPulse ?? []), ...accepted]), heldBack };
}

/** Per-item status for the "sent to the AI" badge (55's wording). */
export type MirrorStatus = 'sent_to_ai' | 'scoring_only' | 'too_long' | 'paragraph';

export function mirrorStatusFor(item: string, mirror: readonly string[]): MirrorStatus {
  const reason = mirrorBlockReason(item);
  if (reason) return reason;
  const i = mirror.findIndex((m) => key(m) === key(item));
  return i >= 0 && i < MARKET_PULSE_AI_CAP ? 'sent_to_ai' : 'scoring_only';
}

/**
 * S6 view: the growth-priorities text, plus any Market-Pulse array items it doesn't
 * already contain (appended, so nothing stored is hidden from the user).
 */
export function growthPrioritiesView(text: string | null | undefined, marketPulse: readonly string[] | null | undefined): {
  text: string;
  marketPulseOnly: string[];
} {
  const t = String(text ?? '');
  const inText = new Set(splitToList(t).map(key));
  return { text: t, marketPulseOnly: dedupe(marketPulse ?? []).filter((m) => !inText.has(key(m))) };
}

/**
 * Read-then-merge for saving report_settings.market_pulse (D6 + 05): the server replaces
 * market_pulse WHOLE, so always send the FULL object, starting from the stored value
 * re-read at save time and overlaying only the keys the user changed.
 */
export function mergeMarketPulseForSave(
  storedMarketPulse: Record<string, unknown> | null | undefined,
  changes: Record<string, unknown>,
): Record<string, unknown> {
  return { ...(storedMarketPulse ?? {}), ...changes };
}

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/**
 * Build report_settings.market_pulse for a profile save (UI step 6.4b; 05: re-read at save).
 * - `stored`: market_pulse RE-READ from the server just before saving (fresh truth).
 * - `loaded`: market_pulse as the form loaded it; `client`: as the form holds it now.
 *   Only keys the user actually changed this session (client ≠ loaded) are overlaid, so
 *   anything written since load (a refine, another tab) is never reverted.
 * - core_offerings / growth_priorities are rebuilt as mirrors: the existing MP entries
 *   (changed value if the user edited them, else the fresh stored value) FIRST, then the
 *   profile items that pass the shape filter.
 */
export function prepareMarketPulseForSave(args: {
  stored: Record<string, unknown> | null | undefined;
  loaded: Record<string, unknown> | null | undefined;
  client: Record<string, unknown> | null | undefined;
  productsServicesList: readonly string[];
  growthPrioritiesText: string | null | undefined;
}): {
  marketPulse: Record<string, unknown>;
  heldBack: { coreOfferings: Array<{ item: string; reason: 'too_long' | 'paragraph' }>; growthPriorities: Array<{ item: string; reason: 'too_long' | 'paragraph' }> };
} {
  const client = args.client ?? {};
  const loaded = args.loaded ?? {};
  const stored = args.stored ?? {};
  const changes: Record<string, unknown> = {};
  for (const k of Object.keys(client)) {
    if (!same(client[k], loaded[k])) changes[k] = client[k];
  }
  const base = mergeMarketPulseForSave(stored, changes);
  const asList = (v: unknown) => (Array.isArray(v) ? (v as unknown[]).map((x) => String(x)) : []);
  const core = buildMirror(asList(base.core_offerings), args.productsServicesList);
  const growth = buildMirror(asList(base.growth_priorities), splitToList(args.growthPrioritiesText ?? ''));
  return {
    marketPulse: { ...base, core_offerings: core.mirror, growth_priorities: growth.mirror },
    heldBack: { coreOfferings: core.heldBack, growthPriorities: growth.heldBack },
  };
}

/**
 * The market_pulse re-read at save time (05): "the server has none" (ok, value null) and
 * "I could not find out" (not ok) are different states and must never be conflated.
 */
export type MarketPulseRead = { ok: true; value: Record<string, unknown> | null } | { ok: false };

/** Parse a GET /api/company-profile body into a MarketPulseRead (no profile → unknown). */
export function marketPulseReadFromBody(body: unknown): MarketPulseRead {
  const profile = (body as { profile?: { report_settings?: { market_pulse?: unknown } | null } } | null)?.profile;
  if (!profile || typeof profile !== 'object') return { ok: false };
  const mp = profile.report_settings?.market_pulse;
  return { ok: true, value: mp && typeof mp === 'object' && !Array.isArray(mp) ? (mp as Record<string, unknown>) : null };
}

const emptyToNull = (v: unknown) => (Array.isArray(v) && v.length === 0 ? null : v ?? null);

/**
 * Decide what a profile save sends as report_settings.market_pulse (05's review of 6.4b).
 * - Re-read succeeded: send the full three-way merge built on the FRESH stored value
 *   (null when the server has none: never resurrect the loaded copy).
 * - Re-read failed: OMIT market_pulse. The server merges report_settings one level deep,
 *   so an absent key keeps the stored object untouched; nobody's work is reverted.
 *   `userChangesDropped` says whether the user had Market Pulse changes (direct, or via
 *   the offerings / growth-priorities mirror) that this save therefore did not apply.
 */
export function planMarketPulseSave(args: {
  read: MarketPulseRead;
  loaded: Record<string, unknown> | null | undefined;
  client: Record<string, unknown> | null | undefined;
  productsServicesList: readonly string[];
  growthPrioritiesText: string | null | undefined;
}): { include: true; marketPulse: Record<string, unknown> } | { include: false; userChangesDropped: boolean } {
  const common = {
    loaded: args.loaded,
    client: args.client,
    productsServicesList: args.productsServicesList,
    growthPrioritiesText: args.growthPrioritiesText,
  };
  if (args.read.ok) {
    return { include: true, marketPulse: prepareMarketPulseForSave({ ...common, stored: args.read.value }).marketPulse };
  }
  const loaded = args.loaded ?? {};
  const wouldSend = prepareMarketPulseForSave({ ...common, stored: args.loaded }).marketPulse;
  const keys = new Set([...Object.keys(loaded), ...Object.keys(wouldSend)]);
  const userChangesDropped = [...keys].some((k) => !same(emptyToNull(wouldSend[k]), emptyToNull(loaded[k])));
  return { include: false, userChangesDropped };
}
