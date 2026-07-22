/**
 * Wave 2 — Content Intelligence: heuristic intelligence extraction.
 *
 * PURE + DETERMINISTIC. No DB, no network, no clocks, no randomness. The same
 * input text always yields byte-identical output. Given a piece of content it
 * decomposes the text into four reusable brand/campaign signals:
 *
 *  - hooks       : the opening attention-grabbers (first line + first sentence).
 *  - ctas        : imperative / link-bearing call-to-action lines.
 *  - narratives  : the ordered non-CTA line structure (the story flow).
 *  - keyMessages : substantive non-CTA sentences (the core claims/messages).
 *
 * These feed both the durable content-memory index and the company-level
 * brand-memory rollup so later generations can reuse voice WITHOUT repeating
 * prior content. Heuristic on purpose — no model calls in this wave.
 */

export interface ContentIntelligence {
  hooks: string[];
  ctas: string[];
  narratives: string[];
  keyMessages: string[];
}

/** Verbs that, when a line/sentence starts with them, signal an imperative CTA. */
const IMPERATIVE_VERBS = new Set<string>([
  'sign', 'subscribe', 'buy', 'learn', 'click', 'get', 'join', 'download',
  'register', 'book', 'try', 'shop', 'order', 'contact', 'follow', 'share',
  'comment', 'discover', 'explore', 'start', 'grab', 'claim', 'read', 'watch',
  'see', 'check', 'visit', 'call', 'email', 'dm', 'tap', 'swipe', 'unlock',
  'save', 'apply', 'request', 'schedule', 'reserve', 'enroll', 'upgrade',
]);

/** Multi-word CTA phrases that mark a line as a call to action anywhere within. */
const CTA_KEYWORDS: ReadonlyArray<string> = [
  'sign up', 'subscribe', 'learn more', 'click here', 'buy now', 'get started',
  'link in bio', 'swipe up', 'check out', 'find out', 'dm us', 'contact us',
  'book a', 'sign-up', 'shop now', 'order now', 'try it', 'join us',
];

/** Detects an inline URL / bare domain — a strong CTA signal. */
const URL_RE = /(https?:\/\/|www\.|\b[a-z0-9-]+\.(?:com|io|co|net|org|ai|app|dev|xyz|link)\b)/i;

/** First lowercase alphabetic word of a line, or '' if none. */
function firstWord(text: string): string {
  const m = text.toLowerCase().match(/[a-z']+/);
  return m ? m[0] : '';
}

/** Number of whitespace-delimited words. */
function wordCount(text: string): number {
  return text.trim().split(/\s+/).filter((w) => w.length > 0).length;
}

/** A line/sentence is a CTA if it links out, starts imperatively, or names a CTA phrase. */
function isCta(text: string): boolean {
  const lower = text.toLowerCase();
  if (URL_RE.test(lower)) return true;
  if (IMPERATIVE_VERBS.has(firstWord(lower))) return true;
  for (const kw of CTA_KEYWORDS) {
    if (lower.includes(kw)) return true;
  }
  return false;
}

/** Order-preserving de-duplication (case-sensitive on the trimmed value). */
function dedupe(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of values) {
    const t = v.trim();
    if (!t || seen.has(t)) continue;
    seen.add(t);
    out.push(t);
  }
  return out;
}

/** Non-empty, trimmed lines of the raw text. */
function lines(raw: string): string[] {
  return raw
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
}

/** Non-empty, trimmed sentences of the raw text. */
function sentences(raw: string): string[] {
  return raw
    .split(/(?<=[.!?])\s+|[.!?]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

// Caps keep the extracted signals bounded regardless of input size.
const HOOKS_CAP = 4;
const CTAS_CAP = 12;
const NARRATIVES_CAP = 20;
const KEY_MESSAGES_CAP = 20;
/** A sentence must carry at least this many words to count as a key message. */
const KEY_MESSAGE_MIN_WORDS = 5;

/**
 * Extract deterministic content intelligence from a piece of text.
 * Empty/whitespace input yields four empty arrays.
 */
export function extractIntelligence(text: string): ContentIntelligence {
  const raw = typeof text === 'string' ? text : '';
  const lineList = lines(raw);
  const sentenceList = sentences(raw);

  // Hooks: the opening line and the opening sentence (deduped).
  const hooks: string[] = [];
  if (lineList.length > 0) hooks.push(lineList[0]);
  if (sentenceList.length > 0) hooks.push(sentenceList[0]);

  // CTAs: imperative / link lines, in document order.
  const ctas = lineList.filter((l) => isCta(l));

  // Narratives: the ordered non-CTA line structure (story flow).
  const narratives = lineList.filter((l) => !isCta(l));

  // Key messages: substantive non-CTA sentences (the core claims).
  const keyMessages = sentenceList.filter(
    (s) => !isCta(s) && wordCount(s) >= KEY_MESSAGE_MIN_WORDS,
  );

  return {
    hooks: dedupe(hooks).slice(0, HOOKS_CAP),
    ctas: dedupe(ctas).slice(0, CTAS_CAP),
    narratives: dedupe(narratives).slice(0, NARRATIVES_CAP),
    keyMessages: dedupe(keyMessages).slice(0, KEY_MESSAGES_CAP),
  };
}
