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
// The shared structural types come from a leaf module, never from the modules that
// consume this seam: importing ComparisonMetrics from the Model and DomainCrawlSignals
// from the Helpers — while both import CompetitorCrawlOutcome from here — made the
// seam and its consumers depend on each other (eight dependency cycles).
import type {
  ComparisonMetrics,
  CompetitorCrawlOutcome,
  DomainCrawlSignals,
} from './competitorMetricsTypes';

/**
 * How the attempt to observe a competitor's public site ended — D2's
 * ReachabilityOutcome plus 'not_attempted'. Defined in competitorMetricsTypes and
 * re-exported here, so existing imports of it from this module are unchanged.
 */
export type { CompetitorCrawlOutcome };

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

/**
 * The four dimensions a public page crawl genuinely observes, derived from ONE side's own
 * crawl signals and nothing else.
 *
 * WP-12 — this is deliberately a single shared derivation. The subject company's baseline and
 * every competitor's metrics are now produced by this same function from the same
 * `DomainCrawlSignals` shape, gathered by the same crawler against the same reference keyword
 * set. That symmetry is what makes the subtraction honest: a delta is a comparison of two
 * measurements taken the same way, not of a measurement against an estimate.
 *
 * It takes ONE argument. Neither side's numbers can leak into the other's, because the other
 * side is not in scope.
 */
function deriveCrawlObservedDimensions(signals: DomainCrawlSignals): Pick<
  ComparisonMetrics,
  'content_depth' | 'authority_score' | 'seo_coverage' | 'aeo_readiness'
> {
  return {
    // Observed: how much substantive page text the crawl actually read.
    content_depth: clampMetric(signals.contentScore),
    // Inferred proxy: a count of credibility-word mentions in page copy. It is NOT a
    // backlink or domain-authority measurement, which is why a resolution built on it is
    // published as `inferred` and never as observed authority.
    authority_score: clampMetric(signals.authorityProxy),
    // Observed: overlap with the reference keyword set.
    seo_coverage: clampMetric(signals.keywordCoverageScore),
    // Observed: presence of extractable answer structures (FAQ, summaries, schema).
    aeo_readiness: clampMetric(signals.aiAnswerPresenceScore),
  };
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
  readonly companyMetrics: ComparisonMetrics | null;
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
      // WP-12 — the SAME derivation the subject company's own baseline goes through.
      ...deriveCrawlObservedDimensions(signals),
      // REMEDIATION-003 / WP-12 — these three are not observable from a page crawl, on either
      // side. The `?? null` is what survives of the old mirror, which existed to force a zero
      // delta against the fabricated baseline; mirroring a synthesized number would have
      // republished it as a COMPETITOR's figure.
      //
      // WP-12 — the company baseline is now REAL (resolveCompanyMetrics, from the subject's own
      // crawl) and sets all three to `null` for exactly the reason a competitor's are null.
      // So in production this always resolves to null on both sides and the delta is null, not
      // 0. The mirror remains only for a caller that supplies these from some future source
      // that genuinely observes them on BOTH sides; it must never be fed a synthesized number.
      publishing_frequency: companyMetrics?.publishing_frequency ?? null,
      engagement_score: companyMetrics?.engagement_score ?? null,
      geo_presence: companyMetrics?.geo_presence ?? null,
    },
    basis: OUTCOME_BASIS[crawlOutcome],
  };
}


/**
 * ─── WP-12 — THE SUBJECT COMPANY'S OWN BASELINE ───────────────────────────────────────
 *
 * REMEDIATION-003 removed a fabricated company baseline (`constant ± penalty ± presence
 * bonus`) and correctly replaced it with `null`. That left the competitive-gap capability
 * DORMANT: a gap is `competitor − company`, so with no company side there was never a gap,
 * and the comparison produced nothing at all.
 *
 * This resolves the company side the ONLY honest way available: from the subject company's
 * OWN public site, crawled by the same crawler, against the same reference keyword set, and
 * mapped through the same `deriveCrawlObservedDimensions` used for every competitor. Nothing
 * here is a constant, a penalty derived from our own audit decisions, a presence bonus for a
 * filled-in profile field, or a number reverse-derived from competitors.
 *
 * THE SIGNATURE IS THE GUARANTEE. This function takes the company's own crawl and nothing
 * else — no competitor metrics, no decisions, no resolved profile. Competitor-derived reverse
 * synthesis is not merely forbidden here, it is un-expressible: the competitors are not in
 * scope.
 *
 * SYMMETRY. The three dimensions no page crawl can establish — publishing cadence, audience
 * engagement, geographic footprint — are `null` for the company for exactly the reason they
 * are `null` for a competitor. Both sides are missing them, so `subtractMetrics` /
 * `gapBetween` yield `null` for them, never 0 and never a one-sided gap.
 *
 * ABSTENTION. When the company's own site could not be observed — no domain on the report, or
 * a crawl that returned no page — the baseline is `null` with state `unavailable`, and the
 * capability abstains exactly as REMEDIATION-003 left it. A dormant capability is the correct
 * outcome when the evidence is absent; it is never a licence to manufacture the number.
 */
export type CompanyMetricsResolution = {
  /**
   * `inferred`    — derived from the company's own observed public pages.
   * `unavailable` — the company's site was not observed; the baseline is null and MUST stay null.
   *
   * Deliberately never `measured`, for the same reason a competitor's is not: the mapping from
   * page text to "authority" or "answer readiness" is a proxy.
   */
  readonly state: ScoreState;
  readonly metrics: ComparisonMetrics | null;
  readonly crawl_outcome: CompetitorCrawlOutcome;
  /** Plain-language reason, published so the report can say why the baseline is absent. */
  readonly basis: string;
};

const COMPANY_OUTCOME_BASIS: Record<CompetitorCrawlOutcome, string> = {
  not_attempted: 'No public site was available to observe for this company, so no comparison baseline was derived and no competitive gap is stated.',
  transport_failure: 'This company’s own site could not be reached, so no comparison baseline was derived and no competitive gap is stated.',
  timeout: 'This company’s own site did not respond in time, so no comparison baseline was derived and no competitive gap is stated.',
  client_error: 'This company’s own site returned a client error, so no comparison baseline was derived and no competitive gap is stated.',
  server_error: 'This company’s own site returned a server error, so no comparison baseline was derived and no competitive gap is stated.',
  success: 'Derived from this company’s own observed public pages, using the same crawl derivation applied to every competitor.',
  redirect: 'Derived from this company’s own observed public pages, using the same crawl derivation applied to every competitor.',
};

export function resolveCompanyMetrics(params: {
  readonly signals: DomainCrawlSignals | null;
  readonly crawlOutcome: CompetitorCrawlOutcome;
}): CompanyMetricsResolution {
  const { signals, crawlOutcome } = params;

  // The company's own site was not observed. Abstain — do not manufacture the baseline.
  if (!signals || isUnobservedCrawl(crawlOutcome)) {
    return {
      state: 'unavailable',
      metrics: null,
      crawl_outcome: crawlOutcome,
      basis: COMPANY_OUTCOME_BASIS[crawlOutcome] ?? COMPANY_OUTCOME_BASIS.not_attempted,
    };
  }

  return {
    state: 'inferred',
    crawl_outcome: crawlOutcome,
    metrics: {
      ...deriveCrawlObservedDimensions(signals),
      // Not observable from a page crawl — on EITHER side. Null here is what makes the
      // comparison symmetric rather than one-sided.
      publishing_frequency: null,
      engagement_score: null,
      geo_presence: null,
    },
    basis: COMPANY_OUTCOME_BASIS[crawlOutcome],
  };
}
