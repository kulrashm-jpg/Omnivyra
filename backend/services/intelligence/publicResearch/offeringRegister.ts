/**
 * Public research — Stage 1 and 2 of competitor discovery: what the company offers, then which
 * market that places it in. Deterministic: every entry quotes the official page it came from.
 *
 *   Stage 1  offering register  — product lines, customer problem, value proposition, buyers, pricing,
 *            business model, free offer, geography; each with URL, verbatim excerpt, date, status.
 *   Stage 2  market             — categories, segments, problem statements and geography derived only
 *            from Stage 1 entries; anything that rests on the company profile alone is an assumption.
 *
 * Nothing is inferred from the company name, generic SaaS wording or an AI-written description.
 */
import { judgeClaim, type OfferingEvidence, type PageRead } from './offering';
import type { ProfileEvidence, ProfileFact } from './profileEvidence';

export type RegisterStatus = 'official_website_verified' | 'company_declared' | 'independently_corroborated' | 'unknown' | 'conflicting';
export type RegisterField = 'product_line' | 'customer_problem' | 'value_proposition' | 'buyer' | 'use_case' | 'pricing' | 'business_model' | 'free_offer' | 'geography'
  | 'industry' | 'differentiator' | 'revenue' | 'team_size' | 'founded';

export type RegisterEntry = {
  field: RegisterField;
  value: string;
  excerpt: string | null;
  url: string | null;
  observedAt: string | null;
  confidence: 'high' | 'medium' | 'low';
  status: RegisterStatus;
  /** Company-profile facts: which record and field said it, when, and who wrote it. */
  provenance?: ProfileFact['provenance'] | null;
  /** The profile also declares this website-verified entry (one claim, one record). */
  alsoDeclared?: ProfileFact['provenance'] | null;
  /** The value the other source gives, when the two disagree (both entries are kept). */
  conflictsWith?: string | null;
  stale?: boolean;
};

export type OfferingRegister = {
  entries: RegisterEntry[];
  /** Fields with no official-website evidence: downstream conclusions that need them stay provisional. */
  missing: RegisterField[];
  provisional: boolean;
  /** The company-profile lookup behind any company-declared entries; null when none was attempted. */
  profile?: { status: ProfileEvidence['status']; detail: string | null; checkedAt: string; facts: number } | null;
};

export type MarketItem = { kind: 'category' | 'segment' | 'problem' | 'geography'; value: string; basis: 'verified' | 'assumption'; evidence: string };
export type MarketView = { items: MarketItem[]; assumptions: string[] };

const GENERIC = /^(free|starter|growth|business|pro|enterprise|compare plans|top-up credits|frequently asked questions|faqs?|help center|contact( support| sales)?|talk to our team|pricing|features|solutions)$/i;
const FOUNDED = /\b(?:founded|established|started)\s+(?:in\s+)?((?:19|20)\d{2})\b/i;
const PROBLEM = /\b(fragment|fail|limit|struggl|scatter|disconnect|never designed|chaos|siloed|manual|wast)/i;
const ROLES: Array<[RegExp, string]> = [
  [/\bfounders?\b|\bcxo\b|\bceo\b/i, 'Founders and executives'], [/\bmarketing leads?\b|\bcmo\b|\bmarketing managers?\b/i, 'Marketing leads'],
  [/\bgrowth teams?\b/i, 'Growth teams'], [/\bcontent strategists?\b|\bcontent teams?\b/i, 'Content strategists'],
  [/\bagenc(y|ies)\b/i, 'Agencies'], [/\bsolo operators?\b|\bfreelancers?\b|\bcreators?\b/i, 'Solo operators and creators'],
  [/\bSMBs?\b|\bsmall (and medium|businesses?)\b/i, 'Small and medium businesses'], [/\bstartups?\b/i, 'Startups'],
];

/** A short passage of `text` around the first match of `re`, on word boundaries. */
function around(text: string, re: RegExp, span = 90): string | null {
  const m = re.exec(text);
  if (!m) return null;
  const from = Math.max(0, text.lastIndexOf(' ', Math.max(0, m.index - span)) + 1);
  const to = text.indexOf(' ', Math.min(text.length, m.index + m[0].length + span));
  return text.slice(m.index - span <= 0 ? 0 : from, to < 0 ? text.length : to).trim();
}

/** The sentence that follows a heading in the page text (its description), when there is one. */
function after(text: string, heading: string): string | null {
  const at = text.indexOf(heading);
  if (at < 0) return null;
  const rest = text.slice(at + heading.length).trim();
  const sentence = /^(.{20,220}?[.!?])(\s|$)/.exec(rest)?.[1] ?? null;
  return sentence && !sentence.includes(heading) ? sentence : null;
}

export function buildOfferingRegister(
  off: OfferingEvidence,
  declared: { offering?: string | null; targetCustomer?: string | null; geography?: string | null; businessType?: string | null; brand?: string | null },
): OfferingRegister {
  const brand = (declared.brand ?? '').toLowerCase().trim();
  const read = off.pages.filter((p): p is PageRead & { text: string } => p.read && typeof p.text === 'string');
  const entries: RegisterEntry[] = [];
  const add = (e: Omit<RegisterEntry, 'confidence'> & { confidence?: RegisterEntry['confidence'] }) => {
    if (!entries.some((x) => x.field === e.field && x.value.toLowerCase() === e.value.toLowerCase())) entries.push({ confidence: 'high', ...e });
  };

  for (const p of read) {
    for (const h of p.headings ?? []) {
      const words = h.split(/\s+/).length;
      // Product lines: short, title-style headings on product / feature / solution pages.
      // Product lines: short, title-style headings on product / feature pages (solution pages carry demo panels).
      if (['features', 'product'].includes(p.purpose) && words <= 5 && !/[.!?]$/.test(h) && !GENERIC.test(h) && h.toLowerCase() !== brand) {
        add({ field: 'product_line', value: h, excerpt: after(p.text, h) ?? h, url: p.url, observedAt: p.fetchedAt, status: 'official_website_verified' });
      } else if (/[.!?]$/.test(h) && ['home', 'features', 'solutions', 'product'].includes(p.purpose) && (p.headings ?? []).indexOf(h) < 3) {
        add({ field: PROBLEM.test(h) ? 'customer_problem' : 'value_proposition', value: h, excerpt: h, url: p.url, observedAt: p.fetchedAt, status: 'official_website_verified' });
      }
      if (/^free\b.*\b(snapshot|report|audit|plan|trial)\b/i.test(h)) add({ field: 'free_offer', value: h, excerpt: h, url: p.url, observedAt: p.fetchedAt, status: 'official_website_verified' });
    }
    for (const [re, role] of ROLES) {
      const ex = ['solutions', 'pricing', 'home', 'about'].includes(p.purpose) ? around(p.text, re, 45) : null;
      if (ex) add({ field: 'buyer', value: role, excerpt: ex, url: p.url, observedAt: p.fetchedAt, status: 'official_website_verified', confidence: 'medium' });
    }
    const founded = ['about', 'home'].includes(p.purpose) ? FOUNDED.exec(p.text) : null;
    if (founded) add({ field: 'founded', value: founded[1], excerpt: around(p.text, FOUNDED, 40), url: p.url, observedAt: p.fetchedAt, status: 'official_website_verified' });
    if (p.purpose === 'pricing') {
      const model = around(p.text, /plans differ (only )?by[^.]*\.|pay by usage[^.]*\./i, 60);
      if (model) add({ field: 'business_model', value: 'Credit-based usage plans; every plan includes the full platform', excerpt: model, url: p.url, observedAt: p.fetchedAt, status: 'official_website_verified' });
      const currencies = [...new Set([...p.text.matchAll(/\b(USD|INR|EUR|GBP|AUD|CAD)\b/g)].map((m) => m[1]))];
      if (currencies.length) add({ field: 'geography', value: `Prices shown in ${currencies.join(', ')} — the markets served are not stated`, excerpt: around(p.text, /\b(USD|INR|EUR)\b/), url: p.url, observedAt: p.fetchedAt, status: 'official_website_verified', confidence: 'low' });
    }
  }
  if (off.pricing) add({ field: 'pricing', value: 'Published plan prices', excerpt: off.pricing.excerpt, url: off.pricing.url, observedAt: off.checkedAt, status: 'official_website_verified' });
  if (off.freePlan) add({ field: 'free_offer', value: 'Free plan', excerpt: off.freePlan.excerpt, url: off.freePlan.url, observedAt: off.checkedAt, status: 'official_website_verified' });

  // The company profile: kept, but labelled for what it is.
  const claimed = (field: RegisterField, value: string | null | undefined) => {
    if (value && !entries.some((x) => x.field === field && x.value.toLowerCase() === value.toLowerCase())) {
      entries.push({ field, value, excerpt: null, url: null, observedAt: null, confidence: 'low', status: 'company_declared' });
    }
  };
  claimed('value_proposition', declared.offering);
  claimed('buyer', declared.targetCustomer);
  claimed('geography', declared.geography);
  for (const c of off.capabilities) {
    entries.push({ field: 'use_case', value: c.claim, excerpt: c.excerpt, url: c.sourceUrl, observedAt: off.checkedAt, confidence: c.confidence,
      status: c.state === 'website_verified' ? 'official_website_verified' : c.state === 'independently_corroborated' ? 'independently_corroborated' : c.state === 'contradictory' ? 'conflicting' : c.state === 'unknown' ? 'unknown' : 'company_declared' });
  }

  const has = (f: RegisterField) => entries.some((e) => e.field === f && e.status === 'official_website_verified');
  const missing = (['product_line', 'customer_problem', 'buyer', 'pricing', 'geography'] as RegisterField[]).filter((f) => !has(f) || (f === 'geography' && !entries.some((e) => e.field === 'geography' && e.status === 'official_website_verified' && !/not stated/.test(e.value))));
  return { entries, missing, provisional: missing.includes('product_line') || missing.includes('buyer') };
}

const CATEGORIES: Array<[RegExp, string]> = [
  [/intelligence|reporting|visibility|authority|\bseo\b|\baeo\b|\bgeo\b|snapshot/i, 'AI-search visibility and digital-authority reporting'],
  [/content/i, 'Content creation and publishing operations'],
  [/campaign/i, 'Campaign planning and execution'],
  [/engagement|market intelligence|competitor/i, 'Engagement and market monitoring'],
  [/marketing operat|operating layer|one system|platform/i, 'All-in-one marketing operations platform'],
];

const profileSource = (e: RegisterEntry) => (e.provenance ? `Company profile · ${e.provenance.profileField}${e.provenance.capturedAt ? ` · ${e.provenance.capturedAt.slice(0, 10)}` : ''}` : 'Company profile only');

/** Stage 2: the market, only from Stage 1. A profile-only fact is an assumption, never a verified market. */
export function deriveMarket(reg: OfferingRegister): MarketView {
  const items: MarketItem[] = [];
  const verified = reg.entries.filter((e) => e.status === 'official_website_verified');
  const offerFields = (e: RegisterEntry) => ['product_line', 'value_proposition', 'free_offer'].includes(e.field);
  for (const [re, label] of CATEGORIES) {
    // The evidence quoted is the words that match: an entry's own name first, else the passage of its excerpt.
    const byValue = verified.find((e) => offerFields(e) && re.test(e.value));
    const byExcerpt = byValue ? null : verified.find((e) => offerFields(e) && re.test(e.excerpt ?? ''));
    if (byValue) items.push({ kind: 'category', value: label, basis: 'verified', evidence: `“${byValue.value}” — ${byValue.url}` });
    else if (byExcerpt) {
      const ex = byExcerpt.excerpt ?? '';
      const at = ex.search(re);
      items.push({ kind: 'category', value: label, basis: 'verified', evidence: `“${ex.slice(Math.max(0, at - 40), at + 60).trim()}” — ${byExcerpt.url}` });
    }
  }
  const seenSeg = new Set<string>();
  for (const e of verified.filter((x) => x.field === 'buyer')) {
    const k = e.value.toLowerCase().replace(/[^a-z]+/g, ' ').replace(/s\b/g, '').trim();
    if (seenSeg.has(k)) continue;
    seenSeg.add(k);
    items.push({ kind: 'segment', value: e.value, basis: 'verified', evidence: `“${e.excerpt}” — ${e.url}` });
  }
  for (const e of verified.filter((x) => x.field === 'customer_problem')) items.push({ kind: 'problem', value: e.value, basis: 'verified', evidence: e.url ?? '' });
  const assumptions: string[] = [];
  for (const e of reg.entries.filter((x) => x.status === 'company_declared' && (x.field === 'geography' || x.field === 'buyer' || x.field === 'industry'))) {
    items.push({ kind: e.field === 'geography' ? 'geography' : e.field === 'industry' ? 'category' : 'segment', value: e.value, basis: 'assumption', evidence: profileSource(e) });
    assumptions.push(`${e.field === 'geography' ? 'Geography' : e.field === 'industry' ? 'Industry' : 'Buyer'} “${e.value}” rests on the company profile, not on the website.`);
  }
  const geo = verified.find((e) => e.field === 'geography');
  if (geo) items.push({ kind: 'geography', value: geo.value, basis: 'verified', evidence: `“${geo.excerpt}” — ${geo.url}` });
  return { items, assumptions };
}

/**
 * Buyer-intent queries from the validated offering and market only — never from a category label
 * template. They are "proposed" until a search actually runs them.
 */
export function proposeQueries(reg: OfferingRegister, market: MarketView): Array<{ query: string; basis: string; status: 'proposed' }> {
  const out: Array<{ query: string; basis: string; status: 'proposed' }> = [];
  const add = (query: string, basis: string) => { if (!out.some((q) => q.query.toLowerCase() === query.toLowerCase())) out.push({ query, basis, status: 'proposed' }); };
  // The broadest buyer the site names leads (how a buyer describes themself in a search), then the rest in site order.
  const segments = market.items.filter((i) => i.kind === 'segment' && i.basis === 'verified').map((i) => i.value.toLowerCase())
    .sort((a, b) => Number(/small (and medium )?business|smb|startup/.test(b)) - Number(/small (and medium )?business|smb|startup/.test(a)));
  for (const c of market.items.filter((i) => i.kind === 'category' && i.basis === 'verified')) {
    add(`${c.value.toLowerCase().replace(/ and .*$/, '')} software${segments[0] ? ` for ${segments[0]}` : ''}`, `Market category from ${c.evidence.split(' — ')[0]}`);
  }
  // A problem becomes a query only when the site states it as a short noun phrase ("fragmented marketing
  // tools"); a full sentence ("operations rarely fail from lack of effort") is not what a buyer types.
  for (const p of reg.entries.filter((e) => e.field === 'customer_problem' && e.status === 'official_website_verified')) {
    const phrase = p.value.replace(/[.!?,]+$/, '').toLowerCase().trim();
    if (phrase.split(/\s+/).length > 6 || /\b(is|are|was|were|rarely|never|sees?|happens?|happening|fail|fails|limit|limits|but)\b/.test(phrase)) continue;
    add(`how to fix ${phrase}`, 'Customer problem stated on the website');
  }
  for (const l of reg.entries.filter((e) => e.field === 'product_line' && e.status === 'official_website_verified').slice(0, 4)) {
    add(`${l.value.toLowerCase()} tool${segments[0] ? ` for ${segments[0]}` : ''}`, `Product line “${l.value}”`);
  }
  // Company-declared offerings the website does not state widen the query set — labelled as declared,
  // with reserved room so they are not cut by the cap. Stale profile facts never drive a query.
  const declared = reg.entries.filter((e) => ['value_proposition', 'product_line'].includes(e.field) && e.status === 'company_declared' && e.provenance && !e.stale).slice(0, 2);
  const buyer = reg.entries.find((e) => e.field === 'buyer' && e.provenance && !e.stale) ?? reg.entries.find((e) => e.field === 'buyer' && e.status === 'official_website_verified');
  // "Startups, micro, SMB, and later enterprises." → "startups": the first buyer named, without punctuation.
  const who = buyer ? buyer.value.split(/[,;]| and later /)[0].replace(/[.!?]+$/, '').trim().toLowerCase() : '';
  const extra = declared.map((d) => ({ query: `${d.value.replace(/[.!?]+$/, '').toLowerCase()}${who ? ` for ${who}` : ''}`, basis: `Company profile (declared, not verified on the website): “${d.value}”`, status: 'proposed' as const }))
    .filter((q) => !out.some((o) => o.query === q.query));
  return [...out.slice(0, 10 - extra.length), ...extra];
}

/** Fields that hold one value: a website value and a different profile value conflict. */
const SINGLE: RegisterField[] = ['founded', 'team_size', 'revenue'];
/** Profile claims that can be looked for, word for word, on the website. */
const CHECKABLE: RegisterField[] = ['value_proposition', 'product_line', 'buyer', 'differentiator', 'customer_problem'];
const FIELD_OF: Record<ProfileFact['field'], RegisterField> = {
  offering: 'value_proposition', product_line: 'product_line', buyer: 'buyer', industry: 'industry', geography: 'geography',
  business_model: 'business_model', differentiator: 'differentiator', revenue: 'revenue', team_size: 'team_size', founded: 'founded', customer_problem: 'customer_problem',
};
const norm = (v: string) => v.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/**
 * Add company-profile facts to the register without overwriting anything:
 *   - the same claim already in the register is not duplicated (its record notes the profile too);
 *   - a claim the website states word for word is website-verified, with the website excerpt;
 *   - a single-valued fact that differs from the website is kept on BOTH sides as conflicting;
 *   - everything else stays company-declared, with its record, field, capture time and author.
 * A stale profile fact is labelled and never outranks website evidence.
 */
export function applyProfileEvidence(reg: OfferingRegister, profile: ProfileEvidence | null, off: OfferingEvidence | null): OfferingRegister {
  const entries = reg.entries.map((e) => ({ ...e }));
  const pages = (off?.pages ?? []).filter((p): p is PageRead & { text: string } => p.read && typeof p.text === 'string').map((p) => ({ url: p.url, text: p.text }));
  for (const f of profile?.facts ?? []) {
    const field = FIELD_OF[f.field];
    const same = entries.find((e) => e.field === field && norm(e.value) === norm(f.value));
    if (same) {
      if (same.status === 'company_declared' && !same.provenance) Object.assign(same, { provenance: f.provenance, stale: f.stale });
      else if (same.status !== 'company_declared') same.alsoDeclared = f.provenance;
      continue;
    }
    if (SINGLE.includes(field)) {
      const site = entries.find((e) => e.field === field && e.status === 'official_website_verified');
      if (site) {
        site.status = 'conflicting';
        site.conflictsWith = `${f.value} (company profile)`;
        entries.push({ field, value: f.value, excerpt: null, url: null, observedAt: f.provenance.capturedAt, confidence: 'low', status: 'conflicting',
          provenance: f.provenance, conflictsWith: `${site.value} (website)`, stale: f.stale });
        continue;
      }
    }
    const onSite = CHECKABLE.includes(field) && pages.length ? judgeClaim(f.value, pages) : null;
    if (onSite?.state === 'website_verified') {
      entries.push({ field, value: f.value, excerpt: onSite.excerpt, url: onSite.sourceUrl, observedAt: off?.checkedAt ?? null, confidence: onSite.confidence,
        status: 'official_website_verified', alsoDeclared: f.provenance });
    } else {
      entries.push({ field, value: f.value, excerpt: null, url: null, observedAt: f.provenance.capturedAt, confidence: f.stale ? 'low' : 'medium',
        status: onSite?.state === 'contradictory' ? 'conflicting' : 'company_declared', provenance: f.provenance, stale: f.stale,
        conflictsWith: onSite?.state === 'contradictory' ? `${onSite.excerpt ?? ''} (website)` : null });
    }
  }
  const verified = (f: RegisterField) => entries.some((e) => e.field === f && e.status === 'official_website_verified');
  return {
    entries,
    missing: reg.missing.filter((f) => !verified(f)),
    provisional: !verified('product_line') || !verified('buyer'),
    profile: profile ? { status: profile.status, detail: profile.detail, checkedAt: profile.checkedAt, facts: profile.facts.length } : reg.profile ?? null,
  };
}
