/**
 * Pattern feature extractor. Pure functions that map a reply text
 * (final_text || suggested_text) to a set of pattern_type labels.
 *
 * Pattern families:
 *   length:   'short_reply'     (<120 chars) | 'long_reply' (>240 chars)
 *             ← 'medium_reply' (120..240) is intentionally omitted so the
 *               learner's comparisons are dichotomous (short vs long).
 *   question: 'has_question'    (ends with '?' or '?…') vs 'no_question'
 *   emoji:    'has_emoji'       (contains any unicode emoji codepoint)
 *             vs 'no_emoji'
 *
 * One row can carry multiple pattern labels (length + question + emoji).
 */

const SHORT_MAX = 120;
const LONG_MIN  = 240;

/**
 * Crude but dependency-free emoji detector. Covers the common BMP emoji
 * blocks + flags + variation selectors. Good enough for a learning
 * signal; not meant for emoji rendering.
 */
const EMOJI_RE =
  /[‼⁉ℹ↔-↙↩↪⌚⌛⌨⏏⏩-⏳⏸-⏺Ⓜ▪▫▶◀◻-◾☀-☄☎☑☔☕☘☝☠☢☣☦☪☮☯☸-☺♀♂♈-♓♟♠♣♥♦♨♻♾♿⚒-⚗⚙⚛⚜⚠⚡⚧⚪⚫⚰⚱⚽⚾⛄⛅⛈⛎⛏⛑⛓⛔⛩⛪⛰-⛵⛷-⛺⛽✂✅✈-✍✏✒✔✖✝✡✨✳✴❄❇❌❎❓-❕❗❣❤➕-➗➡➰➿⤴⤵⬅-⬇⬛⬜⭐⭕〰〽㊗㊙]|\uD83C[\uDC04\uDCCF\uDD70-\uDD71\uDD7E\uDD7F\uDD8E\uDD91-\uDD9A\uDDE6-\uDDFF\uDE01-\uDE02\uDE1A\uDE2F\uDE32-\uDE3A\uDE50\uDE51\uDF00-\uDFFF]|\uD83D[\uDC00-\uDFFF]|\uD83E[\uDC00-\uDFFF]/u;

export type PatternType =
  | 'short_reply'
  | 'long_reply'
  | 'has_question'
  | 'no_question'
  | 'has_emoji'
  | 'no_emoji';

export type PatternFamily = 'length' | 'question' | 'emoji';

const FAMILY_OF: Record<PatternType, PatternFamily> = {
  short_reply:  'length',
  long_reply:   'length',
  has_question: 'question',
  no_question:  'question',
  has_emoji:    'emoji',
  no_emoji:     'emoji',
};

/**
 * Return every pattern label that applies to the text. An empty/nullish
 * text returns an empty list so the learner does not credit anything.
 */
export function extractPatternTypes(text: string | null | undefined): PatternType[] {
  const t = (text ?? '').toString().trim();
  if (!t) return [];
  const out: PatternType[] = [];

  // Length. Omit medium rows from both buckets so the bucket ratios
  // describe tail behaviour rather than the centre of the distribution.
  const len = t.length;
  if (len < SHORT_MAX) out.push('short_reply');
  else if (len > LONG_MIN) out.push('long_reply');

  // Question. Ends with '?' (allow trailing ellipsis / whitespace).
  const trimEnd = t.replace(/[\s…]+$/u, '');
  if (trimEnd.endsWith('?')) out.push('has_question');
  else out.push('no_question');

  // Emoji.
  if (EMOJI_RE.test(t)) out.push('has_emoji');
  else out.push('no_emoji');

  return out;
}

export function patternFamily(type: PatternType): PatternFamily {
  return FAMILY_OF[type];
}

/**
 * Given a family, return the two sibling pattern types so the learner
 * can populate `baseline_rate` + `uplift_ratio` without a second query.
 * `length` is a special case because the centre-of-distribution rows
 * are ignored — siblings are short_reply / long_reply.
 */
export function siblingPatterns(type: PatternType): [PatternType, PatternType] {
  switch (FAMILY_OF[type]) {
    case 'length':   return ['short_reply', 'long_reply'];
    case 'question': return ['has_question', 'no_question'];
    case 'emoji':    return ['has_emoji', 'no_emoji'];
  }
}
