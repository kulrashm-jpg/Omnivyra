/**
 * Pure text helpers shared by the channel formatters and validators:
 * normalization, link and emoji counting, and SMS encoding/segment arithmetic.
 *
 * No existing SMS segment or GSM-7 implementation was found in the repo
 * (searched for gsm7 / ucs2 / segment counting); this is the only one.
 */

/**
 * Deterministic normalization applied by every formatter:
 * - Unicode NFC, so visually identical input is byte-identical output;
 * - CRLF / CR to LF;
 * - trailing whitespace stripped from every line;
 * - runs of 3+ newlines collapsed to one blank line;
 * - leading/trailing whitespace trimmed.
 */
export function normalizeText(text: string): string {
  return text
    .normalize('NFC')
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Collapse all whitespace (including line breaks) to single spaces. */
export function toSingleLine(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

const LINK = /\bhttps?:\/\/[^\s<>"']+|\bwww\.[^\s<>"']+/gi;

export function countLinks(text: string): number {
  return (text.match(LINK) ?? []).length;
}

const EMOJI = /\p{Extended_Pictographic}/gu;

export function countEmoji(text: string): number {
  return (text.match(EMOJI) ?? []).length;
}

/* ── SMS (GSM 03.38) ─────────────────────────────────────────────────────── */

/** GSM-7 default alphabet (the escape code itself excluded). One septet each. */
const GSM7_BASIC = new Set<string>(Array.from(
  '@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !"#¤%&\'()*+,-./0123456789:;<=>?' +
  '¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà',
));

/** GSM-7 extension table. Two septets each (escape + char). Form feed omitted. */
const GSM7_EXTENSION = new Set<string>(Array.from('^{}\\[~]|€'));

export const SMS_LIMITS = {
  gsm7: { single: 160, perPart: 153 },
  ucs2: { single: 70, perPart: 67 },
} as const;

export interface SmsAnalysis {
  readonly encoding: 'gsm7' | 'ucs2';
  /** GSM-7: septets. UCS-2: UTF-16 code units. */
  readonly units: number;
  readonly segments: number;
  /** Characters that forced UCS-2, de-duplicated, in first-seen order. */
  readonly nonGsmCharacters: readonly string[];
}

export function analyzeSms(text: string): SmsAnalysis {
  let septets = 0;
  const nonGsm: string[] = [];
  for (const ch of Array.from(text)) {
    if (GSM7_BASIC.has(ch)) septets += 1;
    else if (GSM7_EXTENSION.has(ch)) septets += 2;
    else if (!nonGsm.includes(ch)) nonGsm.push(ch);
  }

  if (nonGsm.length === 0) {
    const { single, perPart } = SMS_LIMITS.gsm7;
    const segments = septets === 0 ? 0 : septets <= single ? 1 : Math.ceil(septets / perPart);
    return { encoding: 'gsm7', units: septets, segments, nonGsmCharacters: [] };
  }

  // UCS-2 is counted in UTF-16 code units: a character outside the BMP (most
  // emoji) occupies two. (Carriers do not split a surrogate pair across parts;
  // the per-part figure here is the standard 67 and is not adjusted for that.)
  const units = text.length;
  const { single, perPart } = SMS_LIMITS.ucs2;
  const segments = units === 0 ? 0 : units <= single ? 1 : Math.ceil(units / perPart);
  return { encoding: 'ucs2', units, segments, nonGsmCharacters: nonGsm };
}
