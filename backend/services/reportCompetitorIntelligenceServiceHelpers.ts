import type { ScoreState } from './snapshotReport/canonicalScoreState';
import type { ComparisonMetrics, CompetitorCrawlOutcome, DomainCrawlSignals } from './competitor/competitorMetricsTypes';
import type { PersistedDecisionObject } from './decisionObjectService';
import type { ResolvedReportInput } from './reportInputResolver';
import { classifyDecisionType } from './decisionTypeRegistry';
import { impactScore } from './reportDecisionUtils';
import { supabase } from '../db/supabaseClient';
import { config } from '@/config';
// Canonical credential resolution — one path for every SERP call site.
import { resolveProviderCredential } from './providerCredentialResolver';
import { fetchCanonicalSerp } from './serp/canonicalSerpClient';
import type { SerpResultType } from './serp/serpResultTypes';
// R1-D — the EXISTING classifier, reached from production for the first time.
// `serpQueryUniverse` has held a deterministic branded/commercial/informational
// classifier since Phase 3, and until now its only caller was a unit test: no
// report ever carried a query class. Nothing is re-implemented here; the query
// set competitor discovery already runs is classified with the module that was
// written for exactly that and then left unwired.
import {
  brandTokensFor,
  classifyQuery,
  intentForClass,
  type QueryClass,
  type QueryIntent,
} from './serpQueryUniverse';
// R1-L2 -- the Report 1 query-origin allow-list. GSC is structurally absent from this taxonomy.
import {
  type Report1Query,
  type Report1QueryCandidate,
  type Report1QueryOrigin,
} from './report1QueryUniverse';
import {
  buildCompetitorFitRationale,
  buildCompetitorFitSignals,
  evaluateCompetitorCandidate,
  extractCompetitiveContextFromResolvedInput,
  isSparseIdentityFallbackValue,
  scoreCompetitorCandidate,
  type CompanyCompetitiveContext as EngineCompanyCompetitiveContext,
  type CompetitorSource as EngineCompetitorSource,
  type CompetitorRevenueTier,
  type CompetitorTier,
  type CompetitorAuthoritySignals,
  type CompetitorPositioning,
} from './competitorEngineService';
import type { CompetitorEnrichmentProfile } from './competitorEnrichmentKnowledge';
import type { CompetitorSecondaryTag } from './competitorTaxonomy';
// Phase 3: canonical two-axis relations carried through to the report payload.
import type { CompetitorRelations } from './competitorRelationModel';
import type { CompetitorDimensionScores, CompetitorDiscoverySource } from '../../types/competitor';

type CompetitorClassification = 'direct_competitor' | 'seo_competitor' | 'authority_leader';
type CompetitorSource = EngineCompetitorSource;

/**
 * WP-12 — this module carried its OWN `ComparisonMetrics` declaration in which all seven
 * dimensions were plain `number`. That duplicate silently contradicted the canonical leaf type,
 * where `publishing_frequency`, `engagement_score` and `geo_presence` are `number | null`, and
 * it is the type `subtractMetrics` and `averageCompetitorMetrics` below are written against —
 * the two functions whose whole job is to keep a missing dimension missing. With
 * `"strict": false` the contradiction produced no diagnostic at all. The duplicate is gone; the
 * canonical type is imported from the leaf module.
 */

export type DetectedCompetitor = {
  name: string;
  domain: string | null;
  category: string;
  tags: CompetitorSecondaryTag[];
  classification: CompetitorClassification;
  source: CompetitorSource;
  relevance_score: number;
  problem_overlap: number;
  icp_overlap: number;
  market_overlap: number;
  revenue_tier: CompetitorRevenueTier;
  product_depth: number;
  authority_score: number;
  authority_signals: CompetitorAuthoritySignals;
  final_score: number;
  tier: CompetitorTier;
  positioning: CompetitorPositioning;
  enrichment: CompetitorEnrichmentProfile | null;
  enrichment_confidence_score: number;
  rationale: string;
  /**
   * Phase 3 — the canonical two-axis relations (product / market) attached by the ranking
   * engine. `toDetectedCompetitor` already carries this through via spread; declaring it
   * here makes it visible to the report composition without a second mapping step.
   * Optional because legacy construction sites do not set it.
   */
  relations?: CompetitorRelations;
  /** Discovery provenance, carried through from the ranked competitor. */
  discoverySources?: CompetitorDiscoverySource[];
  /** Score-card dimensions, carried through by `toDetectedCompetitor`. */
  dimensions?: CompetitorDimensionScores;
  fit_signals?: {
    market_focus?: string | null;
    product_service?: string | null;
    geography?: string | null;
    team_size?: string | null;
    founded_year?: string | null;
    revenue_range?: string | null;
    target_customer?: string | null;
    business_model?: string | null;
  };
};

export type CompetitorComparisonEntry = {
  competitor: DetectedCompetitor;
  /**
   * D8 — NULL when this competitor was never observed. A null here is the honest
   * absence of evidence and must stay null: it is not a zero, and it must never be
   * back-filled from the customer's own metrics.
   */
  metrics: ComparisonMetrics | null;
  deltas_vs_company: ComparisonMetrics | null;
  /**
   * D8 — canonical ScoreState. `inferred` when derived from this competitor's own
   * observed public pages; `unavailable` when nothing was observed. Never `measured`:
   * a page-text proxy is not a measurement of authority or engagement.
   */
  metrics_state: ScoreState;
  /** Why the metrics are in that state, in the producer's own words. */
  metrics_basis: string;
  /** How the attempt to observe this competitor ended (D2 reachability vocabulary). */
  crawl_outcome: CompetitorCrawlOutcome;
};

export type CompetitorGapType = 'content_gap' | 'authority_gap' | 'visibility_gap' | 'trust_gap' | 'aeo_gap';

export type CompetitorGap = {
  gap_type: CompetitorGapType;
  issue_type: PersistedDecisionObject['issue_type'];
  title: string;
  insight: string;
  why_it_matters: string;
  recommendation: string;
  action_type: PersistedDecisionObject['action_type'];
  expected_outcome: string;
  effort_level: 'low' | 'medium' | 'high';
  impact_score: number;
  confidence_score: number;
  leading_competitors: string[];
};

export type CompetitiveSummary = {
  top_threats: string[];
  key_advantage: string;
  key_risk: string;
  positioning_statement: string;
};

export type CompetitorIntelligenceResult = {
  summary: string;
  detected_competitors: DetectedCompetitor[];
  competitors_by_tier: {
    tier_1: DetectedCompetitor[];
    tier_2: DetectedCompetitor[];
    tier_3: DetectedCompetitor[];
  };
  comparison: {
    /** WP-12 — NULL when the subject's own site was not observed. Never a zeroed baseline. */
    company: ComparisonMetrics | null;
    company_metrics_state?: ScoreState;
    company_metrics_basis?: string;
    competitors: CompetitorComparisonEntry[];
  };
  generated_gaps: CompetitorGap[];
  competitive_summary: CompetitiveSummary;
  keyword_gap?: {
    missing_keywords: string[];
    weak_keywords: string[];
    strong_keywords: string[];
  };
  answer_gap?: {
    missing_answers: string[];
    weak_answers: string[];
    strong_answers: string[];
  };
  discovery_metadata?: {
    keyword_count: number;
    serp_domains_found: number;
    serp_status: 'live' | 'fallback';
    is_fallback_used: boolean;
    /**
     * D8 — how many competitors had comparison metrics derived from their OWN observed
     * public pages, and how many did not. Published so a consumer can tell a real
     * comparison from an empty one without inferring it from the entries.
     */
    competitors_with_observed_metrics?: number;
    competitors_without_observed_metrics?: number;
  };
};

const MAX_COMPETITORS = 3;
const MAX_DISCOVERY_KEYWORDS = 8;
const MAX_KEYWORD_SOURCE_PAGES = 50;
const MAX_COMPETITOR_PAGES = 5;
const MAX_CRAWL_DEPTH = 2;
const MIN_SERP_DOMAINS_PER_KEYWORD = 3;
const STOPWORDS = new Set([
  'the', 'and', 'for', 'with', 'from', 'into', 'that', 'this', 'your', 'you', 'our', 'are', 'was',
  'have', 'has', 'will', 'can', 'how', 'why', 'what', 'when', 'where', 'who', 'not', 'all', 'any',
  'about', 'service', 'services', 'company', 'business', 'solutions', 'solution', 'platform',
  'home', 'page', 'contact', 'blog', 'pricing', 'learn', 'more', 'demo', 'free', 'best',
]);
const METRIC_KEYS: Array<keyof ComparisonMetrics> = [
  'content_depth',
  'authority_score',
  'publishing_frequency',
  'engagement_score',
  'seo_coverage',
  'geo_presence',
  'aeo_readiness',
];

const BLOCKED_SERP_HOSTS = new Set([
  'amazon.com',
  'apple.com',
  'facebook.com',
  'github.com',
  'google.com',
  'instagram.com',
  'linkedin.com',
  'microsoft.com',
  'reddit.com',
  'tiktok.com',
  'twitter.com',
  'wikipedia.org',
  'x.com',
  'youtube.com',
]);

const GENERIC_SERVICE_DOMAIN_TOKENS = new Set([
  'agency',
  'agencies',
  'consulting',
  'consultants',
  'developer',
  'developers',
  'development',
  'employee',
  'employees',
  'outsourcing',
  'staffing',
  'virtual',
  'webdesign',
]);


export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}


export function average(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}


export function tokenize(value: string): string[] {
  return value
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 3 && !STOPWORDS.has(token));
}


export function topTokensFromTexts(texts: string[], limit = MAX_DISCOVERY_KEYWORDS): string[] {
  const counts = new Map<string, number>();
  texts.forEach((text) => {
    tokenize(text).forEach((token) => {
      counts.set(token, (counts.get(token) ?? 0) + 1);
    });
  });

  return [...counts.entries()]
    .sort((left, right) => right[1] - left[1])
    .map(([token]) => token)
    .slice(0, limit);
}


export function topPhrasesFromTexts(texts: string[], limit = MAX_DISCOVERY_KEYWORDS): string[] {
  const counts = new Map<string, number>();
  texts.forEach((text) => {
    const tokens = tokenize(text);
    for (let index = 0; index < tokens.length - 1; index += 1) {
      const phrase = `${tokens[index]} ${tokens[index + 1]}`;
      counts.set(phrase, (counts.get(phrase) ?? 0) + 1);
    }
  });
  return [...counts.entries()]
    .sort((left, right) => right[1] - left[1])
    .map(([phrase]) => phrase)
    .slice(0, limit);
}


export function classifyIntent(value: string): 'informational' | 'commercial' | 'comparison' {
  const normalized = value.toLowerCase();
  if (/\b(vs|versus|compare|comparison|alternative|alternatives)\b/.test(normalized)) {
    return 'comparison';
  }
  if (/\b(best|top|pricing|price|cost|service|services|agency|platform|software|tool|tools|buy)\b/.test(normalized)) {
    return 'commercial';
  }
  return 'informational';
}


export function normalizeDomain(value: string | null | undefined): string | null {
  const raw = String(value ?? '').trim().toLowerCase();
  if (!raw) return null;
  return raw.replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, '');
}

function rootDomainTokenText(domain: string): string {
  const root = domain.split('.')[0] ?? domain;
  return root.replace(/[^a-z0-9]+/gi, ' ').toLowerCase();
}

function isBlockedSerpDomain(domain: string, ownDomain: string): boolean {
  const normalized = normalizeDomain(domain);
  const own = normalizeDomain(ownDomain);
  if (!normalized || normalized === own) return true;
  if (BLOCKED_SERP_HOSTS.has(normalized)) return true;
  if ([...BLOCKED_SERP_HOSTS].some((host) => normalized.endsWith(`.${host}`))) return true;
  const rootTokens = new Set(rootDomainTokenText(normalized).split(/\s+/).filter(Boolean));
  const genericServiceHit = [...rootTokens].some((token) => GENERIC_SERVICE_DOMAIN_TOKENS.has(token));
  const marketSpecificHit = [...rootTokens].some((token) =>
    ['ai', 'crm', 'growth', 'marketing', 'mental', 'therapy', 'wellness', 'sales', 'seo'].includes(token),
  );
  return genericServiceHit && !marketSpecificHit;
}

function simplifyKeyword(keyword: string): string {
  return keyword
    .toLowerCase()
    .replace(/\b(best|top|leading|competitors?|alternatives?|platforms?|software|tools?|apps?|services?)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}


export function titleCase(value: string): string {
  return value
    .split(/[\s-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}


export function domainToName(domain: string): string {
  const root = domain.split('.')[0] ?? domain;
  return titleCase(root.replace(/[^a-z0-9]+/gi, ' '));
}


export function extractDomainKeywords(domain: string | null | undefined): string[] {
  const normalized = normalizeDomain(domain);
  if (!normalized) return [];
  const root = normalized.split('.')[0] ?? normalized;
  const tokens = root
    .replace(/\d+/g, ' ')
    .split(/[^a-z]+/i)
    .map((token) => token.trim().toLowerCase())
    .filter((token) => token.length >= 3 && !['www', 'app', 'get', 'the', 'and', 'for'].includes(token));
  return [...new Set(tokens)];
}


export function extractBusinessKeywords(value: string | null | undefined): string[] {
  const raw = String(value ?? '').toLowerCase();
  if (!raw) return [];
  return [...new Set(
    raw
      .split(/[^a-z]+/)
      .map((token) => token.trim())
      .filter((token) => token.length >= 4 && !['services', 'service', 'company', 'business', 'digital'].includes(token)),
  )];
}

export type CompanyCompetitiveContext = EngineCompanyCompetitiveContext;

export type DiscoveryKeywordInput =
  | ResolvedReportInput
  | CompanyCompetitiveContext
  | Record<string, unknown>
  | null
  | undefined;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function textValue(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.replace(/\s+/g, ' ').trim();
  return trimmed.length > 0 ? trimmed : null;
}

function textList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map(textValue).filter((item): item is string => Boolean(item));
  }
  const single = textValue(value);
  return single ? [single] : [];
}

function pickText(records: Array<Record<string, unknown> | null | undefined>, keys: string[]): string | null {
  for (const record of records) {
    if (!record) continue;
    for (const key of keys) {
      const direct = textValue(record[key]);
      if (direct) return direct;
      const firstListItem = textList(record[key])[0];
      if (firstListItem) return firstListItem;
    }
  }
  return null;
}

export function normalizeQueryPart(value: string | null | undefined, maxTokens = 6): string | null {
  const normalized = String(value ?? '')
    .replace(/https?:\/\/\S+/gi, ' ')
    .replace(/www\.[^\s]+/gi, ' ')
    .replace(/[^\w\s-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!normalized) return null;
  const tokens = normalized.split(/\s+/).filter((token) => token.length > 0);
  return tokens.slice(0, maxTokens).join(' ');
}

function pushUniqueQuery(queries: string[], value: string | null | undefined): void {
  const normalized = normalizeQueryPart(value, 8);
  if (!normalized) return;
  const key = normalized.toLowerCase();
  if (!queries.some((query) => query.toLowerCase() === key)) {
    queries.push(normalized);
  }
}

function extractDiscoveryFields(companyProfile: DiscoveryKeywordInput): {
  problem: string | null;
  product: string | null;
  category: string | null;
  icp: string | null;
  domain: string | null;
  context: CompanyCompetitiveContext;
} {
  const inputRecord: Record<string, unknown> | null = isRecord(companyProfile)
    ? companyProfile as Record<string, unknown>
    : null;
  const resolvedRecord = isRecord(inputRecord?.resolved) ? inputRecord.resolved : null;
  const profileRecord = isRecord(inputRecord?.profile) ? inputRecord.profile : inputRecord;
  const companyContextRecord = isRecord(resolvedRecord?.companyContext)
    ? resolvedRecord.companyContext
    : isRecord(inputRecord?.companyContext)
      ? inputRecord.companyContext
      : inputRecord;

  const context = resolvedRecord
    ? extractCompanyCompetitiveContext(companyProfile as ResolvedReportInput)
    : {
        marketFocus: pickText([companyContextRecord, profileRecord], ['marketFocus', 'market_focus', 'category', 'industry', 'businessType', 'business_type']),
        primaryService: pickText([companyContextRecord, profileRecord], ['primaryService', 'primary_service', 'productServices', 'product_services', 'products_services', 'products_services_list']),
        targetCustomer: pickText([companyContextRecord, profileRecord], ['targetCustomer', 'target_customer', 'targetCustomerSegment', 'target_customer_segment', 'target_audience']),
        idealCustomerProfile: pickText([companyContextRecord, profileRecord], ['idealCustomerProfile', 'ideal_customer_profile', 'icp']),
        brandPositioning: pickText([companyContextRecord, profileRecord], ['brandPositioning', 'brand_positioning', 'problem', 'pain_points', 'competitiveAdvantages', 'competitive_advantages']),
        geography: pickText([companyContextRecord, profileRecord], ['geography', 'market', 'region']),
        teamSize: pickText([companyContextRecord, profileRecord], ['teamSize', 'team_size']),
        foundedYear: pickText([companyContextRecord, profileRecord], ['foundedYear', 'founded_year']),
        revenueRange: pickText([companyContextRecord, profileRecord], ['revenueRange', 'revenue_range']),
        businessModel: pickText([companyContextRecord, profileRecord], ['businessModel', 'business_model', 'pricing_model', 'sales_motion']),
      } satisfies CompanyCompetitiveContext;

  const domain = normalizeDomain(
    pickText([resolvedRecord, profileRecord], ['websiteDomain', 'website_domain', 'website_url', 'url', 'domain']),
  );

  return {
    problem: pickText([companyContextRecord, profileRecord], ['problem', 'pain_points', 'brandPositioning', 'brand_positioning', 'competitiveAdvantages', 'competitive_advantages']) ?? context.brandPositioning,
    product: context.primaryService,
    category: context.marketFocus,
    icp: context.targetCustomer ?? context.idealCustomerProfile,
    domain,
    context,
  };
}

/**
 * R1-L2 -- the declared/template discovery candidates, each carrying the origin that produced it.
 *
 * This is the SAME query construction `generateDiscoveryKeywords` has always performed, in the
 * same order; the only addition is that every candidate records WHY it exists at the moment it
 * is built. Nothing downstream may re-derive that from the query text.
 *
 * THE BASE DECIDES THE ORIGIN. A template is only as grounded as the term it is applied to, so a
 * template built on the generic fallback is reported as `derived_fallback`, not
 * `derived_template`. Calling it a template would imply a real category stood behind it.
 */
export function generateDiscoveryQueryCandidates(
  companyProfile: DiscoveryKeywordInput,
): Report1QueryCandidate[] {
  const fields = extractDiscoveryFields(companyProfile);
  const category = normalizeQueryPart(fields.category, 5);
  const product = normalizeQueryPart(fields.product, 5);
  const problem = normalizeQueryPart(fields.problem, 5);
  const icp = normalizeQueryPart(fields.icp, 5);
  const domainTerms = extractDomainKeywords(fields.domain).join(' ');

  // BASE SELECTION IS UNCHANGED, DELIBERATELY -- this is the original expression, `??` and all.
  //
  // `extractDomainKeywords(...).join(' ')` returns '' rather than null when a domain yields no
  // tokens, and '' is not nullish, so the trailing 'business software' is UNREACHABLE: the real
  // fallback has always been an EMPTY base, producing bare template queries ('competitors',
  // 'alternatives'). Rewriting this as a truthiness chain would make the literal reachable and
  // would therefore SILENTLY CHANGE which queries Report 1 dispatches. L-2 discloses the
  // fallback; it does not alter query behaviour. The dead branch is reported, not fixed here.
  const base = category ?? product ?? problem ?? domainTerms ?? 'business software';

  // ALL-OR-NOTHING. The sparse-identity substitution replaces the whole context object in one
  // spread, so either every field is the company's or every field is the hard-coded template.
  // One flag therefore models it exactly, and it governs EVERY candidate below -- not just the
  // base -- because the product, problem, ICP and vertical-trigger text are substituted too.
  const contextIsFabricated = isSparseIdentityFallbackValue(fields.category)
    || isSparseIdentityFallbackValue(fields.product)
    || isSparseIdentityFallbackValue(fields.problem)
    || isSparseIdentityFallbackValue(fields.icp);
  const FABRICATED_RATIONALE =
    'Generic category template. No declared or public subject context was available for this company, '
    + 'so a hard-coded placeholder identity was used — this is not a statement about this company.';
  /** Route every candidate through one place, so no branch can quietly claim `declared`. */
  const tag = (
    value: string,
    origin: Report1QueryOrigin,
    rationale: string,
    basis: string,
  ): Report1QueryCandidate => (contextIsFabricated
    ? { value, origin: 'derived_fallback', rationale: FABRICATED_RATIONALE, basis: 'fabricated placeholder identity' }
    : { value, origin, rationale, basis });

  // Provenance for whichever branch supplied the base.
  //
  // A FABRICATED IDENTITY IS NOT A DECLARATION. When the profile is too sparse to describe the
  // company, `extractCompetitiveContextFromResolvedInput` substitutes a hard-coded identity
  // ('business software and marketing automation', ...) — its own comment calls this fabricating
  // the owner's identity. Those values arrive here indistinguishable from real ones, so a naive
  // classifier would label a template as something the company said about itself. Recognising the
  // substitute keeps `declared` meaning declared. It changes no query: the same text is still
  // dispatched, it is simply reported as the generic fallback it is.
  //
  // BOTH other fallback shapes — an empty base, and the unreachable generic literal — resolve
  // here too, so no ungrounded query can be presented as the company's declared category.
  // The RAW field is tested, never the normalized one: `normalizeQueryPart(..., 5)` truncates to
  // five tokens, so a longer substituted value ('software platform for growth and customer
  // acquisition') would stop matching the sentinel and would read as declared.
  const declaredBase = (normalized: string | null, raw: string | null): boolean =>
    Boolean(normalized) && !isSparseIdentityFallbackValue(raw);
  const baseSource: { origin: Report1QueryOrigin; basis: string } =
    declaredBase(category, fields.category) ? { origin: 'declared', basis: 'company profile: category' }
      : declaredBase(product, fields.product) ? { origin: 'declared', basis: 'company profile: product or service' }
        : declaredBase(problem, fields.problem) ? { origin: 'declared', basis: 'company profile: problem or positioning' }
          : domainTerms.trim() ? { origin: 'observed_public', basis: 'public domain label' }
            : { origin: 'derived_fallback', basis: 'no declared or public subject context' };
  const templateOrigin: Report1QueryOrigin =
    baseSource.origin === 'derived_fallback' ? 'derived_fallback' : 'derived_template';
  const templateRationale = baseSource.origin === 'derived_fallback'
    ? 'Generic category template. No declared or public subject context was available for this company.'
    : 'Category template applied to the ' + baseSource.basis + '.';
  const tmpl = (value: string): Report1QueryCandidate =>
    tag(value, templateOrigin, templateRationale, baseSource.basis);

  const contextText = [
    fields.category,
    fields.product,
    fields.problem,
    fields.icp,
    domainTerms,
  ].filter(Boolean).join(' ').toLowerCase();

  const candidates: Report1QueryCandidate[] = [];
  candidates.push(tmpl(`${base} competitors`));
  candidates.push(tmpl(`${base} alternatives`));
  candidates.push(tmpl(`${base} software platforms`));
  candidates.push(tmpl(`best ${base} software`));
  candidates.push(tmpl(`${base} comparison`));
  if (product) {
    const on = 'company profile: product or service';
    const why = 'Category template applied to the declared product or service.';
    for (const value of [
      `${product} competitors`,
      `${product} alternatives`,
      `alternatives to ${product}`,
      `best ${product} software`,
      `${product} tools`,
    ]) candidates.push(tag(value, 'derived_template', why, on));
  }
  if (problem) {
    const on = 'company profile: problem or positioning';
    const why = 'Category template applied to the declared problem or positioning.';
    for (const value of [`${problem} tools`, `software for ${problem}`]) {
      candidates.push(tag(value, 'derived_template', why, on));
    }
  }
  if (icp && category) {
    candidates.push(tag(
      `${icp} ${category} platforms`,
      'derived_template',
      'Category template combining the declared customer segment and category.',
      'company profile: customer segment and category',
    ));
  }

  // Vertical template sets, selected by a deterministic match on the DECLARED context text.
  // Fixed lists rather than base-derived, so the basis names the set instead of a profile field.
  if (/\b(mental|wellness|wellbeing|therapy|therapeutic|reflection|self reflection|self-reflection|clarity|emotional|mood|journaling|meditation|mindfulness|stress|anxiety)\b/.test(contextText)) {
    for (const value of [
      'AI mental wellness apps',
      'AI therapy chatbot competitors',
      'self reflection AI tools',
      'mental clarity apps',
      'digital therapy platforms',
      'guided journaling apps',
      'emotional wellbeing AI apps',
    ]) candidates.push(tag(
      value,
      'derived_template',
      'Fixed wellness-vertical template set, selected by the declared company context.',
      'template set: wellness',
    ));
  }

  if (/\b(marketing|crm|sales|campaign|growth|seo|content|revenue|customer|automation|lead|pipeline|demand)\b/.test(contextText)) {
    for (const value of [
      'marketing automation platforms',
      'B2B marketing operating system competitors',
      'campaign execution software',
      'marketing readiness tools',
      'growth workflow platforms',
      'CRM marketing automation alternatives',
      'HubSpot alternatives',
      'Salesforce competitors',
      'Zoho CRM alternatives',
      'best CRM software for marketing automation',
      'customer growth software platforms',
    ]) candidates.push(tag(
      value,
      'derived_template',
      'Fixed marketing-vertical template set, selected by the declared company context.',
      'template set: marketing',
    ));
  }

  for (const value of [
    `${base} tools`,
    `${base} apps`,
    `${base} platforms`,
    `${base} market leaders`,
    `${base} category competitors`,
  ]) candidates.push(tmpl(value));

  return candidates;
}

/**
 * The plain string list this function has always returned. Implemented in terms of the
 * origin-tagged candidates above so the two can never drift: same order, same `pushUniqueQuery`
 * dedupe, same cap of 10.
 */
export function generateDiscoveryKeywords(companyProfile: DiscoveryKeywordInput): string[] {
  const queries: string[] = [];
  for (const candidate of generateDiscoveryQueryCandidates(companyProfile)) {
    pushUniqueQuery(queries, candidate.value);
  }
  return queries.slice(0, 10);
}


export function toShortLabel(value: string | null | undefined, fallback: string): string {
  const normalized = String(value ?? '').trim();
  if (!normalized) return fallback;
  return normalized.length > 42 ? `${normalized.slice(0, 39).trim()}...` : normalized;
}


export function extractCompanyCompetitiveContext(resolvedInput?: ResolvedReportInput | null): CompanyCompetitiveContext {
  return extractCompetitiveContextFromResolvedInput(resolvedInput);
}


export function buildFitSignals(
  context: CompanyCompetitiveContext,
  geography: string | null,
  productService: string | null,
): DetectedCompetitor['fit_signals'] {
  return buildCompetitorFitSignals(context, geography, productService);
}


export function buildFitRationale(context: CompanyCompetitiveContext, geography: string | null, fallback: string): string {
  return buildCompetitorFitRationale(context, geography, fallback);
}


export function extractDecisionCompetitors(
  decisions: PersistedDecisionObject[],
  companyContext: CompanyCompetitiveContext,
): DetectedCompetitor[] {
  void decisions;
  void companyContext;
  return [];
}


/**
 * GAP-06 — one organic SERP row, as the provider supplied it.
 *
 * `position` is the provider's own rank and is never re-derived. Filtering the array and reusing
 * the index would silently renumber results — a domain at rank 7 would be reported as rank 2 once
 * the six above it were dropped as blocked hosts. That is why the rank travels with the row from
 * the moment it is parsed.
 */
export type SerpOrganicRow = {
  position: number | null;
  url: string | null;
  domain: string;
  title: string | null;
  snippet: string | null;
};

/**
 * GAP-06 — one public query and what it established about the company's own domain.
 *
 * `position === null` means the domain was NOT observed in the rows returned. That is a real
 * finding — "we looked and it was not there" — and is deliberately not expressible as `0`, which
 * a reader would misread as a rank.
 */
export type SerpSearchObservation = {
  query: string;
  position: number | null;
  url: string | null;
  title: string | null;
  snippet: string | null;
  /** Organic rows the provider returned for this query — the window the position was found in. */
  resultCount: number;

  // ─── R1-D: what makes this a measurement rather than a number ────────────
  // Everything below answers a question a reader of a position MUST be able to
  // ask: on which engine, via whom, when, and what kind of query was it. A rank
  // without them is an assertion; with them it is an observation. All six are
  // required rather than optional, so a future code path cannot produce a
  // position that silently lacks its provenance.

  /**
   * What KIND of search this was, classified from the query text against the
   * company's own brand tokens.
   *
   * "We rank #1" means something entirely different for the company's own name
   * than for its category. Before this, every query was an unclassified string,
   * so branded and non-branded visibility were indistinguishable in the output
   * and a company ranking first for nothing but its own name read identically
   * to one ranking first for its market.
   */
  queryClass: QueryClass;
  /** The intent grouping, DERIVED from `queryClass` and never asserted separately. */
  intent: QueryIntent;
  /**
   * The search engine whose results page was read. Null only if the provider
   * returned rows without naming one, which the canonical client does not do.
   */
  engine: string | null;
  /** The intermediary that fetched the page. Distinct from `engine`. */
  provider: string | null;
  /**
   * When THIS query was observed, ISO-8601, as reported by the client that read
   * it.
   *
   * Per observation, not per report. The surface previously carried one
   * assembly-time timestamp for the whole set, which dated the composition
   * rather than the evidence.
   */
  observedAt: string | null;
  /**
   * Other domains on this results page, in the provider's rank order.
   *
   * Competitor-overlap GROUNDWORK only, and deliberately nothing more: it
   * records who else was on the page the company's own rank came from, which is
   * the single comparison SERP alone can support. Nothing here is scored,
   * qualified or classified as a competitor — that is the competitor engine's
   * job, over its own evidence, and this array is not an input to it.
   */
  competitorDomains: string[];

  // ─── R1-L2: WHY THIS QUERY WAS ASKED ─────────────────────────────────────
  //
  // Query origin is a DIFFERENT fact from everything above. `engine`/`provider`/
  // `observedAt` say where the ANSWER came from; these two say why Report 1 put
  // the QUESTION. They must never be conflated or rendered as one line: a
  // declared query that returned a Google result is both declared and observed,
  // on different axes.
  //
  // Carried from construction. `null` means the caller supplied no universe for
  // this query, which reads as "origin not recorded" — never as a guess from the
  // query text.

  /** The permitted input that put this query in the universe. Never a private source. */
  queryOrigin: Report1QueryOrigin | null;
  /** The construction-time sentence explaining the choice. Never re-derived downstream. */
  queryRationale: string | null;
};

/**
 * DG-001 — one non-organic SERP feature observed for a query.
 *
 * Deliberately a DIFFERENT type from `SerpOrganicRow`. Sharing one row type is
 * how a People Also Ask entry ends up in a ranking average: the two are not the
 * same kind of fact, so they are not the same shape.
 */
export type SerpFeatureRow = {
  result_type: SerpResultType;
  /** Null for every feature without a meaningful rank. Never zero. */
  position: number | null;
  url: string | null;
  domain: string | null;
  title: string | null;
};

/**
 * DG-001 — one non-organic feature observed for one query.
 *
 * `ownedByCompany` is THREE-valued on purpose. A feature that carries no URL —
 * People Also Ask, most knowledge panels — cannot establish ownership either
 * way, and `null` says exactly that. Collapsing it to `false` would turn "we
 * cannot tell" into "they do not own it", which is a claim the evidence does
 * not support.
 */
export type SerpFeatureObservation = {
  query: string;
  result_type: SerpResultType;
  position: number | null;
  url: string | null;
  domain: string | null;
  title: string | null;
  ownedByCompany: boolean | null;
};

export type SerpKeywordResult = {
  /** `ok` = the provider answered. `unavailable` = no credential / budget. `failed` = it threw. */
  status: 'ok' | 'unavailable' | 'failed';
  rows: SerpOrganicRow[];
  reason: string | null;
  /** DG-001 — sibling evidence. Never merged into `rows`. */
  features: SerpFeatureRow[];
  /**
   * R1-D — the observation's identity, carried through from the canonical client.
   *
   * This projection previously dropped all three. The client knew which provider
   * it used, which engine it asked for and when the page came back, and this
   * type threw every one of them away one call later, which is why the report
   * surface had to assert `provider: 'serpapi'` as a hard-coded literal and
   * stamp its own assembly clock as the observation time.
   *
   * All three are null unless `status === 'ok'` — nothing was read otherwise.
   */
  provider: string | null;
  engine: string | null;
  observedAt: string | null;
};

/**
 * GAP-06 — how many organic rows to request per query.
 *
 * SerpApi bills per SEARCH, not per result, so raising this costs nothing and adds no requests.
 * Ten is page one: "does this company appear on the first page for its own category?" is the
 * question the search-visibility surface exists to answer, and five could not answer it.
 *
 * Competitor discovery deliberately keeps its own `.slice(0, 5)` below, so its behaviour is
 * unchanged by this — the extra rows are visible only to the own-domain scan.
 */
const SERP_RESULTS_PER_QUERY = 10;
/** Competitor discovery's historical window. Unchanged — see above. */
const SERP_COMPETITOR_WINDOW = 5;

/**
 * GAP-06 — THE single SERP fetch. One request per keyword, returning the provider's rows intact.
 *
 * Previously the only fetch (`fetchSerpDomainsForKeyword`) mapped straight to `string[]` of
 * domains, so `position`, `url`, `title` and `snippet` were discarded at the moment of parsing and
 * the company's own row was then filtered out as "not a competitor". Report 1 was paying for
 * public search evidence on every run and throwing all of it away.
 *
 * This returns the rows; the domain-only helper below is now a thin projection of it, so there is
 * still exactly one request per keyword and competitor discovery sees byte-identical input.
 */
/**
 * DG-001 — whether an observed SERP feature belongs to the company.
 *
 * THREE-VALUED, and the third value is the point. Many features — a People Also
 * Ask entry, a knowledge panel — carry no link at all, so ownership cannot be
 * established either way. `null` says exactly that. Collapsing it to `false`
 * would assert "this feature is NOT the company's" on evidence that does not
 * exist, and a reader counting unowned features would count those as losses.
 *
 * Named and exported so the rule is a contract the DG-001 suite asserts
 * directly, rather than an inline expression that could be relaxed to a bare
 * equality without any test noticing.
 */
export function featureOwnership(
  featureDomain: string | null | undefined,
  ownDomain: string | null | undefined,
): boolean | null {
  if (!featureDomain) return null;
  if (!ownDomain) return null;
  return featureDomain === ownDomain;
}

export async function fetchSerpResultsForKeyword(
  keyword: string,
  geography: string | null,
): Promise<SerpKeywordResult> {
  // ─── DG-001: the CANONICAL client, not a private provider call ───────────
  // The credential, the scan budget, the provider cost governor and the
  // telemetry all live inside it now — this function used to own three of those
  // and lacked the fourth (the governor), so a Report 1 run could bill SerpAPI
  // past a spend ceiling the platform believed it was enforcing.
  //
  // Depth stays ten. It is a semantic boundary rather than a knob: at fifty an
  // own-domain rank of 11–50 would appear where the report previously said "not
  // found", flipping a customer-facing evidence state.
  const { __parseProviderResultsForTest: parse } = await import('./serpAcquisitionService');
  const result = await fetchCanonicalSerp({
    query: keyword,
    geography,
    depth: SERP_RESULTS_PER_QUERY,
    operation: 'search',
  }, parse);

  if (result.status !== 'ok') {
    if (result.status === 'failed') {
      console.warn('[competitor-discovery][serp-keyword-failed]', { keyword, geography, error: result.reason });
    }
    return {
      status: result.status,
      rows: [],
      reason: result.reason ?? 'Public search results could not be retrieved.',
      features: [],
      // No page was read. The identity of an observation that did not happen is
      // null on every axis — including the provider, which is named in the
      // client's own failure result but must not travel on an empty row set as
      // though something had been observed through it.
      provider: null,
      engine: null,
      observedAt: null,
    };
  }

  // ─── ORGANIC ROWS: DERIVED EXACTLY AS BEFORE ─────────────────────────────
  // `domain` is taken from the URL and from nowhere else. The canonical parser
  // also falls back to `displayed_link`/`source`, which this path never
  // consulted — adopting that would resolve domains the old code left blank and
  // would therefore change which five domains competitor discovery sees. The
  // ranking window is a frozen invariant of this consolidation, so the old
  // derivation is preserved deliberately rather than inherited by accident.
  const organicRows = result.rows.filter((row) => (row.result_type ?? 'organic') === 'organic');
  const rows: SerpOrganicRow[] = organicRows.map((row) => ({
    position: row.position,
    url: row.url,
    domain: normalizeDomain(row.url) ?? '',
    title: row.title ?? null,
    snippet: row.snippet ?? null,
  }));

  // ─── FEATURE ROWS: SIBLING EVIDENCE, NEVER RANKING ───────────────────────
  // Returned alongside the organic rows and never merged into them. Everything
  // that computes visibility reads `rows`; nothing that computes visibility
  // reads `features`.
  const features: SerpFeatureRow[] = result.rows
    .filter((row) => (row.result_type ?? 'organic') !== 'organic')
    .map((row) => ({
      result_type: row.result_type ?? 'other',
      position: row.position,
      url: row.url,
      domain: row.domain,
      title: row.title ?? null,
    }));

  // R1-D — the observation's identity travels WITH the rows, from the one place
  // that knows it. Read from the client's result and never re-derived here: a
  // second literal would be a second source of truth for which engine was read.
  return {
    status: 'ok',
    rows,
    reason: null,
    features,
    // `?? null` is not defensive noise: a provider result that does not STATE
    // one of these must read as "not stated", never as `undefined`. `undefined`
    // disappears from JSON entirely, so a stored observation would lose the
    // field rather than record that it was unknown.
    provider: result.provider ?? null,
    engine: result.engine ?? null,
    observedAt: result.observedAt ?? null,
  };
}

/**
 * Competitor-discovery projection of {@link fetchSerpResultsForKeyword}. Behaviour is unchanged:
 * the same top-5 window, the same normalisation, the same de-duplication, the same empty array on
 * any failure. Retained as the public contract its existing callers already depend on.
 */
export async function fetchSerpDomainsForKeyword(keyword: string, geography: string | null): Promise<string[]> {
  const result = await fetchSerpResultsForKeyword(keyword, geography);
  return Array.from(new Set(
    result.rows.slice(0, SERP_COMPETITOR_WINDOW).map((row) => row.domain).filter(Boolean),
  ));
}

export async function discoverCompetitorDomainsFromSerp(params: {
  keywords: string[];
  ownDomain: string;
  geography: string | null;
  /**
   * R1-D — the company name, used ONLY to recognise a branded query.
   *
   * Optional, and its absence degrades honestly rather than silently: without
   * it, brand detection falls back to the domain's bare label (`acme` for
   * `acme.com`), which is the brand token for most companies and is derived
   * from evidence the caller already passes. No query is added, removed or
   * reordered by supplying it — it changes only how a query is LABELLED.
   */
  companyName?: string | null;
  /**
   * R1-L2 — the construction-time origin of each query, keyed on the lowercased
   * query text.
   *
   * LOOKUP, NOT INFERENCE. The caller built this map when it built the query
   * universe; this function only retrieves what was recorded. A query missing
   * from the map gets `null`, so an un-provenanced query stays un-provenanced
   * rather than acquiring an origin guessed from its wording.
   *
   * Optional: callers that do not build a universe (and historical callers) are
   * unaffected and their observations carry `null`.
   */
  queryOrigins?: ReadonlyMap<string, Report1Query>;
}): Promise<{
  domains: string[];
  liveKeywordCount: number;
  /**
   * GAP-06 — the company's OWN rows, harvested from the very same responses.
   *
   * These are not competitor data and must not be confused with it: competitor discovery drops
   * the own domain by design (`isBlockedSerpDomain` returns true for it), which is precisely why
   * the company's public search evidence was being thrown away. Collecting here means one request
   * per keyword still serves both purposes, and an own-domain observation survives even when
   * competitor qualification later rejects every other domain on the page.
   *
   * R1-D — each entry now carries its own query class, intent, engine, provider
   * and observation time, so a position is traceable to the search that produced
   * it. This also makes "QUERY CLASS UNAVAILABLE" a readable state rather than a
   * missing one: a class with zero entries here was never searched, which is a
   * different finding from a class that was searched and did not rank (present,
   * with `position: null`). Neither is poor visibility.
   */
  searchObservations: SerpSearchObservation[];
  /**
   * DG-001 — non-organic SERP features observed across the same responses.
   *
   * Sibling evidence. Never merged into `searchObservations`, because
   * everything that computes search visibility reads that array and a feature
   * has no organic rank to contribute.
   */
  featureObservations: SerpFeatureObservation[];
  /** Acquisition status for the run, so the surface can distinguish unavailable from failed. */
  acquisitionStatus: 'ok' | 'unavailable' | 'failed';
  acquisitionReason: string | null;
  /** External SERP requests actually issued by this discovery run. */
  requestsMade: number;
}> {
  const ranked = new Map<string, number>();
  let liveKeywordCount = 0;
  // Canonical resolution for the pre-flight warning too, so the log reflects the credential
  // that will actually be used rather than a separate `config.*` read.
  const preflight = await resolveProviderCredential('serpapi');
  if (!preflight.value) {
    console.warn('[competitor-discovery][serp-disabled]', {
      reason: preflight.reason, // shape-only; never a credential
      source: preflight.source,
      keywords: params.keywords.slice(0, MAX_DISCOVERY_KEYWORDS),
    });
  }

  // GAP-06 — own-domain evidence, gathered from the same responses competitor discovery reads.
  const searchObservations: SerpSearchObservation[] = [];
  const featureObservations: SerpFeatureObservation[] = [];
  const seenQueries = new Set<string>();
  const seenFeatureQueries = new Set<string>();
  let requestsMade = 0;

  // ─── R1-D: "NOT SEARCHED" IS NOT "SEARCH FAILED" ─────────────────────────
  //
  // THE DEFECT. This was `preflight.value ? 'failed' : 'unavailable'` — with a
  // credential present, the run began life already declaring that SERP
  // acquisition had FAILED, before a single request was issued. Nothing reset it
  // when no request was issued at all, and the engine does call this with an
  // empty keyword list: `keywords` there is built from extraction plus
  // generation and is `[]` when both come back empty. The loop then ran zero
  // times and the run reported `status: 'failed'` with `reason: null`, which the
  // report surface renders as a provider error under the generic "Public search
  // results could not be retrieved for this report."
  //
  // So a company for which NO QUERY WAS EVER RUN was reported as a company whose
  // search provider broke. Those are two of the four states that must never
  // collapse into one another, and neither of them is poor visibility.
  //
  // THE FIX. The status now starts at the only thing true before any request:
  // nothing has been attempted. `attempted` counts dispatched queries, and
  // `failed` is reachable ONLY from a request that was actually made and did not
  // succeed. "Nothing was attempted" resolves to `unavailable` — which is the
  // documented meaning of that state ("acquisition could not run") — and carries
  // a reason that says precisely which of the two it was, rather than inheriting
  // a generic retrieval failure.
  let attempted = 0;
  // TypeScript narrows a `let` to its initialising LITERAL, and every assignment that can
  // reach `failed` happens inside `runKeywordBatch` below — a closure the compiler cannot
  // prove runs. So the compiler modelled this variable as permanently `'unavailable'` and
  // called the invariant guard at the return site a dead comparison (TS2367), even though the
  // guard is live at runtime. Reading the initial value through a typed constant keeps the
  // variable's declared domain, so the compiler's model matches the real state machine.
  //
  // This changes nothing about the state machine: the initial value is still `unavailable`,
  // `failed` is still reachable only from a dispatched request, and the guard is unchanged.
  // An annotated `const` does not help: the compiler narrows a `const` to its literal too.
  // A call's result is typed by the declared return type and is not narrowed to a literal, so
  // this is the minimal way to give the variable its true domain.
  const initialAcquisitionStatus = (): 'ok' | 'unavailable' | 'failed' => 'unavailable';
  let acquisitionStatus = initialAcquisitionStatus();
  let acquisitionReason: string | null = preflight.value
    // A credential exists, so if nothing runs it is because nothing was asked.
    ? 'No search queries were available for this company, so no public search observation was attempted.'
    : (preflight.reason ?? 'No SERP provider credential is configured.');
  const ownDomain = normalizeDomain(params.ownDomain);

  // ─── R1-L2: ORIGIN FOR THE SIMPLIFIED RETRY BATCH ────────────────────────
  //
  // This function dispatches a SECOND batch of its own when nothing ranked: it simplifies each
  // keyword and runs those. Those queries are not in the caller's universe, so without this they
  // would reach the report with no recorded origin at all — an un-provenanced query created
  // inside the producer.
  //
  // A simplified form INHERITS its parent's origin: stripping 'best'/'software'/'tools' is a
  // mechanical reduction of the same term from the same source, so the origin is unchanged.
  // Inventing a new one would be fabricated provenance, and leaving it null would hide a query
  // the report nonetheless shows. This is the same rule `expandReport1QueryUniverse` applies.
  const originByQuery = new Map<string, Report1Query>(params.queryOrigins ?? []);
  const inheritOriginForSimplified = (original: string): void => {
    const parent = originByQuery.get(original.toLowerCase());
    if (!parent) return;
    const simplified = simplifyKeyword(original);
    const key = simplified.toLowerCase();
    if (simplified.length < 3 || originByQuery.has(key)) return;
    originByQuery.set(key, {
      query: simplified,
      origin: parent.origin,
      rationale: `${parent.rationale} Broadened form of the same term.`,
      basis: parent.basis,
    });
  };

  // R1-D — brand tokens for query classification. Derived once, from the inputs
  // the caller already supplies; no lookup, no network, no new evidence source.
  const brandTokens = brandTokensFor({ companyName: params.companyName ?? null, domain: params.ownDomain });
  const classOf = (query: string): { queryClass: QueryClass; intent: QueryIntent } => {
    const queryClass = classifyQuery(query, brandTokens);
    return { queryClass, intent: intentForClass(queryClass) };
  };

  const runKeywordBatch = async (keywords: string[], retry: boolean): Promise<void> => {
    for (const keyword of keywords.slice(0, MAX_DISCOVERY_KEYWORDS)) {
      // A query was dispatched. From here a `failed` verdict is earned rather
      // than assumed — see the state note above.
      attempted += 1;
      const result = await fetchSerpResultsForKeyword(keyword, params.geography);
      if (result.status === 'ok') {
        requestsMade += 1;
        // One successful call is enough to say acquisition worked; a later failure does not
        // retroactively erase the evidence already gathered.
        acquisitionStatus = 'ok';
        acquisitionReason = null;
      } else if (acquisitionStatus !== 'ok') {
        acquisitionStatus = result.status;
        acquisitionReason = result.reason;
      }

      // Own-domain scan across the FULL returned window, before any competitor filtering.
      // `normalizeDomain` is the same canonicalisation competitor discovery uses, so
      // `example.com`, `www.example.com` and `https://example.com/path` all match identically —
      // and nothing else does.
      if (result.status === 'ok' && ownDomain && !seenQueries.has(keyword)) {
        seenQueries.add(keyword);
        const own = result.rows.find((row) => row.domain === ownDomain);
        const { queryClass, intent } = classOf(keyword);
        // R1-L2 — the RECORDED origin for this exact query. Retrieval by key, not inference.
        const recordedOrigin = originByQuery.get(keyword.toLowerCase()) ?? null;
        searchObservations.push({
          query: keyword,
          // The provider's own rank, never the post-filter array index.
          position: own?.position ?? null,
          url: own?.url ?? null,
          title: own?.title ?? null,
          snippet: own?.snippet ?? null,
          resultCount: result.rows.length,
          // ─── R1-D — the provenance of this one measurement ───────────────
          // Reached only inside `status === 'ok'`, so every observation that
          // exists was produced by a page that was actually read. There is no
          // branch that can append an observation without one.
          queryClass,
          intent,
          engine: result.engine,
          provider: result.provider,
          // The time the page was read, from the client that read it — NOT this
          // loop's clock and not the report's assembly clock.
          observedAt: result.observedAt,
          // Rank-ordered page neighbours, own domain excluded. Groundwork only:
          // this is who else was on the page, not a competitor set. The blocked-
          // host filter is deliberately NOT applied — it exists to keep
          // directories and aggregators out of competitor QUALIFICATION, and
          // removing them here would misreport what the results page contained.
          competitorDomains: Array.from(new Set(
            result.rows
              .map((row) => row.domain)
              .filter((domain): domain is string => Boolean(domain) && domain !== ownDomain),
          )),
          // R1-L2 — why the question was asked, as recorded when the universe was
          // built. A different axis from the four fields above, which say where
          // the answer came from. Null when the caller recorded nothing.
          queryOrigin: recordedOrigin?.origin ?? null,
          queryRationale: recordedOrigin?.rationale ?? null,
        });
      }

      // DG-001 — feature evidence from the SAME response, collected once per
      // query alongside the own-domain scan. No extra request is issued.
      if (result.status === 'ok' && !seenFeatureQueries.has(keyword)) {
        seenFeatureQueries.add(keyword);
        for (const feature of result.features) {
          featureObservations.push({
            query: keyword,
            result_type: feature.result_type,
            position: feature.position,
            url: feature.url,
            domain: feature.domain,
            title: feature.title,
            ownedByCompany: featureOwnership(feature.domain, ownDomain),
          });
        }
      }

      const domains = Array.from(new Set(
        result.rows.slice(0, SERP_COMPETITOR_WINDOW).map((row) => row.domain).filter(Boolean),
      )).filter((domain) => !isBlockedSerpDomain(domain, params.ownDomain));
      if (domains.length >= MIN_SERP_DOMAINS_PER_KEYWORD) {
        liveKeywordCount += 1;
      }
      domains.forEach((domain, index) => {
        const weight = 6 - Math.min(index + 1, 5);
        ranked.set(domain, (ranked.get(domain) ?? 0) + weight + (retry ? 1 : 0));
      });
    }
  };

  await runKeywordBatch(params.keywords, false);

  if (ranked.size === 0 && params.keywords.length > 0) {
    // R1-L2 -- record the inherited origin BEFORE dispatching, so the retry batch's
    // observations carry provenance rather than arriving unattributed.
    for (const original of params.keywords) inheritOriginForSimplified(original);
    const simplifiedKeywords = [...new Set(params.keywords.map(simplifyKeyword).filter((keyword) => keyword.length >= 3))];
    if (simplifiedKeywords.length > 0) {
      console.warn('[competitor-discovery][serp-retry-simplified]', {
        original_keywords: params.keywords.slice(0, MAX_DISCOVERY_KEYWORDS),
        retry_keywords: simplifiedKeywords.slice(0, MAX_DISCOVERY_KEYWORDS),
      });
      await runKeywordBatch(simplifiedKeywords, true);
    }
  }

  // ─── R1-D: the state invariant, enforced where it is produced ────────────
  //
  // `failed` is a claim about a request that happened. If nothing was dispatched
  // it cannot be true, and the honest state is `unavailable` — "we could not
  // look" — with a reason naming which of the two reasons applied. This is a
  // belt-and-braces guard on the initialiser above rather than a second code
  // path: the only way to reach `failed` is through a dispatched request, and if
  // that ever stops being so, this corrects it instead of shipping the wrong
  // state to a customer-facing surface.
  if (attempted === 0 && acquisitionStatus === 'failed') {
    acquisitionStatus = 'unavailable';
    acquisitionReason = 'No search query was dispatched, so no public search observation was attempted.';
  }

  return {
    domains: [...ranked.entries()]
    .sort((left, right) => right[1] - left[1])
    .map(([domain]) => domain)
    .slice(0, MAX_COMPETITORS + 3),
    liveKeywordCount,
    searchObservations,
    featureObservations,
    acquisitionStatus,
    acquisitionReason,
    requestsMade,
  };
}

// Defined in competitor/competitorMetricsTypes so the D8 seam can use it without
// importing this module; re-exported here so existing importers are unchanged.
export type { DomainCrawlSignals };


export function extractTitle(html: string): string {
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return match?.[1]?.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() ?? '';
}


export function extractHeadings(html: string): string[] {
  const headings: string[] = [];
  const regex = /<(h1|h2|h3)[^>]*>([\s\S]*?)<\/\1>/gi;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(html)) != null) {
    const text = match[2].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    if (text) headings.push(text);
  }
  return headings;
}


export function extractAnchors(html: string): string[] {
  const anchors: string[] = [];
  const regex = /<a[^>]*>([\s\S]*?)<\/a>/gi;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(html)) != null) {
    const text = match[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    if (text) anchors.push(text);
  }
  return anchors;
}


export function discoverInternalUrls(params: { html: string; domain: string; maxDepth: number }): string[] {
  const urls = new Set<string>();
  const regex = /<a[^>]+href=["']([^"']+)["']/gi;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(params.html)) != null) {
    const href = String(match[1] ?? '').trim();
    if (!href || href.startsWith('#') || href.startsWith('mailto:') || href.startsWith('tel:')) continue;
    const absolute = href.startsWith('http') ? href : `https://${params.domain}${href.startsWith('/') ? href : `/${href}`}`;
    const normalized = normalizeDomain(absolute);
    if (normalized !== params.domain) continue;
    const path = absolute.replace(/^https?:\/\/[^/]+/i, '');
    if (!path || path === '/') continue;
    if (path.split('/').filter(Boolean).length > params.maxDepth + 1) continue;
    urls.add(`https://${params.domain}${path.startsWith('/') ? path : `/${path}`}`);
  }
  return [...urls];
}


export function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}


export function extractAnswerTopics(texts: string[]): string[] {
  return texts
    .filter((value) => /\b(how|what|why|when|faq|guide|compare|vs|best)\b/i.test(value))
    .flatMap((value) => topTokensFromTexts([value], 4))
    .slice(0, 10);
}


export function classifyCompetitors(competitors: DetectedCompetitor[]): DetectedCompetitor[] {
  return competitors.slice(0, MAX_COMPETITORS).map((competitor, index) => {
    if (competitor.classification) return competitor;
    if (index === 0) return { ...competitor, classification: 'direct_competitor' };
    if (index === 1) return { ...competitor, classification: 'seo_competitor' };
    return { ...competitor, classification: 'authority_leader' };
  });
}


export function dedupeCompetitors(competitors: DetectedCompetitor[]): DetectedCompetitor[] {
  const seen = new Set<string>();
  const results: DetectedCompetitor[] = [];
  for (const competitor of competitors) {
    const key = `${competitor.domain ?? competitor.name}`.trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    results.push(competitor);
  }
  return results;
}


export function countCategory(decisions: PersistedDecisionObject[], category: string): number {
  return decisions.filter((decision) => classifyDecisionType(decision.issue_type) === category).length;
}


/**
 * REMEDIATION-003 — THE COMPANY BASELINE IS NOT OBSERVED, SO IT IS NOT PUBLISHED.
 *
 * Every one of the seven dimensions this used to return was `constant ± penalty ± bonus`:
 * an invented centre (64, 59, 48, 53, 61, 47, 57) moved by counts of our OWN decisions and
 * by booleans for whether the tenant had filled in a business type, a geography, a domain or
 * a social link. Not one was an observation of the company. The constants have no benchmark
 * and no derivation — the same objection the presence-scoring rewrite raised about partial-
 * credit floors, one subsystem over.
 *
 * The harm was not the arithmetic, it was the SUBTRACTION. Five gap narratives computed
 * `observed competitor average − invented company baseline` and published the difference as
 * a competitive finding, so a customer could be told a named competitor was ahead by a margin
 * that was a function of how many decisions our own audit happened to emit.
 *
 * The provenance boundary could not catch it: these values never enter the evidence system,
 * carry no `EvidenceObservation`, and so are never classified at all. Relabelling was not
 * available either — per the remediation brief, a fabricated metric is not PUBLIC_OBSERVED,
 * COMPANY_CONFIRMED, INFERRED or ESTIMATED. There is no evidence to classify. The only honest
 * output is no output.
 *
 * Returning `null` is the same `unavailable` convention D8 already established for a competitor
 * nobody observed (`metrics: ComparisonMetrics | null`).
 *
 * ─── WP-12 — THE REAL BASELINE NOW EXISTS ELSEWHERE ───────────────────────────────────────
 * The successor this comment anticipated has been built: `resolveCompanyComparisonBaseline` in
 * the engine crawls the subject's OWN domain with the same crawler and the same reference
 * keywords used for competitors, and `resolveCompanyMetrics` in the D8 seam maps those signals
 * with the same derivation. The asynchronous report path uses that and does not call this
 * function at all.
 *
 * This function survives ONLY for the synchronous path, which performs no crawl and therefore
 * observes nothing — not the competitors, and not the company. `null` is the correct answer
 * there and remains the only answer this function can give: no input it receives (decision
 * counts, profile presence booleans) is an observation of the company, which is precisely why
 * REMEDIATION-003 emptied it. It must never be refilled.
 */
export function computeCompanyMetrics(_params: {
  decisions: PersistedDecisionObject[];
  resolvedInput?: ResolvedReportInput | null;
}): ComparisonMetrics | null {
  return null;
}



/**
 * D8 — `liftMetrics()` was REMOVED, not merely left unused.
 *
 * It synthesised a competitor's comparison metrics as
 *   companyMetric + classificationLift + variation[index]
 * i.e. entirely from the CUSTOMER's own numbers plus a table keyed by the competitor's
 * label and its position in the list. No observation of the competitor was involved, yet
 * the output was published as competitor metrics driving comparison tables, gap
 * narratives and recommendations. The lifts were also large enough to clear the gap
 * thresholds in buildGapDefinitions, so it did not merely produce a number — it produced
 * the conclusion that the customer was losing.
 *
 * A competitor with no observation now resolves to `metrics: null` with state
 * `unavailable` via services/competitor/competitorMetricsEvidence. The function is gone
 * so it cannot be called again by accident.
 */


/**
 * REMEDIATION-003 — a delta needs BOTH sides. `strict` is false in this project, so
 * `null - 5` would silently evaluate to -5 and publish a confident-looking delta built
 * on nothing. `delta()` refuses that explicitly: either side missing yields `null`.
 */
const delta = (left: number | null, right: number | null): number | null =>
  typeof left === 'number' && typeof right === 'number' ? left - right : null;

export function subtractMetrics(left: ComparisonMetrics, right: ComparisonMetrics): ComparisonMetrics {
  return {
    content_depth: delta(left.content_depth, right.content_depth) as number,
    authority_score: delta(left.authority_score, right.authority_score) as number,
    publishing_frequency: delta(left.publishing_frequency, right.publishing_frequency),
    engagement_score: delta(left.engagement_score, right.engagement_score),
    seo_coverage: delta(left.seo_coverage, right.seo_coverage) as number,
    geo_presence: delta(left.geo_presence, right.geo_presence),
    aeo_readiness: delta(left.aeo_readiness, right.aeo_readiness) as number,
  };
}


/**
 * D8 — averages ONLY over competitors whose metrics were actually derived from
 * observation. Returns null when none were, so a caller cannot average an empty set into
 * a confident-looking zero and compare the customer against it.
 */
/** Mean of the values that exist; `null` when none does. Never averages a null as zero. */
const averagePresent = (values: Array<number | null>): number | null => {
  const present = values.filter((v): v is number => typeof v === 'number');
  return present.length > 0 ? average(present) : null;
};

export function averageCompetitorMetrics(entries: CompetitorComparisonEntry[]): ComparisonMetrics | null {
  const observed = entries
    .map((entry) => entry.metrics)
    .filter((metrics): metrics is ComparisonMetrics => metrics != null);
  if (observed.length === 0) return null;
  return {
    content_depth: average(observed.map((metrics) => metrics.content_depth)),
    authority_score: average(observed.map((metrics) => metrics.authority_score)),
    // REMEDIATION-003 — average across the competitors that HAVE the dimension. When none
    // does (the normal case for the three uncrawlable ones) the average is `null`, not 0.
    publishing_frequency: averagePresent(observed.map((metrics) => metrics.publishing_frequency)),
    engagement_score: averagePresent(observed.map((metrics) => metrics.engagement_score)),
    seo_coverage: average(observed.map((metrics) => metrics.seo_coverage)),
    geo_presence: averagePresent(observed.map((metrics) => metrics.geo_presence)),
    aeo_readiness: average(observed.map((metrics) => metrics.aeo_readiness)),
  };
}
