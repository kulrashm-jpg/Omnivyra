/**
 * Public research — Stages 3 and 4 of competitor discovery: candidates, then validation.
 *
 *   Stage 3  candidates come from evidence about the market Stage 2 established: the domains Google
 *            returned for the company's buyer-intent searches, the companies already profiled from
 *            their own sites, and brands AI answers named. Publishers, platforms and directories are
 *            sources, not competitors, and are excluded with that reason.
 *   Stage 4  each candidate's own pages are read (homepage plus up to two product / pricing pages).
 *            Identity: the page title or site name carries the domain's brand. Capabilities: one set
 *            of definitions, applied identically to the company and to every candidate. A capability
 *            not stated on the pages read is "not found in checked pages" — never "does not offer".
 *
 * Classification is rule-based and its rationale is recorded; it is not an analyst's judgement.
 */
import { readCapped, safeFetch } from '../../../../lib/security/safeFetch';
import { pageText, purposeOf } from './offering';

export type CapabilityKey = 'visibility_reporting' | 'content_ops' | 'campaign_ops' | 'engagement_monitoring' | 'marketing_analytics';
export type CapabilityState = 'confirmed' | 'not_found_in_checked_pages' | 'not_checked';

/** Equivalent definitions: every term group must appear within one short passage of the company's own pages. */
export const CAPABILITIES: Array<{ key: CapabilityKey; label: string; groups: RegExp[] }> = [
  // "GEO" alone also means geospatial; only the spelled-out generative-engine sense counts.
  { key: 'visibility_reporting', label: 'Search / AI visibility reporting', groups: [/\b(seo|aeo|generative engine optimi[sz]ation|search visibility|ai visibility|ai search|digital authority|rankings?)\b/i, /\b(audit|report|score|analysis|tracking|monitor)/i] },
  { key: 'content_ops', label: 'Content creation and publishing', groups: [/\b(content|posts?|blogs?|articles?)\b/i, /\b(creat|generat|publish|schedul|calendar|writ)/i, /\b(marketing|social|brand|seo|audience)/i] },
  { key: 'campaign_ops', label: 'Campaign planning and execution', groups: [/\bcampaigns?\b/i, /\b(plan|execut|automat|orchestrat|launch)/i, /\b(marketing|email|social|ads?)\b/i] },
  { key: 'engagement_monitoring', label: 'Engagement and market / competitor monitoring', groups: [/\b(social|engagement|competitors?|mentions|brand)\b/i, /\b(monitor|track|listening|inbox)/i] },
  { key: 'marketing_analytics', label: 'Marketing reporting and analytics', groups: [/\bmarketing\b/i, /\b(analytics|dashboards?|reporting|attribution)\b/i] },
];

export type CandidateClass = 'direct' | 'adjacent' | 'substitute' | 'unverified' | 'excluded';
export type Candidate = {
  name: string;
  domain: string | null;
  sources: Array<{ kind: 'search_result' | 'analyst_profile' | 'ai_answer'; detail: string; url: string | null; date: string | null }>;
  pagesRead: string[];
  identityVerified: boolean;
  identityBasis: string;
  signals: { software: boolean; service: boolean };
  capabilities: Partial<Record<CapabilityKey, { state: CapabilityState; excerpt: string | null; url: string | null }>>;
  overlap: CapabilityKey[];
  classification: CandidateClass;
  rationale: string;
  confidence: 'high' | 'medium' | 'low';
  checkedAt: string;
};

/** Domains that publish about tools rather than being one. */
export const NOT_A_COMPETITOR = /(^|\.)(wikipedia|investopedia|reddit|quora|linkedin|youtube|facebook|instagram|x|twitter|medium|forbes|substack|github|chatgpt|openai|gemini\.google|google|gartner|g2|capterra|getapp|softwareadvice|trustradius|producthunt|alternativeto|saasworthy|trustpilot|crunchbase|techradar|zapier|okoone|cookieyes|chromewebstore\.google)\.[a-z.]{2,6}$/i;

const host = (u: string) => { try { return new URL(u.includes('://') ? u : `https://${u}`).hostname.replace(/^www\./, '').toLowerCase(); } catch { return ''; } };
const brandOf = (domain: string) => domain.split('.')[0].replace(/[^a-z0-9]/g, '');

/** First short passage containing every group of the definition; the same function for every company. */
export function capabilityState(def: (typeof CAPABILITIES)[number], pages: Array<{ url: string; text: string }>): { state: CapabilityState; excerpt: string | null; url: string | null } {
  if (!pages.length) return { state: 'not_checked', excerpt: null, url: null };
  for (const p of pages) {
    const toks = p.text.split(/\s+/);
    for (let i = 0; i < toks.length; i++) {
      if (!def.groups[0].test(toks[i])) continue;
      const window = toks.slice(Math.max(0, i - 8), i + 12).join(' ');
      if (def.groups.every((g) => g.test(window))) return { state: 'confirmed', excerpt: window.slice(0, 200), url: p.url };
    }
  }
  return { state: 'not_found_in_checked_pages', excerpt: null, url: null };
}

// Product signals: something a buyer signs into or trials. "Plans" and prices alone also appear on agency sites.
const SOFTWARE = /\b(free trial|start (for )?free|sign ?up|log ?in|create (an )?account|book a demo|request a demo|try (it )?free)\b/i;
// Service signals: wording an agency uses about itself (a SaaS that sells TO agencies does not say these).
const SERVICE = /\b(digital marketing agency|marketing agency|our services|hire us|done-for-you|free consultation|we help (brands|businesses|clients))\b/i;

/**
 * Classify from recorded facts only. `ownConfirmed` is the set of the company's capabilities stated on its
 * own site under the same definitions — overlap is never counted against a capability the company only declares.
 */
export function classifyCandidate(c: Omit<Candidate, 'classification' | 'rationale' | 'confidence' | 'overlap'>, ownConfirmed: CapabilityKey[]): Pick<Candidate, 'classification' | 'rationale' | 'confidence' | 'overlap'> {
  if (c.domain && NOT_A_COMPETITOR.test(c.domain)) return { classification: 'excluded', rationale: 'A publisher, platform or directory: a source buyers read, not a company selling the same thing.', confidence: 'high', overlap: [] };
  if (!c.domain) return { classification: 'unverified', rationale: 'Named in AI answers, but no official domain was established, so its own pages were not read.', confidence: 'low', overlap: [] };
  if (!c.pagesRead.length) return { classification: 'unverified', rationale: 'Its pages could not be read.', confidence: 'low', overlap: [] };
  if (!c.identityVerified) return { classification: 'unverified', rationale: `Identity not established: ${c.identityBasis}`, confidence: 'low', overlap: [] };
  const overlap = ownConfirmed.filter((k) => c.capabilities[k]?.state === 'confirmed');
  const labels = overlap.map((k) => CAPABILITIES.find((d) => d.key === k)!.label.toLowerCase());
  const conf: Candidate['confidence'] = c.pagesRead.length >= 2 && overlap.length >= 2 ? 'high' : overlap.length ? 'medium' : 'low';
  if (!overlap.length) return { classification: 'excluded', rationale: 'Irrelevant to this market: none of the company’s website-stated capabilities is stated on its own pages read.', confidence: 'medium', overlap };
  // One shared capability is too thin to call a company a competitor: it stays a candidate with the reason.
  if (overlap.length < 2) return { classification: 'unverified', rationale: `Only one overlapping capability (${labels.join(', ')}) on the pages read: relevance not established.`, confidence: 'low', overlap };
  if (c.signals.service && !c.signals.software) return { classification: 'substitute', rationale: `A service provider (agency wording) covering ${labels.join(', ')}: an alternative to buying a platform.`, confidence: conf, overlap };
  if (overlap.length >= 3 && c.signals.software) return { classification: 'direct', rationale: `A software product stating ${overlap.length} of the company’s ${ownConfirmed.length} website-stated capabilities: ${labels.join(', ')}.`, confidence: conf, overlap };
  return { classification: 'adjacent', rationale: `States ${overlap.length} of the company’s ${ownConfirmed.length} website-stated capabilities (${labels.join(', ')}); focused on part of the offer.`, confidence: conf, overlap };
}

async function get(url: string, timeoutMs: number): Promise<{ status: number; html: string } | null> {
  try {
    const res = await safeFetch(url, { headers: { 'user-agent': 'Mozilla/5.0 (compatible; OmnivyraSnapshot/1.0)', 'accept-language': 'en' } }, { timeoutMs, maxBytes: 2_000_000, metricLabel: 'public_research_competitor' });
    return { status: res.status, html: (await readCapped(res, 2_000_000)).toString('utf8') };
  } catch { return null; }
}

/** Read a candidate's own pages (no search, no model call). */
export async function readCandidate(domain: string, timeoutMs = 15_000): Promise<{ pages: Array<{ url: string; text: string }>; title: string }> {
  const origin = `https://${domain}`;
  const home = await get(`${origin}/`, timeoutMs);
  if (!home || home.status >= 400) return { pages: [], title: '' };
  const title = pageText(/<title[^>]*>([\s\S]*?)<\/title>/i.exec(home.html)?.[1] ?? '') + ' ' + (/<meta[^>]+property="og:site_name"[^>]+content="([^"]*)"/i.exec(home.html)?.[1] ?? '');
  const pages = [{ url: `${origin}/`, text: pageText(home.html).slice(0, 20_000) }];
  const links = [...new Set([...home.html.matchAll(/href="(\/[a-z0-9][a-z0-9\-/]*)"/gi)].map((m) => m[1].replace(/\/$/, '')))]
    .filter((p) => ['features', 'product', 'pricing', 'solutions'].includes(String(purposeOf(p)))).slice(0, 2);
  for (const l of links) {
    const r = await get(`${origin}${l}`, timeoutMs);
    if (r && r.status < 400) pages.push({ url: `${origin}${l}`, text: pageText(r.html).slice(0, 20_000) });
  }
  return { pages, title };
}

/** Stage 3 + 4 for a list of raw candidates. */
export async function validateCandidates(
  raw: Array<{ name: string; domain: string | null; sources: Candidate['sources'] }>,
  ownConfirmed: CapabilityKey[],
  opts: { concurrency?: number } = {},
): Promise<Candidate[]> {
  const out: Candidate[] = [];
  const queue = [...raw];
  const worker = async () => {
    for (let c = queue.shift(); c; c = queue.shift()) {
      const checkedAt = new Date().toISOString();
      const excluded = c.domain && NOT_A_COMPETITOR.test(c.domain);
      const read = c.domain && !excluded ? await readCandidate(c.domain) : { pages: [], title: '' };
      const brand = c.domain ? brandOf(c.domain) : '';
      const titleSquash = read.title.toLowerCase().replace(/[^a-z0-9]/g, '');
      // Identity: the domain's brand appears in the page title / site name or at the top of the page's own text.
      const topSquash = (read.pages[0]?.text ?? '').slice(0, 3000).toLowerCase().replace(/[^a-z0-9]/g, '');
      const identityVerified = Boolean(brand && brand.length >= 3 && (titleSquash.includes(brand) || topSquash.includes(brand)));
      const text = read.pages.map((p) => p.text).join(' ');
      const base = {
        name: c.name, domain: c.domain, sources: c.sources, pagesRead: read.pages.map((p) => p.url), identityVerified,
        identityBasis: identityVerified ? (titleSquash.includes(brand) ? `the page title names “${brand}”` : `the page names “${brand}”`) : read.pages.length ? `neither the page title (“${read.title.trim().slice(0, 60)}”) nor the top of the page names “${brand}”` : 'no page read',
        signals: { software: SOFTWARE.test(text), service: SERVICE.test(text) },
        capabilities: Object.fromEntries(CAPABILITIES.map((d) => [d.key, read.pages.length ? capabilityState(d, read.pages) : { state: 'not_checked' as const, excerpt: null, url: null }])),
        checkedAt,
      };
      out.push({ ...base, ...classifyCandidate(base, ownConfirmed) });
    }
  };
  await Promise.all(Array.from({ length: opts.concurrency ?? 5 }, worker));
  const order: CandidateClass[] = ['direct', 'adjacent', 'substitute', 'unverified', 'excluded'];
  return out.sort((a, b) => order.indexOf(a.classification) - order.indexOf(b.classification) || b.overlap.length - a.overlap.length);
}

/** Stage 3 inputs from evidence already collected for this report (no new search). */
export function candidatesFromEvidence(pack: {
  subject: { domain: string; brand: string };
  search: Array<{ status: string; query?: string; topDomains?: string[]; observedAt: string; intent?: string; sourceUrl?: string }>;
  competitors: Array<{ name?: string; domain?: string; classification?: string; sourceUrl: string; observedAt: string }>;
  generative: Array<{ status: string; query?: string; brandsNamed?: string[]; observedAt: string }>;
}, isBrandQuery: (q: string) => boolean): Array<{ name: string; domain: string | null; sources: Candidate['sources'] }> {
  const byKey = new Map<string, { name: string; domain: string | null; sources: Candidate['sources'] }>();
  const own = pack.subject.domain.replace(/^www\./, '');
  const put = (key: string, name: string, domain: string | null, src: Candidate['sources'][number]) => {
    const e = byKey.get(key) ?? { name, domain, sources: [] };
    e.sources.push(src);
    byKey.set(key, e);
  };
  for (const r of pack.search.filter((x) => x.status === 'observed' && x.query && !isBrandQuery(x.query))) {
    for (const d of r.topDomains ?? []) {
      const h = host(d);
      if (!h || h === own) continue;
      put(h, h, h, { kind: 'search_result', detail: `Google result for “${r.query}”`, url: r.sourceUrl ?? null, date: r.observedAt?.slice(0, 10) ?? null });
    }
  }
  for (const c of pack.competitors) {
    const h = c.domain ? host(c.domain) : '';
    if (h) put(h, c.name ?? h, h, { kind: 'analyst_profile', detail: `Profiled from its own site (analyst classification: ${c.classification ?? 'unclassified'})`, url: c.sourceUrl || null, date: c.observedAt?.slice(0, 10) ?? null });
  }
  for (const g of pack.generative.filter((x) => x.status === 'observed' && x.query && !isBrandQuery(x.query))) {
    for (const b of g.brandsNamed ?? []) {
      const known = [...byKey.values()].find((v) => v.name.toLowerCase() === b.toLowerCase() || (v.domain && brandOf(v.domain) === b.toLowerCase().replace(/[^a-z0-9]/g, '')));
      if (known) known.sources.push({ kind: 'ai_answer', detail: `Named in an AI answer to “${g.query}”`, url: null, date: g.observedAt?.slice(0, 10) ?? null });
      else put(`brand:${b.toLowerCase()}`, b, null, { kind: 'ai_answer', detail: `Named in an AI answer to “${g.query}”`, url: null, date: g.observedAt?.slice(0, 10) ?? null });
    }
  }
  return [...byKey.values()];
}
