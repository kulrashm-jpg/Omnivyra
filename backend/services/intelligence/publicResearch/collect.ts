/**
 * Public research — collected while a report is generated, without a browser.
 *
 *   1. Site basics, read directly (robots.txt, llms.txt, sitemap, structured data, profile links).
 *   2. Eight questions: five a buyer would ask without knowing the brand, one definitional (the offering
 *      described precisely, without the name), two about the brand.
 *   3. The same eight questions to every AI search tool with a supported, web-grounded API, in
 *      parallel (ChatGPT search, Perplexity, Claude, Gemini, Google AI Mode, Bing Copilot; Meta AI
 *      is recorded as not measurable).
 *   4. A reading of the answers: brands named, sources cited, brand-name answers right or wrong.
 *
 * The result is a ResearchPack (dossierV2/research.ts) stored with the report. It never feeds a
 * score. Enabled by REPORT_PUBLIC_RESEARCH=on; each tool runs only when its own key is set.
 */
import { isBrandQuestion, type ResearchPack, type ResearchRecord } from '../dossierV2/research';
import { askAiSurfaces, SURFACES, type SurfaceAnswer } from './aiAnswers';
import { buyerQuestions, readAnswers, type BuyerQuestion, type CompanyBrief } from './aiQuestions';
import { checkSiteBasicsWithLinks, type SiteCheck } from './siteBasics';
import { canonicalProfile, checkProfiles, findIndependentMentions, type ProfileCheck } from './footprint';
import { aiCapabilities, configCapabilities } from './runtime';
import { discoverAndProfile, type CompetitorProfile, type FieldKey } from './competitors';
import { checkOffering, type OfferingEvidence } from './offering';
import { applyProfileEvidence, buildOfferingRegister, deriveMarket, proposeQueries } from './offeringRegister';
import type { ProfileEvidence } from './profileEvidence';
import { candidatesFromEvidence, CAPABILITIES, capabilityState, focusOf, validateCandidates } from './competitorDiscovery';
import { runProviderChecks } from './providerChecks';
import { searchGoogle, searchPlan } from './searchResults';
import { resolvePageSpeedAccess } from '../../pageSpeedClient';

/** Build the research input from the company context the report already resolved. */
export function researchInputFromNarrative(c: {
  companyName: string | null; domain: string | null; homepageHeadline: string | null; tagline: string | null; primaryOffering: string | null;
  positioning: string | null; marketContext: string | null; marketFocus: string | null; productServices: string[]; geography: string | null; declaredCompetitors?: string[];
  /** Who the company says it sells to (profile "target customer"); preferred over marketFocus for buyer questions. */
  targetCustomer?: string | null;
  teamSize?: string | null;
  foundedYear?: string | null;
  revenueRange?: string | null;
  /** Official profiles the company declared (profile social links). */
  socialLinks?: string[];
  /** The optional company profile, read as company-declared evidence (profileEvidence.ts). */
  profile?: ProfileEvidence | null;
}): ResearchInput | null {
  // Only the website is required. With no profile name, the brand is the domain's own label —
  // an identifier, recorded as such, never an invented company fact.
  if (!c.domain) return null;
  const domainLike = /^[a-z0-9-]+(\.[a-z0-9-]+)+$/i;
  const fromDomain = c.domain.replace(/^www\./, '').split('.')[0];
  return {
    brand: c.companyName ?? fromDomain.charAt(0).toUpperCase() + fromDomain.slice(1), domain: c.domain,
    brandSource: c.companyName ? 'declared' : 'domain',
    profile: c.profile ?? null,
    siteText: [c.homepageHeadline, c.tagline, c.positioning, c.primaryOffering].filter(Boolean).join(' — '),
    category: c.marketContext ?? c.primaryOffering, offering: c.primaryOffering, buyers: c.targetCustomer ?? c.marketFocus, market: c.geography,
    competitors: (c.declaredCompetitors ?? []).map((n) => n.trim()).filter(Boolean).slice(0, 4)
      .map((n) => (domainLike.test(n) ? { name: n.replace(/\.[a-z.]+$/i, ''), domain: n.toLowerCase() } : { name: n, domain: '' })),
    capabilities: distinctCapabilities(c.productServices, 8),
    declared: { teamSize: c.teamSize ?? null, foundedYear: c.foundedYear ?? null, revenueRange: c.revenueRange ?? null },
    socialLinks: (c.socialLinks ?? []).filter((u) => /^https?:\/\//i.test(u)),
  };
}

/** Declared product phrases overlap heavily ("Campaign management", "Campaign management software"); keep distinct ones. */
export function distinctCapabilities(items: string[], limit: number): string[] {
  const words = (s: string) => s.toLowerCase().split(/[^a-z]+/).filter((w) => w.length >= 4 && !['software', 'platform', 'tools', 'system', 'driven', 'powered'].includes(w))
    .map((w) => w.replace(/s$/, ''));
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of items) {
    const w = words(item);
    if (!w.length || w.filter((x) => seen.has(x)).length / w.length >= 0.5) continue;
    w.forEach((x) => seen.add(x));
    out.push(item.trim());
    if (out.length >= limit) break;
  }
  return out;
}

export function publicResearchEnabled(): boolean {
  return /^(1|true|on|yes)$/i.test(process.env.REPORT_PUBLIC_RESEARCH ?? '');
}

export type ResearchInput = CompanyBrief & {
  /** Validated competitors, when the report has them; used only to report their share of AI answers. */
  competitors?: Array<{ name: string; domain: string }>;
  /** The company's own capabilities (products / services it declares), compared across competitors. */
  capabilities?: string[];
  /** Company-declared profile facts, shown in the company's own column as "(claimed)". */
  declared?: { teamSize?: string | null; foundedYear?: string | null; revenueRange?: string | null };
  /** Official social profiles the company declared. */
  socialLinks?: string[];
  /** Where the brand name came from: the company's declaration, or the domain label when none exists. */
  brandSource?: 'declared' | 'domain';
  /** The optional company profile (company-declared facts with provenance). */
  profile?: ProfileEvidence | null;
};

/** Profile rows shown side by side, in this order; a row appears only if some company has a value. */
const PROFILE_ROWS: Array<[FieldKey, string]> = [
  ['offering', 'What it sells'], ['productLines', 'Product lines'], ['buyers', 'Who it is for'], ['segments', 'Segments targeted'],
  ['geography', 'Markets served'], ['headquarters', 'Headquarters'], ['entryPrice', 'Entry price'], ['freePlanOrTrial', 'Free plan or trial'],
  ['employees', 'Employees'], ['funding', 'Funding'], ['revenue', 'Revenue (publicly reported)'], ['customers', 'Customers claimed'],
  ['reviews', 'Review rating'], ['founded', 'Founded'],
];

const host = (u: string): string | null => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return null; } };

const CRAWL_FIX = {
  id: 'A-site-crawl-basics', title: 'Fix the crawl and entity basics on the website',
  action: 'Publish robots.txt (allowing search and AI crawlers) and llms.txt; list every public page in the sitemap with real modification dates; add Organization structured data with sameAs links to the official profiles; link those profiles from the site footer.',
  effort: 'low' as const, impact: 'high' as const, pillar: 'foundation',
  verification: 'robots.txt and llms.txt return 200; the sitemap lists every public page; a structured-data test shows an Organization entity with its profiles.',
};

export async function collectPublicResearch(input: ResearchInput, opts: { timeoutMs?: number } = {}): Promise<ResearchPack> {
  const collectedAt = new Date().toISOString();
  const counters: Record<string, number> = {};
  const id = (prefix: string) => { counters[prefix] = (counters[prefix] ?? 0) + 1; return `E-${prefix}-${String(counters[prefix]).padStart(2, '0')}`; };
  const base = (over: Partial<ResearchRecord> & Pick<ResearchRecord, 'kind' | 'claim' | 'status'>): ResearchRecord => ({
    id: '', confidence: 'high', sourceUrl: '', observedAt: collectedAt, method: '', scope: '', ...over,
  });

  // Competitor discovery and profiling do not depend on the AI answers: start them first, in parallel.
  const caps = (input.capabilities ?? []).filter(Boolean).slice(0, 6);
  const subjectBrief = { brand: input.brand, domain: input.domain.replace(/^www\./, ''), offering: input.offering ?? input.category ?? input.siteText.slice(0, 200), capabilities: caps };
  const maxCompetitors = Number(process.env.PUBLIC_RESEARCH_MAX_COMPETITORS ?? 4);
  // One web-search call finds AND profiles the competitors (declared ones first).
  const competitorTask = process.env.OPENAI_API_KEY || process.env.ANTHROPIC_API_KEY ? (async () => {
    const declared = (input.competitors ?? []).slice(0, maxCompetitors);
    const profiles = await discoverAndProfile({ ...subjectBrief, buyers: input.buyers, geography: input.market }, declared, maxCompetitors);
    return profiles.map((p) => ({ p, origin: declared.some((d) => d.name === p.name) ? 'declared by the company' : 'found by web research' }));
  })().catch(() => null) : Promise.resolve(null);

  const [siteResult, q] = await Promise.all([
    checkSiteBasicsWithLinks(input.domain).catch(() => ({ checks: [] as SiteCheck[], homepageProfiles: [] as string[], sameAs: [] as string[] })),
    buyerQuestions(input),
  ]);
  const site = siteResult.checks;
  // External footprint runs alongside the AI questions: owned profiles first, then third-party mentions.
  const declaredProfiles = input.socialLinks ?? [];
  const footprintTask = Promise.all([
    checkProfiles(input.brand, input.domain, { declared: declaredProfiles, homepage: siteResult.homepageProfiles, sameAs: siteResult.sameAs }).catch((): ProfileCheck[] => []),
    findIndependentMentions(subjectBrief, [...declaredProfiles, ...siteResult.homepageProfiles, ...siteResult.sameAs]).catch(() => ({ mentions: [], socialPosts: [], platforms: [], provider: null, searches: [] as string[], profiles: [] as string[] })),
  ]).then(async ([profiles, m]) => {
    // Profiles the search surfaced that the company neither declared nor linked: opened and verified the same way.
    const known = new Set(profiles.map((p) => canonicalProfile(p.url)));
    const extra = m.profiles.filter((u) => !known.has(canonicalProfile(u)));
    const found = extra.length ? await checkProfiles(input.brand, input.domain, { declared: [], homepage: [], sameAs: [], searched: extra }).catch((): ProfileCheck[] => []) : [];
    return [[...profiles, ...found], m] as [ProfileCheck[], typeof m];
  });
  // The declared offering and capabilities, checked against the site's own product, pricing and help pages.
  const offeringTask = checkOffering(input.domain, { offering: input.offering, capabilities: caps }).catch((): OfferingEvidence | null => null);
  const questions: BuyerQuestion[] = q.questions;
  const answers: SurfaceAnswer[] = await askAiSurfaces(questions.map((x) => x.query), { timeoutMs: opts.timeoutMs });
  const [profileChecks, mentionResult] = await footprintTask;
  const offering = await offeringTask;

  const intentOf = new Map(questions.map((x) => [x.query, x.intent]));
  const observed = answers.filter((a) => a.status === 'observed');
  const keyed = observed.map((a, i) => ({ key: `a${i}`, a }));
  const readings = await readAnswers(input, keyed.map(({ key, a }) => ({ id: key, branded: isBrandQuestion({ intent: intentOf.get(a.query), query: a.query }, input.brand), text: a.text })));
  const readingOf = new Map(keyed.map(({ key, a }) => [a, readings.get(key)]));
  const brandRe = new RegExp(`\\b${input.brand.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
  const ownHost = input.domain.replace(/^www\./, '');

  const generative: ResearchRecord[] = answers.map((a) => {
    const intent = intentOf.get(a.query) ?? 'category';
    const branded = isBrandQuestion({ intent, query: a.query }, input.brand);
    const r = readingOf.get(a);
    const citedDomains = [...new Set(a.sources.map(host).filter((h): h is string => Boolean(h)))];
    const cited = citedDomains.some((h) => h === ownHost || h.endsWith(`.${ownHost}`));
    const accuracy = branded ? r?.accuracy ?? null : null;
    const mentioned = a.status === 'observed' && brandRe.test(a.text) && accuracy !== 'misidentified';
    const claim = a.status === 'not_measured' ? `${a.label}: ${a.reason}`
      : a.status !== 'observed' ? `${a.label}: ${a.reason ?? 'no answer'}`
        : branded ? `${a.label}: ${accuracy === 'correct' ? `describes ${input.brand} accurately` : accuracy === 'partly' ? `describes ${input.brand} but mixes in unrelated companies` : accuracy === 'misidentified' ? `confuses ${input.brand} with something else` : `answer not judged`}${r?.note ? ` (${r.note})` : ''}${cited ? `; cites ${ownHost}` : ''}`
          : `${a.label}: ${input.brand} ${mentioned ? 'named' : 'not named'}; brands named: ${r?.brands.length ? r.brands.slice(0, 8).join(', ') : 'none'}`;
    return base({
      id: id('GEN'), kind: a.surface, surface: a.label, intent, query: a.query, claim,
      status: a.status === 'observed' ? 'observed' : a.status === 'not_measured' ? 'not_measured' : 'failed_source',
      mentioned, cited: cited && accuracy !== 'misidentified', accuracy, brandsNamed: a.status === 'observed' ? r?.brands ?? [] : undefined,
      citedDomains, geography: a.geography, observedAt: a.observedAt,
      sourceUrl: a.sources[0] ?? '', method: 'Answer built by the tool from live web search, with the sources it returned', scope: 'One question, one time',
      ...(a.error ? { providerError: a.error } : {}),
      // Enough of the answer to re-check a mention or a misidentification afterwards.
      excerpt: a.text.slice(0, 4000),
    });
  });

  const siteRecords: ResearchRecord[] = site.map((c) => base({
    id: id('SIT'), kind: 'site_basics', claim: c.claim, status: c.ok === null ? 'failed_source' : 'observed', sourceUrl: c.url,
    method: 'Direct HTTP fetch', scope: input.domain, excerpt: c.excerpt, ...(c.ok === false ? { recommends: CRAWL_FIX } : {}),
  }));

  // Share of AI answers to buyer questions: this company and its validated competitors.
  const buyer = generative.filter((g) => g.status === 'observed' && !isBrandQuestion(g, input.brand));
  const benchmark: ResearchRecord[] = [];
  if (buyer.length) {
    const named = (name: string) => buyer.filter((g) => new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(String(g.excerpt) + ' ' + (g.brandsNamed ?? []).join(' '))).length;
    const v = (value: string) => ({ value, status: 'observed', url: '' });
    const values: Record<string, { value: string; status: string; url: string }> = { [ownHost]: v(`${buyer.filter((g) => g.mentioned).length} of ${buyer.length}`) };
    for (const c of input.competitors ?? []) values[c.domain] = v(`${named(c.name)} of ${buyer.length}`);
    if ((input.competitors ?? []).length) {
      benchmark.push(base({ id: id('BEN'), kind: 'benchmark', dimension: 'ai_share_of_voice', claim: 'Named in AI answers to buyer questions', status: 'observed', values,
        gap: 'Being cited by the pages AI answers draw on is the route into these answers.', method: 'AI answers in this pack', scope: `${buyer.length} answers` }));
    }
    const dom = new Map<string, number>();
    for (const g of buyer) for (const d of g.citedDomains ?? []) dom.set(d, (dom.get(d) ?? 0) + 1);
    const top = [...dom.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);
    if (top.length) {
      benchmark.push(base({ id: id('BEN'), kind: 'ai_cited_sources', dimension: 'ai_cited_sources', claim: 'Sites AI answers cite for buyer questions in this category', status: 'observed',
        values: Object.fromEntries(top.map(([d, n]) => [d, v(`${n} answers`)])),
        gap: 'These are the pages AI tools read before answering; being listed or mentioned on them is how a brand enters the answer.',
        method: 'Cited sources of the AI answers in this pack', scope: `${buyer.length} answers`,
        recommends: { id: 'A-ai-cited-sources', title: 'Get listed on the pages AI answers cite', action: 'Pitch inclusion in the comparison and "best tools" articles that AI answers cite for this category, starting with the most cited; pair each pitch with a review-site listing.',
          effort: 'medium', impact: 'high', pillar: 'discoverability', verification: 'Re-run the same buyer questions; the brand is named in at least one answer per AI tool.' } }));
    }
  }

  // ── Competitor intelligence: declared competitors first, then the brands AI answers recommend. ──
  const competitorRecords: ResearchRecord[] = [];
  const profiles = await competitorTask;
  if (profiles && profiles.length) {
    const rivals = profiles;
    // The company's own column is what it declared, never a web lookup that could pick up a namesake.
    const ownDeclared: Partial<Record<FieldKey, string | null | undefined>> = {
      offering: input.offering, productLines: caps.join(', ') || null, buyers: input.buyers, geography: input.market,
      employees: input.declared?.teamSize, revenue: input.declared?.revenueRange, founded: input.declared?.foundedYear,
    };
    for (const { p, origin } of rivals) {
      const cls = p.classification === 'substitute' ? 'substitute' : p.classification;
      competitorRecords.push(base({
        id: id('CMP'), kind: 'competitor', name: p.name, domain: p.domain, classification: cls as ResearchRecord['classification'],
        claim: p.rationale || (p.error ? `Profile could not be built: ${p.error}` : 'No rationale returned'),
        status: p.status, confidence: 'medium', sourceUrl: p.fields.offering?.url ?? (p.domain ? `https://${p.domain}/` : ''),
        method: 'AI analyst with live web search; each value re-opened at its source and checked', scope: `Candidate ${origin}`, observedAt: p.observedAt,
      }));
    }
    const shown = rivals.filter(({ p }) => p.status === 'observed' && ['direct', 'adjacent', 'substitute'].includes(p.classification));
    const keyOf = (p: CompetitorProfile) => p.domain || p.name;
    // Published on the company's own pricing page beats "not declared": the profile is not the only source.
    const ownSite: Partial<Record<FieldKey, { excerpt: string; url: string } | null>> = { entryPrice: offering?.pricing, freePlanOrTrial: offering?.freePlan };
    const ownCell = (k: FieldKey) => (ownSite[k] ? { value: `“${ownSite[k]!.excerpt}”`, status: 'observed', url: ownSite[k]!.url }
      : ownDeclared[k] ? { value: String(ownDeclared[k]), status: 'company_declared', url: '' } : { value: 'not declared', status: 'looked_for_not_found', url: '' });
    const cell = (p: CompetitorProfile, k: FieldKey) => {
      const f = p.fields[k];
      return f ? { value: f.value, status: f.check === 'confirmed' ? 'observed' : 'inferred', url: f.url } : { value: 'not found', status: 'looked_for_not_found', url: '' };
    };
    if (shown.length) {
      for (const [k, label] of PROFILE_ROWS) {
        if (!shown.some(({ p }) => p.fields[k])) continue;
        const values = { [ownHost]: ownCell(k), ...Object.fromEntries(shown.map(({ p }) => [keyOf(p), cell(p, k)])) };
        benchmark.push(base({ id: id('BEN'), kind: 'benchmark', dimension: `profile_${k}`, claim: label, status: 'observed', confidence: 'medium', values,
          gap: k === 'revenue' ? 'Revenue appears only where a public source states it; most private companies do not publish it.' : '',
          method: 'AI analyst with live web search; values re-checked at the source URL', scope: 'Validated competitors' }));
      }
      // Offering overlap: which of the subject's capabilities each company also offers.
      for (const cap of caps) {
        const own = offering?.capabilities.find((x) => x.claim === cap);
        const values = {
          // The company's own column carries the provenance of its claim, not a bare "yes".
          [ownHost]: { value: own?.state ?? 'company_declared', status: own?.state === 'website_verified' || own?.state === 'independently_corroborated' ? 'observed' : 'company_declared', url: own?.sourceUrl ?? '' },
          ...Object.fromEntries(shown.map(({ p }) => {
            const c = p.capabilities.find((x) => x.capability === cap);
            const v = !c || c.offers === null ? 'unknown' : c.offers ? 'yes' : 'no';
            return [keyOf(p), { value: v, status: v === 'unknown' ? 'looked_for_not_found' : c?.check === 'confirmed' ? 'observed' : 'inferred', url: c?.url ?? '' }];
          })),
        };
        const offeredBy = shown.filter(({ p }) => p.capabilities.some((x) => x.capability === cap && x.offers)).length;
        benchmark.push(base({ id: id('BEN'), kind: 'capability', dimension: 'capability', claim: cap, status: 'observed', confidence: 'medium', values,
          gap: `${offeredBy} of ${shown.length} competitors offer this`, method: 'AI analyst with live web search', scope: 'Offering overlap' }));
      }
    }
  }

  const gaps: ResearchRecord[] = [];
  for (const sf of SURFACES) {
    const rs = answers.filter((a) => a.surface === sf.id);
    if (rs.length && rs.every((a) => a.status === 'not_measured') && sf.keys.length) {
      gaps.push(base({ id: id('GAP'), kind: 'gap', claim: `${sf.label} answers`, status: 'not_measured', method: `Set ${sf.keys[0]} to ask ${sf.label} the same questions on the next report.` }));
    }
  }

  // Stage 1–4: offering → market → candidates (from this report's own evidence) → validation on their pages.
  // Profile facts, when there are any, enter the register as company-declared with provenance; the
  // narrative fallbacks are passed only when no profile evidence covers them (no double counting).
  const fromProfile = Boolean(input.profile?.facts.length);
  const register = offering ? applyProfileEvidence(buildOfferingRegister(offering, fromProfile
    ? { brand: input.brand }
    : { offering: input.offering, targetCustomer: input.buyers, geography: input.market, brand: input.brand }), input.profile ?? null, offering) : null;
  const market = register ? deriveMarket(register) : null;
  const ownPages = (offering?.pages ?? []).filter((p) => p.read && p.text).map((p) => ({ url: p.url, text: p.text! }));
  const ownConfirmed = CAPABILITIES.filter((d) => capabilityState(d, ownPages).state === 'confirmed').map((d) => d.key);
  const proposed = register && market ? proposeQueries(register, market) : null;

  // Google, both ways: the company's own name (is it recognised?) and buyer queries from the offering (is it found?).
  const [observations, providerChecks] = await Promise.all([
    searchGoogle(searchPlan(input.brand, proposed ?? []), ownHost).catch(() => []),
    runProviderChecks(input.domain).catch(() => null),
  ]);
  const search: ResearchRecord[] = observations.map((o) => base({
    id: id('SER'), kind: 'search', intent: o.intent, query: o.query, engine: 'google', geography: o.geography, observedAt: o.observedAt,
    status: o.status, ownPosition: o.ownPosition, topDomains: o.results.map((r) => r.domain), results: o.results, knowledgePanel: o.knowledgePanel,
    claim: o.status !== 'observed' ? `Google “${o.query}”: ${o.reason ?? 'no result'}`
      : `Google “${o.query}”: ${o.ownPosition != null ? `${ownHost} at position ${o.ownPosition}` : `${ownHost} not in the first ${o.results.length} results`}${o.knowledgePanel ? `; knowledge panel “${o.knowledgePanel.title}”${o.knowledgePanel.matchesSite ? ' (links to the site)' : ' (not this company’s site)'}` : ''}`,
    sourceUrl: `https://www.google.com/search?q=${encodeURIComponent(o.query)}`, method: 'SerpAPI Google engine, first page of organic results', scope: 'One query, one time',
    ...(o.error ? { providerError: o.error } : {}),
  }));
  const ran = new Set(search.filter((r) => r.status === 'observed').map((r) => r.query));

  // Candidates: analyst profiles, Google results for the buyer queries, and brands AI answers named; the
  // best-evidenced are read on their own sites. Profile figures feed the size band; the buyer bands come
  // from what the company's own register says it sells to.
  const profileFacts: Record<string, { revenue?: string | null; employees?: string | null }> = {};
  for (const b of benchmark.filter((r) => r.dimension === 'profile_revenue' || r.dimension === 'profile_employees')) {
    for (const [d, v] of Object.entries(b.values ?? {})) {
      if (v.status === 'looked_for_not_found') continue;
      (profileFacts[d] ??= {})[b.dimension === 'profile_revenue' ? 'revenue' : 'employees'] = v.value;
    }
  }
  const ownFocus = focusOf((register?.entries ?? []).filter((e) => e.field === 'buyer').map((e) => e.value).join('. ')).bands;
  const weight = (c: { sources: Array<{ kind: string }> }) => c.sources.length + (c.sources.some((s) => s.kind === 'analyst_profile') ? 10 : 0);
  const raw = candidatesFromEvidence({ subject: { domain: ownHost, brand: input.brand }, search, competitors: competitorRecords, generative }, (q) => isBrandQuestion({ query: q }, input.brand))
    .sort((a, b) => weight(b) - weight(a));
  const cap = Number(process.env.PUBLIC_RESEARCH_MAX_CANDIDATES ?? 16);
  const candidates = await validateCandidates(raw.slice(0, cap), ownConfirmed, { ownFocus, profileFacts, concurrency: 6 }).catch(() => null);

  const surfacesRun = [...new Set(observed.map((a) => a.label))];
  return {
    subject: { brand: input.brand, domain: ownHost },
    collectedAt,
    collector: 'Report pipeline — automated public research',
    method: {
      questions: q.method,
      generativeSearch: `Each question asked once in each AI search tool with a web-grounded API (answered: ${surfacesRun.join(', ') || 'none'}). Answers given without searching the web, and model memory, are not counted.`,
      reading: 'Brands named are read by a model and kept only when the name appears verbatim in the answer; whether a brand-name answer describes this company is the model\'s judgement against the company\'s own description.',
      site: 'robots.txt, llms.txt, sitemap and homepage structured data fetched directly.',
      competitors: 'Declared competitors and the brands AI answers recommend, each profiled by an AI analyst with live web search. Every value carries its source URL and is re-opened and checked; values the page did not confirm are labelled. Revenue appears only when a public source states it.',
    },
    company: [], search, generative, competitors: competitorRecords, independent: [], gaps, site: siteRecords, benchmark,
    footprint: { checkedAt: new Date().toISOString(), profiles: profileChecks, mentions: mentionResult.mentions, socialPosts: mentionResult.socialPosts, platforms: mentionResult.platforms, mentionSearch: mentionResult.provider, mentionQueries: mentionResult.searches, profilesFound: mentionResult.profiles },
    runtime: { checkedAt: new Date().toISOString(), capabilities: [...aiCapabilities(answers), ...configCapabilities({ pageSpeed: (await resolvePageSpeedAccess().catch(() => null))?.source })] },
    offering, register, market, candidates, providerChecks,
    profileEvidence: input.profile ? { status: input.profile.status, detail: input.profile.detail, checkedAt: input.profile.checkedAt, facts: input.profile.facts } : null,
    brandSource: input.brandSource ?? 'declared',
    // Competitor classes rest on the offering: without a website-verified product line and buyer they are provisional.
    candidatesProvisional: register ? register.provisional : true,
    proposedQueries: proposed ? proposed.map((p) => (ran.has(p.query) ? { ...p, status: 'run' as const } : p)) : null,
    candidateDiscovery: candidates ? { found: raw.length, checked: Math.min(raw.length, cap) } : null,
  };
}
