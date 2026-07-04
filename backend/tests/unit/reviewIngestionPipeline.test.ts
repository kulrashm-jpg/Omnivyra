/**
 * BETA-REPORT-EXEC-003 — Canonical review-ingestion pipeline (Trust Activation).
 *
 * Proves the full chain end-to-end — ingest → persist → loader → ReviewAggregator → TrustCoherenceAdapter →
 * trust_coherence — and that every failure/empty/unauthenticated path degrades gracefully (trust unchanged),
 * with deterministic reload and no fabricated reviews/ratings/sentiment. In-memory store; no DB; no clock.
 */
import {
  TrustCoherenceAdapter,
  registerReviewAggregator,
} from '../../services/intelligence/adapters/trustCoherenceAdapter';
import {
  createReputationReviewAggregator,
  registerReviewSourceLoader,
} from '../../services/intelligence/adapters/reputationReviewAggregator';
import {
  ingestReviewSources,
  loadReviewSourceSnapshot,
  createCanonicalReviewSourceLoader,
  setReviewSourceStore,
  subjectKeyFor,
} from '../../services/reviewIngestionService';
import { InMemoryReviewSourceStore, type ReviewSourceStore } from '../../services/reviewSourceRepository';
import type { ReviewSourcePayload } from '../../services/reputationProviderBridge';

const OBSERVED = '2026-02-01T12:00:00.000Z';
const SUBJECT = 'acme.com';
const params = { brandName: 'Acme', domain: 'https://www.acme.com/pricing' };

const SOURCES: ReviewSourcePayload[] = [
  { source: 'google', averageRating: 4.6, reviewCount: 120, lastReviewAt: '2026-01-30T00:00:00.000Z' },
  { source: 'trustpilot', averageRating: 4.5, reviewCount: 80 },
  { source: 'g2', averageRating: 4.7, reviewCount: 40 },
];

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

const CONFIGURED = { TRUST_COHERENCE_ENABLED: 'true', REVIEWS_API_KEY: 'k' };

function wireInMemory(): InMemoryReviewSourceStore {
  const store = new InMemoryReviewSourceStore();
  setReviewSourceStore(store);
  registerReviewSourceLoader(createCanonicalReviewSourceLoader());
  registerReviewAggregator(createReputationReviewAggregator());
  return store;
}

afterEach(() => {
  registerReviewSourceLoader(null);
});

describe('BETA-REPORT-EXEC-003 — subject key normalization', () => {
  it('normalizes domain (protocol/www/path stripped); falls back to brand', () => {
    expect(subjectKeyFor('https://www.acme.com/pricing?x=1', 'Acme')).toBe('acme.com');
    expect(subjectKeyFor(null, 'Acme Co')).toBe('acme co');
    expect(subjectKeyFor(null, null)).toBeNull();
  });
});

describe('BETA-REPORT-EXEC-003 — end-to-end trust activation', () => {
  it('ingest → loader → aggregator → TrustCoherence upgrades to measured', withEnv(CONFIGURED, async () => {
    wireInMemory();
    const res = await ingestReviewSources(SUBJECT, SOURCES, OBSERVED);
    expect(res.ok).toBe(true);
    expect(res.persisted).toBe(3);
    expect(res.evidence.length).toBeGreaterThan(0); // canonical Evidence produced (provider traceability)

    const trust = await new TrustCoherenceAdapter().lookup(params);
    expect(trust.state).toBe('measured');
    expect(trust.signals?.review_source_count).toBe(3);
    expect(trust.score).not.toBeNull();
    expect(trust.score!).toBeGreaterThan(0);
  }));

  it('reloads deterministically and is idempotent (latest snapshot wins)', withEnv(CONFIGURED, async () => {
    wireInMemory();
    await ingestReviewSources(SUBJECT, SOURCES, OBSERVED);
    const a = await loadReviewSourceSnapshot(SUBJECT);
    const b = await loadReviewSourceSnapshot(SUBJECT);
    expect(b).toEqual(a);
    // re-ingest same subject → replace, count stays stable
    await ingestReviewSources(SUBJECT, SOURCES, OBSERVED);
    const c = await loadReviewSourceSnapshot(SUBJECT);
    expect(c?.sources.length).toBe(3);

    const t1 = await new TrustCoherenceAdapter().lookup(params);
    const t2 = await new TrustCoherenceAdapter().lookup(params);
    expect(t2.score).toBe(t1.score);
    expect(t2.signals).toEqual(t1.signals);
  }));
});

describe('BETA-REPORT-EXEC-003 — failure governance (graceful degradation)', () => {
  it('no reviews ingested → loader null → trust unavailable', withEnv(CONFIGURED, async () => {
    wireInMemory();
    const trust = await new TrustCoherenceAdapter().lookup(params);
    expect(trust.state).toBe('unavailable');
  }));

  it('no REVIEWS_API_KEY → loader null even with ingested data → trust unavailable', withEnv(
    { TRUST_COHERENCE_ENABLED: 'true', REVIEWS_API_KEY: undefined },
    async () => {
      // ingest under configured env first, then verify unavailability when the credential is absent
      const store = new InMemoryReviewSourceStore();
      setReviewSourceStore(store);
      await store.save(SUBJECT, { sources: SOURCES, observedAt: OBSERVED });
      registerReviewSourceLoader(createCanonicalReviewSourceLoader());
      registerReviewAggregator(createReputationReviewAggregator());
      const trust = await new TrustCoherenceAdapter().lookup(params);
      expect(trust.state).toBe('unavailable');
    },
  ));

  it('unauthenticated/synthetic sources are dropped; nothing persisted → trust unavailable', withEnv(CONFIGURED, async () => {
    wireInMemory();
    const junk: ReviewSourcePayload[] = [
      { source: 'blog', averageRating: null, reviewCount: null },
      { source: '', averageRating: 5, reviewCount: 10 }, // no source key
    ];
    const res = await ingestReviewSources(SUBJECT, junk, OBSERVED);
    expect(res.persisted).toBe(0); // no fabrication — nothing usable stored
    const trust = await new TrustCoherenceAdapter().lookup(params);
    expect(trust.state).toBe('unavailable');
  }));

  it('partial data (rating without count) still ingests the authenticated source', withEnv(CONFIGURED, async () => {
    wireInMemory();
    const res = await ingestReviewSources(SUBJECT, [{ source: 'google', averageRating: 4.2 }], OBSERVED);
    expect(res.persisted).toBe(1);
    const trust = await new TrustCoherenceAdapter().lookup(params);
    expect(trust.state).toBe('measured');
    expect(trust.signals?.review_source_count).toBe(1);
  }));

  it('persistence failure surfaces ok:false without throwing; loader null → trust unchanged', withEnv(CONFIGURED, async () => {
    const brokenStore: ReviewSourceStore = {
      save: async () => ({ ok: false, error: 'relation "review_sources" does not exist' }),
      load: async () => null,
    };
    setReviewSourceStore(brokenStore);
    registerReviewSourceLoader(createCanonicalReviewSourceLoader());
    registerReviewAggregator(createReputationReviewAggregator());
    const res = await ingestReviewSources(SUBJECT, SOURCES, OBSERVED);
    expect(res.ok).toBe(false); // guarded — no throw
    const trust = await new TrustCoherenceAdapter().lookup(params);
    expect(trust.state).toBe('unavailable');
  }));
});
