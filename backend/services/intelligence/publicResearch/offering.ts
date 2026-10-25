/**
 * Public research — what the company offers, declared versus shown on its own website.
 *
 * The company profile states an offering and a list of capabilities; that is the company's claim.
 * This step reads the live site (the homepage and the product, feature, pricing, solutions, FAQ and
 * help pages it links to) and gives each claim the strongest state the evidence supports:
 *   website_verified            the site's own text states it (excerpt kept)
 *   independently_corroborated  a confirmed third-party page states it as well
 *   contradictory               the site marks it as not available ("coming soon", "not yet")
 *   company_declared            declared in the profile; the pages read do not state it
 *   unknown                     no page could be read, so nothing can be said either way
 * Matching is literal (every significant word of the claim inside one short passage), so a claim is
 * never "verified" by a model's paraphrase. Pages read are listed with their HTTP status.
 */
import { readCapped, safeFetch } from '../../../../lib/security/safeFetch';

export type OfferingState = 'website_verified' | 'independently_corroborated' | 'contradictory' | 'company_declared' | 'unknown';
export type PagePurpose = 'home' | 'product' | 'features' | 'pricing' | 'solutions' | 'faq' | 'help' | 'about';

export type PageRead = {
  url: string; purpose: PagePurpose; status: number | null; read: boolean; fetchedAt: string;
  /** The page's own h1–h3 headings, verbatim: what the company says it offers, in its own words. */
  headings?: string[];
  /** Visible text (capped), kept so register entries can quote the page. */
  text?: string;
};

/** h1–h3 headings, in page order, de-duplicated; each 3–140 characters. */
export function headingsOf(html: string): string[] {
  const out: string[] = [];
  for (const m of html.matchAll(/<h([1-3])[^>]*>([\s\S]*?)<\/h\1>/gi)) {
    const t = pageText(m[2]).replace(/\s+/g, ' ').trim();
    if (t.length >= 3 && t.length <= 140 && !out.includes(t)) out.push(t);
  }
  return out.slice(0, 40);
}
export type ClaimEvidence = {
  claim: string;
  state: OfferingState;
  sourceUrl: string | null;
  excerpt: string | null;
  confidence: 'high' | 'medium' | 'low';
  basis: string;
};
export type OfferingEvidence = {
  checkedAt: string;
  pages: PageRead[];
  /** How the site names itself: homepage title, first heading and meta description, verbatim. */
  selfDescription: { title: string | null; heading: string | null; description: string | null; url: string } | null;
  offering: ClaimEvidence | null;
  capabilities: ClaimEvidence[];
  /** Published on the pricing page, verbatim. */
  pricing: { excerpt: string; url: string } | null;
  freePlan: { excerpt: string; url: string } | null;
};

const UA = 'Mozilla/5.0 (compatible; OmnivyraSnapshot/1.0; +https://www.omnivyra.com)';
const PURPOSE: Array<[RegExp, PagePurpose]> = [
  [/^\/(pricing|plans?)(\/|$)/i, 'pricing'], [/^\/(features?)(\/|$)/i, 'features'], [/^\/(solutions?|use-cases?)(\/|$)/i, 'solutions'],
  [/^\/(products?|platform|how-it-works)(\/|$)/i, 'product'], [/^\/(faqs?)(\/|$)/i, 'faq'], [/^\/(help|support|docs)(\/|$)/i, 'help'], [/^\/(about|company)(\/|$)/i, 'about'],
];
export const purposeOf = (path: string): PagePurpose | null => (path === '/' ? 'home' : PURPOSE.find(([re]) => re.test(path))?.[1] ?? null);

/** Visible text plus the site's own JSON-LD (an FAQ in structured data is the site speaking). */
export function pageText(html: string): string {
  return html
    // JSON-LD: keep only its text values ("name", "text", "description"), not the JSON syntax.
    .replace(/<script[^>]*ld\+json[^>]*>([\s\S]*?)<\/script>/gi, (_m, json: string) =>
      ` ${[...json.matchAll(/"(?:name|text|description)"\s*:\s*"((?:[^"\\]|\\.)*)"/g)].map((x) => x[1]).join('. ')} `)
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&').replace(/&#x27;|&#39;|&rsquo;/g, '\'').replace(/&nbsp;|&[a-z#0-9]+;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** A passage around [at, at+len) with ~60 characters either side, cut on word boundaries. */
const clipWords = (t: string, at: number, len: number): string => {
  const from = Math.max(0, t.lastIndexOf(' ', Math.max(0, at - 60)) + 1);
  const to = t.indexOf(' ', Math.min(t.length, at + len + 60));
  return t.slice(at - 60 <= 0 ? 0 : from, to < 0 ? t.length : to).trim();
};

const STOP = new Set(['and', 'the', 'for', 'with', 'your', 'from', 'into', 'that', 'this', 'system', 'systems', 'platform', 'software', 'tool', 'tools', 'driven', 'powered', 'based', 'solution', 'solutions']);
const stem = (w: string) => w.replace(/ies$/, 'y').replace(/([^s])s$/, '$1'); // plurals only: "marketing" is not "market"
const words = (s: string) => [...new Set(s.toLowerCase().split(/[^a-z0-9]+/).filter((w) => (w.length >= 3 || w === 'ai') && !STOP.has(w)).map(stem))];
const NEGATED = /(coming soon|not yet available|not available|no longer|roadmap|planned for)/i;

/** The first short passage on any page that contains every significant word of the claim (window: the key words plus six, at least six words). */
export function findPassage(claim: string, pages: Array<{ url: string; text: string }>): { url: string; excerpt: string; exact: boolean } | null {
  const want = words(claim);
  if (!want.length) return null;
  const phrase = claim.toLowerCase().replace(/\s+/g, ' ').trim();
  for (const p of pages) {
    const lc = p.text.toLowerCase();
    const at = lc.indexOf(phrase);
    if (at >= 0) return { url: p.url, excerpt: clipWords(p.text, at, phrase.length), exact: true };
  }
  for (const p of pages) {
    const toks = p.text.split(/\s+/);
    // A token such as "AI-driven" holds two words; split it the same way the claim was split.
    const stems = toks.map((t) => t.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean).map(stem));
    for (let i = 0; i < toks.length; i++) {
      if (!stems[i].some((s) => want.includes(s))) continue;
      const span = Math.max(6, want.length + 6);
      const window = stems.slice(i, i + span).flat();
      if (want.every((w) => window.includes(w))) return { url: p.url, excerpt: toks.slice(Math.max(0, i - 6), i + span + 4).join(' ').slice(0, 220), exact: false };
    }
  }
  return null;
}

/** One claim against the site's pages and, optionally, confirmed third-party pages. */
export function judgeClaim(claim: string, site: Array<{ url: string; text: string }>, thirdParty: Array<{ url: string; text: string }> = []): ClaimEvidence {
  if (!site.length) return { claim, state: 'unknown', sourceUrl: null, excerpt: null, confidence: 'low', basis: 'No page of the website could be read.' };
  const own = findPassage(claim, site);
  if (own && NEGATED.test(own.excerpt)) {
    return { claim, state: 'contradictory', sourceUrl: own.url, excerpt: own.excerpt, confidence: 'medium', basis: 'The site mentions it as not yet available.' };
  }
  if (own) {
    const other = findPassage(claim, thirdParty);
    if (other) return { claim, state: 'independently_corroborated', sourceUrl: other.url, excerpt: other.excerpt, confidence: 'high', basis: `Stated on the website (${own.url}) and on a third-party page.` };
    return { claim, state: 'website_verified', sourceUrl: own.url, excerpt: own.excerpt, confidence: own.exact ? 'high' : 'medium',
      basis: own.exact ? 'The website uses the same words.' : 'Every key word appears in one passage of the website.' };
  }
  return { claim, state: 'company_declared', sourceUrl: null, excerpt: null, confidence: 'low', basis: `Not stated in these words on the ${site.length} page(s) read.` };
}

const PRICE = /(?:\$|€|£|₹|USD\s?|INR\s?|EUR\s?)\s?[1-9][\d,]*(?:\.\d+)?(?:\s*(?:\$|€|£|₹)\s?[\d,]+)?\s*\/\s*(?:month|mo|year|yr)/i;
// No \b before a currency sign: "$" after a space is not a word boundary.
const FREE = /(\bfree plan\b|\bfree tier\b|\bfree trial\b|\bfree credits\b|[$₹€]0\b)/i;

export function publishedPricing(pages: Array<{ url: string; text: string; purpose: PagePurpose }>): Pick<OfferingEvidence, 'pricing' | 'freePlan'> {
  const pricingPages = pages.filter((p) => p.purpose === 'pricing');
  let pricing: OfferingEvidence['pricing'] = null;
  let freePlan: OfferingEvidence['freePlan'] = null;
  for (const p of pricingPages) {
    const m = PRICE.exec(p.text);
    if (m && !pricing) pricing = { excerpt: clipWords(p.text, m.index, m[0].length), url: p.url };
    const f = FREE.exec(p.text);
    if (f && !freePlan) freePlan = { excerpt: clipWords(p.text, f.index, f[0].length), url: p.url };
  }
  return { pricing, freePlan };
}

async function get(url: string, timeoutMs: number): Promise<{ status: number; html: string } | null> {
  try {
    const res = await safeFetch(url, { headers: { 'user-agent': UA, 'accept-language': 'en' } }, { timeoutMs, maxBytes: 2_000_000, metricLabel: 'public_research_offering' });
    return { status: res.status, html: (await readCapped(res, 2_000_000)).toString('utf8') };
  } catch {
    return null;
  }
}

const meta = (html: string, re: RegExp) => { const m = re.exec(html); return m ? pageText(m[1]).slice(0, 200) || null : null; };

export async function checkOffering(
  domain: string,
  declared: { offering: string | null; capabilities: string[] },
  thirdParty: Array<{ url: string; text: string }> = [],
  timeoutMs = 20_000,
): Promise<OfferingEvidence> {
  const origin = `https://${domain.replace(/^https?:\/\//, '').replace(/\/.*$/, '')}`;
  const checkedAt = new Date().toISOString();
  const home = await get(`${origin}/`, timeoutMs);
  const pages: PageRead[] = [{ url: `${origin}/`, purpose: 'home', status: home?.status ?? null, read: Boolean(home && home.status === 200), fetchedAt: checkedAt,
    headings: home && home.status === 200 ? headingsOf(home.html) : [], text: home && home.status === 200 ? pageText(home.html).slice(0, 15_000) : undefined }];
  const texts: Array<{ url: string; text: string; purpose: PagePurpose }> = home && home.status === 200 ? [{ url: `${origin}/`, text: pageText(home.html), purpose: 'home' }] : [];

  // Only pages the homepage itself links to: nothing is guessed.
  const linked = home ? [...new Set([...home.html.matchAll(/href="(\/[a-z0-9][a-z0-9\-/]*)"/gi)].map((m) => m[1].replace(/\/$/, '')))] : [];
  const targets = linked.map((path) => ({ path, purpose: purposeOf(path) })).filter((t): t is { path: string; purpose: PagePurpose } => Boolean(t.purpose)).slice(0, 8);
  const fetched = await Promise.all(targets.map(async (t) => ({ t, r: await get(`${origin}${t.path}`, timeoutMs) })));
  for (const { t, r } of fetched) {
    const url = `${origin}${t.path}`;
    pages.push({ url, purpose: t.purpose, status: r?.status ?? null, read: Boolean(r && r.status === 200), fetchedAt: new Date().toISOString(),
      headings: r && r.status === 200 ? headingsOf(r.html) : [], text: r && r.status === 200 ? pageText(r.html).slice(0, 15_000) : undefined });
    if (r && r.status === 200) texts.push({ url, text: pageText(r.html), purpose: t.purpose });
  }

  const selfDescription = home && home.status === 200 ? {
    title: meta(home.html, /<title[^>]*>([\s\S]*?)<\/title>/i),
    heading: meta(home.html, /<h1[^>]*>([\s\S]*?)<\/h1>/i),
    description: meta(home.html, /<meta[^>]+name="description"[^>]+content="([^"]*)"/i),
    url: `${origin}/`,
  } : null;

  return {
    checkedAt, pages, selfDescription,
    offering: declared.offering ? judgeClaim(declared.offering, texts, thirdParty) : null,
    capabilities: declared.capabilities.map((c) => judgeClaim(c, texts, thirdParty)),
    ...publishedPricing(texts),
  };
}
