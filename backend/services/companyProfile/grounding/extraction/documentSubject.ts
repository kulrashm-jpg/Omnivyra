/**
 * CPG-007 / CPG-009 — WHO a document statement is about (§12, §13).
 *
 * Split out of documentExtractors.ts (CPG-016) along the boundary the spec
 * already draws: this module decides whether a statement is ABOUT the company
 * (JSON-LD organisation nodes, entity boundary, subject attribution, assertion);
 * documentExtractors.ts decides WHAT value it states. Moved verbatim — no rule,
 * pattern or reason text changed. documentExtractors.ts re-exports the public
 * functions, so every existing import is unchanged.
 *
 * Pure: no I/O, no clock, no randomness.
 */

// ── §12 JSON-LD ──────────────────────────────────────────────────────────────

/** Read `<script type="application/ld+json">` blocks. Never throws. */
export function readJsonLdBlocks(html: string): unknown[] {
  const out: unknown[] = [];
  const re = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    try {
      const parsed = JSON.parse(m[1].trim());
      if (Array.isArray(parsed)) out.push(...parsed);
      else out.push(parsed);
    } catch { /* malformed block — ignored, never guessed at */ }
  }
  return out;
}

export function nodesOfType(blocks: readonly unknown[], type: string): Record<string, unknown>[] {
  const hits: Record<string, unknown>[] = [];
  const visit = (n: unknown) => {
    if (!n || typeof n !== 'object') return;
    if (Array.isArray(n)) { n.forEach(visit); return; }
    const o = n as Record<string, unknown>;
    const t = o['@type'];
    const types = Array.isArray(t) ? t.map(String) : t ? [String(t)] : [];
    if (types.some((x) => x.toLowerCase() === type.toLowerCase())) hits.push(o);
    if (Array.isArray(o['@graph'])) (o['@graph'] as unknown[]).forEach(visit);
  };
  blocks.forEach(visit);
  return hits;
}

// ── §13 entity boundary ──────────────────────────────────────────────────────

/** Verbs that attach a number to a DIFFERENT entity or a non-revenue event. */
// CPG-007 live-run fix: bare "Invest" ("Kamath Brothers Invest INR 250 Cr in
// InCred") did not match `invest(ed|s|ment) in`; up to four words may now sit
// between the verb and "in".
export const FOREIGN_ATTRIBUTION = /\b(acquir(?:e|ed|ing|es)|bought|purchas(?:e|ed)|merg(?:e|ed|er)|invest(?:s|ed|ing|ment)?\s+(?:\S+\s+){0,4}in|stake in|sold to|divest(?:ed)?)\b/i;

/**
 * The company must be namable in the sentence, or the sentence must be clearly
 * about the subject. Without that, a number is unattributed and is dropped.
 */
export function nameTokens(name: string): string[] {
  return name.toLowerCase()
    // CPG-009: "holdings" / "group" are NOT stripped — they usually name a
    // PARENT, a different entity from the operating company.
    .replace(/\b(inc|ltd|limited|pvt|private|llc|llp|corp|corporation|plc)\b/g, ' ')
    .replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter((t) => t.length >= 3);
}

/**
 * ⚠️ CPG-007 FIX — EVERY significant token must appear, as a whole word. The
 * first version accepted ANY token as a substring, so for "Acme Services" any
 * sentence containing "services" was attributed to Acme, and for "Tata
 * Consultancy Services" a Tata Motors revenue sentence passed. Missing a value
 * written only as an acronym ("TCS") is the acceptable cost.
 */
export function mentionsCompany(sentence: string, companyName: string): boolean {
  return companyMentions(sentence, companyName).length > 0;
}

// ── subject attribution (CPG-007 live-run fixes) ─────────────────────────────
//
// Naming the company is not the same as the statement being ABOUT it. The live
// run attributed 15+ funding rounds of OTHER startups to Zerodha because
// Zerodha (via Rainmatter) was their investor, read "Zerodha Capital"'s income
// as Zerodha's funding, and read "Stripe Atlas businesses … $5 billion" as
// Stripe's revenue. Each mention is now classified before it may attribute.

interface Mention { start: number; end: number }
export type MentionContext = 'subject' | 'compound_entity' | 'investor_or_owner' | 'person' | 'joint_subject' | 'related_entity';

const LEGAL_NOISE = String.raw`(?:inc|ltd|limited|pvt|private|llc|llp|corp|corporation|plc)`;
export const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Where the company is named: its significant tokens, contiguous, as whole words. */
function companyMentions(sentence: string, companyName: string): Mention[] {
  const tokens = nameTokens(companyName);
  if (tokens.length === 0) return [];
  const sep = String.raw`[^a-z0-9]+(?:${LEGAL_NOISE}[^a-z0-9]+)*`;
  const re = new RegExp(String.raw`(?<![a-z0-9])${tokens.map(escapeRe).join(sep)}(?![a-z0-9])`, 'gi');
  const out: Mention[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(sentence)) !== null) out.push({ start: m.index, end: m.index + m[0].length });
  return out;
}

/** A following Capitalised word makes a different entity: "Stripe Atlas", "Zerodha Capital". */
const COMPOUND_NEXT = /^\s+([A-Z][A-Za-z]{2,})\b/;
// CPG-009: Holdings / Group removed — "Acme Holdings" is a parent entity, not
// "Acme" plus legal noise; attributing its figures to Acme is a Case-B collapse.
const NOT_COMPOUND = /^(Inc|Ltd|Limited|Corp|Corporation|LLC|LLP|PLC|Pvt|Private|CEO|CFO|COO|CTO|Chief|Co)$/;
const PERSON_AFTER = /^(?:['’]s)?\s*(?:co-?founders?|founders?|chairman|chairperson)\b/i;
const OWNER_AFTER = /^(?:['’]s)?\s*(?:investment arm|investment initiative|venture arm|venture capital arm|health initiative|family office|fund)\b|^\s*-\s*backed\b|^\s+backed\b/i;
/** Words that make the NEXT mention an investor/owner, not the actor. */
const OWNER_BEFORE_STRICT = /\b(?:by|from|of|backed by|led by|headed by|including|with|via)\s+(?:the\s+)?$/i;
/** CPG-009: "ABC, which owns the XYZ brand, …" — the mention is the OWNED thing; the owner acts. */
const OWNED_BEFORE = /\b(?:owns|owned|operates|runs|parent (?:company )?of|owner of)\s+(?:the\s+|its\s+)?$/i;
/** CPG-009: "XYZ, a brand of ABC, reported revenue …" — a brand's revenue is its legal entity's. */
const BRAND_OF_AFTER = /^\s*,?\s*(?:is\s+)?(?:a|an|the)\s+(?:brand|trading name|product|business unit|division|unit)\s+(?:of|owned by)\b/i;
/** For revenue, "revenue of <Company>" is the company's own revenue, so "of" is allowed. */
const OWNER_BEFORE_REVENUE = /\b(?:by|from|backed by|led by|headed by|including|with|via)\s+(?:the\s+)?$/i;

/** "Zerodha's Kamath Brothers", "Zerodha's Rainmatter": the possessed entity is the actor. */
const POSSESSED_ENTITY = /^['’]s\s+([A-Z][A-Za-z]{2,})\b/;
const FINANCIAL_PROPER = /^(Series|Seed|IPO|FY|Q[1-4]|Annual|Fiscal)$/;

/**
 * "Cloudflare and Akamai together reported revenue of $5.66 billion": a joint
 * subject's figure is not the company's own. Only "and"/"&" joins are read —
 * a comma before the name is too often an attribution ("According to Get
 * Latka, Stripe …") to be treated as a list.
 */
const JOINT_AFTER = /^\s+(?:and|&)\s+([A-Z][A-Za-z]{1,})/;
const JOINT_BEFORE = /\b[A-Z][A-Za-z]+\s+(?:and|&)\s+$/;
const JOINT_WORDS = /\b(together|combined|jointly)\b/i;

function mentionContext(sentence: string, m: Mention, field: string): MentionContext {
  const after = sentence.slice(m.end);
  const before = sentence.slice(Math.max(0, m.start - 24), m.start);
  const joint = JOINT_AFTER.exec(after);
  if ((joint && !NOT_COMPOUND.test(joint[1])) || JOINT_BEFORE.test(before)) return 'joint_subject';
  if (JOINT_WORDS.test(sentence) && (field === 'revenue' || field === 'funding')) return 'joint_subject';
  const next = COMPOUND_NEXT.exec(after);
  if (next && !NOT_COMPOUND.test(next[1])) return 'compound_entity';
  const possessed = POSSESSED_ENTITY.exec(after);
  if (possessed && !FINANCIAL_PROPER.test(possessed[1]) && !NOT_COMPOUND.test(possessed[1])) return 'compound_entity';
  if (PERSON_AFTER.test(after)) return 'person';
  if (OWNER_AFTER.test(after)) return 'investor_or_owner';
  const ownerBefore = field === 'revenue' ? OWNER_BEFORE_REVENUE : OWNER_BEFORE_STRICT;
  if (ownerBefore.test(before)) return 'investor_or_owner';
  if (OWNED_BEFORE.test(before)) return 'related_entity';
  if (field === 'revenue' && BRAND_OF_AFTER.test(after)) return 'related_entity';
  return 'subject';
}

/**
 * ⚠️ CPG-007 LIVE-RUN FIX — statements that do not ASSERT a fact. A live
 * article refuting a rumour ("The claim that Stripe raises $1 billion in new
 * financing round does not match what the company has announced.") produced
 * FIVE funding values. Negated, hypothetical, speculative and reported-claim
 * statements are refused for every field.
 */
const NON_ASSERTIVE = /\b(not|never|no longer|denied|denies|deny|false|untrue|rumou?r(?:s|ed)?|speculat\w*|alleged(?:ly)?|in talks|could|would|might|if|whether|hypothetical|story in which|framing that|claims? (?:that|like)|contrary to)\b|n['’]t\b/i;
/** Lower-case only: "may" is a modal, "May" is a month ("raised $X in May 2023"). */
const MODAL_MAY = /\bmay\b/;

/** The word that makes a statement non-assertive, or null. */
export function nonAssertive(s: string): string | null {
  return NON_ASSERTIVE.exec(s)?.[0] ?? MODAL_MAY.exec(s)?.[0] ?? null;
}
export const nonAssertiveReason = (w: string) => `statement is negated, hypothetical or reports a claim ("${w}") — not an assertion of fact`;

const CONTEXT_REASON: Readonly<Record<Exclude<MentionContext, 'subject'>, string>> = Object.freeze({
  compound_entity: 'company is named only as part of a different entity (a product, subsidiary or programme)',
  investor_or_owner: 'company is named only as an investor, owner or backer — the statement is about another entity',
  person: 'company is named only to identify a person (e.g. "<company> co-founder …")',
  joint_subject: 'statement is about several entities jointly ("<company> and <other>") — the figure is not the company\'s alone',
  related_entity: 'company is named as owned by, or as the brand / product / unit of, another entity — the figure belongs to that related (legal) entity; attribution must stay explicit',
});

/**
 * Is the company named as the ACTOR of the statement — optionally before a
 * given position (the raise verb)? Returns `ok`, or the reason every mention
 * failed, so the rejection is inspectable.
 */
export function subjectMention(sentence: string, companyName: string, field: string, before?: number):
  { ok: true } | { ok: false; reason: string } {
  const mentions = companyMentions(sentence, companyName);
  if (mentions.length === 0) return { ok: false, reason: 'company not named in the statement — attribution ambiguous' };
  let firstReason: string | null = null;
  for (const m of mentions) {
    const ctx = mentionContext(sentence, m, field);
    if (ctx !== 'subject') { firstReason ??= CONTEXT_REASON[ctx]; continue; }
    if (before !== undefined && m.start > before) {
      firstReason ??= 'company is named only AFTER the event — another entity is the actor';
      continue;
    }
    return { ok: true };
  }
  return { ok: false, reason: firstReason ?? 'company not named as the subject' };
}

/**
 * ⚠️ CPG-007 FIX — a JSON-LD Organization node is used ONLY when it IS the
 * subject company. News pages routinely embed the PUBLISHER's Organization
 * node; without this, a Reuters article about Cloudflare yielded Reuters'
 * founding date as Cloudflare's. Checked against name, legalName and
 * alternateName; all significant tokens must match.
 */
export function orgIsSubject(org: Record<string, unknown>, companyName: string): boolean {
  const alt = org.alternateName;
  const names = [org.name, org.legalName, ...(Array.isArray(alt) ? alt : [alt])]
    .filter((n): n is string => typeof n === 'string' && n.trim().length > 0);
  return names.some((n) => {
    const have = new Set(nameTokens(n));
    const want = nameTokens(companyName);
    return want.length > 0 && want.every((t) => have.has(t));
  });
}
