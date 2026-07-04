import {
  reviewsEvidenceAdapter, REVIEWS_EVIDENCE_KEYS, type ReputationEvidenceInput,
} from '../../services/evidencePlatform/providers/reputation/reviewsEvidenceAdapter';
import { PROVIDER_FAILURE } from '../../services/evidencePlatform';
import {
  isReputationProviderConfigured, registerReputationProvider, isReputationProviderAvailable,
  reputationProviderReliability, consolidateReviewSources, fetchReputationEvidence,
  type ReviewSourcePayload,
} from '../../services/reputationProviderBridge';
import { __clearProviderRegistry } from '../../services/evidencePlatform';

const OBSERVED = '2026-01-31T00:00:00.000Z';

const input: ReputationEvidenceInput = {
  subjectId: 'company-1',
  avgRating: 4.3, reviewCount: 520, sourceCount: 3, verifiedReviews: 480, recentReviews: 60,
  reviewVelocityPerDay: 2, sentimentPositiveRatio: 0.72, sentimentNegativeRatio: 0.12,
  responseRate: 0.65, avgResponseHours: 18, ownerResponses: 340, ratingSpread: 0.6,
  reviewParity: 0.88, freshnessHours: 12, observedAt: OBSERVED, providerReliability: 0.85,
  contributingSources: ['google', 'trustpilot', 'g2'],
};

describe('Reputation Provider — canonical adapter (BETA-PROVIDER-005)', () => {
  it('converts consolidated reputation to canonical Evidence, per-field MEASURED / derived CALCULATED', () => {
    const ev = reviewsEvidenceAdapter.toEvidence(input, { observedAt: OBSERVED });
    const byKey = Object.fromEntries(ev.map((e) => [e.id.split(':').pop(), e]));
    expect(byKey['avg_rating'].value).toBe(4.3);
    expect(byKey['avg_rating'].maturity).toBe('MEASURED');
    expect(byKey['review_count'].value).toBe(520);
    expect(byKey['review_source_count'].value).toBe(3);
    expect(byKey['verified_reviews'].value).toBe(480);
    expect(byKey['response_rate'].value).toBe(0.65);
    expect(byKey['sentiment_positive_ratio'].value).toBe(0.72);
    expect(byKey['review_parity'].value).toBe(0.88);
    expect(byKey['review_parity'].maturity).toBe('CALCULATED');
    expect(byKey['review_velocity'].maturity).toBe('CALCULATED');
    for (const e of ev) expect(e.sourceType).toBe('external_api');
  });

  it('never fabricates sentiment: omits sentiment ratios when no source supplied sentiment', () => {
    const noSentiment: ReputationEvidenceInput = { ...input, sentimentPositiveRatio: null, sentimentNegativeRatio: null };
    const ev = reviewsEvidenceAdapter.toEvidence(noSentiment, { observedAt: OBSERVED });
    const keys = ev.map((e) => e.id.split(':').pop());
    expect(keys).not.toContain('sentiment_positive_ratio');
    expect(keys).not.toContain('sentiment_negative_ratio');
    expect(keys).toContain('avg_rating'); // other measured evidence still present
  });

  it('never fabricates: omits missing metrics, values trace to input', () => {
    const sparse: ReputationEvidenceInput = {
      subjectId: 'c', avgRating: 4.0, reviewCount: 10, sourceCount: 1, verifiedReviews: null,
      recentReviews: null, reviewVelocityPerDay: null, sentimentPositiveRatio: null,
      sentimentNegativeRatio: null, responseRate: null, avgResponseHours: null, ownerResponses: null,
      ratingSpread: 0, reviewParity: 1, freshnessHours: null, observedAt: OBSERVED,
      providerReliability: 0.85, contributingSources: ['google'],
    };
    const ev = reviewsEvidenceAdapter.toEvidence(sparse, { observedAt: OBSERVED });
    const keys = ev.map((e) => e.id.split(':').pop());
    expect(keys).toContain('avg_rating');
    expect(keys).toContain('review_parity');
    expect(keys).not.toContain('verified_reviews');
    expect(keys).not.toContain('response_rate');
    expect(keys).not.toContain('review_velocity');
  });

  it('is deterministic', () => {
    expect(reviewsEvidenceAdapter.toEvidence(input, {})).toEqual(reviewsEvidenceAdapter.toEvidence(input, {}));
  });

  it('maps failure to canonical Evidence (no silent failure, null value)', () => {
    const ev = reviewsEvidenceAdapter.onFailure({
      providerId: 'reviews', state: PROVIDER_FAILURE.QUOTA_EXCEEDED,
      reason: 'rate limited', evidenceKey: 'avg_rating', observedAt: OBSERVED,
    });
    expect(ev).toHaveLength(1);
    expect(ev[0].value).toBeNull();
    expect(ev[0].maturity).toBe('UNAVAILABLE');
    expect((ev[0].metadata as any).reason_code).toBe('PROVIDER_QUOTA_EXCEEDED');
  });

  it('exposes exactly the declared reputation evidence keys', () => {
    expect(reviewsEvidenceAdapter.supportedEvidence).toEqual([...REVIEWS_EVIDENCE_KEYS]);
  });
});

describe('Reputation Provider — deterministic multi-provider consolidation (Phase 6)', () => {
  it('single provider passes through', () => {
    const c = consolidateReviewSources([{ source: 'google', averageRating: 4.5, reviewCount: 100 }], OBSERVED);
    expect(c.avgRating).toBe(4.5);
    expect(c.reviewCount).toBe(100);
    expect(c.sourceCount).toBe(1);
    expect(c.ratingSpread).toBe(0);
    expect(c.reviewParity).toBe(1);
  });

  it('multiple providers: review-count-weighted rating, summed counts, source coverage', () => {
    const sources: ReviewSourcePayload[] = [
      { source: 'google', averageRating: 4.6, reviewCount: 300, verifiedCount: 300, recentReviews: 30 },
      { source: 'trustpilot', averageRating: 4.0, reviewCount: 100, verifiedCount: 90, recentReviews: 10 },
      { source: 'g2', averageRating: 3.0, reviewCount: 100, verifiedCount: 100, recentReviews: 20 },
    ];
    const c = consolidateReviewSources(sources, OBSERVED);
    // weighted: (4.6*300 + 4.0*100 + 3.0*100)/500 = (1380+400+300)/500 = 2080/500 = 4.16
    expect(c.avgRating).toBeCloseTo(4.16, 5);
    expect(c.reviewCount).toBe(500);
    expect(c.verifiedReviews).toBe(490);
    expect(c.recentReviews).toBe(60);
    expect(c.sourceCount).toBe(3);
  });

  it('surfaces provider disagreement deterministically via rating spread + parity', () => {
    const sources: ReviewSourcePayload[] = [
      { source: 'google', averageRating: 4.8, reviewCount: 100 },
      { source: 'glassdoor', averageRating: 2.3, reviewCount: 100 },
    ];
    const c = consolidateReviewSources(sources, OBSERVED);
    expect(c.ratingSpread).toBeCloseTo(2.5, 5); // 4.8 - 2.3
    expect(c.reviewParity).toBeCloseTo(0.5, 5); // 1 - 2.5/5
  });

  it('de-duplicates duplicate source keys (last wins) and drops empty/unavailable sources', () => {
    const sources: ReviewSourcePayload[] = [
      { source: 'google', averageRating: 4.0, reviewCount: 50 },
      { source: 'google', averageRating: 4.5, reviewCount: 200 }, // duplicate key → this one wins
      { source: 'yelp' }, // no signal → dropped
    ];
    const c = consolidateReviewSources(sources, OBSERVED);
    expect(c.sourceCount).toBe(1); // yelp dropped, google de-duped
    expect(c.avgRating).toBe(4.5);
    expect(c.reviewCount).toBe(200);
  });

  it('consolidates sentiment only from sources that supplied it (never generated)', () => {
    const withSent: ReviewSourcePayload[] = [
      { source: 'google', averageRating: 4.2, reviewCount: 100, sentimentPositive: 70, sentimentNegative: 10, sentimentNeutral: 20 },
      { source: 'trustpilot', averageRating: 4.0, reviewCount: 100 }, // no sentiment
    ];
    const c = consolidateReviewSources(withSent, OBSERVED);
    expect(c.sentimentPositiveRatio).toBeCloseTo(0.7, 5); // 70/100
    expect(c.sentimentNegativeRatio).toBeCloseTo(0.1, 5);

    const noSent = consolidateReviewSources([{ source: 'g2', averageRating: 4.1, reviewCount: 50 }], OBSERVED);
    expect(noSent.sentimentPositiveRatio).toBeNull(); // never fabricated
  });

  it('empty source list yields a null consolidation (no fabrication)', () => {
    const c = consolidateReviewSources([], OBSERVED);
    expect(c.sourceCount).toBeNull();
    expect(c.avgRating).toBeNull();
    expect(c.contributingSources).toEqual([]);
  });
});

describe('Reputation Provider — availability + failure governance (bridge)', () => {
  const saved = { ...process.env };
  afterEach(() => { process.env = { ...saved }; __clearProviderRegistry(); });

  it('is UNAVAILABLE without credentials (backward compatible)', () => {
    delete process.env.REVIEWS_API_KEY;
    expect(isReputationProviderConfigured()).toBe(false);
    const d = registerReputationProvider();
    expect(d.authStatus).toBe('unauthenticated');
    expect(d.connectionStatus).toBe('disconnected');
    expect(isReputationProviderAvailable()).toBe(false);
  });

  it('flips to authenticated/connected when a credential is present', () => {
    process.env.REVIEWS_API_KEY = 'test-key';
    const d = registerReputationProvider();
    expect(d.authStatus).toBe('authenticated');
    expect(d.connectionStatus).toBe('connected');
    expect(isReputationProviderAvailable()).toBe(true);
    expect(reputationProviderReliability()).toBe(0.85);
  });

  it('fetch without credentials returns canonical UNAVAILABLE evidence (no network, no DB, no fabrication)', () => {
    delete process.env.REVIEWS_API_KEY;
    const ev = fetchReputationEvidence('company-1', null, OBSERVED);
    expect(ev).toHaveLength(1);
    expect(ev[0].maturity).toBe('UNAVAILABLE');
    expect(ev[0].value).toBeNull();
    expect((ev[0].metadata as any).failure_state).toBe(PROVIDER_FAILURE.UNAVAILABLE);
  });

  it('connected-but-empty-history returns UNAVAILABLE evidence (never fabricated trust)', () => {
    process.env.REVIEWS_API_KEY = 'test-key';
    const ev = fetchReputationEvidence('company-1', [], OBSERVED);
    expect(ev).toHaveLength(1);
    expect(ev[0].maturity).toBe('UNAVAILABLE');
    expect((ev[0].metadata as any).failure_state).toBe(PROVIDER_FAILURE.UNAVAILABLE);
  });

  it('connected with sources converts through the canonical adapter to MEASURED evidence', () => {
    process.env.REVIEWS_API_KEY = 'test-key';
    registerReputationProvider();
    const ev = fetchReputationEvidence('company-1', [
      { source: 'google', averageRating: 4.4, reviewCount: 120, verifiedCount: 110 },
      { source: 'trustpilot', averageRating: 4.1, reviewCount: 80 },
    ], OBSERVED);
    const rating = ev.find((e) => e.id.endsWith(':avg_rating'))!;
    expect(rating.maturity).toBe('MEASURED');
    const sourceCount = ev.find((e) => e.id.endsWith(':review_source_count'))!;
    expect(sourceCount.value).toBe(2);
  });
});
