// Real Trust Coherence adapter.
//
// Phase 4 ships the architecture; the underlying review-aggregator integrations
// (Trustpilot / G2 / Capterra / Google reviews) are pluggable services. The
// adapter wires the orchestration that combines them into a single result.
//
// Activates when TRUST_COHERENCE_ENABLED=true. When no underlying service is
// reachable, returns state='unavailable' with the actual failure reason.

import type {
  TrustCoherenceProvider,
  TrustCoherenceResult,
  TrustCoherenceSignals,
} from '../providerInterfaces';
import { unavailableEvidence } from '../providerInterfaces';
import { freshnessFromTimestamp, logProviderCall } from '../productionPrimitives';
import type { EvidenceObservation, EvidenceTrace } from '../../canonicalReport/canonicalReportTypes';

// ── Sub-services (pluggable; default to noop) ─────────────────────────────────
//
// Each sub-service is a Promise<T | null> — null means "not configured".
// Operators wire real implementations (e.g. a Trustpilot fetcher) when the
// corresponding upstream credentials are present.

export type ReviewAggregator = (params: { brandName: string; domain: string | null }) => Promise<{
  source_count: number;
  rating_variance: number; // 0-1: 0 = perfect parity across sources, 1 = wildly inconsistent
  observed_at: string;
} | null>;

export type ConsistencyChecker = (params: { brandName: string; domain: string | null }) => Promise<{
  nap_consistency: number; // 0-1
  brand_description_consistency: number; // 0-1
  observed_at: string;
} | null>;

export type ExpertiseExtractor = (params: { domain: string | null }) => Promise<{
  author_bylines: number;
  credentialed_authors: number;
  organizational_about_completeness: number; // 0-1
  observed_at: string;
} | null>;

let configuredReviewAggregator: ReviewAggregator | null = null;
let configuredConsistencyChecker: ConsistencyChecker | null = null;
let configuredExpertiseExtractor: ExpertiseExtractor | null = null;

export function registerReviewAggregator(impl: ReviewAggregator): void {
  configuredReviewAggregator = impl;
}
export function registerConsistencyChecker(impl: ConsistencyChecker): void {
  configuredConsistencyChecker = impl;
}
export function registerExpertiseExtractor(impl: ExpertiseExtractor): void {
  configuredExpertiseExtractor = impl;
}

// ── Adapter ───────────────────────────────────────────────────────────────────

function compositeScore(signals: TrustCoherenceSignals): number {
  // 35% NAP + 25% description + 25% review parity + 15% expertise.
  const nap = (signals.nap_consistency ?? 0) * 35;
  const desc = (signals.brand_description_consistency ?? 0) * 25;
  const review = signals.review_parity != null ? (1 - signals.review_parity) * 25 : 0;
  const expertise =
    signals.expertise_signals?.organizational_about_completeness != null
      ? signals.expertise_signals.organizational_about_completeness * 15
      : 0;
  return Math.round(Math.max(0, Math.min(100, nap + desc + review + expertise)));
}

export class TrustCoherenceAdapter implements TrustCoherenceProvider {
  public readonly id = 'consistency_checker';

  async isAvailable(): Promise<boolean> {
    return process.env.TRUST_COHERENCE_ENABLED === 'true';
  }

  async lookup(params: { brandName: string; domain: string | null }): Promise<TrustCoherenceResult> {
    if (process.env.TRUST_COHERENCE_ENABLED !== 'true') {
      return {
        state: 'unavailable',
        signals: null,
        score: null,
        evidence: unavailableEvidence('TRUST_COHERENCE_ENABLED is not true.'),
        reason_unavailable: 'TRUST_COHERENCE_ENABLED is not true.',
      };
    }

    const observations: EvidenceObservation[] = [];
    let observedAt = new Date().toISOString();

    let napConsistency: number | null = null;
    let descriptionConsistency: number | null = null;
    let reviewParity: number | null = null;
    let reviewSourceCount = 0;
    let expertise: TrustCoherenceSignals['expertise_signals'] = null;

    if (configuredConsistencyChecker) {
      try {
        const result = await configuredConsistencyChecker(params);
        if (result) {
          napConsistency = result.nap_consistency;
          descriptionConsistency = result.brand_description_consistency;
          observedAt = result.observed_at;
          observations.push({
            signal: `consistency:nap:${napConsistency.toFixed(2)}`,
            source: 'review_aggregator',
            observed_at: observedAt,
          });
        }
      } catch (error) {
        logProviderCall({
          providerId: this.id,
          operation: 'consistency_checker',
          status: 'unavailable',
          reason: error instanceof Error ? error.message : 'unknown',
        });
      }
    }

    if (configuredReviewAggregator) {
      try {
        const result = await configuredReviewAggregator(params);
        if (result) {
          reviewSourceCount = result.source_count;
          reviewParity = result.rating_variance;
          observedAt = result.observed_at;
          observations.push({
            signal: `review_parity:${reviewParity.toFixed(2)} sources=${reviewSourceCount}`,
            source: 'review_aggregator',
            observed_at: observedAt,
          });
        }
      } catch (error) {
        logProviderCall({
          providerId: this.id,
          operation: 'review_aggregator',
          status: 'unavailable',
          reason: error instanceof Error ? error.message : 'unknown',
        });
      }
    }

    if (configuredExpertiseExtractor) {
      try {
        const result = await configuredExpertiseExtractor({ domain: params.domain });
        if (result) {
          expertise = {
            author_bylines: result.author_bylines,
            credentialed_authors: result.credentialed_authors,
            organizational_about_completeness: result.organizational_about_completeness,
          };
          observations.push({
            signal: `expertise:authors=${result.author_bylines} credentialed=${result.credentialed_authors}`,
            source: 'expertise_extractor',
            observed_at: result.observed_at,
          });
        }
      } catch (error) {
        logProviderCall({
          providerId: this.id,
          operation: 'expertise_extractor',
          status: 'unavailable',
          reason: error instanceof Error ? error.message : 'unknown',
        });
      }
    }

    if (
      napConsistency == null &&
      descriptionConsistency == null &&
      reviewParity == null &&
      expertise == null
    ) {
      const reason =
        'No trust-coherence sub-service is configured. Register a review aggregator, consistency checker, or expertise extractor to activate.';
      return {
        state: 'unavailable',
        signals: null,
        score: null,
        evidence: unavailableEvidence(reason),
        reason_unavailable: reason,
      };
    }

    const signals: TrustCoherenceSignals = {
      nap_consistency: napConsistency,
      brand_description_consistency: descriptionConsistency,
      review_parity: reviewParity,
      review_source_count: reviewSourceCount,
      expertise_signals: expertise,
    };
    const score = compositeScore(signals);
    const evidence: EvidenceTrace = {
      count: observations.length,
      sources: ['review_aggregator', 'expertise_extractor'],
      freshness: freshnessFromTimestamp(observedAt),
      observations,
    };

    logProviderCall({ providerId: this.id, operation: 'lookup', status: 'ok' });
    return {
      state: 'measured',
      signals,
      score,
      evidence,
      reason_unavailable: null,
    };
  }
}
