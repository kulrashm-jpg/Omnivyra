/**
 * BETA-REPORT-EXEC-002 (Wave 1, Phase 4) — Reputation → TrustCoherence ReviewAggregator.
 *
 * Proves the one clean Evidence-Platform integration: trust_coherence upgrades to `measured` ONLY when review
 * evidence genuinely exists, reflects real cross-source agreement, and degrades gracefully (trust unchanged)
 * when the credential or ingestion is absent. The 0-100 trust math stays in the existing adapter — this only
 * supplies signals. Deterministic; no clock; no network; no fabrication.
 */
import {
  TrustCoherenceAdapter,
  registerReviewAggregator,
} from '../../services/intelligence/adapters/trustCoherenceAdapter';
import {
  createReputationReviewAggregator,
  registerReviewSourceLoader,
} from '../../services/intelligence/adapters/reputationReviewAggregator';
import type { ReviewSourcePayload } from '../../services/reputationProviderBridge';

const OBSERVED = '2026-02-01T12:00:00.000Z';
const params = { brandName: 'Acme', domain: 'acme.com' };

const withEnv = (env: Record<string, string | undefined>, fn: () => Promise<void>) => async () => {
  const saved = { ...process.env };
  for (const [k, v] of Object.entries(env)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  try {
    await fn();
  } finally {
    process.env = saved;
  }
};

const loader = (sources: ReviewSourcePayload[]) => async () => ({ observedAt: OBSERVED, sources });

afterEach(() => {
  registerReviewSourceLoader(null);
});

describe('BETA-REPORT-EXEC-002 — ReviewAggregator integration', () => {
  it('upgrades trust_coherence to measured when review sources exist', withEnv(
    { TRUST_COHERENCE_ENABLED: 'true', REVIEWS_API_KEY: 'k' },
    async () => {
      registerReviewSourceLoader(loader([
        { source: 'google', averageRating: 4.6, reviewCount: 120, lastReviewAt: '2026-01-30T00:00:00.000Z' },
        { source: 'trustpilot', averageRating: 4.5, reviewCount: 80 },
        { source: 'g2', averageRating: 4.7, reviewCount: 40 },
      ]));
      registerReviewAggregator(createReputationReviewAggregator());

      const res = await new TrustCoherenceAdapter().lookup(params);
      expect(res.state).toBe('measured');
      expect(res.signals?.review_source_count).toBe(3);
      expect(res.score).not.toBeNull();
      expect(res.score!).toBeGreaterThan(0);
    },
  ));

  it('reflects cross-source agreement: tighter parity yields higher trust contribution', withEnv(
    { TRUST_COHERENCE_ENABLED: 'true', REVIEWS_API_KEY: 'k' },
    async () => {
      const run = async (sources: ReviewSourcePayload[]) => {
        registerReviewSourceLoader(loader(sources));
        registerReviewAggregator(createReputationReviewAggregator());
        return (await new TrustCoherenceAdapter().lookup(params)).score!;
      };
      const agree = await run([
        { source: 'g', averageRating: 4.5, reviewCount: 50 },
        { source: 't', averageRating: 4.4, reviewCount: 50 },
      ]);
      const diverge = await run([
        { source: 'g', averageRating: 5.0, reviewCount: 50 },
        { source: 't', averageRating: 3.0, reviewCount: 50 },
      ]);
      expect(agree).toBeGreaterThan(diverge);
    },
  ));

  it('degrades gracefully with no REVIEWS_API_KEY (trust falls back exactly as today)', withEnv(
    { TRUST_COHERENCE_ENABLED: 'true', REVIEWS_API_KEY: undefined },
    async () => {
      registerReviewSourceLoader(loader([{ source: 'g', averageRating: 4.5, reviewCount: 10 }]));
      registerReviewAggregator(createReputationReviewAggregator());
      const res = await new TrustCoherenceAdapter().lookup(params);
      expect(res.state).toBe('unavailable'); // aggregator returns null → no sub-service → unavailable
    },
  ));

  it('stays inert when configured but no ingestion loader is registered', withEnv(
    { TRUST_COHERENCE_ENABLED: 'true', REVIEWS_API_KEY: 'k' },
    async () => {
      registerReviewSourceLoader(null);
      registerReviewAggregator(createReputationReviewAggregator());
      const res = await new TrustCoherenceAdapter().lookup(params);
      expect(res.state).toBe('unavailable');
    },
  ));

  it('is deterministic', withEnv(
    { TRUST_COHERENCE_ENABLED: 'true', REVIEWS_API_KEY: 'k' },
    async () => {
      registerReviewSourceLoader(loader([
        { source: 'g', averageRating: 4.6, reviewCount: 120 },
        { source: 't', averageRating: 4.5, reviewCount: 80 },
      ]));
      registerReviewAggregator(createReputationReviewAggregator());
      const a = await new TrustCoherenceAdapter().lookup(params);
      const b = await new TrustCoherenceAdapter().lookup(params);
      expect(a.state).toBe('measured');
      expect(b.score).toBe(a.score);
      expect(b.signals).toEqual(a.signals);
    },
  ));
});
