/** Competitor intelligence — types, classification, profile helpers — split from reportCompetitorIntelligenceService.ts (barrel preserved; importers unchanged). */
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
import type {
  CompetitorCapabilityVector,
  CompetitorDimensionScores,
  CompetitorDiscoverySource,
  CompetitorIntelligenceTier,
  CompetitorScoreCard,
  DebugCompetitorScoring,
} from '../../types/competitor';
import {
  assertCompetitorOutputPartition,
  dedupeCompetitorCandidates,
  getFinalCompetitors,
  getFinalCompetitorsSync,
  getLatestDebugCompetitorScoring,
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


export type CompetitorClassification = 'direct_competitor' | 'seo_competitor' | 'authority_leader';
type CompetitorSource = EngineCompetitorSource;

export type ComparisonMetrics = {
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
  score_card?: CompetitorScoreCard;
  overallScore?: number;
  scoreCategory?: CompetitorScoreCard['category'];
  intelligence_tier?: CompetitorIntelligenceTier;
  dimensions?: CompetitorDimensionScores;
  reasoning?: string[];
  discoverySources?: CompetitorDiscoverySource[];
  capabilityVector?: CompetitorCapabilityVector;
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
  debugCompetitorScoring?: DebugCompetitorScoring;
};

export function groupCompetitorsByTier(competitors: DetectedCompetitor[]): CompetitorIntelligenceResult['competitors_by_tier'] {
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

export function buildCompetitiveSummary(params: {
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

export const MAX_COMPETITORS = 3;
export const MAX_COMPETITOR_ENGINE_OUTPUT = MAX_COMPETITORS + MARKET_SUBSTITUTE_MAX_COUNT;
const MAX_DISCOVERY_KEYWORDS = 8;
const MAX_KEYWORD_SOURCE_PAGES = 50;
export const MAX_COMPETITOR_PAGES = 5;
export const MAX_CRAWL_DEPTH = 2;
export const MIN_SERP_DOMAINS_PER_KEYWORD = 3;
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

export function toDetectedCompetitor(competitor: RankedCompetitor): DetectedCompetitor {
  return {
    ...competitor,
    source: competitor.source,
    classification: competitor.classification,
    overallScore: competitor.score_card.overallScore,
    scoreCategory: competitor.score_card.category,
    intelligence_tier: competitor.score_card.tier,
    dimensions: competitor.score_card.dimensions,
    reasoning: competitor.score_card.reasoning ?? competitor.reasoning,
    discoverySources: competitor.discoverySources,
    capabilityVector: competitor.capabilityVector,
  };
}

export function devCompetitorScoringDebug(): { debugCompetitorScoring?: DebugCompetitorScoring } {
  const debugCompetitorScoring = getLatestDebugCompetitorScoring();
  return debugCompetitorScoring ? { debugCompetitorScoring } : {};
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
    discoverySources: competitor.discoverySources,
    capabilityVector: competitor.capabilityVector,
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
    ...devCompetitorScoringDebug(),
  };
}

export function buildManualCompetitorCandidates(params: {
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
        discoverySources: ['manual'],
      } satisfies CompetitorCandidate;
    });
}

export function buildStoredCompetitorCandidates(params: {
  resolvedInput?: ResolvedReportInput | null;
  businessType: string | null;
  geography: string | null;
  companyContext: CompanyCompetitiveContext;
}): CompetitorCandidate[] {
  const rawProfileCompetitors = params.resolvedInput?.profile?.competitors;
  const profileCompetitors = (Array.isArray(rawProfileCompetitors) ? rawProfileCompetitors : [])
    .filter((competitor) => competitor.state !== 'rejected' && competitor.state !== 'removed')
    .map((competitor) => ({
      name: competitor.name,
      domain: competitor.domain,
      rationale: competitor.rationale,
      intelligence: competitor.competitor_intelligence,
    }));
  const defaultCompetitors = (params.resolvedInput?.defaults.competitors ?? []).map((name) => ({
    name,
    domain: normalizeDomain(name),
    rationale: null,
    intelligence: null,
  }));

  return [...profileCompetitors, ...defaultCompetitors]
    .filter((item) => String(item.name ?? '').trim().length > 0)
    .map((item, index) => ({
      name: normalizeDomain(item.name) ? domainToName(normalizeDomain(item.name) ?? item.name) : titleCase(String(item.name)),
      domain: item.domain ?? normalizeDomain(item.name),
      category: params.companyContext.marketFocus ?? params.businessType ?? 'Stored market peer',
      classification: index === 0 ? 'direct_competitor' : index === 1 ? 'seo_competitor' : 'authority_leader',
      source: 'website' as const,
      rationale: item.rationale ?? buildFitRationale(
        params.companyContext,
        params.geography,
        'Stored competitor carried forward and revalidated by the competitor engine.',
      ),
      geography: params.geography,
      productSignals: params.companyContext.primaryService ? [params.companyContext.primaryService] : null,
      competitorIntelligence: item.intelligence ? {
        ecosystem_role: item.intelligence.ecosystem_role ?? null,
        reasoning: item.intelligence.reasoning ?? null,
      } : null,
      discoverySources: ['stored'],
    } satisfies CompetitorCandidate));
}

export function buildAiInferredCompetitorCandidates(params: {
  companyContext: CompanyCompetitiveContext;
  keywords: string[];
  geography: string | null;
}): CompetitorCandidate[] {
  const contextText = discoveryTextFromContext(params.companyContext, params.keywords);
  const candidates: CompetitorCandidate[] = [];
  if (/\b(crm|sales|lead|pipeline|marketing|campaign|growth|automation)\b/.test(contextText)) {
    candidates.push(
      {
        name: 'HubSpot',
        domain: 'hubspot.com',
        source: 'profile_ai',
        classification: 'direct_competitor',
        category: 'CRM, marketing automation, and growth operations',
        description: 'CRM and marketing automation platform evaluated by buyers solving campaign, lead, sales, and growth workflow problems.',
        productSignals: ['CRM', 'marketing automation', 'sales enablement', 'analytics', 'lead scoring', 'pipeline management'],
        useCase: 'Unifying customer, campaign, lead, and revenue workflows',
        geography: params.geography ?? 'Global',
        confidenceScore: 0.82,
        discoverySources: ['ai-inferred', 'ecosystem'],
      },
      {
        name: 'Zoho',
        domain: 'zoho.com',
        source: 'profile_ai',
        classification: 'seo_competitor',
        category: 'CRM and business workflow suite',
        description: 'Business software suite with CRM, automation, analytics, support, and marketing workflows.',
        productSignals: ['CRM', 'workflow automation', 'analytics', 'marketing automation', 'customer support'],
        useCase: 'Operating sales, marketing, support, and business workflows in one suite',
        geography: params.geography ?? 'Global',
        confidenceScore: 0.78,
        discoverySources: ['ai-inferred', 'ecosystem'],
      },
      {
        name: 'Salesforce',
        domain: 'salesforce.com',
        source: 'profile_ai',
        classification: 'authority_leader',
        category: 'Enterprise CRM and revenue operations',
        description: 'Enterprise CRM and revenue workflow platform evaluated for sales, service, marketing, automation, and analytics.',
        productSignals: ['CRM', 'sales enablement', 'marketing automation', 'analytics', 'enterprise workflows', 'AI assistant'],
        useCase: 'Managing customer lifecycle, sales pipeline, and enterprise go-to-market workflows',
        geography: params.geography ?? 'Global',
        confidenceScore: 0.8,
        discoverySources: ['ai-inferred', 'ecosystem'],
      },
    );
  }
  return candidates;
}

export function buildProviderCompetitorCandidates(params: {
  decisions: PersistedDecisionObject[];
  companyContext: CompanyCompetitiveContext;
  geography: string | null;
}): CompetitorCandidate[] {
  return params.decisions
    .flatMap((decision) => {
      const payload = decision.action_payload ?? {};
      const names = [
        payload.competitor_name,
        ...((Array.isArray(payload.leading_competitors) ? payload.leading_competitors : []) as unknown[]),
      ];
      return names.map((name) => String(name ?? '').trim()).filter(Boolean);
    })
    .map((name, index) => {
      const domain = normalizeDomain(name);
      return {
        name: domain ? domainToName(domain) : titleCase(name),
        domain,
        category: params.companyContext.marketFocus ?? 'Provider supplied competitor',
        classification: index === 0 ? 'direct_competitor' : index === 1 ? 'seo_competitor' : 'authority_leader',
        source: 'profile_ai' as const,
        rationale: buildFitRationale(
          params.companyContext,
          params.geography,
          'Provider/API signal named this company in competitor evidence and it was revalidated by buyer-decision-space scoring.',
        ),
        geography: params.geography,
        productSignals: params.companyContext.primaryService ? [params.companyContext.primaryService] : null,
        discoverySources: ['provider'],
      } satisfies CompetitorCandidate;
    });
}

export function buildUnifiedCandidatePool(params: {
  manual: CompetitorCandidate[];
  stored?: CompetitorCandidate[];
  provider?: CompetitorCandidate[];
  serp?: CompetitorCandidate[];
  aiInferred?: CompetitorCandidate[];
  ecosystem?: CompetitorCandidate[];
}): CompetitorCandidate[] {
  return dedupeCompetitorCandidates([
    ...params.manual,
    ...(params.stored ?? []),
    ...(params.provider ?? []),
    ...(params.serp ?? []),
    ...(params.aiInferred ?? []),
    ...(params.ecosystem ?? []),
  ]);
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

export function buildKnownDatasetCandidates(params: {
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
      discoverySources: ['ecosystem'],
      rationale: buildFitRationale(
        params.companyContext,
        params.geography,
        'Selected from the known category competitor dataset after SERP discovery returned too few usable domains.',
      ),
    }));
}

export function expandDiscoveryKeywords(
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

export async function extractTopKeywords(params: {
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

