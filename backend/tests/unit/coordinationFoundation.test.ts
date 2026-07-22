/**
 * Coordination Intelligence Layer — foundation tests (OMNIVYRA-PMO-001 Zone A2).
 *
 * Exercises the canonical registry, semantic duplicate-INTENT detection, tenant
 * isolation, lifecycle, and the "never fabricate uniqueness" guarantee. Uses the
 * in-memory store + inert comparator with caller-supplied embeddings, so the math
 * is deterministic and the frozen embedding seam is never called.
 */
import {
  createInMemoryCommunicationRegistry,
  evaluateDuplicateIntent,
  deriveSemanticRootId,
  inertComparator,
  DUPLICATE_INTENT_THRESHOLD,
  RELATED_INTENT_THRESHOLD,
  type RegisterCommunicationInput,
  type SemanticEmbeddingRef,
} from '../../services/intelligence/coordination';

const emb = (vector: number[]): SemanticEmbeddingRef => ({ provider: 'test', dim: vector.length, vector });
const fixedNow = () => '2026-07-20T00:00:00.000Z';

const base = (over: Partial<RegisterCommunicationInput> = {}): RegisterCommunicationInput => ({
  companyId: 'company-A',
  communicationIntent: 'promote',
  topic: 'launch new pricing tiers',
  campaignId: 'camp-1',
  sourceModule: 'campaigns',
  ...over,
});

describe('coordination foundation — CommunicationRegistry', () => {
  it('registers a communication and reads it back (tenant-scoped)', async () => {
    const reg = createInMemoryCommunicationRegistry({ comparator: inertComparator, now: fixedNow });
    const r = await reg.register(base());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.semanticRootId).toMatch(/^sroot_/);
    expect(r.value.publicationStatus).toBe('planned');
    expect(r.value.observedAt).toBe('2026-07-20T00:00:00.000Z');

    const list = await reg.lookup('company-A');
    expect(list.ok).toBe(true);
    if (list.ok) expect(list.value).toHaveLength(1);
  });

  it('requires a tenant (companyId) — never a cross-tenant default', async () => {
    const reg = createInMemoryCommunicationRegistry({ comparator: inertComparator });
    const r = await reg.register(base({ companyId: '' }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('TENANT_REQUIRED');

    const l = await reg.lookup('');
    expect(l.ok).toBe(false);
  });

  it('isolates tenants — company B never sees company A', async () => {
    const reg = createInMemoryCommunicationRegistry({ comparator: inertComparator });
    await reg.register(base({ companyId: 'company-A' }));
    const bList = await reg.lookup('company-B');
    expect(bList.ok).toBe(true);
    if (bList.ok) expect(bList.value).toHaveLength(0);
  });

  it('detects duplicate INTENT deterministically via shared semantic root', async () => {
    const reg = createInMemoryCommunicationRegistry({ comparator: inertComparator });
    await reg.register(base()); // no embedding supplied → root tier only
    const verdict = await reg.checkDuplicateIntent(base()); // identical intent+campaign+topic ⇒ same root
    expect(verdict.ok).toBe(true);
    if (!verdict.ok) return;
    expect(verdict.value.decision).toBe('duplicate_intent');
    expect(verdict.value.basis).toBe('root_id');
  });

  it('detects duplicate INTENT semantically via embedding cosine (different wording, same intent)', async () => {
    const reg = createInMemoryCommunicationRegistry({ comparator: inertComparator });
    await reg.register(base({ topic: 'we are raising prices next month', embedding: emb([1, 0, 0]) }));
    const verdict = await reg.checkDuplicateIntent(
      base({ topic: 'pricing goes up in April', embedding: emb([1, 0, 0]) }), // different root, identical vector
    );
    expect(verdict.ok).toBe(true);
    if (!verdict.ok) return;
    expect(verdict.value.basis).toBe('embedding');
    expect(verdict.value.decision).toBe('duplicate_intent');
    expect(verdict.value.maxSimilarity).toBeGreaterThanOrEqual(DUPLICATE_INTENT_THRESHOLD);
  });

  it('degrades to not_evaluable when it cannot compare semantically (never fabricates uniqueness)', async () => {
    const reg = createInMemoryCommunicationRegistry({ comparator: inertComparator });
    // Prior exists, different topic ⇒ different root, and neither carries an embedding.
    await reg.register(base({ topic: 'topic one', embedding: null }));
    const verdict = await reg.checkDuplicateIntent(base({ topic: 'a totally different topic', embedding: null }));
    expect(verdict.ok).toBe(true);
    if (!verdict.ok) return;
    expect(verdict.value.decision).toBe('not_evaluable');
    expect(verdict.value.maxSimilarity).toBeNull();
  });

  it('advances lifecycle via markStatus', async () => {
    const reg = createInMemoryCommunicationRegistry({ comparator: inertComparator });
    const r = await reg.register(base());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const m = await reg.markStatus('company-A', r.value.id, 'published');
    expect(m.ok).toBe(true);
    const list = await reg.lookup('company-A');
    if (list.ok) expect(list.value[0].publicationStatus).toBe('published');
  });
});

describe('coordination foundation — evaluateDuplicateIntent (pure)', () => {
  const rec = (over: Partial<{ id: string; semanticRootId: string; vector: number[] | null }>) => ({
    id: over.id ?? 'r1',
    companyId: 'c',
    semanticRootId: over.semanticRootId ?? 'sroot_x',
    communicationIntent: 'promote' as const,
    topic: 't',
    publicationStatus: 'planned' as const,
    embedding: over.vector === undefined ? null : (over.vector ? emb(over.vector) : null),
    sourceModule: 'unknown' as const,
    observedAt: '2026-07-20T00:00:00.000Z',
  });

  it('is trivially unique with no priors', () => {
    const v = evaluateDuplicateIntent({
      candidate: { semanticRootId: 'sroot_a', communicationIntent: 'promote', embedding: [1, 0] },
      existing: [],
      comparator: inertComparator,
    });
    expect(v.decision).toBe('unique');
    expect(v.basis).toBe('none');
  });

  it('classifies related (adjacent) intent between the floors', () => {
    const v = evaluateDuplicateIntent({
      candidate: { semanticRootId: 'sroot_a', communicationIntent: 'promote', embedding: [1, 0] },
      existing: [rec({ semanticRootId: 'sroot_b', vector: [0.8, 0.6] })], // cosine 0.8
      comparator: inertComparator,
    });
    expect(v.decision).toBe('related');
    expect(v.maxSimilarity!).toBeGreaterThanOrEqual(RELATED_INTENT_THRESHOLD);
    expect(v.maxSimilarity!).toBeLessThan(DUPLICATE_INTENT_THRESHOLD);
  });

  it('classifies unique when similarity is below the related floor', () => {
    const v = evaluateDuplicateIntent({
      candidate: { semanticRootId: 'sroot_a', communicationIntent: 'promote', embedding: [1, 0] },
      existing: [rec({ semanticRootId: 'sroot_b', vector: [0, 1] })], // cosine 0
      comparator: inertComparator,
    });
    expect(v.decision).toBe('unique');
    expect(v.basis).toBe('embedding');
  });
});

describe('coordination foundation — deriveSemanticRootId', () => {
  it('is deterministic and stable for the same intent signature', () => {
    const a = deriveSemanticRootId({ companyId: 'c', communicationIntent: 'promote', campaignId: 'x', topic: 'Launch  New Pricing!' });
    const b = deriveSemanticRootId({ companyId: 'c', communicationIntent: 'promote', campaignId: 'x', topic: 'launch new pricing' });
    expect(a).toBe(b); // normalization collapses case/punctuation/whitespace
    expect(a).toMatch(/^sroot_[0-9a-f]{24}$/);
  });

  it('differs across companies (tenant-partitioned roots)', () => {
    const a = deriveSemanticRootId({ companyId: 'c1', communicationIntent: 'promote', topic: 't' });
    const b = deriveSemanticRootId({ companyId: 'c2', communicationIntent: 'promote', topic: 't' });
    expect(a).not.toBe(b);
  });
});
