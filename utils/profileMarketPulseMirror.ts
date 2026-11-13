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
