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
/** Who a company says it sells to, in four bands; the same patterns for the company and every candidate. */
export type FocusBand = 'small_business' | 'agency' | 'mid_market' | 'enterprise';
export type ScaleBand = 'early' | 'growth' | 'large';
export type Candidate = {
  name: string;
  domain: string | null;
  /** How the domain was established when the evidence named only a brand. */
  domainBasis?: string | null;
  /** Buyer bands stated on the candidate's own pages, and whether they meet the company's own. */
  focus?: { bands: FocusBand[]; excerpt: string | null; match: boolean | null };
  /** Size, only from a stated figure (analyst profile or the candidate's own page); null when none was found. */
  scale?: { band: ScaleBand | null; basis: string };
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

const FOCUS: Array<[FocusBand, RegExp]> = [
  ['small_business', /\b(small (and medium[- ]sized )?business(es)?|smbs?|smes?|startups?|solopreneurs?|freelancers?|creators?|founders?|small teams?|local business(es)?)\b/i],
  ['agency', /\bagenc(y|ies)\b/i],
  ['mid_market', /\b(mid[- ]?market|mid[- ]?sized|growing (companies|businesses|teams))\b/i],
  ['enterprise', /\b(enterprises?|fortune 500|large organi[sz]ations|global brands)\b/i],
];

/** Buyer bands a text states, with the first passage as evidence. The same patterns for every company. */
export function focusOf(text: string): { bands: FocusBand[]; excerpt: string | null } {
  const bands: FocusBand[] = [];
  let excerpt: string | null = null;
  for (const [band, re] of FOCUS) {
    const m = re.exec(text);
    if (!m) continue;
    bands.push(band);
    excerpt ??= text.slice(Math.max(0, m.index - 60), m.index + 80).replace(/\s+/g, ' ').trim();
  }
  return { bands, excerpt };
}

const money = (s: string): number | null => {
  const m = /([\d][\d,.]*)\s*(k|thousand|m|mn|million|b|bn|billion)?/i.exec(s.replace(/[$€£₹]|usd|inr|eur/gi, ''));
  if (!m) return null;
  const n = Number(m[1].replace(/,/g, ''));
  const u = (m[2] ?? '').toLowerCase();
  return Number.isFinite(n) ? n * (u.startsWith('b') ? 1e9 : u.startsWith('m') ? 1e6 : u.startsWith('k') || u === 'thousand' ? 1e3 : 1) : null;
};

/**
 * Size band from a stated figure only: revenue (order of magnitude), headcount, or a customer count
 * the company states about itself. Nothing stated → band null, "not established".
 */
export function scaleOf(facts: { revenue?: string | null; employees?: string | null; pageText?: string | null }): { band: ScaleBand | null; basis: string } {
  if (facts.revenue && !/not (found|declared)|unknown/i.test(facts.revenue)) {
    const v = money(facts.revenue);
    if (v != null && v > 0) return { band: v < 5e6 ? 'early' : v < 1e8 ? 'growth' : 'large', basis: `revenue stated as “${facts.revenue.slice(0, 40)}”` };
  }
  if (facts.employees && !/not (found|declared)|unknown/i.test(facts.employees)) {
    const nums = (facts.employees.match(/\d[\d,]*/g) ?? []).map((x) => Number(x.replace(/,/g, '')));
    const top = nums.length ? Math.max(...nums) : null;
    if (top != null) return { band: top <= 50 ? 'early' : top <= 500 ? 'growth' : 'large', basis: `headcount stated as “${facts.employees.slice(0, 40)}”` };
  }
  const t = facts.pageText ?? '';
  if (/\b(nyse|nasdaq)\s*:\s*[a-z]{1,5}\b/i.test(t)) return { band: 'large', basis: 'its own page cites a stock-exchange listing' };
  const claim = /(\d[\d,.]*)\s*(k|m|million)?\+?\s*(customers|businesses|companies|brands|organi[sz]ations)\b/i.exec(t);
  if (claim) {
    const n = money(`${claim[1]}${claim[2] ?? ''}`);
    if (n != null && n >= 1000) return { band: n >= 100_000 ? 'large' : 'growth', basis: `its own page claims “${claim[0].trim()}”` };
  }
  return { band: null, basis: 'no revenue, headcount or customer figure found' };
}

/** A brand name's significant words: "Jasper AI" → jasper; "Surfer SEO" → surfer / surferseo. */
export function brandTokens(name: string): { first: string; full: string } {
  const tokens = name.toLowerCase().replace(/\.(ai|io|com|co)\b/g, ' ').replace(/\b(ai|app|hq|inc|ltd|software|platform|tools?)\b/g, ' ').split(/[^a-z0-9]+/).filter(Boolean);
  return { first: tokens[0] ?? '', full: tokens.join('') };
}

/** Plausible official domains for a brand named without one; each is still verified on its own page. */
export function domainGuesses(name: string): string[] {
  const { first, full } = brandTokens(name);
  if (!first) return [];
  const ai = /\bai\b|\.ai\b/i.test(name);
  return [...new Set([ai ? `${first}.ai` : '', ai ? `${full}.ai` : '', `${full}.com`, `${first}.com`, `${first}.ai`, `${first}.io`].filter((d) => d && d.length > 4))].slice(0, 5);
}

/** Stage 3 + 4 for a list of raw candidates. */
export async function validateCandidates(
  raw: Array<{ name: string; domain: string | null; domainBasis?: string | null; sources: Candidate['sources'] }>,
  ownConfirmed: CapabilityKey[],
  opts: { concurrency?: number; ownFocus?: FocusBand[]; profileFacts?: Record<string, { revenue?: string | null; employees?: string | null }> } = {},
): Promise<Candidate[]> {
  const out: Candidate[] = [];
  const queue = [...raw];
  const inspect = async (domain: string) => {
    const read = NOT_A_COMPETITOR.test(domain) ? { pages: [], title: '' } : await readCandidate(domain, 10_000);
    const brand = brandOf(domain);
    const titleSquash = read.title.toLowerCase().replace(/[^a-z0-9]/g, '');
    // Identity: the domain's brand appears in the page title / site name or at the top of the page's own text.
    const topSquash = (read.pages[0]?.text ?? '').slice(0, 3000).toLowerCase().replace(/[^a-z0-9]/g, '');
    const identityVerified = Boolean(brand && brand.length >= 3 && (titleSquash.includes(brand) || topSquash.includes(brand)));
    return { read, brand, titleSquash, identityVerified };
  };
  const worker = async () => {
    for (let c = queue.shift(); c; c = queue.shift()) {
      const checkedAt = new Date().toISOString();
      let domain = c.domain;
      let domainBasis = c.domainBasis ?? null;
      let got = domain ? await inspect(domain) : null;
      // A brand named without a domain: try its plausible official domains; keep the first whose own page
      // carries the brand AND states at least one of the company's capabilities. A site that only shares
      // the name (and states none of them) is a namesake, not adopted: the brand stays unverified.
      let tried: string[] = [];
      if (!domain) {
        tried = domainGuesses(c.name);
        for (const d of tried) {
          const g = await inspect(d);
          if (!g.identityVerified) continue;
          if (CAPABILITIES.some((def) => ownConfirmed.includes(def.key) && capabilityState(def, g.read.pages).state === 'confirmed')) {
            domain = d; got = g; domainBasis = `Domain inferred from the name; its own page names “${g.brand}” and states the same work`;
            break;
          }
        }
      }
      const read = got?.read ?? { pages: [], title: '' };
      const brand = got?.brand ?? '';
      const text = read.pages.map((p) => p.text).join(' ');
      const f = focusOf(text);
      const own = opts.ownFocus ?? [];
      const prof = domain ? opts.profileFacts?.[domain] : undefined;
      const base = {
        name: c.name, domain, domainBasis, sources: c.sources, pagesRead: read.pages.map((p) => p.url), identityVerified: Boolean(got?.identityVerified),
        identityBasis: got?.identityVerified ? (got.titleSquash.includes(brand) ? `the page title names “${brand}”` : `the page names “${brand}”`)
          : read.pages.length ? `neither the page title (“${read.title.trim().slice(0, 60)}”) nor the top of the page names “${brand}”` : domain ? 'no page read' : tried.length ? `no official site confirmed: ${tried.join(', ')} either did not name it or stated none of the same work` : 'no official domain could be confirmed from the name',
        signals: { software: SOFTWARE.test(text), service: SERVICE.test(text) },
        capabilities: Object.fromEntries(CAPABILITIES.map((d) => [d.key, read.pages.length ? capabilityState(d, read.pages) : { state: 'not_checked' as const, excerpt: null, url: null }])),
        focus: { ...f, match: f.bands.length && own.length ? f.bands.some((b) => own.includes(b)) : null },
        scale: scaleOf({ revenue: prof?.revenue, employees: prof?.employees, pageText: text }),
        checkedAt,
      };
      out.push({ ...base, ...classifyCandidate(base, ownConfirmed) });
    }
  };
  await Promise.all(Array.from({ length: opts.concurrency ?? 5 }, worker));
  const order: CandidateClass[] = ['direct', 'adjacent', 'substitute', 'unverified', 'excluded'];
  return out.sort((a, b) => order.indexOf(a.classification) - order.indexOf(b.classification) || b.overlap.length - a.overlap.length);
}

export type ShortlistTier = 'direct_peer' | 'direct_other' | 'alternative';
export const TIER_LABEL: Record<ShortlistTier, string> = {
  direct_peer: 'Direct — same buyers, not known to be larger',
  direct_other: 'Direct — much larger, or a different buyer focus',
  alternative: 'Alternative — part of the offer, or a service instead of software',
};

/**
 * The competitor shortlist (at most `max`): direct competitors first, peers before larger or
 * differently-focused ones, then alternatives. Within a tier: capability overlap, then focus match.
 * `ownScale` is the company's own band when it states one; an unknown size never counts as a mismatch.
 */
export function shortlist(cands: Candidate[], ownScale: ScaleBand | null, max = 8): Array<Candidate & { tier: ShortlistTier; fitNote: string }> {
  const rankScale: Record<ScaleBand, number> = { early: 0, growth: 1, large: 2 };
  const tierOf = (c: Candidate): ShortlistTier => {
    if (c.classification !== 'direct') return 'alternative';
    const focusOff = c.focus?.match === false;
    const bigger = ownScale && c.scale?.band ? rankScale[c.scale.band] - rankScale[ownScale] >= 2 : false;
    return focusOff || bigger ? 'direct_other' : 'direct_peer';
  };
  const note = (c: Candidate): string => {
    const f = c.focus?.bands.length ? `sells to ${c.focus.bands.map((b) => b.replace('_', ' ')).join(', ')}${c.focus.match === false ? ' (not the company’s buyers)' : ''}` : 'buyer focus not stated on the pages read';
    const s = c.scale?.band ? `${c.scale.band} stage (${c.scale.basis})` : 'size not established';
    return `${f}; ${s}`;
  };
  const tiers: ShortlistTier[] = ['direct_peer', 'direct_other', 'alternative'];
  return cands.filter((c) => ['direct', 'adjacent', 'substitute'].includes(c.classification))
    .map((c) => ({ ...c, tier: tierOf(c), fitNote: note(c) }))
    .sort((a, b) => tiers.indexOf(a.tier) - tiers.indexOf(b.tier) || b.overlap.length - a.overlap.length || Number(b.focus?.match === true) - Number(a.focus?.match === true)
      || Number(a.classification === 'substitute') - Number(b.classification === 'substitute'))
    .slice(0, max);
}

/** Stage 3 inputs from evidence already collected for this report (no new search). */
export function candidatesFromEvidence(pack: {
  subject: { domain: string; brand: string };
  search: Array<{ status: string; query?: string; topDomains?: string[]; observedAt: string; intent?: string; sourceUrl?: string }>;
  competitors: Array<{ name?: string; domain?: string; classification?: string; sourceUrl: string; observedAt: string }>;
  generative: Array<{ status: string; query?: string; brandsNamed?: string[]; citedDomains?: string[]; observedAt: string }>;
}, isBrandQuery: (q: string) => boolean): Array<{ name: string; domain: string | null; domainBasis?: string | null; sources: Candidate['sources'] }> {
  const byKey = new Map<string, { name: string; domain: string | null; domainBasis?: string | null; sources: Candidate['sources'] }>();
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
      // One company, many product names ("HubSpot", "HubSpot CRM", "HubSpot Marketing Hub"): keyed by its first word.
      const { first, full } = brandTokens(b);
      if (!first) continue;
      const src = { kind: 'ai_answer' as const, detail: `Named in an AI answer to “${g.query}”`, url: null, date: g.observedAt?.slice(0, 10) ?? null };
      const known = [...byKey.values()].find((v) => v.name.toLowerCase() === b.toLowerCase() || (v.domain && [first, full].includes(brandOf(v.domain))) || brandTokens(v.name).first === first);
      if (known) {
        known.sources.push(src);
        if (!known.domain && b.length < known.name.length) known.name = b;
        continue;
      }
      // The answer's own citations may include the brand's site.
      const cited = (g.citedDomains ?? []).map(host).find((h) => h && h !== own && [first, full].includes(brandOf(h)));
      put(`brand:${first}`, b, cited ?? null, src);
      if (cited) byKey.get(`brand:${first}`)!.domainBasis = `Cited by the AI answer that named “${b}”`;
    }
  }
  return [...byKey.values()];
}
