/**
 * Dossier v2 — public-research evidence pack.
 *
 * Analyst-collected public evidence that the report pipeline does not (yet) collect itself:
 * the company's own definition from its official pages, buyer-query search observations with
 * geography/language/depth, retrieval-grounded generative-search observations, competitor
 * candidates validated against their own sites, independent mentions, and open gaps.
 *
 * Every record carries a stable id, source URL, observation time, method, scope, status and
 * confidence. The report renders a pack only when one is supplied, labels it with its
 * collection date and method, and never mixes it into the scores.
 */
import type { Mention, PlatformCheck, ProfileCheck, SocialPost } from '../publicResearch/footprint';
import type { RuntimeSnapshot } from '../publicResearch/runtime';
import type { OfferingEvidence } from '../publicResearch/offering';
import type { MarketView, OfferingRegister } from '../publicResearch/offeringRegister';
import type { Candidate } from '../publicResearch/competitorDiscovery';
import type { ProviderCheck } from '../publicResearch/providerChecks';
import type { ErrorClass, ProviderErrorEvidence } from '../publicResearch/providerErrors';
import type { ProfileFact, ProfileStatus } from '../publicResearch/profileEvidence';
import type { BingWebmasterEvidence } from '../publicResearch/bingWebmaster';
import type { RegistryEvidence } from '../publicResearch/registryEvidence';

export type ResearchStatus =
  | 'observed'
  | 'company_declared'
  | 'independently_corroborated'
  | 'inferred'
  | 'looked_for_not_found'
  | 'not_measured'
  | 'failed_source'
  | 'insufficient_evidence';

export type ResearchRecord = {
  id: string;
  kind: string;
  claim: string;
  status: ResearchStatus;
  confidence: string;
  sourceUrl: string;
  observedAt: string;
  method: string;
  scope: string;
  excerpt?: string;
  /** A published price, exactly as the source page states it. */
  price?: string;
  /** site_navigation: paths linked from the site's header and footer. */
  pages?: string[];
  // search
  intent?: string;
  query?: string;
  ownPosition?: number | null;
  depth?: number;
  topDomains?: string[];
  /** The first results Google showed, in order (title and domain), for reading what took the place of the site. */
  results?: Array<{ position: number; title: string; domain: string; url: string }>;
  /** The knowledge panel Google showed for the query, and whether its website is the company's own. */
  knowledgePanel?: { title: string; website: string | null; matchesSite: boolean } | null;
  engine?: string;
  geography?: string;
  language?: string;
  // generative
  surface?: string;
  mentioned?: boolean;
  cited?: boolean;
  citedDomains?: string[];
  /** Brand-name answers only: whether the answer describes this company correctly. */
  accuracy?: 'correct' | 'partly' | 'misidentified' | null;
  brandsNamed?: string[];
  // benchmark
  dimension?: string;
  values?: Record<string, { value: string; status: string; url: string }>;
  gap?: string;
  /** An action the evidence supports, authored at research time; records sharing an id are one action. */
  recommends?: { id: string; title: string; action: string; effort: 'low' | 'medium' | 'high'; impact?: 'low' | 'medium' | 'high'; pillar?: string; verification: string };
  /** Failed requests: the provider's sanitised error fields and the class they support. */
  providerError?: ProviderErrorEvidence & { errorClass: ErrorClass; causeConfirmed: boolean };
  // competitors
  name?: string;
  domain?: string;
  classification?: 'direct' | 'adjacent' | 'substitute' | 'substitute_candidate' | 'not_competitor' | 'unconfirmed' | 'strategic';
};

export type ResearchPack = {
  subject: { brand: string; domain: string };
  collectedAt: string;
  collector: string;
  method: Record<string, string>;
  company: ResearchRecord[];
  search: ResearchRecord[];
  generative: ResearchRecord[];
  competitors: ResearchRecord[];
  independent: ResearchRecord[];
  gaps: ResearchRecord[];
  /** Direct checks of the subject's own site (robots.txt, sitemap, structured data, cadence). */
  site: ResearchRecord[];
  /** Like-for-like digital-marketing comparison with the validated competitors. */
  benchmark: ResearchRecord[];
  /** Official social profiles, independent mentions and review listings (publicResearch/footprint.ts). */
  footprint?: Footprint | null;
  /** What this run could reach and why not when it could not (publicResearch/runtime.ts). */
  runtime?: RuntimeSnapshot | null;
  /** Declared offering and capabilities checked against the live site's own pages (publicResearch/offering.ts). */
  offering?: OfferingEvidence | null;
  /** Stage 1–2: what the company offers and the market that places it in (publicResearch/offeringRegister.ts). */
  register?: OfferingRegister | null;
  market?: MarketView | null;
  /** Stage 3–4: candidates from this report's evidence, validated on their own pages (publicResearch/competitorDiscovery.ts). */
  candidates?: Candidate[] | null;
  /** Free provider checks (credential, quota, model access, keyless PageSpeed) — publicResearch/providerChecks.ts. */
  providerChecks?: ProviderCheck[] | null;
  /** Buyer-intent queries derived from the validated offering and market; "proposed" until a search runs them. */
  proposedQueries?: Array<{ query: string; basis: string; status: 'proposed' | 'run' }> | null;
  /** How many candidates the evidence produced and how many were read on their own sites. */
  candidateDiscovery?: { found: number; checked: number } | null;
  /** The optional company profile: lookup status and the company-declared facts it supplied. */
  profileEvidence?: { status: ProfileStatus; detail: string | null; checkedAt: string; facts: ProfileFact[] } | null;
  /** Where the brand name came from: declared by the company, or the domain label when none existed. */
  brandSource?: 'declared' | 'domain';
  /** True when competitor classes rest on an offering not yet verified on the website. */
  candidatesProvisional?: boolean;
  /** Bing Webmaster Tools for the company's verified site: inbound links and Bing search performance. */
  bingWebmaster?: BingWebmasterEvidence | null;
  /** Company registry: identifiers the company states, their format check, and any registry confirmation. */
  registry?: RegistryEvidence | null;
};

export type Footprint = {
  checkedAt: string;
  profiles: ProfileCheck[];
  mentions: Mention[];
  /** Social posts naming the brand: never independent coverage. */
  socialPosts?: SocialPost[];
  platforms: PlatformCheck[];
  /** Which model searched for mentions; null when no search ran. */
  mentionSearch: string | null;
  /** The web-search queries that search ran, as the provider reported them. */
  mentionQueries?: string[];
  /** Official profile URLs the same search surfaced (LinkedIn, Facebook, Instagram, YouTube, X, TikTok); null when not asked. */
  profilesFound?: string[] | null;
  /** Unconfirmed results whose page and title never name the brand (similarly named companies): excluded, and disclosed. */
  namesakes?: Array<{ url: string; title: string }>;
};

/**
 * A grounded answer is one built from live web search WITH at least one checkable source. Packs
 * collected before the collector enforced the second half can hold "observed" answers with no
 * source at all; those are re-classified here (answered, not grounded) and never counted.
 */
export function withoutUnsourcedAnswers(r: ResearchRecord): ResearchRecord {
  // The reason recorded for Meta AI was a code constant, not an observation, and Meta's Model API does
  // offer search grounding (dev.meta.ai/docs/search-grounding): restate it as what it was — no adapter.
  if (r.status === 'not_measured' && /^Meta AI:/.test(r.claim) && /no public API/i.test(r.claim)) {
    return { ...r, claim: 'Meta AI: no adapter is implemented for the Meta Model API’s search grounding, so it was not asked; the consumer app is not used.' };
  }
  if (r.status !== 'observed' || !r.query || r.kind === 'ai_overview' || r.kind === 'model_recall') return r;
  if ((r.citedDomains ?? []).length || r.sourceUrl) return r;
  return { ...r, status: 'insufficient_evidence', mentioned: false, cited: false,
    claim: `${r.claim} — no checkable source was returned, so the answer is not counted` };
}

/** Letters and digits only, lower case: "Omni-Vyra.ai" → "omnivyraai". */
const squash = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

/**
 * A web search for a brand returns similarly named companies. An unconfirmed result whose URL and
 * title never contain the brand is a namesake: it is removed from mentions and listings (a listing it
 * claimed becomes "not found in search") and kept in `namesakes` so the report can say what was excluded.
 */
export function withoutNamesakes(fp: Footprint, brand: string): Footprint {
  const token = squash(brand);
  if (token.length < 3) return fp;
  const names = (url: string, title = '') => squash(`${url} ${title}`).includes(token);
  const namesakes: Array<{ url: string; title: string }> = [...(fp.namesakes ?? [])];
  const mentions = fp.mentions.filter((m) => {
    if (m.check === 'confirmed' || names(m.url, m.title)) return true;
    namesakes.push({ url: m.url, title: m.title });
    return false;
  });
  const platforms = fp.platforms.map((p) => {
    if (p.state !== 'claimed_unconfirmed' || names(p.url)) return p;
    namesakes.push({ url: p.url, title: `${p.platform} listing` });
    return { ...p, state: 'not_found_in_search' as const, url: '' };
  });
  return { ...fp, mentions, platforms, namesakes };
}

const SECTIONS = ['company', 'search', 'generative', 'competitors', 'independent', 'gaps'] as const;

/**
 * Accept a pack only if it is shaped like one and is about the report's domain. Anything else is
 * ignored rather than partially rendered.
 */
export function parseResearchPack(input: unknown, domain: string | null | undefined): ResearchPack | null {
  if (!input || typeof input !== 'object') return null;
  const p = input as Partial<ResearchPack>;
  const own = String(domain ?? '').replace(/^www\./, '').toLowerCase();
  const subject = String(p.subject?.domain ?? '').replace(/^www\./, '').toLowerCase();
  if (!subject || (own && subject !== own)) return null;
  for (const s of SECTIONS) if (!Array.isArray(p[s])) return null;
  const valid = (r: unknown): r is ResearchRecord =>
    Boolean(r) && typeof (r as ResearchRecord).id === 'string' && typeof (r as ResearchRecord).claim === 'string' && typeof (r as ResearchRecord).status === 'string';
  const brand = String(p.subject?.brand ?? '');
  return {
    subject: { brand, domain: subject },
    collectedAt: String(p.collectedAt ?? ''),
    collector: String(p.collector ?? ''),
    method: (p.method && typeof p.method === 'object') ? p.method as Record<string, string> : {},
    company: (p.company ?? []).filter(valid),
    search: (p.search ?? []).filter(valid),
    generative: (p.generative ?? []).filter(valid).map(withoutUnsourcedAnswers),
    competitors: (p.competitors ?? []).filter(valid),
    independent: (p.independent ?? []).filter(valid),
    gaps: (p.gaps ?? []).filter(valid),
    site: (Array.isArray(p.site) ? p.site : []).filter(valid),
    benchmark: (Array.isArray(p.benchmark) ? p.benchmark : []).filter(valid),
    footprint: p.footprint && typeof p.footprint === 'object' && Array.isArray(p.footprint.profiles)
      ? withoutNamesakes({ checkedAt: String(p.footprint.checkedAt ?? ''), profiles: p.footprint.profiles, mentions: Array.isArray(p.footprint.mentions) ? p.footprint.mentions : [],
        socialPosts: Array.isArray(p.footprint.socialPosts) ? p.footprint.socialPosts : [],
        platforms: Array.isArray(p.footprint.platforms) ? p.footprint.platforms : [], mentionSearch: p.footprint.mentionSearch ?? null,
        mentionQueries: Array.isArray(p.footprint.mentionQueries) ? p.footprint.mentionQueries : [],
        profilesFound: Array.isArray(p.footprint.profilesFound) ? p.footprint.profilesFound : null }, brand)
      : null,
    runtime: p.runtime && typeof p.runtime === 'object' && Array.isArray(p.runtime.capabilities)
      ? { checkedAt: String(p.runtime.checkedAt ?? ''), capabilities: p.runtime.capabilities } : null,
    register: p.register && Array.isArray(p.register.entries) ? p.register : null,
    market: p.market && Array.isArray(p.market.items) ? p.market : null,
    candidates: Array.isArray(p.candidates) ? p.candidates : null,
    providerChecks: Array.isArray(p.providerChecks) ? p.providerChecks : null,
    proposedQueries: Array.isArray(p.proposedQueries) ? p.proposedQueries : null,
    candidateDiscovery: p.candidateDiscovery && typeof p.candidateDiscovery.found === 'number' ? p.candidateDiscovery : null,
    profileEvidence: p.profileEvidence && typeof p.profileEvidence.status === 'string' && Array.isArray(p.profileEvidence.facts) ? p.profileEvidence : null,
    brandSource: p.brandSource === 'domain' ? 'domain' : 'declared',
    candidatesProvisional: Boolean(p.candidatesProvisional),
    bingWebmaster: p.bingWebmaster && typeof p.bingWebmaster === 'object' && typeof p.bingWebmaster.status === 'string' ? p.bingWebmaster : null,
    registry: p.registry && typeof p.registry === 'object' && Array.isArray(p.registry.identifiers) ? p.registry : null,
    offering: p.offering && typeof p.offering === 'object' && Array.isArray(p.offering.pages) && Array.isArray(p.offering.capabilities)
      ? { ...p.offering, selfDescription: p.offering.selfDescription ?? null, offering: p.offering.offering ?? null, pricing: p.offering.pricing ?? null, freePlan: p.offering.freePlan ?? null }
      : null,
  };
}

export type VisibilitySummary = {
  search: { found: number; checked: number; branded: number; brandedFound: number; failed: number; geography: string | null; date: string | null } | null;
  generative: {
    grounded: number; mentioned: number; cited: number; failed: number; notMeasuredSurfaces: string[]; excluded: string[];
    /** Answers to buyer questions that do not name the brand — the visibility that matters. */
    buyerAnswers: number; buyerNamed: number; surfaces: string[];
    /** Answers to brand-name questions, by whether they describe the company correctly. */
    brandAnswers: number; brandCorrect: number; brandMisidentified: number;
  } | null;
};

/** A marketing basic the company can act on (not a profile fact such as revenue or headquarters). */
export function isMarketingBasic(r: Pick<ResearchRecord, 'kind' | 'dimension'>): boolean {
  return r.kind === 'benchmark' && !String(r.dimension ?? '').startsWith('profile_');
}

/** A question about the brand itself (it names the brand), as opposed to a buyer's question. */
export function isBrandQuestion(r: Pick<ResearchRecord, 'intent' | 'query'>, brand: string): boolean {
  if (r.intent === 'branded') return true;
  return Boolean(brand) && String(r.query ?? '').toLowerCase().includes(brand.toLowerCase());
}

/**
 * Visibility read both ways, from what the pack observed:
 *   found      — searches and AI answers to buyer questions that do not name the company;
 *   recognised — the company's own name (Google: is the site first, is there a panel for it, what else
 *                ranks; AI tools: is the company described correctly) and the definitional question
 *                (a precise description of the offering without the name: is the company the answer?).
 * Each part is null when it was not observed — unknown, never zero.
 */
export type TwoWayVisibility = {
  found: { searchChecked: number; searchFound: number; aiAnswers: number; aiNamed: number } | null;
  recognised: {
    nameSearch: { query: string; ownPosition: number | null; panel: ResearchRecord['knowledgePanel'] | null; others: string[]; date: string } | null;
    nameSearchFailed: string | null;
    aiByName: Array<{ surface: string; query: string; accuracy: 'correct' | 'partly' | 'misidentified' | null; note: string | null }>;
    definitional: { query: string; answers: number; named: number; namedInstead: string[] } | null;
  };
};

export function twoWayVisibility(pack: ResearchPack | null): TwoWayVisibility | null {
  if (!pack) return null;
  const brand = pack.subject.brand;
  const ok = pack.search.filter((r) => r.status === 'observed');
  const buyerSearch = ok.filter((r) => !isBrandQuestion(r, brand));
  const ai = pack.generative.filter((r) => r.status === 'observed' && r.query && r.kind !== 'ai_overview');
  const buyerAi = ai.filter((r) => !isBrandQuestion(r, brand));
  const name = ok.find((r) => r.intent === 'branded');
  const nameFailed = name ? null : pack.search.find((r) => r.intent === 'branded' && r.status !== 'observed');
  const def = ai.filter((r) => r.intent === 'definitional');
  const instead = new Map<string, number>();
  for (const r of def) for (const b of r.brandsNamed ?? []) instead.set(b, (instead.get(b) ?? 0) + 1);
  return {
    found: buyerSearch.length || buyerAi.length ? { searchChecked: buyerSearch.length, searchFound: buyerSearch.filter((r) => r.ownPosition != null).length, aiAnswers: buyerAi.length, aiNamed: buyerAi.filter((r) => r.mentioned).length } : null,
    recognised: {
      nameSearch: name ? { query: String(name.query ?? brand), ownPosition: name.ownPosition ?? null, panel: name.knowledgePanel ?? null,
        others: (name.results ?? []).filter((x) => x.position < (name.ownPosition ?? 99)).map((x) => x.domain).filter((d, i, a) => d && a.indexOf(d) === i).slice(0, 5), date: name.observedAt.slice(0, 10) } : null,
      nameSearchFailed: nameFailed ? nameFailed.claim : null,
      aiByName: ai.filter((r) => r.accuracy !== undefined && isBrandQuestion(r, brand)).map((r) => ({ surface: String(r.surface ?? r.kind), query: String(r.query), accuracy: r.accuracy ?? null, note: r.claim.split('(')[1]?.replace(/\).*$/, '') ?? null })),
      definitional: def.length ? { query: String(def[0].query), answers: def.length, named: def.filter((r) => r.mentioned).length, namedInstead: [...instead.entries()].sort((a, b) => b[1] - a[1]).map(([b]) => b).slice(0, 5) } : null,
    },
  };
}

/** The three kinds of visibility, counted only from what the pack observed. */
export function summariseVisibility(pack: ResearchPack | null): VisibilitySummary {
  if (!pack) return { search: null, generative: null };
  const ok = pack.search.filter((r) => r.status === 'observed');
  const branded = ok.filter((r) => isBrandQuestion(r, pack.subject.brand));
  const grounded = pack.generative.filter((r) => r.status === 'observed');
  // Google AI Overview has its own denominator (overviews retrieved); it is not one of the AI tools'
  // answers, so it stays out of these counts exactly as it does in the ledger.
  const buyer = grounded.filter((r) => r.query && r.kind !== 'ai_overview' && !isBrandQuestion(r, pack.subject.brand));
  const brand = grounded.filter((r) => r.accuracy);
  return {
    search: {
      found: ok.filter((r) => r.ownPosition != null).length,
      checked: ok.length,
      branded: branded.length,
      brandedFound: branded.filter((r) => r.ownPosition != null).length,
      failed: pack.search.filter((r) => r.status === 'failed_source').length,
      geography: ok[0]?.geography ?? null,
      date: ok[0]?.observedAt?.slice(0, 10) ?? null,
    },
    generative: {
      grounded: grounded.length,
      mentioned: grounded.filter((r) => r.mentioned).length,
      cited: grounded.filter((r) => r.cited).length,
      failed: pack.generative.filter((r) => r.status === 'failed_source').length,
      notMeasuredSurfaces: [...new Set(pack.generative.filter((r) => r.status === 'not_measured' && r.kind !== 'model_recall').map((r) => r.surface ?? r.kind))],
      excluded: pack.generative.filter((r) => r.kind === 'model_recall').map((r) => r.surface ?? 'model recall'),
      buyerAnswers: buyer.length,
      buyerNamed: buyer.filter((r) => r.mentioned).length,
      surfaces: [...new Set(grounded.map((r) => r.surface ?? r.kind))],
      brandAnswers: brand.length,
      brandCorrect: brand.filter((r) => r.accuracy === 'correct').length,
      brandMisidentified: brand.filter((r) => r.accuracy === 'misidentified').length,
    },
  };
}
