/**
 * Reviews & Reputation Evidence Adapter  (BETA-PROVIDER-005, Phase 3-4) — REFERENCE IMPLEMENTATION #5
 *
 * Converts authenticated, cross-platform reputation data into canonical Evidence via the BETA-ENGINE-004
 * `ProviderEvidenceAdapter` contract. It is the ONLY bridge from a reputation payload to the canonical
 * Evidence model — no engine consumes the payload directly. Deterministic; emits ONLY the metrics the
 * review providers actually supplied (missing metrics are omitted, failures emitted as UNAVAILABLE —
 * never fabricated).
 *
 * Provider-agnostic + multi-provider: it consumes a normalised `ReputationEvidenceInput` that the
 * reputation bridge builds by DETERMINISTICALLY CONSOLIDATING one or more review sources (Google, G2,
 * Trustpilot, Facebook, Yelp, Clutch, Capterra, Glassdoor, app stores, …). The bridge owns consolidation;
 * this adapter owns the canonical Evidence conversion.
 *
 * NON-NEGOTIABLE: sentiment is emitted ONLY when a source genuinely supplied sentiment counts — never
 * generated. All values trace to provider-supplied data.
 */
import { createEvidence, type Evidence } from '../../evidenceModel';
import { buildProvenance } from '../../provenance';
import { fromEngineConfidence } from '../../confidenceContract';
import type { ProviderEvidenceAdapter, AdapterContext } from '../providerAdapter';
import { baseAdapterFailure } from '../providerAdapter';
import type { ProviderFailure } from '../providerFailure';

const PROVIDER_ENGINE_ID = 'provider:reviews';

/**
 * Normalised, provider-agnostic CONSOLIDATED reputation metrics (output of multi-provider consolidation).
 * Every field nullable — only values genuinely supplied by ≥1 review source pass through; nulls are
 * omitted by the adapter (never fabricated). `contributingSources` lists the sources that fed this
 * consolidation, for provenance/explainability.
 */
export interface ReputationEvidenceInput {
  subjectId: string;
  avgRating: number | null; // 0..5, review-count-weighted across sources
  reviewCount: number | null; // total across sources
  sourceCount: number | null; // number of contributing review sources (platform coverage)
  verifiedReviews: number | null; // total verified across sources
  recentReviews: number | null; // total reviews in the recent window across sources
  reviewVelocityPerDay: number | null; // recentReviews / window days (CALCULATED)
  sentimentPositiveRatio: number | null; // 0..1, ONLY when ≥1 source supplied sentiment
  sentimentNegativeRatio: number | null; // 0..1, ONLY when ≥1 source supplied sentiment
  responseRate: number | null; // 0..1, review-count-weighted
  avgResponseHours: number | null; // review-count-weighted
  ownerResponses: number | null; // total owner responses across sources
  ratingSpread: number | null; // max-min avg rating across sources (disagreement magnitude)
  reviewParity: number | null; // 0..1 cross-source agreement = 1 - spread/5 (CALCULATED)
  freshnessHours: number | null; // hours since the most recent review (CALCULATED from provided timestamps)
  observedAt: string | null;
  providerReliability: number | null;
  contributingSources: string[];
}

/** The canonical evidence keys this adapter can emit (align with the Evidence Registry + descriptor). */
export const REVIEWS_EVIDENCE_KEYS = [
  'avg_rating',
  'review_count',
  'review_source_count',
  'verified_reviews',
  'recent_reviews',
  'review_velocity',
  'sentiment_positive_ratio',
  'sentiment_negative_ratio',
  'response_rate',
  'avg_response_time_hours',
  'owner_responses',
  'review_parity',
  'review_freshness_hours',
] as const;

const round = (n: number): number => Math.round(n * 100) / 100;
const round4 = (n: number): number => Math.round(n * 10000) / 10000;

export class ReviewsEvidenceAdapter implements ProviderEvidenceAdapter<ReputationEvidenceInput> {
  readonly providerId = 'reviews';
  readonly supportedEvidence = [...REVIEWS_EVIDENCE_KEYS];

  toEvidence(raw: ReputationEvidenceInput, _context: AdapterContext): Evidence[] {
    const ts = raw.observedAt ?? null;
    const out: Evidence[] = [];
    const conf = fromEngineConfidence(raw.providerReliability, { reliability: raw.providerReliability ?? null });
    const sources = raw.contributingSources ?? [];
    const prov = (maturityOp: string | null = null) =>
      buildProvenance({
        origin: 'provider:reviews',
        collector: 'reviews_api',
        engine: PROVIDER_ENGINE_ID,
        version: '1.0.0',
        timestamp: ts,
        calculationSteps: [
          { op: 'consolidate', detail: `sources=${sources.join('+') || 'none'}` },
          ...(maturityOp ? [{ op: maturityOp }] : []),
        ],
      });

    // MEASURED — a value ≥1 source genuinely supplied (consolidated). Missing → skipped (no fabrication).
    const measured = (key: string, value: number, unit: string, measurementType: string) =>
      out.push(createEvidence({
        engineId: PROVIDER_ENGINE_ID, key, value, maturity: 'MEASURED',
        sourceSystem: 'reviews_api', sourceType: 'external_api', measurementType, observationType: 'aggregate',
        unit, observedAt: ts, collectedAt: ts, confidence: conf, provenance: prov(), validationStatus: 'validated',
      }));
    // CALCULATED — a value deterministically derived from measured inputs.
    const calculated = (key: string, value: number, unit: string, measurementType: string, detail: string) =>
      out.push(createEvidence({
        engineId: PROVIDER_ENGINE_ID, key, value, maturity: 'CALCULATED',
        sourceSystem: 'reviews_api', sourceType: 'external_api', measurementType, observationType: 'aggregate',
        unit, observedAt: ts, collectedAt: ts, confidence: conf,
        provenance: prov(detail), validationStatus: 'validated',
      }));

    if (raw.avgRating != null) measured('avg_rating', round(raw.avgRating), 'rating_0_5', 'rating');
    if (raw.reviewCount != null) measured('review_count', raw.reviewCount, 'count', 'count');
    if (raw.sourceCount != null) measured('review_source_count', raw.sourceCount, 'count', 'count');
    if (raw.verifiedReviews != null) measured('verified_reviews', raw.verifiedReviews, 'count', 'count');
    if (raw.recentReviews != null) measured('recent_reviews', raw.recentReviews, 'count', 'count');
    if (raw.ownerResponses != null) measured('owner_responses', raw.ownerResponses, 'count', 'count');
    if (raw.responseRate != null) measured('response_rate', round4(raw.responseRate), 'ratio', 'ratio');
    if (raw.avgResponseHours != null) measured('avg_response_time_hours', round(raw.avgResponseHours), 'hours', 'duration');

    // Sentiment: emitted ONLY when a source genuinely supplied sentiment (never generated).
    if (raw.sentimentPositiveRatio != null) measured('sentiment_positive_ratio', round4(raw.sentimentPositiveRatio), 'ratio', 'ratio');
    if (raw.sentimentNegativeRatio != null) measured('sentiment_negative_ratio', round4(raw.sentimentNegativeRatio), 'ratio', 'ratio');

    // Derived (CALCULATED).
    if (raw.reviewVelocityPerDay != null) calculated('review_velocity', round(raw.reviewVelocityPerDay), 'per_day', 'rate', 'recent_reviews/window_days');
    if (raw.reviewParity != null) calculated('review_parity', round4(raw.reviewParity), 'ratio', 'agreement', '1 - rating_spread/5');
    if (raw.freshnessHours != null) calculated('review_freshness_hours', round(raw.freshnessHours), 'hours', 'age', 'now - most_recent_review');
    return out;
  }

  onFailure(failure: ProviderFailure): Evidence[] {
    return baseAdapterFailure(failure);
  }
}

export const reviewsEvidenceAdapter = new ReviewsEvidenceAdapter();
