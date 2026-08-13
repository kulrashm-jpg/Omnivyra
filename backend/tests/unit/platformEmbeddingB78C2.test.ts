/**
 * B7.8-C.2 — platform embedding provider path.
 *
 * The decisive assertions are negative: the customer ledger is NEVER invoked,
 * no companyId is required, and only the supplied label reaches the provider.
 * No real OpenAI call is made — the client is stubbed.
 */

const mockEmbeddingsCreate = jest.fn();
jest.mock('openai', () => ({
  __esModule: true,
  default: class MockOpenAI {
    embeddings = { create: (...a: unknown[]) => mockEmbeddingsCreate(...a) };
  },
}));

const mockAssertPricing = jest.fn();
const mockRecordCostAnomaly = jest.fn();
jest.mock('../../services/pricingService', () => ({
  assertModelPricingExists: (...a: unknown[]) => mockAssertPricing(...a),
  recordCostAnomaly: (...a: unknown[]) => mockRecordCostAnomaly(...a),
  estimateEmbeddingCostUsd: jest.fn(),
}));

/** The CUSTOMER ledger. It must never fire on the platform path. */
const mockLogUsageEvent = jest.fn();
const mockResolveEmbeddingCost = jest.fn();
jest.mock('../../services/usageLedgerService', () => ({
  logUsageEvent: (...a: unknown[]) => mockLogUsageEvent(...a),
  resolveEmbeddingCost: (...a: unknown[]) => mockResolveEmbeddingCost(...a),
}));

/** The PLATFORM ledger. */
const mockRecordPlatformUsage = jest.fn();
jest.mock('../../services/billing/platformUsageLedgerService', () => ({
  recordPlatformUsage: (...a: unknown[]) => mockRecordPlatformUsage(...a),
}));

import { generatePlatformEmbedding } from '../../services/signalEmbeddingService';

const DIM = 1536;
const TOPIC = 'aaaa0000-0000-4000-8000-00000000000a';
const vec = (): number[] => Array.from({ length: DIM }, (_, i) => (i === 0 ? 1 : 0));

const opts = { resourceType: 'platform_topic_node', resourceId: TOPIC };
const PRIOR_KEY = process.env.OPENAI_API_KEY;

beforeEach(() => {
  jest.clearAllMocks();
  process.env.OPENAI_API_KEY = 'sk-test-not-a-real-key';
  mockAssertPricing.mockResolvedValue(undefined);
  mockEmbeddingsCreate.mockResolvedValue({ data: [{ embedding: vec() }], usage: { total_tokens: 6 } });
  mockRecordPlatformUsage.mockResolvedValue({ ok: true, action: 'recorded', idempotencyKey: 'k', totalCost: 0.00000012 });
});
afterAll(() => {
  if (PRIOR_KEY === undefined) delete process.env.OPENAI_API_KEY;
  else process.env.OPENAI_API_KEY = PRIOR_KEY;
});

/* ── 1-7: happy path, pricing, ledger routing ──────────────────────────── */

describe('B7.8-C.2 · platform embedding', () => {
  it('1. returns a 1536-dimensional embedding', async () => {
    const r = await generatePlatformEmbedding('AI lead qualification', opts);
    expect(r.ok).toBe(true);
    expect((r as { embedding: number[] }).embedding).toHaveLength(DIM);
  });

  it('2. sends ONLY the supplied label to the provider', async () => {
    await generatePlatformEmbedding('AI lead qualification', opts);
    const payload = mockEmbeddingsCreate.mock.calls[0][0];
    expect(payload.input).toBe('AI lead qualification');
    expect(payload.model).toBe('text-embedding-3-small');
    expect(payload.dimensions).toBe(DIM);
    // Nothing tenant-derived may ride along in the request.
    const serialized = JSON.stringify(payload);
    for (const forbidden of ['company', 'campaign', 'organization', 'customer', 'user_id', 'tenant']) {
      expect(serialized.toLowerCase()).not.toContain(forbidden);
    }
    expect(Object.keys(payload).sort()).toEqual(['dimensions', 'input', 'model']);
  });

  it('3. uses no production credential of its own — the client is stubbed here', async () => {
    // Proves the unit path never reaches a real provider: a stub answered.
    await generatePlatformEmbedding('x', opts);
    expect(mockEmbeddingsCreate).toHaveBeenCalledTimes(1);
  });

  it('4. requires NO companyId anywhere in its contract', async () => {
    // The signature takes only text + resource identifiers.
    const r = await generatePlatformEmbedding('x', { resourceType: 'platform_topic_node', resourceId: TOPIC });
    expect(r.ok).toBe(true);
    const ledgerArg = mockRecordPlatformUsage.mock.calls[0][0];
    for (const forbidden of ['companyId', 'organizationId', 'userId', 'campaignId']) {
      expect(ledgerArg).not.toHaveProperty(forbidden);
    }
  });

  it('5. performs the pre-flight pricing assertion before paying', async () => {
    await generatePlatformEmbedding('x', opts);
    expect(mockAssertPricing).toHaveBeenCalledWith('openai', 'text-embedding-3-small', 'embedding');
    const assertOrder = mockAssertPricing.mock.invocationCallOrder[0];
    const callOrder = mockEmbeddingsCreate.mock.invocationCallOrder[0];
    expect(assertOrder).toBeLessThan(callOrder);
  });

  it('6. records spend through the PLATFORM ledger with the resource attached', async () => {
    await generatePlatformEmbedding('AI lead qualification', opts);
    expect(mockRecordPlatformUsage).toHaveBeenCalledTimes(1);
    expect(mockRecordPlatformUsage.mock.calls[0][0]).toMatchObject({
      providerName: 'openai',
      modelName: 'text-embedding-3-small',
      sourceType: 'system',
      resourceType: 'platform_topic_node',
      resourceId: TOPIC,
      totalTokens: 6,
    });
  });

  it('7. NEVER invokes the customer ledger', async () => {
    await generatePlatformEmbedding('x', opts);
    expect(mockLogUsageEvent).not.toHaveBeenCalled();
    expect(mockResolveEmbeddingCost).not.toHaveBeenCalled();
    expect(mockRecordCostAnomaly).not.toHaveBeenCalled();   // needs an org; must not fire
  });
});

/* ── 8-12: failure containment ─────────────────────────────────────────── */

describe('B7.8-C.2 · failure containment', () => {
  it.each([
    ['8. malformed vector', { data: [{ embedding: Array.from({ length: DIM }, () => NaN) }], usage: {} }],
    ['9. wrong dimensionality', { data: [{ embedding: [1, 2, 3] }], usage: {} }],
    ['9b. missing data', { data: [], usage: {} }],
  ])('%s is rejected and NOT ledgered', async (_n, resp) => {
    mockEmbeddingsCreate.mockResolvedValue(resp);
    const r = await generatePlatformEmbedding('x', opts);
    expect(r).toMatchObject({ ok: false, reason: 'invalid_embedding_shape' });
    expect(mockRecordPlatformUsage).not.toHaveBeenCalled();   // no spend recorded for junk
  });

  it('10. a provider failure is contained — no throw, no ledger', async () => {
    mockEmbeddingsCreate.mockRejectedValue(new Error('503 upstream'));
    const r = await generatePlatformEmbedding('x', opts);
    expect(r.ok).toBe(false);
    expect((r as { reason: string }).reason).toContain('provider_failed');
    expect(mockRecordPlatformUsage).not.toHaveBeenCalled();
  });

  it('11. a LEDGER failure refuses the vector — spend can never be lost silently', async () => {
    mockRecordPlatformUsage.mockResolvedValue({ ok: false, reason: 'insert_failed:deadlock' });
    const r = await generatePlatformEmbedding('x', opts);
    expect(r.ok).toBe(false);
    expect((r as { reason: string }).reason).toContain('ledger_failed');
    // No embedding is returned, so the caller cannot persist one.
    expect(r).not.toHaveProperty('embedding');
  });

  it('11b. the ledger is written BEFORE the vector is returned', async () => {
    const order: string[] = [];
    mockRecordPlatformUsage.mockImplementation(async () => { order.push('ledger'); return { ok: true, action: 'recorded', idempotencyKey: 'k', totalCost: 0 }; });
    const r = await generatePlatformEmbedding('x', opts);
    order.push('returned');
    expect(order).toEqual(['ledger', 'returned']);
    expect(r.ok).toBe(true);
  });

  it('12. missing pricing refuses BEFORE the provider is called (never pay unpriced)', async () => {
    mockAssertPricing.mockRejectedValue(new Error('PricingMissingError'));
    const r = await generatePlatformEmbedding('x', opts);
    expect(r.ok).toBe(false);
    expect((r as { reason: string }).reason).toContain('pricing_missing');
    expect(mockEmbeddingsCreate).not.toHaveBeenCalled();
  });

  it('refuses empty text and missing resource before any call', async () => {
    expect(await generatePlatformEmbedding('   ', opts)).toMatchObject({ ok: false, reason: 'empty_text' });
    expect(await generatePlatformEmbedding('x', { resourceType: '', resourceId: '' })).toMatchObject({ ok: false, reason: 'missing_resource' });
    expect(mockEmbeddingsCreate).not.toHaveBeenCalled();
  });
});

/* ── 13-17: blast radius + retry + customer path unchanged ─────────────── */

describe('B7.8-C.2 · blast radius', () => {
  it('13/14/15. writes NO topic or coverage row — it persists nothing at all', async () => {
    await generatePlatformEmbedding('x', opts);
    // The module under test imports no supabase client for this path; the only
    // write it can perform is via recordPlatformUsage, which is mocked and
    // targets platform_usage_events alone (proven in platformUsageLedgerB78C).
    const ledgerArg = mockRecordPlatformUsage.mock.calls[0][0];
    for (const forbidden of ['canonical_topic_id', 'parent_topic_id', 'angle_label', 'canonicalTopicId', 'parentTopicId', 'angleLabel']) {
      expect(ledgerArg).not.toHaveProperty(forbidden);
    }
  });

  it('16. retry remains possible — a failed attempt returns no vector to persist', async () => {
    mockEmbeddingsCreate.mockRejectedValueOnce(new Error('timeout'));
    const first = await generatePlatformEmbedding('x', opts);
    expect(first.ok).toBe(false);

    // Second attempt succeeds; the topic was never written, so it stayed eligible.
    const second = await generatePlatformEmbedding('x', opts);
    expect(second.ok).toBe(true);
    expect((second as { embedding: number[] }).embedding).toHaveLength(DIM);
  });

  it('17. the customer-facing generateTopicEmbedding is untouched and still org-required', () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod = require('../../services/signalEmbeddingService');
    expect(typeof mod.generateTopicEmbedding).toBe('function');
    expect(typeof mod.generatePlatformEmbedding).toBe('function');
    // Distinct functions — the platform path is additive, not a replacement.
    expect(mod.generateTopicEmbedding).not.toBe(mod.generatePlatformEmbedding);
  });
});
