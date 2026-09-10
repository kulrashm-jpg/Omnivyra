/**
 * D8 — the single seam that decides whether a competitor's comparison metrics are
 * supported by evidence.
 *
 * WHY THIS EXISTS
 *
 * Competitor comparison metrics were previously produced two ways, and BOTH could
 * manufacture a competitive deficit that no observation supported:
 *
 *   1. When a competitor's site WAS crawled, each metric was
 *        (companyMetric + competitorSignal) / 2 + K
 *      with unconditional constants K of +6 (content), +8 (authority), +9 (SEO) and
 *      +7 (AEO). Those constants are evidence-free: they bias every competitor above
 *      the customer by a fixed amount before any observation is consulted. They are
 *      also calibrated against the gap thresholds in buildGapDefinitions (>=8 content,
 *      >=10 authority, >=10 visibility, >=8 AEO), so they do not merely nudge a score —
 *      they move a competitor across the line at which the report starts telling the
 *      customer it is losing.
 *
 *   2. When a competitor's site was NOT crawled — no domain, 4xx, 5xx, timeout, or
 *      transport failure, all of which collapsed to the same `null` — metrics were
 *      synthesised by `liftMetrics()` as
 *        companyMetric + classificationLift + variation[index]
 *      i.e. purely from the CUSTOMER's own numbers plus a table keyed by the
 *      competitor's classification and its position in the list. Nothing observed about
 *      the competitor entered the calculation at all, yet the result was published as a
 *      competitor metric, and `is_fallback_used` stayed false.
 *
 * WHAT THIS MODULE DOES
 *
 * It is the one place that answers "do we have the evidence to state this competitor's
 * metrics?", mirroring how D1's aiVisibilityGrounding and D2's reachabilityOutcome own
 * their respective decisions. It creates NO new state taxonomy and NO second scoring
 * engine: the state is the repository's canonical `ScoreState`, and the crawl outcome is
 * D2's canonical `ReachabilityOutcome`.
 *
 * THE RULE
 *
 * A competitor metric may be stated only when it is derived from that competitor's own
 * observed public evidence. When it is not, the metric is `null` with state
 * `unavailable` — never a fabricated number, and never an arbitrary zero, which would be
 * read as a real measurement of "no capability".
 *
 * Observed-crawl metrics are `inferred`, not `measured`. They are derived from a real
 * public crawl, but the mapping from page text to "authority" or "answer readiness" is a
 * proxy, not a measurement of those things. Calling that `measured` is what let the
 * report claim observed competitor superiority in the first place.
 */
import type { ScoreState } from '../snapshotReport/canonicalScoreState';
import type { ReachabilityOutcome } from '../crawl/reachabilityOutcome';
import type { ComparisonMetrics } from '../reportCompetitorIntelligenceServiceModel';
import type { DomainCrawlSignals } from '../reportCompetitorIntelligenceServiceHelpers';

/**
 * How the attempt to observe a competitor's public site ended.
 *
 * Reuses D2's ReachabilityOutcome for every case where a fetch was actually attempted,
 * and adds the one state D2 has no reason to model: we never looked. "Never looked" and
 * "looked and got a 404" are different facts about the world and must not be merged —
 * merging them is precisely what produced the defect this module closes.
 */
export type CompetitorCrawlOutcome = ReachabilityOutcome | 'not_attempted';

/** No page answered, so nothing about this competitor was observed. */
export function isUnobservedCrawl(outcome: CompetitorCrawlOutcome): boolean {
  return outcome !== 'success' && outcome !== 'redirect';
}

export type CompetitorMetricsResolution = {
  /**
   * `inferred`    — derived from this competitor's own observed public pages.
   * `unavailable` — nothing was observed; metrics are null and MUST stay null.
   *
   * Deliberately never `measured`: see the module comment.
   */
  readonly state: ScoreState;
  readonly metrics: ComparisonMetrics | null;
  readonly crawl_outcome: CompetitorCrawlOutcome;
  /** Plain-language reason, published so the report can say why a cell is empty. */
  readonly basis: string;
};

function clampMetric(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

const OUTCOME_BASIS: Record<CompetitorCrawlOutcome, string> = {
  not_attempted: 'No public site was available to observe for this competitor, so no comparison metrics were derived.',
  transport_failure: 'This competitor’s site could not be reached, so no comparison metrics were derived.',
  timeout: 'This competitor’s site did not respond in time, so no comparison metrics were derived.',
  client_error: 'This competitor’s site returned a client error, so no comparison metrics were derived.',
  server_error: 'This competitor’s site returned a server error, so no comparison metrics were derived.',
  success: 'Derived from this competitor’s own observed public pages.',
  redirect: 'Derived from this competitor’s own observed public pages.',
};

/**
 * Dimensions a public page crawl genuinely observes.
 *
 * These are the only dimensions whose competitor value carries evidence, and therefore
 * the only ones permitted to produce a non-zero delta against the customer.
 */
export const CRAWL_OBSERVED_DIMENSIONS: readonly (keyof ComparisonMetrics)[] = [
  'content_depth',
  'authority_score',
  'seo_coverage',
  'aeo_readiness',
];

/**
 * Dimensions no public page crawl observes: publishing cadence, audience engagement, and
 * geographic footprint.
 *
 * Previously these were filled from unrelated signals — `engagement_score` was
 * `authorityProxy * 0.65`, i.e. a count of credibility words in page copy printed as a
 * measure of a competitor's audience engagement. Nothing in a page crawl observes any of
 * these three.
 */
export const CRAWL_UNOBSERVED_DIMENSIONS: readonly (keyof ComparisonMetrics)[] = [
  'publishing_frequency',
  'engagement_score',
  'geo_presence',
];

/**
 * Resolve one competitor's comparison metrics.
 *
 * The observed dimensions are derived from the competitor's OWN signals. The customer's
 * metrics are not an input to them: blending the customer's score into the competitor's
 * is what made a competitor's number a function of the customer's, and the unconditional
 * constant on top is what guaranteed the gap.
 *
 * `companyMetrics` is used for ONE purpose only, and only on the dimensions a crawl
 * cannot observe: those are mirrored from the customer's own value so their delta is
 * exactly zero. That is deliberate and is not a score. A fixed constant (say 50) was
 * rejected because it still produces a directional delta against the customer's real
 * value — a competitor would appear ahead on "engagement" purely because the customer's
 * own publishing number happened to be below the constant. Mirroring is the only filling
 * that provably contributes no evidence in either direction, and the D8 suite asserts
 * that delta is 0.
 */
export function resolveCompetitorMetrics(params: {
  readonly signals: DomainCrawlSignals | null;
  readonly crawlOutcome: CompetitorCrawlOutcome;
  readonly companyMetrics: ComparisonMetrics;
}): CompetitorMetricsResolution {
  const { signals, crawlOutcome, companyMetrics } = params;

  // No observation of this competitor exists. Report that, do not manufacture it.
  if (!signals || isUnobservedCrawl(crawlOutcome)) {
    return {
      state: 'unavailable',
      metrics: null,
      crawl_outcome: crawlOutcome,
      basis: OUTCOME_BASIS[crawlOutcome] ?? OUTCOME_BASIS.not_attempted,
    };
  }

  return {
    state: 'inferred',
    crawl_outcome: crawlOutcome,
    metrics: {
      // Observed: how much substantive page text the crawl actually read.
      content_depth: clampMetric(signals.contentScore),
      // Inferred proxy: a count of credibility-word mentions in page copy. It is NOT a
      // backlink or domain-authority measurement, which is why this resolution is
      // published as `inferred` and never as observed authority.
      authority_score: clampMetric(signals.authorityProxy),
      // Observed: overlap with the reference keyword set.
      seo_coverage: clampMetric(signals.keywordCoverageScore),
      // Observed: presence of extractable answer structures (FAQ, summaries, schema).
      aeo_readiness: clampMetric(signals.aiAnswerPresenceScore),
      // Unobserved by any page crawl — mirrored so they contribute a zero delta.
      publishing_frequency: companyMetrics.publishing_frequency,
      engagement_score: companyMetrics.engagement_score,
      geo_presence: companyMetrics.geo_presence,
    },
    basis: OUTCOME_BASIS[crawlOutcome],
  };
}
