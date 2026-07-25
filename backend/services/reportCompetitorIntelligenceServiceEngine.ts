/** Competitor intelligence — analysis engine + report entrypoints — split from reportCompetitorIntelligenceService.ts (barrel preserved; importers unchanged). */
import type { PersistedDecisionObject } from './decisionObjectService';
import type { ResolvedReportInput } from './reportInputResolver';
import { classifyDecisionType } from './decisionTypeRegistry';
import { impactScore } from './reportDecisionUtils';
import { supabase } from '../db/supabaseClient';
import axios from 'axios';
import { config } from '@/config';
import type { CompetitorEnrichmentProfile } from './competitorEnrichmentKnowledge';
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

import { type CompetitorClassification, type ComparisonMetrics, type CompetitorComparisonEntry, type CompetitorGap, type CompetitorIntelligenceResult, groupCompetitorsByTier, buildCompetitiveSummary, MAX_COMPETITORS, MAX_COMPETITOR_ENGINE_OUTPUT, MAX_COMPETITOR_PAGES, MAX_CRAWL_DEPTH, MIN_SERP_DOMAINS_PER_KEYWORD, toDetectedCompetitor, devCompetitorScoringDebug, buildManualCompetitorCandidates, buildStoredCompetitorCandidates, buildProviderCompetitorCandidates, expandDiscoveryKeywords, extractTopKeywords } from './reportCompetitorIntelligenceServiceModel';
import { assembleEvidenceCompetitorCandidates, deriveCompetitorEvidenceStatus, type CompetitorEvidenceStatus } from './competitorCandidateAssembly';

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
      // HARDEN-005: competitor crawl URLs derive from a user-writable domain —
      // SSRF-safe fetch (host-validated, DNS-pinned, redirect-revalidated).
      const { safeFetch, readCapped } = await import('../../lib/security/safeFetch');
      const response = await safeFetch(url, {
        method: 'GET',
        headers: {
          'User-Agent': 'OmnivyraBot/1.0 (+https://omnivyra.com)',
          Accept: 'text/html,application/xhtml+xml',
        },
      }, { timeoutMs: 8000, maxRedirects: 3, maxBytes: 5 * 1024 * 1024 });
      if (response.status < 200 || response.status >= 400) continue;
      const html = (await readCapped(response)).toString('utf8');
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

/**
 * Graceful empty-state result. When evidence yields no validated competitors we return a valid,
 * empty CompetitorIntelligenceResult carrying `competitor_evidence_status: 'insufficient_public_data'`
 * — never throw, never fabricate. Consumers render a thin/empty competitor section honestly.
 */
function emptyCompetitorIntelligenceResult(input: {
  domain: string;
  companyContext: CompanyCompetitiveContext;
  companyMetrics: ComparisonMetrics;
  keywordCount: number;
  serpDomainsFound: number;
  serpStatus: 'live' | 'fallback';
}): CompetitorIntelligenceResult {
  return {
    summary: `Public competitive evidence for ${input.domain} was insufficient to name peers without fabrication. No competitors are shown rather than inventing them.`,
    detected_competitors: [],
    market_alternatives: [],
    competitors_by_tier: { tier_1: [], tier_2: [], tier_3: [] },
    comparison: { company: input.companyMetrics, competitors: [] },
    generated_gaps: [],
    competitive_summary: buildCompetitiveSummary({ competitors: [], companyContext: input.companyContext, domain: input.domain }),
    keyword_gap: { missing_keywords: [], weak_keywords: [], strong_keywords: [] },
    answer_gap: { missing_answers: [], weak_answers: [], strong_answers: [] },
    discovery_metadata: {
      keyword_count: input.keywordCount,
      serp_domains_found: input.serpDomainsFound,
      serp_status: input.serpStatus,
      is_fallback_used: false,
      competitor_evidence_status: 'insufficient_public_data',
    },
    ...devCompetitorScoringDebug(),
  };
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
  const storedCandidates = buildStoredCompetitorCandidates({
    resolvedInput: params.resolvedInput,
    businessType,
    geography,
    companyContext,
  });
  const providerCandidates = buildProviderCompetitorCandidates({
    decisions: params.decisions,
    companyContext,
    geography,
  });
  // Canonical evidence-only assembly — stored / manual / provider evidence, no hardcoded or
  // keyword→company injection. The sync path performs no SERP (it cannot await); reports needing
  // fresh SERP discovery use buildCompetitorIntelligenceActive.
  const candidates = assembleEvidenceCompetitorCandidates({
    evidenceCandidates: [...manualCandidates, ...storedCandidates, ...providerCandidates],
  });
  const ranked = getFinalCompetitorsSync({
    candidates,
    context: companyContext,
    max: MAX_COMPETITOR_ENGINE_OUTPUT,
    includeMarketSubstitutes: true,
  });
  const splitOutput = splitRankedCompetitorsForOutput(ranked, MAX_COMPETITORS, MARKET_SUBSTITUTE_MAX_COUNT);
  assertCompetitorOutputPartition(splitOutput, 'report_competitor_intelligence_sync');
  const discovered = classifyCompetitors(splitOutput.competitors.map(toDetectedCompetitor));
  const marketAlternatives = splitOutput.market_alternatives.map(toDetectedCompetitor);
  const evidenceStatus = deriveCompetitorEvidenceStatus(discovered.length);

  const companyMetrics = computeCompanyMetrics(params);
  if (discovered.length === 0) {
    return emptyCompetitorIntelligenceResult({
      domain,
      companyContext,
      companyMetrics,
      keywordCount: discoveryKeywords.length,
      serpDomainsFound: 0,
      serpStatus: 'fallback',
    });
  }

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
      is_fallback_used: false,
      competitor_evidence_status: evidenceStatus,
    },
    ...devCompetitorScoringDebug(),
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
  const storedCandidates = buildStoredCompetitorCandidates({
    resolvedInput: params.resolvedInput,
    businessType,
    geography,
    companyContext,
  });
  const providerCandidates = buildProviderCompetitorCandidates({
    decisions: params.decisions,
    companyContext,
    geography,
  });

  // Canonical evidence-only assembly: manual/stored/provider evidence + SERP-live domains.
  // No hardcoded roster, no keyword→company map, no count-based padding.
  const candidatePool = assembleEvidenceCompetitorCandidates({
    evidenceCandidates: [...manualCandidates, ...storedCandidates, ...providerCandidates],
    serpDomains,
    serpContext: {
      marketFocus: companyContext.marketFocus,
      businessType,
      geography,
      primaryService: companyContext.primaryService,
      rationale: `Discovered from top SERP domains for high-priority keywords (${keywords.slice(0, 3).join(', ') || 'core demand terms'}).`,
    },
  });
  const ranked = await getFinalCompetitors({
    candidates: candidatePool,
    context: companyContext,
    max: MAX_COMPETITOR_ENGINE_OUTPUT,
    useNetwork: true,
    companyId: params.companyId,
    includeMarketSubstitutes: true,
  });
  const splitOutput = splitRankedCompetitorsForOutput(ranked, MAX_COMPETITORS, MARKET_SUBSTITUTE_MAX_COUNT);
  assertCompetitorOutputPartition(splitOutput, 'report_competitor_intelligence_active');
  const discovered = classifyCompetitors(splitOutput.competitors.map(toDetectedCompetitor));
  const marketAlternatives = splitOutput.market_alternatives.map(toDetectedCompetitor);
  const evidenceStatus = deriveCompetitorEvidenceStatus(discovered.length);

  const companyMetrics = computeCompanyMetrics({
    decisions: params.decisions,
    resolvedInput: params.resolvedInput,
  });

  if (discovered.length === 0) {
    console.info('[competitor-discovery][insufficient-public-data]', {
      keywords_generated: keywords,
      serp_domains_found: serpDomains.length,
      domain,
    });
    return emptyCompetitorIntelligenceResult({
      domain,
      companyContext,
      companyMetrics,
      keywordCount: keywords.length,
      serpDomainsFound: serpDomains.length,
      serpStatus,
    });
  }

  console.info('[competitor-discovery][summary]', {
    keywords_generated: keywords,
    serp_domains_found: serpDomains.length,
    final_candidates_count: discovered.length,
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
      is_fallback_used: ranked.some((competitor) => competitor.source === 'market_substitute'),
      competitor_evidence_status: evidenceStatus,
    },
    ...devCompetitorScoringDebug(),
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

