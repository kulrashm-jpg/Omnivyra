import type { PersistedDecisionObject } from './decisionObjectService';
import type { ResolvedReportInput } from './reportInputResolver';
import { classifyDecisionType } from './decisionTypeRegistry';
import { impactScore } from './reportDecisionUtils';
import { supabase } from '../db/supabaseClient';
import axios from 'axios';
import { config } from '@/config';
import {
  listKnownCompetitorProfiles,
  type CompetitorEnrichmentProfile,
} from './competitorEnrichmentKnowledge';
import type { CompetitorSecondaryTag } from './competitorTaxonomy';
import {
  assertCompetitorOutputPartition,
  getFinalCompetitors,
  getFinalCompetitorsSync,
  splitRankedCompetitorsForOutput,
  MARKET_SUBSTITUTE_MAX_COUNT,
  type CompetitorCandidate,
  type CompetitorSource as EngineCompetitorSource,
  type RankedCompetitor,
  type CompetitorRevenueTier,
  type CompetitorTier,
  type CompetitorAuthoritySignals,
  type CompetitorPositioning,
} from './competitorEngineService';
import {
  clamp,
  average,
  tokenize,
  topTokensFromTexts,
  topPhrasesFromTexts,
  classifyIntent,
  normalizeDomain,
  normalizeQueryPart,
  titleCase,
  domainToName,
  extractDomainKeywords,
  extractBusinessKeywords,
  toShortLabel,
  extractCompanyCompetitiveContext,
  buildFitRationale,
  discoverCompetitorDomainsFromSerp,
  extractTitle,
  extractHeadings,
  extractAnchors,
  discoverInternalUrls,
  stripHtml,
  extractAnswerTopics,
  classifyCompetitors,
  dedupeCompetitors,
  countCategory,
  computeCompanyMetrics,
  liftMetrics,
  subtractMetrics,
  averageCompetitorMetrics,
  type CompanyCompetitiveContext,
  type DomainCrawlSignals,
  generateDiscoveryKeywords,
} from "./reportCompetitorIntelligenceServiceHelpers";

export { generateDiscoveryKeywords } from "./reportCompetitorIntelligenceServiceHelpers";

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
  market_alternatives?: DetectedCompetitor[];
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

function groupCompetitorsByTier(competitors: DetectedCompetitor[]): CompetitorIntelligenceResult['competitors_by_tier'] {
  return {
    tier_1: competitors.filter((competitor) => competitor.tier === 'Tier 1'),
    tier_2: competitors.filter((competitor) => competitor.tier === 'Tier 2'),
    tier_3: competitors.filter((competitor) => competitor.tier === 'Tier 3'),
  };
}

function threatWeight(threat: DetectedCompetitor['positioning']['threat_level'] | null | undefined): number {
  if (threat === 'high') return 3;
  if (threat === 'medium') return 2;
  return 1;
}

function summaryPhrase(value: string | null | undefined, fallback: string): string {
  const cleaned = String(value ?? '')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!cleaned) return fallback;
  return cleaned.length <= 110 ? cleaned : `${cleaned.slice(0, 107).trim()}...`;
}

function buildCompetitiveSummary(params: {
  competitors: DetectedCompetitor[];
  companyContext: CompanyCompetitiveContext;
  domain: string;
}): CompetitiveSummary {
  const companyName = domainToName(params.domain) || 'the company';
  const companyFocus = summaryPhrase(params.companyContext.primaryService ?? params.companyContext.marketFocus, 'core offer');
  const target = summaryPhrase(params.companyContext.targetCustomer ?? params.companyContext.idealCustomerProfile, 'target customers');
  const sortedThreats = [...params.competitors].sort((left, right) => {
    const threatDelta = threatWeight(right.positioning?.threat_level) - threatWeight(left.positioning?.threat_level);
    if (threatDelta !== 0) return threatDelta;
    const scoreDelta = Number(right.final_score ?? 0) - Number(left.final_score ?? 0);
    if (scoreDelta !== 0) return scoreDelta;
    return Number(right.authority_score ?? 0) - Number(left.authority_score ?? 0);
  });
  const topThreats = sortedThreats.slice(0, 2).map((competitor) => competitor.name);
  const highThreats = sortedThreats.filter((competitor) => competitor.positioning?.threat_level === 'high');
  const indirectCount = params.competitors.filter((competitor) => competitor.tier === 'Tier 3').length;
  const directCount = params.competitors.filter((competitor) => competitor.tier === 'Tier 1').length;
  const topThreatNames = topThreats.length ? topThreats.join(' and ') : 'direct market peers';
  const highThreatNames = highThreats.map((competitor) => competitor.name).join(' and ');
  const highThreatVerb = highThreats.length === 1 ? 'combines' : 'combine';

  return {
    top_threats: topThreats,
    key_advantage: indirectCount > directCount
      ? `${companyName} wins on focus: ${companyFocus} for ${target} is narrower than the broader substitute set.`
      : `${companyName} wins where buyers need focused ${companyFocus} instead of broader category suites.`,
    key_risk: highThreats.length > 0
      ? `${highThreatNames} ${highThreatVerb} Tier 1 relevance, high ICP overlap, and stronger authority.`
      : `${topThreatNames} still create pressure where authority, product depth, or search visibility is stronger.`,
    positioning_statement: `Position ${companyName} around ${companyFocus} for ${target}, using direct comparisons against ${topThreatNames} while separating from lower-tier substitutes on specificity.`,
  };
}

const MAX_COMPETITORS = 3;
const MAX_COMPETITOR_ENGINE_OUTPUT = MAX_COMPETITORS + MARKET_SUBSTITUTE_MAX_COUNT;
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

const EMPTY_COMPARISON_METRICS: ComparisonMetrics = {
  content_depth: 0,
  authority_score: 0,
  publishing_frequency: 0,
  engagement_score: 0,
  seo_coverage: 0,
  geo_presence: 0,
  aeo_readiness: 0,
};

function toDetectedCompetitor(competitor: RankedCompetitor): DetectedCompetitor {
  return {
    ...competitor,
    source: competitor.source,
    classification: competitor.classification,
  };
}

function detectedToCandidate(competitor: DetectedCompetitor): CompetitorCandidate {
  return {
    name: competitor.name,
    domain: competitor.domain,
    source: competitor.source,
    classification: competitor.classification,
    category: competitor.category,
    tags: competitor.tags,
    rationale: competitor.rationale,
    geography: competitor.fit_signals?.geography ?? null,
    businessModel: competitor.fit_signals?.business_model ?? null,
    revenueRange: competitor.fit_signals?.revenue_range ?? null,
    productSignals: competitor.fit_signals?.product_service ? [competitor.fit_signals.product_service] : null,
    enrichment: competitor.enrichment,
    confidenceScore: competitor.enrichment_confidence_score,
  };
}

function competitorIdentityKey(value: { name?: string | null; domain?: string | null }): string {
  return `${value.domain || value.name || ''}`.trim().toLowerCase();
}

export function enforceFinalCompetitorIntelligenceSync(params: {
  result: CompetitorIntelligenceResult;
  resolvedInput?: ResolvedReportInput | null;
}): CompetitorIntelligenceResult {
  const companyContext = extractCompanyCompetitiveContext(params.resolvedInput);
  const finalRanked = getFinalCompetitorsSync({
    candidates: (params.result.detected_competitors ?? []).map(detectedToCandidate),
    context: companyContext,
    max: MAX_COMPETITOR_ENGINE_OUTPUT,
    includeMarketSubstitutes: true,
  });
  const splitOutput = splitRankedCompetitorsForOutput(finalRanked, MAX_COMPETITORS, MARKET_SUBSTITUTE_MAX_COUNT);
  assertCompetitorOutputPartition(splitOutput, 'report_competitor_intelligence_enforce');
  const finalCompetitors = splitOutput.competitors.map(toDetectedCompetitor);
  const marketAlternatives = splitOutput.market_alternatives.map(toDetectedCompetitor);
  const finalByKey = new Map(finalCompetitors.map((competitor) => [competitorIdentityKey(competitor), competitor]));
  const comparisonEntries = (params.result.comparison?.competitors ?? [])
    .map((entry) => {
      const competitor = finalByKey.get(competitorIdentityKey(entry.competitor));
      return competitor
        ? {
            ...entry,
            competitor,
          }
        : null;
    })
    .filter((entry): entry is CompetitorComparisonEntry => Boolean(entry));
  const finalNames = new Set(finalCompetitors.flatMap((competitor) => [
    competitor.name.trim().toLowerCase(),
    competitor.domain?.trim().toLowerCase() ?? '',
  ]).filter(Boolean));
  const generatedGaps = (params.result.generated_gaps ?? [])
    .map((gap) => ({
      ...gap,
      leading_competitors: (gap.leading_competitors ?? [])
        .filter((competitor) => finalNames.has(String(competitor).trim().toLowerCase())),
    }))
    .filter((gap) => gap.leading_competitors.length > 0);
  const competitiveSummary = buildCompetitiveSummary({
    competitors: finalCompetitors,
    companyContext,
    domain: normalizeDomain(params.resolvedInput?.resolved.websiteDomain) ?? 'your-site.com',
  });

  return {
    ...params.result,
    summary: finalCompetitors.length > 0
      ? params.result.summary
      : `No competitor comparison could be built for ${normalizeDomain(params.resolvedInput?.resolved.websiteDomain) ?? 'your-site.com'}.`,
    detected_competitors: finalCompetitors,
    market_alternatives: marketAlternatives,
    competitors_by_tier: groupCompetitorsByTier(finalCompetitors),
    comparison: {
      company: params.result.comparison?.company ?? EMPTY_COMPARISON_METRICS,
      competitors: comparisonEntries,
    },
    generated_gaps: generatedGaps,
    competitive_summary: competitiveSummary,
  };
}

function buildManualCompetitorCandidates(params: {
  resolvedInput?: ResolvedReportInput | null;
  businessType: string | null;
  geography: string | null;
  companyContext: CompanyCompetitiveContext;
}): CompetitorCandidate[] {
  return (params.resolvedInput?.resolved.competitors ?? [])
    .map((item) => normalizeDomain(item) ?? item.trim())
    .filter(Boolean)
    .slice(0, MAX_COMPETITORS)
    .map((item, index) => {
      const domainValue = normalizeDomain(item);
      return {
        name: domainValue ? domainToName(domainValue) : titleCase(String(item)),
        domain: domainValue,
        category: params.companyContext.marketFocus ?? params.businessType ?? 'Market peer',
        classification:
          index === 0
            ? 'direct_competitor'
            : index === 1
              ? 'seo_competitor'
              : 'authority_leader',
        source: 'manual',
        rationale: buildFitRationale(
          params.companyContext,
          params.geography,
          'Provided through resolved report inputs and validated by the competitor engine.',
        ),
        geography: params.geography,
        productSignals: params.companyContext.primaryService ? [params.companyContext.primaryService] : null,
      } satisfies CompetitorCandidate;
    });
}

function discoveryTextFromContext(context: CompanyCompetitiveContext, keywords: string[] = []): string {
  return [
    context.marketFocus,
    context.primaryService,
    context.targetCustomer,
    context.idealCustomerProfile,
    context.brandPositioning,
    context.businessModel,
    context.geography,
    ...keywords,
  ].filter(Boolean).join(' ').toLowerCase();
}

function profileSearchText(profile: CompetitorEnrichmentProfile): string {
  return [
    profile.name,
    profile.domain,
    profile.category,
    profile.description,
    profile.business_model,
    profile.product_type,
    profile.icp.age_group,
    profile.icp.use_case,
    profile.icp.user_intent,
    profile.geography,
    Object.values(profile.scale_signals).filter(Boolean).join(' '),
  ].filter(Boolean).join(' ').toLowerCase();
}

function discoveryTokens(value: string): string[] {
  return value
    .split(/[^a-z0-9]+/)
    .map((token) => token.trim())
    .filter((token) => (token.length >= 3 || token === 'ai') && !STOPWORDS.has(token));
}

function scoreKnownProfileForContext(
  profile: CompetitorEnrichmentProfile,
  context: CompanyCompetitiveContext,
  keywords: string[],
): number {
  const contextText = discoveryTextFromContext(context, keywords);
  const profileText = profileSearchText(profile);
  const hasSpecificContext = discoveryTokens(contextText).length > 0;
  const wellnessContext = /\b(mental|wellness|wellbeing|therapy|therapeutic|reflection|self reflection|self-reflection|clarity|emotional|mood|journaling|meditation|mindfulness|stress|anxiety)\b/.test(contextText);
  const wellnessProfile = /\b(mental|wellness|wellbeing|therapy|therapeutic|reflection|journaling|meditation|mindfulness|emotional|mood|companion|cbt|anxiety|stress)\b/.test(profileText);
  const marketingContext = /\b(marketing|crm|sales|campaign|growth|seo|content|revenue|customer|automation|lead|pipeline|demand)\b/.test(contextText);
  const marketingProfile = /\b(marketing|crm|sales|campaign|growth|seo|content|customer|automation|lead|pipeline|revenue)\b/.test(profileText);
  const sustainabilityContext = /\b(sustainability|esg|climate|impact analytics|carbon)\b/.test(contextText);
  const sustainabilityProfile = /\b(sustainability|esg|climate|carbon|impact analytics)\b/.test(profileText);
  const outsourcingProfile = /\b(outsourcing|staffing|virtual employee|offshore)\b/.test(profileText);

  if (outsourcingProfile) return -100;
  if (sustainabilityProfile && !sustainabilityContext) return -80;
  if (wellnessContext && !wellnessProfile) return -40;
  if (marketingContext && !marketingProfile) return -40;

  let score = Math.round(profile.confidence_score * 20);
  if (wellnessContext && wellnessProfile) score += 45;
  if (marketingContext && marketingProfile) score += 45;
  if (sustainabilityContext && sustainabilityProfile) score += 45;
  if (!hasSpecificContext && marketingProfile) score += 20;

  const profileTokenSet = new Set(discoveryTokens(profileText));
  discoveryTokens(contextText).forEach((token) => {
    if (profileTokenSet.has(token)) score += 4;
  });

  return score;
}

function buildKnownDatasetCandidates(params: {
  companyContext: CompanyCompetitiveContext;
  keywords: string[];
  geography: string | null;
  max?: number;
}): CompetitorCandidate[] {
  return listKnownCompetitorProfiles()
    .map((profile) => ({
      profile,
      score: scoreKnownProfileForContext(profile, params.companyContext, params.keywords),
    }))
    .filter((item) => item.score > 0)
    .sort((left, right) => right.score - left.score || right.profile.confidence_score - left.profile.confidence_score)
    .slice(0, params.max ?? MAX_COMPETITORS + 3)
    .map(({ profile }, index) => ({
      name: profile.name,
      domain: profile.domain,
      category: profile.category,
      tags: profile.tags,
      classification: (
        index === 0
          ? 'direct_competitor'
          : index === 1
            ? 'seo_competitor'
            : 'authority_leader'
      ) as CompetitorClassification,
      source: 'known_category_dataset' as const,
      description: profile.description,
      targetCustomer: profile.icp.age_group,
      useCase: profile.icp.use_case ?? profile.icp.user_intent,
      geography: params.geography ?? profile.geography,
      businessModel: profile.business_model,
      productType: profile.product_type,
      scaleSignals: profile.scale_signals,
      confidenceScore: profile.confidence_score,
      productSignals: [profile.product_type, profile.category, ...profile.tags].filter(Boolean),
      rationale: buildFitRationale(
        params.companyContext,
        params.geography,
        'Selected from the known category competitor dataset after SERP discovery returned too few usable domains.',
      ),
    }));
}

function expandDiscoveryKeywords(
  keywords: string[],
  companyContext: CompanyCompetitiveContext,
  businessContext: string,
): string[] {
  const generated = generateDiscoveryKeywords(companyContext);
  const simplified = keywords
    .map((keyword) => keyword
      .toLowerCase()
      .replace(/\b(best|top|leading|competitors?|alternatives?|platforms?|software|tools?|apps?|services?)\b/g, ' ')
      .replace(/\s+/g, ' ')
      .trim())
    .filter((keyword) => keyword.length >= 3);
  return [
    ...keywords,
    ...generated,
    ...simplified,
    `${businessContext} competitors`,
    `${businessContext} alternatives`,
    `${businessContext} software`,
    `${businessContext} tools`,
    `${businessContext} platforms`,
  ].reduce<string[]>((merged, keyword) => {
    const normalized = normalizeQueryPart(keyword, 8);
    if (!normalized) return merged;
    if (!merged.some((item) => item.toLowerCase() === normalized.toLowerCase())) merged.push(normalized);
    return merged;
  }, []).slice(0, 10);
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

  const discoveryKeywords = generateDiscoveryKeywords(params.resolvedInput ?? companyContext);
  const manualCandidates = buildManualCompetitorCandidates({
    resolvedInput: params.resolvedInput,
    businessType,
    geography,
    companyContext,
  });
  const knownDatasetCandidates = buildKnownDatasetCandidates({
    companyContext,
    keywords: discoveryKeywords,
    geography,
  });
  const candidates = manualCandidates.length >= MIN_SERP_DOMAINS_PER_KEYWORD
    ? manualCandidates
    : [...manualCandidates, ...knownDatasetCandidates];
  let ranked = getFinalCompetitorsSync({
    candidates,
    context: companyContext,
    max: MAX_COMPETITOR_ENGINE_OUTPUT,
    includeMarketSubstitutes: true,
  });
  let splitOutput = splitRankedCompetitorsForOutput(ranked, MAX_COMPETITORS, MARKET_SUBSTITUTE_MAX_COUNT);
  assertCompetitorOutputPartition(splitOutput, 'report_competitor_intelligence_sync');
  if (splitOutput.competitors.length < MIN_SERP_DOMAINS_PER_KEYWORD && knownDatasetCandidates.length > 0) {
    const retryRanked = getFinalCompetitorsSync({
      candidates: [...candidates, ...knownDatasetCandidates],
      context: companyContext,
      max: MAX_COMPETITOR_ENGINE_OUTPUT,
      includeMarketSubstitutes: true,
    });
    const retrySplitOutput = splitRankedCompetitorsForOutput(retryRanked, MAX_COMPETITORS, MARKET_SUBSTITUTE_MAX_COUNT);
    assertCompetitorOutputPartition(retrySplitOutput, 'report_competitor_intelligence_sync_retry');
    if (retrySplitOutput.competitors.length > splitOutput.competitors.length) {
      ranked = retryRanked;
      splitOutput = retrySplitOutput;
    }
  }
  const discovered = classifyCompetitors(splitOutput.competitors.map(toDetectedCompetitor));
  const marketAlternatives = splitOutput.market_alternatives.map(toDetectedCompetitor);

  if (discovered.length === 0) {
    throw new Error(`competitor_discovery_empty_after_final_gate:${domain}`);
  }

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

  console.info('[competitor-discovery][summary]', {
    keywords_generated: discoveryKeywords,
    serp_domains_found: 0,
    final_candidates_count: comparisonEntries.length,
  });

  const summary = `Benchmarked ${domain} against ${comparisonEntries.length} ${toShortLabel(companyContext.primaryService ?? companyContext.marketFocus, 'market')} peers and found the strongest pressure in ${generatedGaps[0]?.gap_type?.replace(/_/g, ' ') ?? 'competitive positioning'}.`;
  const competitiveSummary = buildCompetitiveSummary({
    competitors: comparisonEntries.map((entry) => entry.competitor),
    companyContext,
    domain,
  });

  return {
    summary,
    detected_competitors: comparisonEntries.map((entry) => entry.competitor),
    market_alternatives: marketAlternatives,
    competitors_by_tier: groupCompetitorsByTier(comparisonEntries.map((entry) => entry.competitor)),
    comparison: {
      company: companyMetrics,
      competitors: comparisonEntries,
    },
    generated_gaps: generatedGaps,
    competitive_summary: competitiveSummary,
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
      keyword_count: discoveryKeywords.length,
      serp_domains_found: 0,
      serp_status: 'fallback',
      is_fallback_used: candidates.length > manualCandidates.length,
    },
  };
}

export async function buildCompetitorIntelligenceActive(params: {
  companyId: string;
  decisions: PersistedDecisionObject[];
  resolvedInput?: ResolvedReportInput | null;
}): Promise<CompetitorIntelligenceResult> {
  const domain = normalizeDomain(params.resolvedInput?.resolved.websiteDomain) ?? 'your-site.com';
  const businessType = params.resolvedInput?.resolved.businessType ?? null;
  const geography = params.resolvedInput?.resolved.geography ?? null;
  const companyContext = extractCompanyCompetitiveContext(params.resolvedInput);
  const businessContext = companyContext.marketFocus ? titleCase(companyContext.marketFocus) : businessType ? titleCase(businessType) : domainToName(domain);

  const generatedKeywords = generateDiscoveryKeywords(params.resolvedInput ?? companyContext);
  const extractedKeywords = await extractTopKeywords({
    companyId: params.companyId,
    domain,
    businessType,
  }).catch((error) => {
    console.warn('[competitor-discovery][keyword-extraction-failed]', {
      company_id: params.companyId,
      domain,
      error: error instanceof Error ? error.message : String(error),
    });
    return [] as string[];
  });
  const keywords = [...extractedKeywords, ...generatedKeywords].reduce<string[]>((merged, keyword) => {
    const normalized = normalizeQueryPart(keyword, 8);
    if (!normalized) return merged;
    if (!merged.some((item) => item.toLowerCase() === normalized.toLowerCase())) merged.push(normalized);
    return merged;
  }, []).slice(0, 10);
  const serpDiscovery = await discoverCompetitorDomainsFromSerp({
    keywords,
    ownDomain: domain,
    geography,
  });
  let serpDomains = serpDiscovery.domains;
  let liveKeywordCount = serpDiscovery.liveKeywordCount;
  if (serpDomains.length < MIN_SERP_DOMAINS_PER_KEYWORD) {
    const expandedKeywords = expandDiscoveryKeywords(keywords, companyContext, businessContext);
    const expandedDiscovery = await discoverCompetitorDomainsFromSerp({
      keywords: expandedKeywords,
      ownDomain: domain,
      geography,
    });
    serpDomains = [...serpDomains, ...expandedDiscovery.domains].reduce<string[]>((merged, candidateDomain) => {
      if (!merged.includes(candidateDomain)) merged.push(candidateDomain);
      return merged;
    }, []);
    liveKeywordCount += expandedDiscovery.liveKeywordCount;
  }
  const serpStatus: 'live' | 'fallback' =
    serpDomains.length >= MIN_SERP_DOMAINS_PER_KEYWORD || liveKeywordCount > 0 ? 'live' : 'fallback';

  const manualCandidates = buildManualCompetitorCandidates({
    resolvedInput: params.resolvedInput,
    businessType,
    geography,
    companyContext,
  });

  const serpCandidates: CompetitorCandidate[] = serpDomains.map((item, index) => ({
      name: domainToName(item),
      domain: item,
      category: companyContext.marketFocus ?? businessType ?? 'Search competitor',
      classification: (
        index === 0
          ? 'direct_competitor'
          : index === 1
            ? 'seo_competitor'
            : 'authority_leader'
      ) as CompetitorClassification,
      source: 'serp_live' as const,
      rationale: `Discovered from top SERP domains for high-priority keywords (${keywords.slice(0, 3).join(', ') || 'core demand terms'}).`,
      geography,
      productSignals: companyContext.primaryService ? [companyContext.primaryService] : null,
    }));
  const knownDatasetCandidates = buildKnownDatasetCandidates({
    companyContext,
    keywords,
    geography,
  });
  const needsKnownDataset = serpDomains.length === 0 || serpCandidates.length + manualCandidates.length < MIN_SERP_DOMAINS_PER_KEYWORD;
  const candidatePool = serpStatus === 'live'
    ? [
        ...serpCandidates,
        ...manualCandidates,
        ...(needsKnownDataset ? knownDatasetCandidates : []),
      ]
    : [
        ...manualCandidates,
        ...serpCandidates,
        ...(needsKnownDataset ? knownDatasetCandidates : []),
      ];
  let ranked = await getFinalCompetitors({
    candidates: candidatePool,
    context: companyContext,
    max: MAX_COMPETITOR_ENGINE_OUTPUT,
    useNetwork: true,
    companyId: params.companyId,
    includeMarketSubstitutes: true,
  });
  let splitOutput = splitRankedCompetitorsForOutput(ranked, MAX_COMPETITORS, MARKET_SUBSTITUTE_MAX_COUNT);
  assertCompetitorOutputPartition(splitOutput, 'report_competitor_intelligence_active');
  if (splitOutput.competitors.length < MIN_SERP_DOMAINS_PER_KEYWORD && knownDatasetCandidates.length > 0) {
    const retryRanked = await getFinalCompetitors({
      candidates: [...candidatePool, ...knownDatasetCandidates],
      context: companyContext,
      max: MAX_COMPETITOR_ENGINE_OUTPUT,
      useNetwork: false,
      useStoredCache: false,
      companyId: params.companyId,
      includeMarketSubstitutes: true,
    });
    const retrySplitOutput = splitRankedCompetitorsForOutput(retryRanked, MAX_COMPETITORS, MARKET_SUBSTITUTE_MAX_COUNT);
    assertCompetitorOutputPartition(retrySplitOutput, 'report_competitor_intelligence_active_retry');
    if (retrySplitOutput.competitors.length > splitOutput.competitors.length) {
      ranked = retryRanked;
      splitOutput = retrySplitOutput;
    }
  }
  const discovered = classifyCompetitors(splitOutput.competitors.map(toDetectedCompetitor));
  const marketAlternatives = splitOutput.market_alternatives.map(toDetectedCompetitor);

  if (discovered.length === 0) {
    console.error('[competitor-discovery][empty-after-final-gate]', {
      keywords_generated: keywords,
      serp_domains_found: serpDomains.length,
      final_candidates_count: 0,
      domain,
    });
    throw new Error(`competitor_discovery_empty_after_final_gate:${domain}`);
  }

  console.info('[competitor-discovery][summary]', {
    keywords_generated: keywords,
    serp_domains_found: serpDomains.length,
    final_candidates_count: discovered.length,
  });

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
  const competitiveSummary = buildCompetitiveSummary({
    competitors: comparisonEntries.map((entry) => entry.competitor),
    companyContext,
    domain,
  });

  return {
    summary,
    detected_competitors: comparisonEntries.map((entry) => entry.competitor),
    market_alternatives: marketAlternatives,
    competitors_by_tier: groupCompetitorsByTier(comparisonEntries.map((entry) => entry.competitor)),
    comparison: {
      company: companyMetrics,
      competitors: comparisonEntries,
    },
    generated_gaps: generatedGaps,
    competitive_summary: competitiveSummary,
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
      is_fallback_used: needsKnownDataset || ranked.some((competitor) => competitor.source === 'known_category_dataset' || competitor.source === 'market_substitute'),
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
