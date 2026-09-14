/**
 * CPG-007 — deterministic field extractors (§7, §9, §10, §11, §12, §13).
 *
 * Each extractor answers one question: does this document contain an EXPLICIT
 * statement establishing this field for THIS company? If not, it emits nothing
 * and records why.
 *
 * ─── WHAT IS NEVER DONE HERE ───────────────────────────────────────────────
 *   • no inference (headcount x productivity, growth% x prior year, …);
 *   • no borrowing the page's publication date as a fiscal period;
 *   • no accepting a number merely because it sits near a keyword;
 *   • no LLM, no model, no clock, no randomness.
 *
 * ─── AUTHORITY IS NOT DECIDED HERE (§14) ───────────────────────────────────
 * A perfectly parsed revenue figure from a source the CPG-003 registry marks
 * `neverFor: revenue` is still excluded downstream. Extraction produces typed
 * candidates; entity resolution, authority, freshness, corroboration and the
 * CPG-001 resolver decide what happens to them.
 */

import {
  classifyTemporal, extractPeriod, INTERIM_PERIOD, isForwardLooking, isRange, parseAllMoney, splitSentences,
  type ExtractionOutcome, type MoneyKind, type RejectedValue, type SourceDerivedValue,
} from './valueTypes';

import {
  escapeRe, FOREIGN_ATTRIBUTION, mentionsCompany, nameTokens, nodesOfType, nonAssertive, nonAssertiveReason, orgIsSubject, readJsonLdBlocks, subjectMention,
} from './documentSubject';

// §12 / §13 — statement subject and JSON-LD reading live in ./documentSubject; re-exported so importers are unchanged.
export { mentionsCompany, nodesOfType, nonAssertive, orgIsSubject, readJsonLdBlocks, subjectMention, type MentionContext } from './documentSubject';

// ── §7/§8 revenue ────────────────────────────────────────────────────────────

/** Money words that are NOT revenue and must stay distinct (§8). */
const MONEY_KIND_PATTERNS: readonly [RegExp, MoneyKind][] = Object.freeze([
  [/\bvaluation\b|\bvalued at\b|\bworth\b/i, 'valuation'],
  [/\braised\b|\bfunding\b|\bseries [a-h]\b|\bseed round\b|\bpre-seed\b|\bround\b/i, 'funding'],
  [/\border book\b/i, 'order_book'],
  [/\bGMV\b|\bgross merchandise\b/i, 'gmv'],
  [/\bbookings\b/i, 'bookings'],
  [/\bmarket size\b|\bTAM\b|\baddressable market\b/i, 'market_size'],
  [/\bARR\b|\bannual recurring revenue\b/i, 'arr'],
  [/\binvest(?:ed|ment)\b/i, 'investment'],
  [/\bacquir(?:e|ed)\b.*\bfor\b|\bacquisition (?:price|value)\b/i, 'acquisition_price'],
]);

function classifyMoneyKind(sentence: string): MoneyKind {
  for (const [re, kind] of MONEY_KIND_PATTERNS) if (re.test(sentence)) return kind;
  if (/\brevenue\b|\bturnover\b|\btop[- ]line\b/i.test(sentence)) return 'revenue';
  return 'unknown';
}

const REVENUE_STATEMENT = /\brevenue\b|\bturnover\b|\btop[- ]line\b/i;

/** Financial metrics an amount can be bound to. The nearest one wins. */
const METRIC_WORDS = /\b(net revenues?|gross revenues?|revenues?|turnover|sales|top[- ]line|net profits?|profits?|net income|income|net loss(?:es)?|loss(?:es)?|ebitda|earnings|margins?|cash flow|expenses|costs|valuation|market cap\w*|funding|gmv|bookings|arr|order book)\b/gi;
const REVENUE_WORD = /^(net revenues?|gross revenues?|revenues?|turnover|sales|top[- ]line)$/i;

/** Who else revenue is commonly attributed to in the same sentence. */
const BENEFICIARY = /\b(businesses|customers|merchants|users|sellers|clients|partners|startups|developers|creators|brands|retailers|subscribers)\b/i;

/**
 * Which metric the amount belongs to: the nearest metric word BEFORE it, or —
 * when none precedes — the first one shortly AFTER it ("$19.4B in annual
 * revenue"). Null when the amount is not bound to any metric word.
 */
function boundMetric(s: string, amountIndex: number, amountEnd: number): string | null {
  let last: string | null = null;
  for (const m of s.slice(0, amountIndex).matchAll(METRIC_WORDS)) last = m[1];
  if (last) return last;
  const after = new RegExp(METRIC_WORDS.source, 'i').exec(s.slice(amountEnd, amountEnd + 40));
  return after ? after[1] : null;
}

export function extractRevenue(text: string, companyName: string): ExtractionOutcome {
  const values: SourceDerivedValue[] = [];
  const rejected: RejectedValue[] = [];
  const reject = (s: string, reason: string) => rejected.push({ field: 'revenue', sourceStatement: s, reason });

  for (const s of splitSentences(text)) {
    if (!REVENUE_STATEMENT.test(s)) continue;

    const amounts = parseAllMoney(s);
    if (amounts.length === 0) { reject(s, 'discusses revenue but states no currency-qualified amount'); continue; }
    // ⚠️ CPG-007 LIVE-RUN FIX — the first version took the FIRST amount in the
    // sentence. For "Zerodha's net profit rose 1.2% to ₹4,283 crore in FY26,
    // while revenue remained … ₹8,847 crore it reported a year earlier" it
    // returned NET PROFIT as revenue. With several figures in one statement the
    // binding of amount → metric → period is not determinable without
    // parsing grammar, so the statement is refused.
    if (amounts.length > 1) { reject(s, `states ${amounts.length} amounts — cannot bind one of them to revenue unambiguously`); continue; }
    const money = amounts[0];

    const kind = classifyMoneyKind(s);
    if (kind !== 'revenue') { reject(s, `amount is ${kind}, not revenue — kept distinct per CPG-005/007 §8`); continue; }
    const metric = boundMetric(s, money.index, money.end);
    if (!metric || !REVENUE_WORD.test(metric)) {
      reject(s, `amount is bound to "${metric ?? 'no metric'}", not to revenue`); continue;
    }
    // A quarter, half-year or trailing-twelve-month figure is not a fiscal
    // year's revenue; shown next to an annual figure it reads as one.
    if (INTERIM_PERIOD.test(s)) { reject(s, 'quarterly / interim / trailing-twelve-month figure — not fiscal-year revenue'); continue; }
    const beneficiary = BENEFICIARY.exec(s.slice(0, money.index));
    if (beneficiary) { reject(s, `revenue is attributed to "${beneficiary[1]}", not to the company itself`); continue; }
    if (FOREIGN_ATTRIBUTION.test(s)) {
      reject(s, 'amount is attached to an acquisition/investment in another entity, not this company\'s revenue'); continue;
    }
    const subject = subjectMention(s, companyName, 'revenue');
    if ('reason' in subject) { reject(s, subject.reason); continue; }
    const na = nonAssertive(s);
    if (na) { reject(s, nonAssertiveReason(na)); continue; }
    if (isRange(s)) { reject(s, 'source states a RANGE, not a single figure — belongs to revenue_range'); continue; }

    const temporalType = classifyTemporal(s);
    if (isForwardLooking(temporalType)) { reject(s, `${temporalType} statement — must never populate current revenue`); continue; }

    const { period, year } = extractPeriod(s);
    const qualifier = /\bnet revenue/i.test(metric) ? 'net' : /\bgross revenue/i.test(metric) ? 'gross' : null;
    values.push({
      field: 'revenue', value: String(money.amount), normalizedValue: String(money.amount),
      sourceStatement: s, temporalType, period, year,
      currency: money.currency, unit: money.multiplier === 'none' ? null : money.multiplier,
      approximation: money.approximate, moneyKind: 'revenue', method: 'explicit_statement',
      acceptedBecause: `explicit ${qualifier ? qualifier + ' ' : ''}revenue statement: one ${money.currency} amount bound to "${metric}", company is the subject, temporal=${temporalType}`,
      qualifier,
    });
  }
  return { values, rejected };
}

// ── §9 CEO ───────────────────────────────────────────────────────────────────

const NAME = String.raw`([A-Z][\p{L}'’.-]+(?:\s+[A-Z][\p{L}'’.-]+){1,3})`;
/** Two or three capitalised tokens — for company-anchored patterns. */
const NAME_2_3 = String.raw`([A-Z][\p{L}'’.-]+(?:\s+[A-Z][\p{L}'’.-]+){1,2})`;
const CEO_TITLE = String.raw`(?:CEO|Chief Executive Officer|chief executive)`;
/** Case-sensitive spelling of the title, for patterns that must not use the `i` flag. */
const CEO_TITLE_CS = String.raw`(?:CEO|[Cc]hief [Ee]xecutive(?: [Oo]fficer)?)`;

export function extractCeo(html: string, companyName: string): ExtractionOutcome {
  const values: SourceDerivedValue[] = [];
  const rejected: RejectedValue[] = [];
  const seen = new Set<string>();

  const push = (person: string, statement: string, method: SourceDerivedValue['method'], why: string) => {
    const key = person.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    values.push({
      field: 'ceo', value: person, normalizedValue: key, sourceStatement: statement,
      temporalType: 'CURRENT', period: null, year: null, currency: null, unit: null,
      approximation: false, moneyKind: null, method, acceptedBecause: why,
    });
  };

  // §12 — structured Person/Organization first, when explicit.
  for (const org of nodesOfType(readJsonLdBlocks(html), 'Organization')) {
    if (!orgIsSubject(org, companyName)) {
      rejected.push({ field: 'ceo', sourceStatement: `JSON-LD Organization: ${String(org.name ?? '(unnamed)')}`, reason: 'JSON-LD Organization is not the subject company (e.g. the publisher) — §13' });
      continue;
    }
    const emp = org.employee ?? org.founder;
    const list = Array.isArray(emp) ? emp : emp ? [emp] : [];
    for (const e of list) {
      if (!e || typeof e !== 'object') continue;
      const p = e as Record<string, unknown>;
      const role = String(p.jobTitle ?? '');
      const name = String(p.name ?? '').trim();
      if (name && new RegExp(CEO_TITLE, 'i').test(role)) {
        push(name, `JSON-LD Organization.employee: ${name} — ${role}`, 'json_ld', 'schema.org Person explicitly titled CEO within the Organization node');
      }
    }
  }

  // All CEO patterns are CASE-SENSITIVE: under the `i` flag `[A-Z]` in NAME
  // matches lowercase, and "Zerodha CEO Nithin Kamath recalls terrifying…"
  // would yield the person "Nithin Kamath recalls terrifying". The company part
  // is made case-insensitive letter by letter instead.
  const ci = (t: string) => t.replace(/[a-z]/gi, (ch) => `[${ch.toLowerCase()}${ch.toUpperCase()}]`);
  const co = nameTokens(companyName).map((t) => ci(escapeRe(t))).join(String.raw`[^A-Za-z0-9]+`);
  for (const s of splitSentences(html)) {
    // Company-anchored first — these name the company AND the person explicitly.
    // "Zerodha CEO Nithin Kamath" / "Stripe's chief executive Patrick Collison"
    const c = co ? new RegExp(`(?<![A-Za-z0-9])${co}(?:['’]s)?\\s+${CEO_TITLE_CS}\\s*,?\\s+${NAME_2_3}`, 'u').exec(s) : null;
    // "Matthew Prince is the co-founder and CEO of Cloudflare"
    const d = co ? new RegExp(`${NAME_2_3}\\s+(?:is|serves as|has been)\\s+(?:the\\s+)?(?:co-?founder\\s+and\\s+)?${CEO_TITLE_CS}\\s+(?:of|at)\\s+${co}(?![A-Za-z0-9])`, 'u').exec(s) : null;
    // "Matthew Prince, CEO of Cloudflare" / "Jane Doe, chief executive officer"
    const a = new RegExp(`${NAME},?\\s+(?:the\\s+)?${CEO_TITLE_CS}\\b`, 'u').exec(s);
    // "The company's chief executive officer is Jane Doe"
    const b = new RegExp(`${CEO_TITLE_CS}\\s+(?:of\\s+[^,.]+\\s+)?is\\s+${NAME}`, 'u').exec(s);
    const hit = c ?? d ?? a ?? b;
    const person = hit?.[1];
    // Name boundary: when the capture is immediately followed by another
    // Capitalised word (Title Case headline), where the name ends is unknowable.
    if (hit && (hit === c || hit === b) && /^\s+[A-Z][\p{L}]/u.test(s.slice(hit.index + hit[0].length))) {
      rejected.push({ field: 'ceo', sourceStatement: s.slice(0, 200), reason: 'Title-Case run after the name — where the person name ends cannot be determined' });
      continue;
    }
    if (!hit || !person) {
      if (/\b(founder|leadership team|management team)\b/i.test(s) && !new RegExp(CEO_TITLE, 'i').test(s)) {
        rejected.push({ field: 'ceo', sourceStatement: s.slice(0, 200), reason: 'mentions a person or leadership without an explicit CEO role' });
      }
      continue;
    }
    // A former/interim/incoming title is not the current CEO.
    const titleAt = s.search(new RegExp(CEO_TITLE_CS));
    // Up to three words may sit between the qualifier and the title:
    // "former Stripe CEO", "ex co-founder and CEO".
    if (/\b(former|ex|then|previous|past|interim|acting|outgoing|incoming|deputy|vice|future)[\s-]+(?:[\p{L}’'.-]+\s+){0,3}$/iu.test(s.slice(Math.max(0, titleAt - 40), titleAt))) {
      rejected.push({ field: 'ceo', sourceStatement: s.slice(0, 200), reason: 'former / interim / incoming CEO — not a statement of the current CEO' });
      continue;
    }
    const clean = person.trim().replace(/[.,;:]+$/, '').replace(/['’]s$/, '');
    // "Inside Stripe CEO Patrick Collison…" once yielded CEO = "Inside Stripe":
    // a candidate containing the company's own name, or opening with a
    // headline word, is not a person.
    const candTokens = new Set(nameTokens(clean));
    if (nameTokens(companyName).some((t) => candTokens.has(t))
      || /^(Inside|The|Former|Ex|Our|Its|Their|New|Meet|Why|How|When|Who|What|Interim|Acting|Deputy|Vice|Co|Chief|Global|Group)\b/.test(clean)) {
      rejected.push({ field: 'ceo', sourceStatement: s.slice(0, 200), reason: `"${clean}" is not a person name (contains the company name or a headline word)` });
      continue;
    }
    const na = nonAssertive(s);
    if (na) {
      rejected.push({ field: 'ceo', sourceStatement: s.slice(0, 200), reason: nonAssertiveReason(na) });
      continue;
    }
    if (!(c || d) && !mentionsCompany(s, companyName)) {
      rejected.push({ field: 'ceo', sourceStatement: s.slice(0, 200), reason: 'CEO title present but company not named — attribution ambiguous' });
      continue;
    }
    push(clean, s.slice(0, 300), 'explicit_statement',
      c || d ? 'explicit statement naming the company, the CEO title and the person together'
        : 'explicit CEO role adjacent to the person name, company named in the same statement');
  }
  return { values, rejected };
}

// ── §10 founded year ─────────────────────────────────────────────────────────

const COPYRIGHT = /©|\bcopyright\b|\ball rights reserved\b/i;
const PUBLISHED = /\bpublished\b|\bupdated\b|\bposted on\b|\blast modified\b/i;

export function extractFoundedYear(html: string, companyName: string): ExtractionOutcome {
  const values: SourceDerivedValue[] = [];
  const rejected: RejectedValue[] = [];

  for (const org of nodesOfType(readJsonLdBlocks(html), 'Organization')) {
    if (!orgIsSubject(org, companyName)) {
      if (org.foundingDate) rejected.push({ field: 'founded_year', sourceStatement: `JSON-LD Organization: ${String(org.name ?? '(unnamed)')} foundingDate ${String(org.foundingDate)}`, reason: 'JSON-LD Organization is not the subject company (e.g. the publisher) — §13' });
      continue;
    }
    const fd = String(org.foundingDate ?? '').trim();
    const y = /^(\d{4})/.exec(fd);
    if (y) {
      values.push({
        field: 'founded_year', value: y[1], normalizedValue: y[1],
        sourceStatement: `JSON-LD Organization.foundingDate: ${fd}`,
        temporalType: 'HISTORICAL', period: null, year: Number(y[1]),
        currency: null, unit: null, approximation: false, moneyKind: null,
        method: 'json_ld', acceptedBecause: 'schema.org Organization.foundingDate',
      });
    }
  }

  for (const s of splitSentences(html)) {
    // ⚠️ CPG-007 LIVE-RUN FIX — "launched in" removed. "Cloudflare's Project
    // Galileo, launched in 2014, …" made 2014 a Cloudflare founding year:
    // products launch far more often than companies do.
    if (!/\bfound(?:ed|ing)\b|\bestablished\b|\bincorporated\b/i.test(s)) continue;
    if (COPYRIGHT.test(s)) { rejected.push({ field: 'founded_year', sourceStatement: s.slice(0, 200), reason: 'copyright notice, not a founding statement' }); continue; }
    if (PUBLISHED.test(s)) { rejected.push({ field: 'founded_year', sourceStatement: s.slice(0, 200), reason: 'publication/update date, not a founding statement' }); continue; }
    const y = /\bfound(?:ed|ing)\s+(?:in\s+)?(?:the\s+year\s+)?((?:19|20)\d{2})\b|\b(?:established|incorporated)\s+in\s+((?:19|20)\d{2})\b/i.exec(s);
    if (!y) { rejected.push({ field: 'founded_year', sourceStatement: s.slice(0, 200), reason: 'founding language present but no explicit four-digit year attached to it' }); continue; }
    // "Rainmatter, founded in 2016 by Zerodha" is Rainmatter's founding year.
    const subject = subjectMention(s, companyName, 'founded_year');
    if ('reason' in subject) { rejected.push({ field: 'founded_year', sourceStatement: s.slice(0, 200), reason: subject.reason }); continue; }
    const na = nonAssertive(s);
    if (na) { rejected.push({ field: 'founded_year', sourceStatement: s.slice(0, 200), reason: nonAssertiveReason(na) }); continue; }
    const year = y[1] ?? y[2];
    if (values.some((v) => v.value === year)) continue;
    values.push({
      field: 'founded_year', value: year, normalizedValue: year, sourceStatement: s.slice(0, 300),
      temporalType: 'HISTORICAL', period: null, year: Number(year),
      currency: null, unit: null, approximation: false, moneyKind: null,
      method: 'explicit_statement', acceptedBecause: 'explicit founding verb with a four-digit year and the company named',
    });
  }
  return { values, rejected };
}

// ── §11 funding ──────────────────────────────────────────────────────────────

/**
 * Round names. ⚠️ CPG-007 LIVE-RUN FIX: bare "growth" matched "growth in its
 * loan business", turning a subsidiary's income into a funding round; it now
 * needs "growth round"/"growth equity". "Series I" (Stripe, 2023) is a real
 * round, so any letter is accepted; post-IPO rounds are named explicitly.
 */
const ROUND = /\b(pre-seed|seed|series\s+[a-z]\b|bridge|growth(?:-stage)?\s+(?:round|equity)|mezzanine|(?:pre|post)[- ]?IPO|IPO)/i;
const RAISE = /\b(rais(?:e|ed|es|ing)|secur(?:e|ed|es)|clos(?:e|ed) (?:a|its)\s+\w*\s*round|funding round|led by)\b/i;
/** Profit-and-loss metrics: never funding. */
const PNL = /\b(income|profits?|loss(?:es)?|ebitda|earnings)\b/i;

/**
 * WHICH funding measure the sentence states. A company's "$332M raised in
 * total" and its "largest round of $1.29B" are different facts and are never
 * shown as one value.
 */
const AMBIGUOUS_BASIS = 'AMBIGUOUS';

function fundingBasis(s: string): string | null {
  // ⚠️ CPG-007 LIVE-RUN FIX — a sentence naming MORE THAN ONE measure is
  // refused, not guessed. Both real sentences below name a total AND a round:
  //   "raised roughly $9.81 billion in total …, with the March 2023 Series I
  //    standing as its largest single round"            → the amount is a TOTAL
  //   "Cloudflare's last funding round was on Aug 2026 for a total of $2.2B"
  //                                                     → the amount is a ROUND
  // "Check largest first" got the first wrong; "nearest phrase wins" got the
  // second wrong. Only grammar decides, and this layer does not parse grammar.
  const found = new Set<string>();
  if (/\b(largest|biggest)\b[^.]{0,40}\bround\b/i.test(s)) found.add('largest round');
  if (/\b(last|latest|most recent)\b[^.]{0,40}\bround\b/i.test(s)) found.add('latest round');
  if (/\b(a total of|in total|total funding|total of|cumulative|to date)\b/i.test(s)) found.add('total raised');
  if (found.size > 1) return AMBIGUOUS_BASIS;
  return found.values().next().value ?? null;
}

function roundLabel(raw: string): string {
  const r = raw.replace(/\s+/g, ' ').trim();
  if (/^series /i.test(r)) return `Series ${r.slice(-1).toUpperCase()}`;
  if (/ipo$/i.test(r)) return r.toLowerCase().replace(/^(pre|post)[- ]?ipo$/, '$1-IPO').replace(/^ipo$/, 'IPO');
  return r.toLowerCase();
}

export function extractFunding(text: string, companyName: string): ExtractionOutcome {
  const values: SourceDerivedValue[] = [];
  const rejected: RejectedValue[] = [];
  const reject = (s: string, reason: string) => rejected.push({ field: 'funding', sourceStatement: s.slice(0, 200), reason });

  for (const s of splitSentences(text)) {
    // A round NAME alone is not a funding event: "… Ahead of IPO" is not a
    // raise. A raise verb, or the word "round", must be present.
    if (!RAISE.test(s) && !(ROUND.test(s) && /\bround\b/i.test(s))) continue;
    const amounts = parseAllMoney(s);
    if (amounts.length === 0) { reject(s, 'funding language but no currency-qualified amount'); continue; }
    if (amounts.length > 1) { reject(s, `states ${amounts.length} amounts — cannot bind one of them to a funding event unambiguously`); continue; }
    // The company investing in someone else is not the company's funding.
    if (FOREIGN_ATTRIBUTION.test(s)) { reject(s, 'amount is an investment in / acquisition of another entity — not this company\'s funding'); continue; }
    const money = amounts[0];

    const kind = classifyMoneyKind(s);
    if (kind === 'valuation') { reject(s, 'amount is a VALUATION — never converted into funding (§11)'); continue; }
    if (kind === 'revenue') { reject(s, 'amount is REVENUE — never converted into funding (§11)'); continue; }
    if (kind === 'order_book') { reject(s, 'amount is an ORDER BOOK — never converted into funding (§11)'); continue; }
    if (kind === 'acquisition_price') { reject(s, 'amount is an acquisition price, not a funding round'); continue; }
    // 'raised its revenue to $5m' is a revenue statement wearing a funding verb.
    if (/\brevenue\b|\bturnover\b/i.test(s) && !ROUND.test(s)) {
      reject(s, 'amount is REVENUE described with a raising verb, not a funding round (§11)'); continue;
    }
    if (PNL.test(s)) { reject(s, 'amount is income / profit / loss — never converted into funding (§11)'); continue; }

    // ⚠️ CPG-007 LIVE-RUN FIX — the company must be the party that RAISED:
    // named as the subject, before the raise verb, not as an investor. The
    // first version accepted any sentence naming the company, so every round
    // Zerodha/Rainmatter INVESTED in became "Zerodha's funding".
    const raiseAt = s.search(RAISE);
    const subject = subjectMention(s, companyName, 'funding', raiseAt >= 0 ? raiseAt : undefined);
    if ('reason' in subject) { reject(s, subject.reason); continue; }
    const na = nonAssertive(s);
    if (na) { reject(s, nonAssertiveReason(na)); continue; }

    const temporalType = classifyTemporal(s);
    if (isForwardLooking(temporalType)) { reject(s, `${temporalType} statement — not a completed funding event`); continue; }

    const basis = fundingBasis(s);
    if (basis === AMBIGUOUS_BASIS) {
      reject(s, 'names several funding measures (a total AND a single round) — which one the amount is cannot be determined'); continue;
    }
    // A round name is the value's period only when the statement is about ONE
    // round. "raised a total of $332M over 7 rounds: 2 Seed, … 2 Post IPO"
    // lists round types; it does not make the total an IPO round.
    const roundRaw = basis === 'total raised' ? null : ROUND.exec(s)?.[1] ?? null;
    const round = roundRaw ? roundLabel(roundRaw) : null;
    const { year } = extractPeriod(s);
    values.push({
      field: 'funding', value: String(money.amount), normalizedValue: String(money.amount),
      sourceStatement: s.slice(0, 300),
      // Funding is an EVENT: dated, and it does not decay (CPG-003 §10).
      temporalType: 'HISTORICAL', period: round, year,
      currency: money.currency, unit: money.multiplier === 'none' ? null : money.multiplier,
      approximation: money.approximate, moneyKind: 'funding', method: 'explicit_statement',
      acceptedBecause: `explicit funding statement${basis ? ` (${basis})` : ''}${round ? ` (${round})` : ''}: one amount, company is the party that raised`,
      qualifier: basis,
    });
  }
  return { values, rejected };
}

// ── document date (§20) ──────────────────────────────────────────────────────

const ISO_DATE = /^\d{4}-\d{2}-\d{2}(?:[T ][\d:.]+(?:Z|[+-]\d{2}:?\d{2})?)?$/;

/**
 * The publication date the DOCUMENT declares about itself, or null.
 *
 * Read only from explicit machine-readable markup — `article:published_time`,
 * `datePublished` (meta itemprop or JSON-LD). ISO-8601 only: a free-text date
 * such as "3 March" would need a locale and a year guess, which is inference.
 *
 * This feeds `sourcePublishedAt` (freshness). It is NEVER used as the fiscal
 * period of a value — "FY2024 revenue" in an article published 2026 is FY2024.
 */
export function extractDocumentDate(html: string): string | null {
  const candidates: string[] = [];
  const metaRe = /<meta\b[^>]*>/gi;
  let m: RegExpExecArray | null;
  while ((m = metaRe.exec(html)) !== null) {
    const tag = m[0];
    const key = /(?:property|name|itemprop)\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1]?.toLowerCase();
    const content = /content\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1];
    if (content && (key === 'article:published_time' || key === 'datepublished')) candidates.push(content.trim());
  }
  for (const block of readJsonLdBlocks(html)) {
    const visit = (n: unknown) => {
      if (!n || typeof n !== 'object') return;
      if (Array.isArray(n)) { n.forEach(visit); return; }
      const o = n as Record<string, unknown>;
      if (typeof o.datePublished === 'string') candidates.push(o.datePublished.trim());
      if (Array.isArray(o['@graph'])) (o['@graph'] as unknown[]).forEach(visit);
    };
    visit(block);
  }
  for (const c of candidates) {
    if (!ISO_DATE.test(c)) continue;
    const t = Date.parse(c.length === 10 ? `${c}T00:00:00Z` : c);
    if (Number.isFinite(t)) return new Date(t).toISOString();
  }
  return null;
}

// ── orchestration ────────────────────────────────────────────────────────────

export const SUPPORTED_EXTRACTION_FIELDS: readonly string[] = Object.freeze([
  'revenue', 'founded_year', 'ceo', 'funding',
]);

/** Run the extractor for one field. Unsupported fields yield nothing, loudly. */
export function extractField(field: string, html: string, companyName: string): ExtractionOutcome {
  switch (field) {
    case 'revenue': return extractRevenue(html, companyName);
    case 'founded_year': return extractFoundedYear(html, companyName);
    case 'ceo': return extractCeo(html, companyName);
    case 'funding': return extractFunding(html, companyName);
    default:
      return { values: [], rejected: [{ field, sourceStatement: '', reason: `no deterministic extractor for "${field}" — CPG-007 deliberately covers only ${SUPPORTED_EXTRACTION_FIELDS.join(', ')}` }] };
  }
}
