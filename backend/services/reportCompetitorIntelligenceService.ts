import type { PersistedDecisionObject } from './decisionObjectService';
import type { ResolvedReportInput } from './reportInputResolver';
import { classifyDecisionType } from './decisionTypeRegistry';
import { impactScore } from './reportDecisionUtils';
import { supabase } from '../db/supabaseClient';
import axios from 'axios';
import { config } from '@/config';

type CompetitorClassification = 'direct_competitor' | 'seo_competitor' | 'authority_leader';
type CompetitorSource =
  | 'manual'
  | 'decision_evidence'
  | 'inferred_keyword_peer'
  | 'serp_live'
  | 'serp_unavailable_fallback';

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
  classification: CompetitorClassification;
  source: CompetitorSource;
  relevance_score: number;
  rationale: string;
  fit_signals?: {
    market_focus?: string | null;
    product_service?: string | null;
    geography?: string | null;
    team_size?: string | null;
    founded_year?: string | null;
    revenue_range?: string | null;
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

export type CompetitorIntelligenceResult = {
  summary: string;
  detected_competitors: DetectedCompetitor[];
  comparison: {
    company: ComparisonMetrics;
    competitors: CompetitorComparisonEntry[];
  };
  generated_gaps: CompetitorGap[];
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

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function average(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function tokenize(value: string): string[] {
  return value
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 3 && !STOPWORDS.has(token));
}

function topTokensFromTexts(texts: string[], limit = MAX_DISCOVERY_KEYWORDS): string[] {
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

function topPhrasesFromTexts(texts: string[], limit = MAX_DISCOVERY_KEYWORDS): string[] {
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

function classifyIntent(value: string): 'informational' | 'commercial' | 'comparison' {
  const normalized = value.toLowerCase();
  if (/\b(vs|versus|compare|comparison|alternative|alternatives)\b/.test(normalized)) {
    return 'comparison';
  }
  if (/\b(best|top|pricing|price|cost|service|services|agency|platform|software|tool|tools|buy)\b/.test(normalized)) {
    return 'commercial';
  }
  return 'informational';
}

function normalizeDomain(value: string | null | undefined): string | null {
  const raw = String(value ?? '').trim().toLowerCase();
  if (!raw) return null;
  return raw.replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, '');
}

function titleCase(value: string): string {
  return value
    .split(/[\s-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function domainToName(domain: string): string {
  const root = domain.split('.')[0] ?? domain;
  return titleCase(root.replace(/[^a-z0-9]+/gi, ' '));
}

function extractDomainKeywords(domain: string | null | undefined): string[] {
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

function extractBusinessKeywords(value: string | null | undefined): string[] {
  const raw = String(value ?? '').toLowerCase();
  if (!raw) return [];
  return [...new Set(
    raw
      .split(/[^a-z]+/)
      .map((token) => token.trim())
      .filter((token) => token.length >= 4 && !['services', 'service', 'company', 'business', 'digital'].includes(token)),
  )];
}

type CompanyCompetitiveContext = {
  marketFocus: string | null;
  primaryService: string | null;
  targetCustomer: string | null;
  idealCustomerProfile: string | null;
  brandPositioning: string | null;
  teamSize: string | null;
  foundedYear: string | null;
  revenueRange: string | null;
};

function toShortLabel(value: string | null | undefined, fallback: string): string {
  const normalized = String(value ?? '').trim();
  if (!normalized) return fallback;
  return normalized.length > 42 ? `${normalized.slice(0, 39).trim()}...` : normalized;
}

function extractCompanyCompetitiveContext(resolvedInput?: ResolvedReportInput | null): CompanyCompetitiveContext {
  const context = resolvedInput?.resolved.companyContext;
  const profile = resolvedInput?.profile;
  const primaryService =
    context?.productServices?.[0] ??
    (Array.isArray(profile?.products_services_list) ? profile.products_services_list[0] : null) ??
    profile?.products_services ??
    null;

  return {
    marketFocus:
      context?.marketFocus ??
      resolvedInput?.resolved.businessType ??
      profile?.campaign_focus ??
      profile?.category ??
      profile?.industry ??
      null,
    primaryService,
    targetCustomer: context?.targetCustomer ?? profile?.target_customer_segment ?? profile?.target_audience ?? null,
    idealCustomerProfile: context?.idealCustomerProfile ?? profile?.ideal_customer_profile ?? null,
    brandPositioning: context?.brandPositioning ?? profile?.brand_positioning ?? profile?.unique_value ?? null,
    teamSize: context?.teamSize ?? null,
    foundedYear: context?.foundedYear ?? null,
    revenueRange: context?.revenueRange ?? null,
  };
}

function buildFitSignals(
  context: CompanyCompetitiveContext,
  geography: string | null,
  productService: string | null,
): DetectedCompetitor['fit_signals'] {
  return {
    market_focus: context.marketFocus,
    product_service: productService ?? context.primaryService,
    geography,
    team_size: context.teamSize,
    founded_year: context.foundedYear,
    revenue_range: context.revenueRange,
  };
}

function buildFitRationale(context: CompanyCompetitiveContext, geography: string | null, fallback: string): string {
  const parts: string[] = [];
  if (context.marketFocus) parts.push(`market focus: ${context.marketFocus}`);
  if (context.primaryService) parts.push(`product/service: ${context.primaryService}`);
  if (context.targetCustomer) parts.push(`buyer fit: ${context.targetCustomer}`);
  if (geography) parts.push(`region: ${geography}`);
  if (context.teamSize) parts.push(`team size: ${context.teamSize}`);
  if (context.foundedYear) parts.push(`founded: ${context.foundedYear}`);
  if (context.revenueRange) parts.push(`revenue: ${context.revenueRange}`);
  return parts.length > 0
    ? `${fallback} Fit signals used: ${parts.slice(0, 4).join('; ')}.`
    : fallback;
}

function extractDecisionCompetitors(decisions: PersistedDecisionObject[]): DetectedCompetitor[] {
  const seen = new Set<string>();
  const competitors: DetectedCompetitor[] = [];

  decisions.forEach((decision) => {
    const payload = (decision.action_payload ?? {}) as Record<string, unknown>;
    const evidence = (decision.evidence ?? {}) as Record<string, unknown>;
    const rawCandidate = [
      typeof payload.competitor_name === 'string' ? payload.competitor_name : null,
      typeof payload.competitor_domain === 'string' ? payload.competitor_domain : null,
      typeof evidence.competitor_name === 'string' ? evidence.competitor_name : null,
    ].find(Boolean);

    if (!rawCandidate) return;
    const normalizedDomain = normalizeDomain(rawCandidate);
    const key = normalizedDomain ?? String(rawCandidate).trim().toLowerCase();
    if (!key || seen.has(key)) return;
    seen.add(key);
    competitors.push({
      name: normalizedDomain ? domainToName(normalizedDomain) : titleCase(String(rawCandidate)),
      domain: normalizedDomain,
      classification: 'seo_competitor',
      source: 'decision_evidence',
      relevance_score: clamp((impactScore(decision) + Number(decision.confidence_score ?? 0) * 100) / 2, 40, 92),
      rationale: 'Surfaced from existing decision evidence already linked to competitor pressure.',
    });
  });

  return competitors;
}

function buildInferredCompetitors(params: {
  domain: string | null;
  businessType: string | null;
  geography: string | null;
  existing: DetectedCompetitor[];
  companyContext: CompanyCompetitiveContext;
}): DetectedCompetitor[] {
  const domainKeywords = extractDomainKeywords(params.domain);
  const businessKeywords = extractBusinessKeywords(params.businessType);
  const productKeywords = extractBusinessKeywords(params.companyContext.primaryService);
  const personaKeywords = extractBusinessKeywords(params.companyContext.targetCustomer ?? params.companyContext.idealCustomerProfile);
  const primaryKeyword = productKeywords[0] ?? businessKeywords[0] ?? domainKeywords[0] ?? 'market';
  const contextLabel = titleCase(params.companyContext.marketFocus ?? params.businessType ?? primaryKeyword);
  const productLabel = titleCase(params.companyContext.primaryService ?? primaryKeyword);
  const personaLabel = titleCase(personaKeywords[0] ?? params.companyContext.targetCustomer ?? 'buyer');
  const geography = params.geography ? ` in ${params.geography}` : '';
  const candidates: Array<Omit<DetectedCompetitor, 'relevance_score'>> = [
    {
      name: `${productLabel} ${personaLabel} competitor${geography}`,
      domain: null,
      classification: 'direct_competitor',
      source: 'inferred_keyword_peer',
      rationale: buildFitRationale(
        params.companyContext,
        params.geography,
        'Inferred as a direct peer from company market focus, product/service scope, and customer fit.',
      ),
      fit_signals: buildFitSignals(params.companyContext, params.geography, productLabel),
    },
    {
      name: `${productLabel} search rival${geography}`,
      domain: null,
      classification: 'seo_competitor',
      source: 'inferred_keyword_peer',
      rationale: buildFitRationale(
        params.companyContext,
        params.geography,
        'Inferred as a search competitor from demand themes tied to the company offer and market.',
      ),
      fit_signals: buildFitSignals(params.companyContext, params.geography, productLabel),
    },
    {
      name: `${contextLabel} authority leader`,
      domain: null,
      classification: 'authority_leader',
      source: 'inferred_keyword_peer',
      rationale: buildFitRationale(
        params.companyContext,
        params.geography,
        'Inferred as the authority benchmark for the same category and company-fit envelope.',
      ),
      fit_signals: buildFitSignals(params.companyContext, params.geography, productLabel),
    },
    {
      name: `${productLabel} comparison-focused peer`,
      domain: null,
      classification: 'direct_competitor',
      source: 'inferred_keyword_peer',
      rationale: buildFitRationale(
        params.companyContext,
        params.geography,
        'Inferred as a likely comparison-stage peer in the same buying journey.',
      ),
      fit_signals: buildFitSignals(params.companyContext, params.geography, productLabel),
    },
  ];

  const existingKeys = new Set(params.existing.map((item) => `${item.name}|${item.domain ?? ''}`.toLowerCase()));
  return candidates
    .filter((item) => !existingKeys.has(`${item.name}|${item.domain ?? ''}`.toLowerCase()))
    .slice(0, Math.max(0, MAX_COMPETITORS - params.existing.length))
    .map((item, index) => ({
      ...item,
      relevance_score: clamp(
        74 - index * 5 +
          (params.companyContext.primaryService ? 4 : 0) +
          (params.companyContext.targetCustomer ? 3 : 0) +
          (params.companyContext.teamSize ? 2 : 0) +
          (params.companyContext.revenueRange ? 2 : 0),
        52,
        92,
      ),
    }));
}

async function extractTopKeywords(params: {
  companyId: string;
  domain: string;
  businessType: string | null;
}): Promise<string[]> {
  const [keywordRowsRes, keywordMetricRowsRes, pageRowsRes, linkRowsRes, contentRowsRes] = await Promise.all([
    supabase
      .from('canonical_keywords')
      .select('id, keyword')
      .eq('company_id', params.companyId)
      .limit(200),
    supabase
      .from('keyword_metrics')
      .select('keyword_id, impressions')
      .eq('company_id', params.companyId)
      .order('impressions', { ascending: false })
      .limit(300),
    supabase
      .from('canonical_pages')
      .select('title, headings, crawl_depth')
      .eq('company_id', params.companyId)
      .order('last_crawled_at', { ascending: false })
      .limit(300),
    supabase
      .from('page_links')
      .select('anchor_text')
      .eq('company_id', params.companyId)
      .eq('is_internal', true)
      .limit(1200),
    supabase
      .from('page_content')
      .select('content_text')
      .eq('company_id', params.companyId)
      .limit(1200),
  ]);

  const metricByKeywordId = new Map<string, number>();
  for (const row of (keywordMetricRowsRes.data ?? []) as Array<{ keyword_id?: string | null; impressions?: number | null }>) {
    const id = String(row.keyword_id ?? '');
    if (!id) continue;
    metricByKeywordId.set(id, (metricByKeywordId.get(id) ?? 0) + Number(row.impressions ?? 0));
  }

  const canonicalKeywords = ((keywordRowsRes.data ?? []) as Array<{ id?: string | null; keyword?: string | null }>)
    .map((row) => ({
      keyword: String(row.keyword ?? '').trim(),
      score: metricByKeywordId.get(String(row.id ?? '')) ?? 0,
    }))
    .filter((row) => row.keyword.length > 0)
    .sort((left, right) => right.score - left.score)
    .map((row) => row.keyword);

  const scopedPageRows = ((pageRowsRes.data ?? []) as Array<{ title?: string | null; headings?: unknown; crawl_depth?: number | null }>)
    .filter((row) => row.crawl_depth == null || Number(row.crawl_depth) <= MAX_CRAWL_DEPTH)
    .slice(0, MAX_KEYWORD_SOURCE_PAGES);
  const pageTexts = scopedPageRows
    .flatMap((row) => {
      const headingTexts = Array.isArray(row.headings)
        ? (row.headings as Array<{ text?: string }>).map((item) => String(item?.text ?? ''))
        : [];
      return [String(row.title ?? ''), ...headingTexts];
    })
    .filter((text) => text.trim().length > 0);

  const anchorTexts = ((linkRowsRes.data ?? []) as Array<{ anchor_text?: string | null }>)
    .map((row) => String(row.anchor_text ?? '').trim())
    .filter((item) => item.length > 0);
  const repeatedPhrases = topPhrasesFromTexts(
    ((contentRowsRes.data ?? []) as Array<{ content_text?: string | null }>)
      .map((row) => String(row.content_text ?? '').slice(0, 600)),
    MAX_DISCOVERY_KEYWORDS,
  );

  const inferredFromPages = topTokensFromTexts(pageTexts, MAX_DISCOVERY_KEYWORDS);
  const inferredFromAnchors = topTokensFromTexts(anchorTexts, MAX_DISCOVERY_KEYWORDS);
  const inferredFromPhrases = repeatedPhrases;
  const inferredFromDomain = extractDomainKeywords(params.domain);
  const inferredFromBusiness = extractBusinessKeywords(params.businessType);

  const merged = [...new Set([
    ...canonicalKeywords,
    ...inferredFromPages,
    ...inferredFromAnchors,
    ...inferredFromPhrases,
    ...inferredFromBusiness,
    ...inferredFromDomain,
  ])]
    .map((value) => value.toLowerCase())
    .filter((value) => value.length >= 3);

  const scored = merged.map((keyword) => {
    const intent = classifyIntent(keyword);
    const sourceBoost =
      canonicalKeywords.includes(keyword) ? 5 :
      inferredFromAnchors.includes(keyword) ? 3 :
      inferredFromPhrases.includes(keyword) ? 2 :
      inferredFromPages.includes(keyword) ? 2 : 1;
    const intentBoost = intent === 'comparison' ? 3 : intent === 'commercial' ? 2 : 1;
    return { keyword, score: sourceBoost + intentBoost };
  });

  return scored
    .sort((left, right) => right.score - left.score)
    .map((item) => item.keyword)
    .slice(0, MAX_DISCOVERY_KEYWORDS);
}

async function fetchSerpDomainsForKeyword(keyword: string, geography: string | null): Promise<string[]> {
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
  } catch {
    return [];
  }
}

async function discoverCompetitorDomainsFromSerp(params: {
  keywords: string[];
  ownDomain: string;
  geography: string | null;
}): Promise<{ domains: string[]; liveKeywordCount: number }> {
  const ranked = new Map<string, number>();
  let liveKeywordCount = 0;
  for (const keyword of params.keywords.slice(0, MAX_DISCOVERY_KEYWORDS)) {
    const domains = (await fetchSerpDomainsForKeyword(keyword, params.geography))
      .filter((domain) => domain !== params.ownDomain);
    if (domains.length >= MIN_SERP_DOMAINS_PER_KEYWORD) {
      liveKeywordCount += 1;
    }
    domains.forEach((domain, index) => {
      const weight = 6 - Math.min(index + 1, 5);
      ranked.set(domain, (ranked.get(domain) ?? 0) + weight);
    });
  }

  return {
    domains: [...ranked.entries()]
    .sort((left, right) => right[1] - left[1])
    .map(([domain]) => domain)
    .slice(0, MAX_COMPETITORS + 3),
    liveKeywordCount,
  };
}

type DomainCrawlSignals = {
  contentScore: number;
  keywordCoverageScore: number;
  authorityProxy: number;
  technicalScore: number;
  aiAnswerPresenceScore: number;
  extractedKeywords: string[];
  answerTopics: string[];
};

function extractTitle(html: string): string {
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return match?.[1]?.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() ?? '';
}

function extractHeadings(html: string): string[] {
  const headings: string[] = [];
  const regex = /<(h1|h2|h3)[^>]*>([\s\S]*?)<\/\1>/gi;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(html)) != null) {
    const text = match[2].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    if (text) headings.push(text);
  }
  return headings;
}

function extractAnchors(html: string): string[] {
  const anchors: string[] = [];
  const regex = /<a[^>]*>([\s\S]*?)<\/a>/gi;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(html)) != null) {
    const text = match[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    if (text) anchors.push(text);
  }
  return anchors;
}

function discoverInternalUrls(params: { html: string; domain: string; maxDepth: number }): string[] {
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

function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractAnswerTopics(texts: string[]): string[] {
  return texts
    .filter((value) => /\b(how|what|why|when|faq|guide|compare|vs|best)\b/i.test(value))
    .flatMap((value) => topTokensFromTexts([value], 4))
    .slice(0, 10);
}

async function crawlDomainSignals(domain: string, referenceKeywords: string[]): Promise<DomainCrawlSignals | null> {
  const seedUrls = [
    `https://${domain}/`,
    `https://${domain}/pricing`,
    `https://${domain}/blog`,
    `https://${domain}/about`,
    `https://${domain}/features`,
  ];
  const urls = [...new Set(seedUrls)].slice(0, MAX_COMPETITOR_PAGES);

  const pages: Array<{ title: string; headings: string[]; text: string; html: string }> = [];
  const queue = [...urls];
  const visited = new Set<string>();
  while (queue.length > 0 && pages.length < MAX_COMPETITOR_PAGES) {
    const url = queue.shift()!;
    if (visited.has(url)) continue;
    visited.add(url);
    try {
      const response = await axios.get<string>(url, {
        timeout: 8000,
        maxRedirects: 3,
        responseType: 'text',
        headers: {
          'User-Agent': 'OmnivyraBot/1.0 (+https://omnivyra.com)',
          Accept: 'text/html,application/xhtml+xml',
        },
        validateStatus: (status) => status >= 200 && status < 400,
      });
      const html = String(response.data ?? '');
      const title = extractTitle(html);
      const headings = extractHeadings(html);
      const text = stripHtml(html).slice(0, 9000);
      pages.push({ title, headings, text, html });
      const discoveredUrls = discoverInternalUrls({ html, domain, maxDepth: MAX_CRAWL_DEPTH });
      discoveredUrls.forEach((nextUrl) => {
        if (!visited.has(nextUrl) && queue.length < MAX_COMPETITOR_PAGES * 4) {
          queue.push(nextUrl);
        }
      });
    } catch {
      // continue with remaining pages
    }
  }

  if (pages.length === 0) return null;

  const anchorTexts = pages.flatMap((page) => extractAnchors(page.html));
  const joinedText = pages.map((page) => `${page.title} ${page.headings.join(' ')} ${anchorTexts.join(' ')} ${page.text}`).join(' ');
  const extractedKeywords = topTokensFromTexts(
    pages.flatMap((page) => [page.title, ...page.headings, ...anchorTexts, page.text.slice(0, 700)]),
    16,
  );
  const answerTopics = extractAnswerTopics(pages.flatMap((page) => [page.title, ...page.headings]));

  const wordCount = joinedText.split(/\s+/).filter(Boolean).length;
  const keywordHits = referenceKeywords.filter((keyword) => joinedText.toLowerCase().includes(keyword.toLowerCase()));
  const keywordCoverage = referenceKeywords.length > 0
    ? (keywordHits.length / referenceKeywords.length) * 100
    : 0;
  const hasMetaDescription = /<meta[^>]+name=["']description["'][^>]+content=["'][^"']+["']/i.test(pages[0].html);
  const hasSchema = /application\/ld\+json/i.test(joinedText) || /schema\.org/i.test(joinedText);
  const hasFaqPattern = /\bfaq|frequently asked|q&a|questions?\b/i.test(joinedText);
  const hasParagraphSummaries = /\bin summary|quick answer|tl;dr|key takeaway|summary\b/i.test(joinedText);
  const structuredAnswerSignals = /\b(what is|how to|why|steps|checklist)\b/i.test(joinedText);
  const linkMentions = (joinedText.match(/\b(case study|customer|trusted|review|award|featured|partners?)\b/gi) ?? []).length;
  const faqMentions = (joinedText.match(/\b(faq|how to|what is|why|guide)\b/gi) ?? []).length;

  return {
    contentScore: clamp(Math.round((wordCount / 2600) * 100), 20, 96),
    keywordCoverageScore: clamp(Math.round(keywordCoverage), 15, 98),
    authorityProxy: clamp(35 + linkMentions * 2 + (hasSchema ? 8 : 0), 20, 95),
    technicalScore: clamp(40 + (hasMetaDescription ? 12 : 0) + (hasSchema ? 10 : 0) + pages.length * 6, 24, 96),
    aiAnswerPresenceScore: clamp(
      28 +
      faqMentions * 3 +
      (hasSchema ? 10 : 0) +
      (hasFaqPattern ? 8 : 0) +
      (hasParagraphSummaries ? 6 : 0) +
      (structuredAnswerSignals ? 6 : 0),
      18,
      96,
    ),
    extractedKeywords,
    answerTopics,
  };
}

function classifyCompetitors(competitors: DetectedCompetitor[]): DetectedCompetitor[] {
  return competitors.slice(0, MAX_COMPETITORS).map((competitor, index) => {
    if (competitor.classification) return competitor;
    if (index === 0) return { ...competitor, classification: 'direct_competitor' };
    if (index === 1) return { ...competitor, classification: 'seo_competitor' };
    return { ...competitor, classification: 'authority_leader' };
  });
}

function dedupeCompetitors(competitors: DetectedCompetitor[]): DetectedCompetitor[] {
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

function countCategory(decisions: PersistedDecisionObject[], category: string): number {
  return decisions.filter((decision) => classifyDecisionType(decision.issue_type) === category).length;
}

function computeCompanyMetrics(params: {
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

function liftMetrics(
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

function subtractMetrics(left: ComparisonMetrics, right: ComparisonMetrics): ComparisonMetrics {
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

function averageCompetitorMetrics(entries: CompetitorComparisonEntry[]): ComparisonMetrics {
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

function buildGapDefinitions(params: {
  domain: string;
  businessContext: string;
  entries: CompetitorComparisonEntry[];
  companyMetrics: ComparisonMetrics;
}): CompetitorGap[] {
  const averageMetrics = averageCompetitorMetrics(params.entries);
  const leadingCompetitors = params.entries.slice(0, 3).map((entry) => entry.competitor.domain ?? entry.competitor.name);
  const gaps: CompetitorGap[] = [];

  const contentGap = averageMetrics.content_depth - params.companyMetrics.content_depth;
  if (contentGap >= 8) {
    gaps.push({
      gap_type: 'content_gap',
      issue_type: 'competitor_content_gap',
      title: `Competitors cover more buying-stage content than ${params.domain}`,
      insight: `Compared with ${leadingCompetitors.join(', ')}, ${params.domain} appears under-covered on comparison, decision, and proof-led content.` ,
      why_it_matters: 'When competitors answer more of the evaluation journey, they become the default shortlist before your brand is even considered.',
      recommendation: 'Build comparison pages, proof-rich service pages, and objection-handling content around the topics competitors already cover more deeply.',
      action_type: 'improve_content',
      expected_outcome: 'The site should compete more often in high-intent search and comparison moments.',
      effort_level: contentGap >= 15 ? 'high' : 'medium',
      impact_score: clamp(62 + contentGap, 0, 95),
      confidence_score: clamp(0.66 + contentGap / 50, 0, 0.92),
      leading_competitors: leadingCompetitors,
    });
  }

  const authorityGap = averageMetrics.authority_score - params.companyMetrics.authority_score;
  if (authorityGap >= 10) {
    gaps.push({
      gap_type: 'authority_gap',
      issue_type: 'competitor_backlink_advantage',
      title: `${params.businessContext} competitors are signalling more authority than ${params.domain}`,
      insight: `Authority leaders in this market are materially ahead on trust and credibility signals versus ${params.domain}.`,
      why_it_matters: 'Authority gaps make every downstream acquisition channel harder because buyers trust better-known alternatives faster.',
      recommendation: 'Strengthen proof assets, expert positioning, backlinks, and credibility blocks on the pages that should win buyer confidence first.',
      action_type: 'adjust_strategy',
      expected_outcome: 'The business should feel more credible earlier in the buyer journey, lifting trust and conversion readiness.',
      effort_level: authorityGap >= 18 ? 'high' : 'medium',
      impact_score: clamp(60 + authorityGap, 0, 96),
      confidence_score: clamp(0.68 + authorityGap / 55, 0, 0.94),
      leading_competitors: leadingCompetitors,
    });
  }

  const visibilityGap = averageMetrics.seo_coverage - params.companyMetrics.seo_coverage;
  if (visibilityGap >= 10) {
    gaps.push({
      gap_type: 'visibility_gap',
      issue_type: 'competitor_gap',
      title: `${params.domain} is trailing the market on discoverability`,
      insight: `SEO-focused competitors are showing broader search coverage and stronger visibility patterns than ${params.domain}.`,
      why_it_matters: 'If competitors own more search territory, your brand loses qualified discovery before buyers ever reach your site.',
      recommendation: 'Prioritize the search themes and landing-page angles where competitors appear easier to find, then tighten metadata and topical depth around them.',
      action_type: 'improve_content',
      expected_outcome: 'Search visibility should become more competitive in the demand areas the market is already rewarding.',
      effort_level: visibilityGap >= 16 ? 'high' : 'medium',
      impact_score: clamp(58 + visibilityGap, 0, 94),
      confidence_score: clamp(0.64 + visibilityGap / 60, 0, 0.9),
      leading_competitors: leadingCompetitors,
    });
  }

  const trustGap = average([averageMetrics.authority_score, averageMetrics.engagement_score]) - average([params.companyMetrics.authority_score, params.companyMetrics.engagement_score]);
  if (trustGap >= 9) {
    gaps.push({
      gap_type: 'trust_gap',
      issue_type: 'trust_gap',
      title: `${params.domain} is not building confidence as strongly as the market leaders`,
      insight: `Competitors are pairing stronger authority with stronger engagement, which usually indicates a more trusted narrative and better proof architecture.`,
      why_it_matters: 'Trust gaps reduce conversion even when traffic arrives, because buyers find reassurance faster on competing options.',
      recommendation: 'Audit the first-impression narrative, trust markers, testimonials, proof language, and case studies that a new buyer sees in the first 30 seconds.',
      action_type: 'adjust_strategy',
      expected_outcome: 'Visitors should feel more certainty about relevance and credibility before they leave or compare further.',
      effort_level: trustGap >= 14 ? 'high' : 'medium',
      impact_score: clamp(57 + trustGap, 0, 92),
      confidence_score: clamp(0.62 + trustGap / 55, 0, 0.89),
      leading_competitors: leadingCompetitors,
    });
  }

  const aeoGap = averageMetrics.aeo_readiness - params.companyMetrics.aeo_readiness;
  if (aeoGap >= 8) {
    gaps.push({
      gap_type: 'aeo_gap',
      issue_type: 'content_gap',
      title: `${params.domain} is less answer-engine ready than competing peers`,
      insight: `Competitors look better prepared for answer-style search and AI summaries because their content appears easier to extract, quote, and trust.`,
      why_it_matters: 'As answer engines shape more discovery, weaker AEO readiness means losing visibility even when traditional rankings are stable.',
      recommendation: 'Add direct answers, FAQs, summary blocks, comparison structures, and proof statements to core pages so they are easier for search and AI systems to reuse.',
      action_type: 'improve_content',
      expected_outcome: 'Core pages should become more reusable in answer-engine contexts and stronger in zero-click discovery moments.',
      effort_level: aeoGap >= 14 ? 'high' : 'medium',
      impact_score: clamp(55 + aeoGap, 0, 90),
      confidence_score: clamp(0.6 + aeoGap / 60, 0, 0.87),
      leading_competitors: leadingCompetitors,
    });
  }

  return gaps.sort((a, b) => b.impact_score * b.confidence_score - a.impact_score * a.confidence_score).slice(0, 4);
}

export function buildCompetitorIntelligence(params: {
  decisions: PersistedDecisionObject[];
  resolvedInput?: ResolvedReportInput | null;
}): CompetitorIntelligenceResult {
  const domain = normalizeDomain(params.resolvedInput?.resolved.websiteDomain) ?? 'your-site.com';
  const businessType = params.resolvedInput?.resolved.businessType ?? null;
  const geography = params.resolvedInput?.resolved.geography ?? null;
  const companyContext = extractCompanyCompetitiveContext(params.resolvedInput);
  const businessContext = companyContext.marketFocus ? titleCase(companyContext.marketFocus) : businessType ? titleCase(businessType) : domainToName(domain);

  const manualCompetitors = (params.resolvedInput?.resolved.competitors ?? [])
    .map((item) => normalizeDomain(item) ?? item.trim())
    .filter(Boolean)
    .slice(0, MAX_COMPETITORS)
    .map((item, index) => {
      const domainValue = normalizeDomain(item);
      return {
        name: domainValue ? domainToName(domainValue) : titleCase(String(item)),
        domain: domainValue,
        classification:
          index === 0
            ? 'direct_competitor'
            : index === 1
              ? 'seo_competitor'
              : 'authority_leader',
        source: 'manual' as const,
        relevance_score: clamp(88 - index * 6, 60, 92),
        rationale: buildFitRationale(
          companyContext,
          geography,
          'Provided directly through resolved report inputs or stored company defaults.',
        ),
        fit_signals: buildFitSignals(companyContext, geography, companyContext.primaryService),
      } satisfies DetectedCompetitor;
    });

  const evidenceCompetitors = extractDecisionCompetitors(params.decisions);
  const initialCompetitors = dedupeCompetitors([...manualCompetitors, ...evidenceCompetitors]);
  const discovered = classifyCompetitors(
    dedupeCompetitors([
      ...initialCompetitors,
      ...buildInferredCompetitors({
        domain,
        businessType,
        geography,
        existing: initialCompetitors,
        companyContext,
      }),
    ]).slice(0, MAX_COMPETITORS),
  );

  const companyMetrics = computeCompanyMetrics(params);
  const comparisonEntries = discovered.map((competitor, index) => {
    const metrics = liftMetrics(companyMetrics, competitor, index);
    return {
      competitor,
      metrics,
      deltas_vs_company: subtractMetrics(metrics, companyMetrics),
    } satisfies CompetitorComparisonEntry;
  });

  const generatedGaps = buildGapDefinitions({
    domain,
    businessContext,
    entries: comparisonEntries,
    companyMetrics,
  });

  const summary = comparisonEntries.length > 0
    ? `Benchmarked ${domain} against ${comparisonEntries.length} ${toShortLabel(companyContext.primaryService ?? companyContext.marketFocus, 'market')} peers and found the strongest pressure in ${generatedGaps[0]?.gap_type?.replace(/_/g, ' ') ?? 'competitive positioning'}.`
    : `No competitor comparison could be built for ${domain}.`;

  return {
    summary,
    detected_competitors: comparisonEntries.map((entry) => entry.competitor),
    comparison: {
      company: companyMetrics,
      competitors: comparisonEntries,
    },
    generated_gaps: generatedGaps,
    keyword_gap: {
      missing_keywords: [],
      weak_keywords: [],
      strong_keywords: [],
    },
    answer_gap: {
      missing_answers: [],
      weak_answers: [],
      strong_answers: [],
    },
    discovery_metadata: {
      keyword_count: 0,
      serp_domains_found: 0,
      serp_status: 'fallback',
      is_fallback_used: true,
    },
  };
}

export async function buildCompetitorIntelligenceActive(params: {
  companyId: string;
  decisions: PersistedDecisionObject[];
  resolvedInput?: ResolvedReportInput | null;
}): Promise<CompetitorIntelligenceResult> {
  const baseline = buildCompetitorIntelligence({
    decisions: params.decisions,
    resolvedInput: params.resolvedInput,
  });

  const domain = normalizeDomain(params.resolvedInput?.resolved.websiteDomain) ?? 'your-site.com';
  const businessType = params.resolvedInput?.resolved.businessType ?? null;
  const geography = params.resolvedInput?.resolved.geography ?? null;
  const companyContext = extractCompanyCompetitiveContext(params.resolvedInput);
  const businessContext = companyContext.marketFocus ? titleCase(companyContext.marketFocus) : businessType ? titleCase(businessType) : domainToName(domain);

  const keywords = await extractTopKeywords({
    companyId: params.companyId,
    domain,
    businessType,
  });
  const serpDiscovery = await discoverCompetitorDomainsFromSerp({
    keywords,
    ownDomain: domain,
    geography,
  });
  const serpDomains = serpDiscovery.domains;
  const serpStatus: 'live' | 'fallback' =
    serpDomains.length >= MIN_SERP_DOMAINS_PER_KEYWORD || serpDiscovery.liveKeywordCount > 0 ? 'live' : 'fallback';

  const manualAndEvidence = dedupeCompetitors(
    baseline.detected_competitors.filter((item) => item.source === 'manual' || item.source === 'decision_evidence'),
  );

  const serpCompetitors: DetectedCompetitor[] = serpDomains.map((item, index) => ({
    name: domainToName(item),
    domain: item,
    classification:
      index === 0
        ? 'direct_competitor'
        : index === 1
          ? 'seo_competitor'
          : 'authority_leader',
    source: 'serp_live',
    relevance_score: clamp(90 - index * 6, 58, 94),
    rationale: `Discovered from top SERP domains for high-priority keywords (${keywords.slice(0, 3).join(', ') || 'core demand terms'}).`,
    fit_signals: buildFitSignals(companyContext, geography, companyContext.primaryService),
  }));

  let discovered = classifyCompetitors(
    dedupeCompetitors(
      serpStatus === 'live'
        ? [...serpCompetitors, ...manualAndEvidence]
        : [...manualAndEvidence, ...serpCompetitors],
    ).slice(0, MAX_COMPETITORS),
  );

  if (discovered.length < MAX_COMPETITORS) {
    const inferred = buildInferredCompetitors({
      domain,
      businessType,
      geography,
      existing: discovered,
      companyContext,
    }).map((item) => ({
      ...item,
      source: serpStatus === 'fallback' ? 'serp_unavailable_fallback' : item.source,
      rationale:
        serpStatus === 'fallback'
          ? buildFitRationale(companyContext, geography, 'Live SERP discovery unavailable; fallback competitor inferred from company-fit context.')
          : item.rationale,
    }));
    discovered = classifyCompetitors(dedupeCompetitors([...discovered, ...inferred]).slice(0, MAX_COMPETITORS));
  }

  const companyMetrics = computeCompanyMetrics({
    decisions: params.decisions,
    resolvedInput: params.resolvedInput,
  });

  const companyKeywordSet = new Set(keywords.map((item) => item.toLowerCase()));
  const companyAnswerSet = new Set<string>();
  const userPagesRes = await supabase
    .from('canonical_pages')
    .select('title, headings')
    .eq('company_id', params.companyId)
    .limit(120);
  ((userPagesRes.data ?? []) as Array<{ title?: string | null; headings?: unknown }>).forEach((row) => {
    const texts = [
      String(row.title ?? ''),
      ...(Array.isArray(row.headings)
        ? (row.headings as Array<{ text?: string }>).map((heading) => String(heading?.text ?? ''))
        : []),
    ];
    extractAnswerTopics(texts).forEach((topic) => companyAnswerSet.add(topic.toLowerCase()));
  });

  const competitorKeywordSet = new Set<string>();
  const competitorAnswerSet = new Set<string>();
  const comparisonEntries: CompetitorComparisonEntry[] = [];

  for (let index = 0; index < discovered.length; index += 1) {
    const competitor = discovered[index];
    const signals = competitor.domain
      ? await crawlDomainSignals(competitor.domain, keywords)
      : null;

    const metrics = signals
      ? {
          content_depth: clamp(Math.round((companyMetrics.content_depth + signals.contentScore) / 2 + 6), 24, 98),
          authority_score: clamp(Math.round((companyMetrics.authority_score + signals.authorityProxy) / 2 + 8), 24, 98),
          publishing_frequency: clamp(Math.round((companyMetrics.publishing_frequency + signals.contentScore * 0.6) / 1.6), 22, 95),
          engagement_score: clamp(Math.round((companyMetrics.engagement_score + signals.authorityProxy * 0.65) / 1.65), 20, 94),
          seo_coverage: clamp(Math.round((companyMetrics.seo_coverage + signals.keywordCoverageScore) / 2 + 9), 24, 99),
          geo_presence: clamp(Math.round((companyMetrics.geo_presence + signals.technicalScore * 0.55) / 1.55), 20, 92),
          aeo_readiness: clamp(Math.round((companyMetrics.aeo_readiness + signals.aiAnswerPresenceScore) / 2 + 7), 20, 99),
        }
      : liftMetrics(companyMetrics, competitor, index);

    (signals?.extractedKeywords ?? []).forEach((keyword) => competitorKeywordSet.add(keyword.toLowerCase()));
    (signals?.answerTopics ?? []).forEach((topic) => competitorAnswerSet.add(topic.toLowerCase()));

    comparisonEntries.push({
      competitor,
      metrics,
      deltas_vs_company: subtractMetrics(metrics, companyMetrics),
    });
  }

  if (comparisonEntries.length === 0) {
    return baseline;
  }

  const generatedGaps = buildGapDefinitions({
    domain,
    businessContext,
    entries: comparisonEntries,
    companyMetrics,
  });

  const missingKeywords = [...competitorKeywordSet].filter((keyword) => !companyKeywordSet.has(keyword)).slice(0, 12);
  const weakKeywords = [...companyKeywordSet]
    .filter((keyword) => competitorKeywordSet.has(keyword))
    .slice(0, 12);
  const strongKeywords = [...companyKeywordSet]
    .filter((keyword) => !competitorKeywordSet.has(keyword))
    .slice(0, 12);

  const missingAnswers = [...competitorAnswerSet].filter((item) => !companyAnswerSet.has(item)).slice(0, 12);
  const weakAnswers = [...companyAnswerSet].filter((item) => competitorAnswerSet.has(item)).slice(0, 12);
  const strongAnswers = [...companyAnswerSet].filter((item) => !competitorAnswerSet.has(item)).slice(0, 12);

  const summary = `Benchmarked ${domain} against ${comparisonEntries.length} actively discovered ${toShortLabel(companyContext.primaryService ?? companyContext.marketFocus, 'market')} competitors. Strongest pressure is in ${generatedGaps[0]?.gap_type?.replace(/_/g, ' ') ?? 'competitive positioning'}.`;

  return {
    summary,
    detected_competitors: comparisonEntries.map((entry) => entry.competitor),
    comparison: {
      company: companyMetrics,
      competitors: comparisonEntries,
    },
    generated_gaps: generatedGaps,
    keyword_gap: {
      missing_keywords: missingKeywords,
      weak_keywords: weakKeywords,
      strong_keywords: strongKeywords,
    },
    answer_gap: {
      missing_answers: missingAnswers,
      weak_answers: weakAnswers,
      strong_answers: strongAnswers,
    },
    discovery_metadata: {
      keyword_count: keywords.length,
      serp_domains_found: serpDomains.length,
      serp_status: serpStatus,
      is_fallback_used: serpStatus !== 'live',
    },
  };
}

export function competitorGapsToDecisions(params: {
  companyId: string;
  gaps: CompetitorGap[];
  reportTier?: PersistedDecisionObject['report_tier'];
}): PersistedDecisionObject[] {
  const now = new Date().toISOString();

  return params.gaps.map((gap, index) => ({
    id: `competitor_gap_${index}_${gap.gap_type}`,
    company_id: params.companyId,
    report_tier: params.reportTier ?? 'snapshot',
    source_service: 'reportCompetitorIntelligenceService',
    entity_type: 'global',
    entity_id: null,
    issue_type: gap.issue_type,
    title: gap.title,
    description: gap.insight,
    evidence: {
      gap_type: gap.gap_type,
      leading_competitors: gap.leading_competitors,
    },
    impact_traffic: clamp(Math.round(gap.impact_score * 0.9), 0, 100),
    impact_conversion: clamp(Math.round(gap.impact_score * 0.82), 0, 100),
    impact_revenue: clamp(Math.round(gap.impact_score * 0.78), 0, 100),
    priority_score: clamp(Math.round(gap.impact_score * 0.7 + gap.confidence_score * 30), 0, 100),
    effort_score: gap.effort_level === 'low' ? 20 : gap.effort_level === 'medium' ? 42 : 68,
    execution_score: clamp(Math.round(gap.impact_score * 0.62 + gap.confidence_score * 38), 0, 100),
    confidence_score: gap.confidence_score,
    recommendation: gap.recommendation,
    action_type: gap.action_type,
    action_payload: {
      gap_type: gap.gap_type,
      leading_competitors: gap.leading_competitors,
      expected_outcome: gap.expected_outcome,
      effort_level: gap.effort_level,
      optimization_focus: 'competitor_intelligence',
    },
    status: 'open',
    last_changed_by: 'system',
    created_at: now,
    updated_at: now,
    resolved_at: null,
    ignored_at: null,
  }));
}

export type { ComparisonMetrics };
