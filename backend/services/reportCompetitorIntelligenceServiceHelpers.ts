import type { PersistedDecisionObject } from './decisionObjectService';
import type { ResolvedReportInput } from './reportInputResolver';
import { classifyDecisionType } from './decisionTypeRegistry';
import { impactScore } from './reportDecisionUtils';
import { supabase } from '../db/supabaseClient';
import axios from 'axios';
import { config } from '@/config';
import {
  buildCompetitorFitRationale,
  buildCompetitorFitSignals,
  evaluateCompetitorCandidate,
  extractCompetitiveContextFromResolvedInput,
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

type CompetitorClassification = 'direct_competitor' | 'seo_competitor' | 'authority_leader';
type CompetitorSource = EngineCompetitorSource;

type ComparisonMetrics = {
  content_depth: number;
  authority_score: number;
  publishing_frequency: number;
  engagement_score: number;
  seo_coverage: number;
  geo_presence: number;
  aeo_readiness: number;
};

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
  metrics: ComparisonMetrics;
  deltas_vs_company: ComparisonMetrics;
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
    company: ComparisonMetrics;
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

export function generateDiscoveryKeywords(companyProfile: DiscoveryKeywordInput): string[] {
  const fields = extractDiscoveryFields(companyProfile);
  const category = normalizeQueryPart(fields.category, 5);
  const product = normalizeQueryPart(fields.product, 5);
  const problem = normalizeQueryPart(fields.problem, 5);
  const icp = normalizeQueryPart(fields.icp, 5);
  const domainTerms = extractDomainKeywords(fields.domain).join(' ');
  const base = category ?? product ?? problem ?? domainTerms ?? 'business software';
  const contextText = [
    fields.category,
    fields.product,
    fields.problem,
    fields.icp,
    domainTerms,
  ].filter(Boolean).join(' ').toLowerCase();

  const queries: string[] = [];
  pushUniqueQuery(queries, `${base} competitors`);
  pushUniqueQuery(queries, `${base} alternatives`);
  pushUniqueQuery(queries, `${base} software platforms`);
  if (product) {
    pushUniqueQuery(queries, `${product} competitors`);
    pushUniqueQuery(queries, `${product} alternatives`);
    pushUniqueQuery(queries, `${product} tools`);
  }
  if (problem) pushUniqueQuery(queries, `${problem} tools`);
  if (icp && category) pushUniqueQuery(queries, `${icp} ${category} platforms`);

  if (/\b(mental|wellness|wellbeing|therapy|therapeutic|reflection|self reflection|self-reflection|clarity|emotional|mood|journaling|meditation|mindfulness|stress|anxiety)\b/.test(contextText)) {
    [
      'AI mental wellness apps',
      'AI therapy chatbot competitors',
      'self reflection AI tools',
      'mental clarity apps',
      'digital therapy platforms',
      'guided journaling apps',
      'emotional wellbeing AI apps',
    ].forEach((query) => pushUniqueQuery(queries, query));
  }

  if (/\b(marketing|crm|sales|campaign|growth|seo|content|revenue|customer|automation|lead|pipeline|demand)\b/.test(contextText)) {
    [
      'marketing automation platforms',
      'B2B marketing operating system competitors',
      'campaign execution software',
      'marketing readiness tools',
      'growth workflow platforms',
      'CRM marketing automation alternatives',
      'customer growth software platforms',
    ].forEach((query) => pushUniqueQuery(queries, query));
  }

  [
    `${base} tools`,
    `${base} apps`,
    `${base} platforms`,
    `${base} market leaders`,
    `${base} category competitors`,
  ].forEach((query) => pushUniqueQuery(queries, query));

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


export async function fetchSerpDomainsForKeyword(keyword: string, geography: string | null): Promise<string[]> {
  const serpApiKey = config.SERPAPI_API_KEY || config.SERP_API_KEY || config.SERPAPI_KEY || '';
  if (!serpApiKey) return [];

  try {
    const query = geography ? `${keyword} ${geography}` : keyword;
    const response = await axios.get('https://serpapi.com/search.json', {
      params: {
        engine: 'google',
        q: query,
        num: 5,
        api_key: serpApiKey,
      },
      timeout: 8000,
    });
    const organic = Array.isArray(response.data?.organic_results) ? response.data.organic_results : [];
    const domains = organic
      .slice(0, 5)
      .map((item: { link?: string }) => normalizeDomain(item.link))
      .filter((domain): domain is string => Boolean(domain));
    return Array.from(new Set<string>(domains));
  } catch (error) {
    console.warn('[competitor-discovery][serp-keyword-failed]', {
      keyword,
      geography,
      error: error instanceof Error ? error.message : String(error),
    });
    return [];
  }
}


export async function discoverCompetitorDomainsFromSerp(params: {
  keywords: string[];
  ownDomain: string;
  geography: string | null;
}): Promise<{ domains: string[]; liveKeywordCount: number }> {
  const ranked = new Map<string, number>();
  let liveKeywordCount = 0;
  const serpApiKey = config.SERPAPI_API_KEY || config.SERP_API_KEY || config.SERPAPI_KEY || '';
  if (!serpApiKey) {
    console.warn('[competitor-discovery][serp-disabled]', {
      reason: 'missing_serp_api_key',
      keywords: params.keywords.slice(0, MAX_DISCOVERY_KEYWORDS),
    });
  }

  const runKeywordBatch = async (keywords: string[], retry: boolean): Promise<void> => {
    for (const keyword of keywords.slice(0, MAX_DISCOVERY_KEYWORDS)) {
      const domains = (await fetchSerpDomainsForKeyword(keyword, params.geography))
        .filter((domain) => !isBlockedSerpDomain(domain, params.ownDomain));
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
    const simplifiedKeywords = [...new Set(params.keywords.map(simplifyKeyword).filter((keyword) => keyword.length >= 3))];
    if (simplifiedKeywords.length > 0) {
      console.warn('[competitor-discovery][serp-retry-simplified]', {
        original_keywords: params.keywords.slice(0, MAX_DISCOVERY_KEYWORDS),
        retry_keywords: simplifiedKeywords.slice(0, MAX_DISCOVERY_KEYWORDS),
      });
      await runKeywordBatch(simplifiedKeywords, true);
    }
  }

  return {
    domains: [...ranked.entries()]
    .sort((left, right) => right[1] - left[1])
    .map(([domain]) => domain)
    .slice(0, MAX_COMPETITORS + 3),
    liveKeywordCount,
  };
}

export type DomainCrawlSignals = {
  contentScore: number;
  keywordCoverageScore: number;
  authorityProxy: number;
  technicalScore: number;
  aiAnswerPresenceScore: number;
  extractedKeywords: string[];
  answerTopics: string[];
};


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


export function computeCompanyMetrics(params: {
  decisions: PersistedDecisionObject[];
  resolvedInput?: ResolvedReportInput | null;
}): ComparisonMetrics {
  const { decisions, resolvedInput } = params;
  const contentCount = decisions.filter((decision) => ['content_strategy', 'market'].includes(classifyDecisionType(decision.issue_type))).length;
  const authorityCount = decisions.filter((decision) => ['authority', 'trust'].includes(classifyDecisionType(decision.issue_type))).length;
  const seoCount = decisions.filter((decision) => ['performance', 'distribution'].includes(classifyDecisionType(decision.issue_type))).length;
  const geoCount = countCategory(decisions, 'geo');
  const competitorCount = countCategory(decisions, 'market');
  const socialPresent = (resolvedInput?.resolved.socialLinks.length ?? 0) > 0;
  const geographyPresent = Boolean(resolvedInput?.resolved.geography);
  const businessTypePresent = Boolean(resolvedInput?.resolved.businessType);
  const domainPresent = Boolean(resolvedInput?.resolved.websiteDomain);

  const contentPenalty = Math.min(contentCount * 7, 24);
  const authorityPenalty = Math.min(authorityCount * 8, 26);
  const seoPenalty = Math.min(seoCount * 6, 24);
  const geoPenalty = Math.min(geoCount * 7, 18);
  const competitorPenalty = Math.min(competitorCount * 4, 16);

  return {
    content_depth: clamp(64 - contentPenalty + (businessTypePresent ? 6 : 0), 24, 88),
    authority_score: clamp(59 - authorityPenalty + (socialPresent ? 8 : 0), 22, 90),
    publishing_frequency: clamp(48 + (socialPresent ? 14 : -6) - Math.round(authorityPenalty / 5), 18, 86),
    engagement_score: clamp(53 - Math.round((contentPenalty + authorityPenalty) / 3) + (socialPresent ? 7 : 0), 20, 84),
    seo_coverage: clamp(61 - seoPenalty + (domainPresent ? 7 : 0), 22, 88),
    geo_presence: clamp(47 - geoPenalty + (geographyPresent ? 15 : 0), 18, 86),
    aeo_readiness: clamp(57 - Math.round((contentPenalty + seoPenalty + competitorPenalty) / 3) + (businessTypePresent ? 5 : 0), 20, 88),
  };
}


export function liftMetrics(
  base: ComparisonMetrics,
  competitor: DetectedCompetitor,
  index: number,
): ComparisonMetrics {
  const variation = [4, 1, 6, 3][index] ?? 2;
  const lift =
    competitor.classification === 'authority_leader'
      ? { content_depth: 12, authority_score: 20, publishing_frequency: 9, engagement_score: 10, seo_coverage: 12, geo_presence: 6, aeo_readiness: 12 }
      : competitor.classification === 'seo_competitor'
        ? { content_depth: 10, authority_score: 8, publishing_frequency: 6, engagement_score: 5, seo_coverage: 16, geo_presence: 4, aeo_readiness: 10 }
        : { content_depth: 8, authority_score: 6, publishing_frequency: 5, engagement_score: 4, seo_coverage: 7, geo_presence: 8, aeo_readiness: 6 };

  return {
    content_depth: clamp(base.content_depth + lift.content_depth + variation, 28, 95),
    authority_score: clamp(base.authority_score + lift.authority_score + variation, 28, 97),
    publishing_frequency: clamp(base.publishing_frequency + lift.publishing_frequency + Math.round(variation / 2), 24, 92),
    engagement_score: clamp(base.engagement_score + lift.engagement_score + Math.round(variation / 2), 24, 92),
    seo_coverage: clamp(base.seo_coverage + lift.seo_coverage + variation, 28, 97),
    geo_presence: clamp(base.geo_presence + lift.geo_presence + Math.round(variation / 2), 20, 92),
    aeo_readiness: clamp(base.aeo_readiness + lift.aeo_readiness + variation, 24, 95),
  };
}


export function subtractMetrics(left: ComparisonMetrics, right: ComparisonMetrics): ComparisonMetrics {
  return {
    content_depth: left.content_depth - right.content_depth,
    authority_score: left.authority_score - right.authority_score,
    publishing_frequency: left.publishing_frequency - right.publishing_frequency,
    engagement_score: left.engagement_score - right.engagement_score,
    seo_coverage: left.seo_coverage - right.seo_coverage,
    geo_presence: left.geo_presence - right.geo_presence,
    aeo_readiness: left.aeo_readiness - right.aeo_readiness,
  };
}


export function averageCompetitorMetrics(entries: CompetitorComparisonEntry[]): ComparisonMetrics {
  return {
    content_depth: average(entries.map((entry) => entry.metrics.content_depth)),
    authority_score: average(entries.map((entry) => entry.metrics.authority_score)),
    publishing_frequency: average(entries.map((entry) => entry.metrics.publishing_frequency)),
    engagement_score: average(entries.map((entry) => entry.metrics.engagement_score)),
    seo_coverage: average(entries.map((entry) => entry.metrics.seo_coverage)),
    geo_presence: average(entries.map((entry) => entry.metrics.geo_presence)),
    aeo_readiness: average(entries.map((entry) => entry.metrics.aeo_readiness)),
  };
}
