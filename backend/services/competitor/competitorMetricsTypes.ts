/**
 * The structural types shared by the D8 competitor-metrics seam and the
 * competitor-intelligence modules that consume it.
 *
 * WHY THIS MODULE EXISTS. The seam (competitorMetricsEvidence) needed
 * `ComparisonMetrics` from reportCompetitorIntelligenceServiceModel and
 * `DomainCrawlSignals` from reportCompetitorIntelligenceServiceHelpers, while
 * both of those needed `CompetitorCrawlOutcome` from the seam. The mutual
 * type-only imports made the seam and its own consumers depend on each other,
 * and the native architecture gate counted eight new dependency cycles through
 * the seam. The types live here instead, so the graph points one way:
 *
 *   competitorMetricsEvidence ──▶ competitorMetricsTypes ◀── Model / Helpers
 *
 * WHAT MAY LIVE HERE. Pure structural types that more than one of those modules
 * genuinely shares — nothing else. No runtime code, no functions, no constants,
 * no evidence rules, no provider or database access. This is deliberately not a
 * general `types.ts`: a type belongs here only if it is shared across that seam.
 *
 * Its only import is D2's canonical `ReachabilityOutcome`, a type from a module
 * that itself imports nothing, so this file cannot take part in a cycle.
 *
 * The original modules re-export these types, so every existing import keeps
 * working unchanged.
 */
import type { ReachabilityOutcome } from '../crawl/reachabilityOutcome';

/** The seven comparison dimensions scored for the company and each competitor. */
export type ComparisonMetrics = {
  content_depth: number;
  authority_score: number;
  publishing_frequency: number;
  engagement_score: number;
  seo_coverage: number;
  geo_presence: number;
  aeo_readiness: number;
};

/** What a crawl of one competitor's public pages observed. */
export type DomainCrawlSignals = {
  contentScore: number;
  keywordCoverageScore: number;
  authorityProxy: number;
  technicalScore: number;
  aiAnswerPresenceScore: number;
  extractedKeywords: string[];
  answerTopics: string[];
};

/**
 * How the attempt to observe a competitor's public site ended.
 *
 * D2's ReachabilityOutcome for every case where a fetch was attempted, plus the
 * one state D2 has no reason to model: we never looked. "Never looked" and
 * "looked and got a 404" are different facts and must not be merged.
 */
export type CompetitorCrawlOutcome = ReachabilityOutcome | 'not_attempted';
