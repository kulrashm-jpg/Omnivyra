/**
 * Reputation → Trust-Coherence ReviewAggregator  (BETA-REPORT-EXEC-002, Wave 1 — Phase 4)
 *
 * The ONE clean Evidence-Platform → canonical-report integration sanctioned by BETA-REPORT-AUDIT-002: it fills
 * the pre-existing, EMPTY `registerReviewAggregator()` extension slot on the live TrustCoherenceAdapter with
 * the canonical reviews provider's DETERMINISTIC consolidation. It adds NO parallel trust calculation and NO
 * duplicate review provider — the existing adapter's `compositeScore` still owns the 0-100 trust math; this
 * only SUPPLIES the review-parity + source-count signals it already knows how to consume.
 *
 * Fail-safe by construction (zero regression): it returns null — leaving `trust_coherence` exactly as today —
 * unless (a) REVIEWS_API_KEY is set AND (b) a review-source loader has been registered by an ingestion layer.
 * No review ingestion pipeline exists yet (per BETA-REPORT-AUDIT-002), so this is INERT in the current
 * environment; it activates automatically, with no further wiring, the moment ingestion supplies sources.
 * Deterministic: no clock/random — the observation timestamp is supplied by the ingestion snapshot.
 */
import type { ReviewAggregator } from './trustCoherenceAdapter';
import {
  isReputationProviderConfigured,
  consolidateReviewSources,
  type ReviewSourcePayload,
} from '../../reputationProviderBridge';

/** A point-in-time set of ingested review sources + the ISO time they were observed (deterministic input). */
export interface ReviewSourceSnapshot {
  sources: ReviewSourcePayload[];
  observedAt: string;
}

/**
 * The ingestion seam. An operator/ingestion layer registers a loader that returns the company's review
 * sources. Default is none — until one is registered the aggregator stays inert (trust unchanged).
 */
export type ReviewSourceLoader = (params: {
  brandName: string;
  domain: string | null;
}) => Promise<ReviewSourceSnapshot | null>;

let configuredLoader: ReviewSourceLoader | null = null;

/** Register (or, with null, clear) the review-source loader. */
export function registerReviewSourceLoader(impl: ReviewSourceLoader | null): void {
  configuredLoader = impl;
}

/**
 * Build the ReviewAggregator sub-service. Consolidates ingested review sources via the canonical reputation
 * bridge and maps them onto the trust adapter's expected `{ source_count, rating_variance }` shape.
 * `rating_variance` is the inverse of the bridge's `review_parity` (0 = perfect cross-source agreement).
 */
export function createReputationReviewAggregator(): ReviewAggregator {
  return async ({ brandName, domain }) => {
    if (!isReputationProviderConfigured()) return null; // no credential → trust unchanged
    const loader = configuredLoader;
    if (!loader) return null; // no ingestion registered yet → trust unchanged

    const snapshot = await loader({ brandName, domain });
    if (!snapshot || snapshot.sources.length === 0) return null; // no data → trust unchanged

    const consolidated = consolidateReviewSources(snapshot.sources, snapshot.observedAt);
    if (
      consolidated.sourceCount == null ||
      consolidated.sourceCount === 0 ||
      consolidated.reviewParity == null
    ) {
      return null; // nothing usable → trust unchanged (never fabricate)
    }

    return {
      source_count: consolidated.sourceCount,
      // bridge `review_parity`: 1 = perfect agreement → variance 0. Clamp defensively.
      rating_variance: Math.max(0, Math.min(1, 1 - consolidated.reviewParity)),
      observed_at: consolidated.observedAt ?? snapshot.observedAt,
    };
  };
}
