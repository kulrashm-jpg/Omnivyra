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
};

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
  return {
    subject: { brand: String(p.subject?.brand ?? ''), domain: subject },
    collectedAt: String(p.collectedAt ?? ''),
    collector: String(p.collector ?? ''),
    method: (p.method && typeof p.method === 'object') ? p.method as Record<string, string> : {},
    company: (p.company ?? []).filter(valid),
    search: (p.search ?? []).filter(valid),
    generative: (p.generative ?? []).filter(valid),
    competitors: (p.competitors ?? []).filter(valid),
    independent: (p.independent ?? []).filter(valid),
    gaps: (p.gaps ?? []).filter(valid),
    site: (Array.isArray(p.site) ? p.site : []).filter(valid),
    benchmark: (Array.isArray(p.benchmark) ? p.benchmark : []).filter(valid),
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

/** The three kinds of visibility, counted only from what the pack observed. */
export function summariseVisibility(pack: ResearchPack | null): VisibilitySummary {
  if (!pack) return { search: null, generative: null };
  const ok = pack.search.filter((r) => r.status === 'observed');
  const branded = ok.filter((r) => r.intent === 'branded');
  const grounded = pack.generative.filter((r) => r.status === 'observed');
  const buyer = grounded.filter((r) => r.query && !isBrandQuestion(r, pack.subject.brand));
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
