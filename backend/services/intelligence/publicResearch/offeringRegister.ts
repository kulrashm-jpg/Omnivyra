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
import type { OfferingEvidence, PageRead } from './offering';

export type RegisterStatus = 'official_website_verified' | 'company_declared' | 'independently_corroborated' | 'unknown' | 'conflicting';
export type RegisterField = 'product_line' | 'customer_problem' | 'value_proposition' | 'buyer' | 'use_case' | 'pricing' | 'business_model' | 'free_offer' | 'geography';

export type RegisterEntry = {
  field: RegisterField;
  value: string;
  excerpt: string | null;
  url: string | null;
  observedAt: string | null;
  confidence: 'high' | 'medium' | 'low';
  status: RegisterStatus;
};

export type OfferingRegister = {
  entries: RegisterEntry[];
  /** Fields with no official-website evidence: downstream conclusions that need them stay provisional. */
  missing: RegisterField[];
  provisional: boolean;
};

export type MarketItem = { kind: 'category' | 'segment' | 'problem' | 'geography'; value: string; basis: 'verified' | 'assumption'; evidence: string };
export type MarketView = { items: MarketItem[]; assumptions: string[] };

const GENERIC = /^(free|starter|growth|business|pro|enterprise|compare plans|top-up credits|frequently asked questions|faqs?|help center|contact( support| sales)?|talk to our team|omnivyra|pricing|features|solutions)$/i;
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
  declared: { offering?: string | null; targetCustomer?: string | null; geography?: string | null; businessType?: string | null },
): OfferingRegister {
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
      if (['features', 'product'].includes(p.purpose) && words <= 5 && !/[.!?]$/.test(h) && !GENERIC.test(h)) {
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

/** Stage 2: the market, only from Stage 1. A profile-only fact is an assumption, never a verified market. */
export function deriveMarket(reg: OfferingRegister): MarketView {
  const items: MarketItem[] = [];
  const verified = reg.entries.filter((e) => e.status === 'official_website_verified');
  for (const [re, label] of CATEGORIES) {
    const src = verified.find((e) => ['product_line', 'value_proposition', 'free_offer'].includes(e.field) && re.test(`${e.value} ${e.excerpt ?? ''}`));
    if (src) items.push({ kind: 'category', value: label, basis: 'verified', evidence: `“${src.value}” — ${src.url}` });
  }
  for (const e of verified.filter((x) => x.field === 'buyer')) items.push({ kind: 'segment', value: e.value, basis: 'verified', evidence: `“${e.excerpt}” — ${e.url}` });
  for (const e of verified.filter((x) => x.field === 'customer_problem')) items.push({ kind: 'problem', value: e.value, basis: 'verified', evidence: e.url ?? '' });
  const assumptions: string[] = [];
  for (const e of reg.entries.filter((x) => x.status === 'company_declared' && (x.field === 'geography' || x.field === 'buyer'))) {
    items.push({ kind: e.field === 'geography' ? 'geography' : 'segment', value: e.value, basis: 'assumption', evidence: 'Company profile only' });
    assumptions.push(`${e.field === 'geography' ? 'Geography' : 'Buyer'} “${e.value}” rests on the company profile, not on the website.`);
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
  const segments = market.items.filter((i) => i.kind === 'segment' && i.basis === 'verified').map((i) => i.value.toLowerCase());
  for (const c of market.items.filter((i) => i.kind === 'category' && i.basis === 'verified')) {
    add(`${c.value.toLowerCase().replace(/ and .*$/, '')} software${segments[0] ? ` for ${segments[0]}` : ''}`, `Market category from ${c.evidence.split(' — ')[0]}`);
  }
  for (const p of reg.entries.filter((e) => e.field === 'customer_problem' && e.status === 'official_website_verified')) {
    add(`how to fix ${p.value.replace(/[.!?]$/, '').toLowerCase()}`, 'Customer problem stated on the website');
  }
  for (const l of reg.entries.filter((e) => e.field === 'product_line' && e.status === 'official_website_verified').slice(0, 4)) {
    add(`${l.value.toLowerCase()} tool${segments[0] ? ` for ${segments[0]}` : ''}`, `Product line “${l.value}”`);
  }
  return out.slice(0, 10);
}
