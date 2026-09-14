/**
 * CPG-007 — source-derived value types, money parsing and temporal semantics.
 *
 * ─── THE RULE THIS LAYER ENFORCES ──────────────────────────────────────────
 * A structured value is emitted ONLY when the document contains an explicit,
 * attributable statement supporting it. Everything else — vague growth language,
 * a number that happens to sit near the word "revenue", anything requiring
 * arithmetic or assumption — produces nothing.
 *
 * There is no LLM here, no generative completion, no external model, no clock
 * and no randomness. Same document bytes ⇒ same claims, forever.
 *
 * ─── WHY TEMPORAL TYPE IS NOT OPTIONAL ─────────────────────────────────────
 * "Revenue was $500M", "revenue will reach $1B" and "we target $1B revenue" are
 * three different facts that share a shape. Collapsing them is exactly the error
 * the Raina-12 freeze exposed at dataset level, and it would be far more
 * damaging here because these values feed the resolver. So temporal type is a
 * REQUIRED field, and FORECAST/TARGET are structurally barred from populating a
 * current-state field.
 */

/** §6 — mandatory temporal classification. */
export type TemporalType = 'CURRENT' | 'HISTORICAL' | 'FORECAST' | 'TARGET' | 'UNKNOWN';

/** What kind of monetary quantity a statement actually asserts (§8). */
export type MoneyKind =
  | 'revenue' | 'revenue_range' | 'arr' | 'valuation' | 'funding'
  | 'order_book' | 'gmv' | 'bookings' | 'market_size' | 'acquisition_price'
  | 'investment' | 'unknown';

export interface MoneyValue {
  /** Normalised to base currency units (e.g. 614_500_000). */
  amount: number;
  currency: string;
  /** Multiplier word actually present, for audit. */
  multiplier: 'none' | 'thousand' | 'million' | 'billion' | 'trillion' | 'lakh' | 'crore';
  /** True when the source hedged ("approximately", "about", "~", "over"). */
  approximate: boolean;
  /** Verbatim matched text. */
  raw: string;
}

/** One structured value extracted from a retrieved document (§5). */
export interface SourceDerivedValue {
  field: string;
  /** Normalised machine value: number for money/year, string for people. */
  value: string;
  normalizedValue: string;
  /** VERBATIM sentence that supports the value. Never paraphrased. */
  sourceStatement: string;
  temporalType: TemporalType;
  /** Period the statement itself establishes — never inferred from page date. */
  period: string | null;
  year: number | null;
  currency: string | null;
  unit: string | null;
  approximation: boolean;
  /** What the money actually was, so revenue ≠ valuation ≠ ARR (§8). */
  moneyKind: MoneyKind | null;
  /** How the value was obtained. */
  method: 'json_ld' | 'explicit_statement';
  /** Why it was accepted — surfaced so the decision is inspectable. */
  acceptedBecause: string;
  /**
   * The MEASURE the source stated, when it qualified one: 'net' / 'gross'
   * revenue, 'total raised' / 'largest round' / 'latest round' funding. Shown
   * in the value so two different measures are never displayed as one.
   */
  qualifier?: string | null;
}

/** A candidate the extractor examined and deliberately REJECTED. */
export interface RejectedValue {
  field: string;
  sourceStatement: string;
  reason: string;
}

export interface ExtractionOutcome {
  values: SourceDerivedValue[];
  rejected: RejectedValue[];
}

// ── money parsing ────────────────────────────────────────────────────────────

/** Keys are UPPER-CASED with any trailing dot removed. */
const CURRENCY_SYMBOLS: Readonly<Record<string, string>> = Object.freeze({
  '$': 'USD', 'US$': 'USD', '₹': 'INR', 'RS': 'INR',
  '€': 'EUR', '£': 'GBP', '¥': 'JPY',
  USD: 'USD', INR: 'INR', EUR: 'EUR', GBP: 'GBP', JPY: 'JPY',
});

const MULTIPLIERS: Readonly<Record<string, { factor: number; key: MoneyValue['multiplier'] }>> = Object.freeze({
  k: { factor: 1e3, key: 'thousand' }, thousand: { factor: 1e3, key: 'thousand' },
  m: { factor: 1e6, key: 'million' }, mn: { factor: 1e6, key: 'million' }, million: { factor: 1e6, key: 'million' },
  b: { factor: 1e9, key: 'billion' }, bn: { factor: 1e9, key: 'billion' }, billion: { factor: 1e9, key: 'billion' },
  t: { factor: 1e12, key: 'trillion' }, trillion: { factor: 1e12, key: 'trillion' },
  lakh: { factor: 1e5, key: 'lakh' }, lakhs: { factor: 1e5, key: 'lakh' },
  cr: { factor: 1e7, key: 'crore' }, crore: { factor: 1e7, key: 'crore' }, crores: { factor: 1e7, key: 'crore' },
});

/**
 * Approximation hedges.
 *
 * ⚠️ CPG-007 FIX — this is checked ONLY in the short window immediately BEFORE
 * the amount, and bare "over"/"under" were removed. The first version scanned
 * the whole sentence, so the real Cloudflare IR line
 *   "…revenue totaled $614.5 million, representing an increase of 27%
 *    year-over-year."
 * matched `\bover\b` inside "year-over-year" and flagged an exact reported
 * figure as approximate. A hedge that does not precede the number is not a
 * hedge on that number.
 */
const APPROX_PREFIX = /\b(approximately|approx\.?|about|around|roughly|nearly|circa|more than|less than|at least|up to|north of|~)\s*$/i;
/** How far back to look for a hedge. Long enough for "approximately", short
 *  enough that unrelated prose cannot leak in. */
const APPROX_WINDOW = 24;

/**
 * The source itself calls the figure an estimate. Checked anywhere BEFORE the
 * amount in the statement: "had an estimated net revenue of $6.9 billion".
 */
const ESTIMATE_BEFORE = /\b(estimated|estimates?|reportedly|est\.)(?=\W)/i;

/**
 * ⚠️ CPG-007 LIVE-RUN FIX — two defects produced FABRICATED ZERO values:
 *  • `Rs` had no word boundary under the `i` flag, so it matched inside
 *    "yea-rs" and "Partne-rs";
 *  • the number accepted a bare comma, and Number('') is 0.
 * Live output was "RS 0" for "…6 fiscal years , compounding…". The currency
 * token now needs a word boundary, the number must START with a digit, and an
 * unrecognised currency token yields no value rather than an invented code.
 */
const MONEY_RE = String.raw`(US\$|\bRs\.?|[$₹€£¥]|\b(?:USD|INR|EUR|GBP|JPY)\b)\s*` +
  String.raw`(\d[\d,]*(?:\.\d+)?)\s*` +
  String.raw`(k|thousand|mn|m|million|bn|b|billion|t|trillion|lakhs?|crores?|cr)?\b`;

export interface MoneyMatch extends MoneyValue { index: number; end: number }

function toMoney(text: string, m: RegExpExecArray): MoneyMatch | null {
  const symRaw = m[1].trim();
  const currency = CURRENCY_SYMBOLS[symRaw.toUpperCase().replace(/\.$/, '')];
  if (!currency) return null;
  const base = Number(m[2].replace(/,/g, ''));
  if (!Number.isFinite(base)) return null;

  const mult = m[3] ? MULTIPLIERS[m[3].toLowerCase()] : undefined;
  const before = text.slice(0, m.index);
  return {
    // ⚠️ CPG-007 FIX — rounded to 2 decimal places. Raw IEEE-754 products are
    // not exact: 0.14 × 1e7 = 1400000.0000000002, and 28,462 of the 99,999
    // two-decimal amounts × {1e3,1e5,1e6,1e7,1e9} carried such an artifact.
    // That broke exact equality in `canonicalMoneyKey` and leaked into display.
    amount: mult ? Math.round(base * mult.factor * 100) / 100 : base,
    currency,
    multiplier: mult?.key ?? 'none',
    approximate: APPROX_PREFIX.test(before.slice(-APPROX_WINDOW)) || ESTIMATE_BEFORE.test(before),
    raw: m[0].trim(),
    index: m.index,
    end: m.index + m[0].length,
  };
}

/**
 * Every currency-qualified amount in a statement, in order.
 *
 * An amount that merely RESTATES the previous one in another currency — "Rs 40
 * crore, about $4.2 million" / "₹30 Cr ($3.2 Mn)" — is dropped: it is a
 * conversion, not a second figure.
 */
export function parseAllMoney(text: string): MoneyMatch[] {
  const re = new RegExp(MONEY_RE, 'gi');
  const out: MoneyMatch[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const v = toMoney(text, m);
    if (!v) continue;
    const prev = out[out.length - 1];
    if (prev && prev.currency !== v.currency
      && /^\s*[(,]\s*(?:about|approx\.?|approximately|around|roughly|~)?\s*$/i.test(text.slice(prev.end, v.index))) continue;
    out.push(v);
  }
  return out;
}

/**
 * Parse the FIRST monetary amount in a statement.
 *
 * Returns null when no currency-qualified amount is present. A bare number is
 * deliberately NOT money — "revenue grew 40" must never become $40.
 */
export function parseMoney(text: string): MoneyValue | null {
  const first = parseAllMoney(text)[0];
  if (!first) return null;
  const { index: _i, end: _e, ...money } = first;
  return money;
}

// ── canonical comparison form (CPG-007 §15/§18) ───────────────────────────────

/** Fields whose values are monetary amounts and must compare numerically. */
const MONEY_FIELDS: ReadonlySet<string> = new Set(['revenue', 'annual_revenue', 'turnover', 'funding']);

/**
 * The key two money values are compared by: `"<CURRENCY> <amount>"`.
 *
 * ⚠️ CPG-007 FIX — WHY THIS EXISTS. The resolver compares `normalizedValue`
 * strings. Before this key:
 *   • a user's "₹7.8 Cr" (→ "₹7.8 cr") falsely CONFLICTED with a source stating
 *     the identical ₹7.8 crore (→ "78000000");
 *   • "$78,000,000" and "₹7.8 Cr" both became "78000000" and falsely
 *     CORROBORATED each other across currencies;
 *   • token-containment folding read "USD 5,000,000" and "USD 5,000,000,000"
 *     as the same value.
 *
 * Equal key ⇔ same currency AND same amount. Nothing fuzzier. There is no FX
 * conversion (that would be inference), so the same money in two currencies is
 * reported as a difference for the user to resolve, never silently merged.
 *
 * Returns null when the field is not monetary or the value states no
 * currency-qualified amount — callers then fall back to the existing text
 * comparison, unchanged.
 */
export function canonicalMoneyKey(field: string, value: string): string | null {
  if (!MONEY_FIELDS.has(field)) return null;
  const m = parseMoney(value);
  return m ? `${m.currency} ${m.amount}` : null;
}

/** Deterministic thousands grouping — no locale/ICU dependency. */
function groupThousands(n: number): string {
  const [int, frac] = String(n).split('.');
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return frac ? `${grouped}.${frac}` : grouped;
}

/**
 * The `value` / `normalizedValue` pair an extracted value carries into an
 * `EvidenceClaim`. Money is rendered currency-qualified ("INR 78,000,000
 * (FY2024)") so every downstream consumer — `revenueKind`, `parseMoney`, the
 * user reading a confirmation request — sees the currency and the period the
 * SOURCE stated. The period is appended only when the statement itself gave one.
 */
export function toEvidenceValue(v: SourceDerivedValue): { value: string; normalizedValue: string } {
  if (v.moneyKind !== null && v.currency) {
    const amount = Number(v.value);
    const when = v.period === 'FY' ? (v.year !== null ? `FY${v.year}` : 'annual')
      : [v.period, v.year].filter((x) => x !== null).join(' ');
    const label = [v.qualifier ?? null, when || null].filter(Boolean).join(', ');
    return {
      value: `${v.currency} ${groupThousands(amount)}${label ? ` (${label})` : ''}`,
      normalizedValue: `${v.currency} ${amount}`,
    };
  }
  return { value: v.value, normalizedValue: v.normalizedValue };
}

/** True when the statement expresses a RANGE rather than a single figure (§8). */
export function isRange(text: string): boolean {
  return /[\d.]\s*(?:-|–|—|to)\s*(?:US\$|Rs\.?|[$₹€£¥])?\s*[\d.]/i.test(text)
    || /\bbetween\b[^.]*\band\b/i.test(text);
}

// ── temporal classification (§6) ─────────────────────────────────────────────

const FORECAST = /\b(expect(?:s|ed|ing)?|forecast(?:s|ed|ing)?|project(?:s|ed|ion|ions)?|will (?:reach|hit|grow|be)|anticipat(?:e|es|ed)|estimat(?:e|es|ed) to (?:reach|hit)|guidance|outlook|on track to)\b/i;
const TARGET = /\b(target(?:s|ing|ed)?|goal|aims? to|aiming to|ambition|objective|plans? to reach|seeks? to)\b/i;
const PAST = /\b(was|were|totall?ed|reported|posted|recorded|generated|achieved|stood at|came in at|ended|closed at|delivered)\b/i;
const PRESENT = /\b(is|are|has|currently|as of today|now stands?)\b/i;

/** Sub-annual or trailing periods: a figure for one of these is not a fiscal year's. */
export const INTERIM_PERIOD = /\b(quarter(?:ly)?|Q[1-4]|three months|six months|nine months|half[- ]year(?:ly)?|H[12]|last twelve months|trailing twelve months|TTM|LTM)\b/i;

/** Fiscal/calendar period the STATEMENT itself establishes. Never page date. */
export function extractPeriod(text: string): { period: string | null; year: number | null } {
  const fy = /\b(?:FY|fiscal(?: year)?)\s?'?(\d{2,4})\b/i.exec(text);
  if (fy) {
    const raw = Number(fy[1]);
    return { period: 'FY', year: raw < 100 ? 2000 + raw : raw };
  }
  const q = /\b(first|second|third|fourth|Q([1-4]))\s+quarter|\bQ([1-4])\s?(?:FY)?\s?(\d{4})?\b/i.exec(text);
  const yr = /\b(19|20)\d{2}\b/.exec(text);
  const year = yr ? Number(yr[0]) : null;
  if (q) {
    const map: Record<string, string> = { first: 'Q1', second: 'Q2', third: 'Q3', fourth: 'Q4' };
    const label = q[2] ? `Q${q[2]}` : q[3] ? `Q${q[3]}` : map[(q[1] ?? '').toLowerCase()] ?? 'Q';
    return { period: label, year: q[4] ? Number(q[4]) : year };
  }
  // CPG-007 live-run fix: "revenue of $696.06M in the quarter ending June 30,
  // 2026" carried no Qn label, so it was shown as "(2026)" — a quarterly figure
  // presented as a year's revenue. Any quarter/interim wording is now labelled.
  if (INTERIM_PERIOD.test(text)) return { period: 'interim', year };
  if (/\bannual|full[- ]year|for the year\b/i.test(text)) return { period: 'FY', year };
  return { period: null, year };
}

/**
 * Classify a statement's temporal meaning.
 *
 * Order matters: forward-looking language wins over past-tense verbs, because
 * "revenue was expected to reach $1B" is a FORECAST, not history.
 */
export function classifyTemporal(text: string): TemporalType {
  if (TARGET.test(text)) return 'TARGET';
  if (FORECAST.test(text)) return 'FORECAST';
  const { year } = extractPeriod(text);
  if (PAST.test(text)) return 'HISTORICAL';
  if (year !== null) return 'HISTORICAL';
  if (PRESENT.test(text)) return 'CURRENT';
  return 'UNKNOWN';
}

/** Forward-looking values may never populate a current-state field (§6). */
export function isForwardLooking(t: TemporalType): boolean {
  return t === 'FORECAST' || t === 'TARGET';
}

// ── sentence splitting ───────────────────────────────────────────────────────

const NAMED_ENTITIES: Readonly<Record<string, string>> = Object.freeze({
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—',
  lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”', hellip: '…', rupee: '₹', euro: '€', pound: '£', yen: '¥',
});

/** Decode HTML character references. Unknown names are left as-is, never guessed. */
export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, ref: string) => {
    if (ref[0] === '#') {
      const code = ref[1] === 'x' || ref[1] === 'X' ? parseInt(ref.slice(2), 16) : parseInt(ref.slice(1), 10);
      if (!Number.isFinite(code) || code > 0x10ffff) return whole;
      // Control characters become spaces: they must never collide with the
      // splitter's internal sentinels.
      return code < 0x20 ? ' ' : String.fromCodePoint(code);
    }
    return NAMED_ENTITIES[ref.toLowerCase()] ?? whole;
  });
}

/**
 * Conservative splitter, modelled on the deterministic approach already proven
 * in `longForm/claimExtractionEngine.ts` (regex-driven, no LLM). Extraction
 * operates per sentence so a value is always tied to the words that support it.
 */
export function splitSentences(text: string): string[] {
  // ⚠️ CPG-007 FIX — two structural defects in the first version:
  //  1. Only TAGS were stripped, so the CONTENTS of <script>/<style> survived.
  //     A JSON-LD block was glued onto the next sentence and became part of the
  //     "verbatim" source statement, and script bodies were extractable text.
  //  2. Block elements were joined with a space, so a nav item "Cloudflare"
  //     followed by "<p>The company's revenue was $5M.</p>" became ONE
  //     sentence naming Cloudflare — manufactured attribution.
  // Non-content elements are now removed wholesale, and block-level tags are
  // hard boundaries: no sentence ever spans two blocks.
  const BLOCK = '\u0001';
  const flat = text
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style|noscript|template|svg|head|textarea|pre|code)\b[\s\S]*?<\/\1\s*>/gi, ' ')
    .replace(/<\/?(p|div|li|ul|ol|h[1-6]|td|th|tr|table|br|hr|section|article|header|footer|nav|aside|blockquote|figcaption|dt|dd|title)\b[^>]*>/gi, ` ${BLOCK} `)
    .replace(/<[^>]+>/g, ' ');
  // CPG-007 live-run fix: entities were left encoded, so "verbatim" statements
  // read "Stripe&#x27;s revenue", and an escaped embed-widget snippet
  // ("&lt;div style=&quot;…&quot;&gt;…") was extracted as prose. Decode, then
  // strip whatever markup the decoding revealed.
  const text2 = decodeEntities(flat).replace(/<[^>]+>/g, ' ').replace(/[ \t\r\n\f\v]+/g, ' ').trim();

  // ⚠️ CPG-007 CRITICAL FIX — a decimal point is NOT a sentence terminator.
  // The first version split "$614.5 million" into "…totaled $614." and
  // "5 million…", so the extracted revenue became 614 instead of 614,500,000.
  // Every decimal money value in the system was silently truncated. Digit-dot-
  // digit runs (and common abbreviations) are masked before splitting and
  // restored afterwards.
  const DOT = '\u0000';
  const masked = text2
    .replace(/(\d)\.(\d)/g, `$1${DOT}$2`)                                 // 614.5
    .replace(/\b(Inc|Ltd|Co|Corp|Pvt|Mr|Mrs|Ms|Dr|St|No|vs|etc|Jr|Sr|U\.S|U\.K)\./gi, `$1${DOT}`);

  const restore = (s: string) => s.split(DOT).join('.').replace(/\s+/g, ' ').trim();
  const blocks = masked.split(BLOCK).map((b) => b.trim()).filter(Boolean);

  const out: string[] = [];
  for (const block of blocks) {
    const re = /[^.!?]+[.!?]+/g;
    let m: RegExpExecArray | null;
    let last = 0;
    while ((m = re.exec(block)) !== null) {
      const s = restore(m[0]);
      if (s.length >= 12 && s.length <= 600) out.push(s);
      last = re.lastIndex;
    }
    // ⚠️ CPG-009 FIX — a sentence ENDING in a masked abbreviation ("… Pvt
    // Ltd.", "… Inc.") has no visible terminator, so it was silently dropped
    // whenever any other block had one. Its masked final dot IS the terminator.
    const tail = block.slice(last).trim();
    if (tail.endsWith(DOT)) {
      const s = restore(tail);
      if (s.length >= 12 && s.length <= 600) out.push(s);
    }
  }
  // No terminated sentence anywhere (e.g. a bare statement): fall back to each
  // block on its own — still never fusing two blocks into one statement.
  if (out.length === 0) {
    for (const block of blocks) {
      const s = restore(block);
      if (s.length >= 12) out.push(s.slice(0, 600));
    }
  }
  return out;
}
