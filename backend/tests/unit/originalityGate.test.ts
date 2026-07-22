/**
 * Wave 2 — Originality Gate contract tests.
 *
 * Exercises the REAL gate + REAL fingerprint/similarity primitives against a
 * MOCKED content-memory service, proving the staged cascade, early termination,
 * fail-open behavior, and the embedding-stage flag gate. Mocking the memory
 * module keeps supabase/env entirely out of the unit under test.
 */

// Mock the durable memory layer — only retrieveRelevant matters to the gate.
jest.mock('../../services/content/contentMemoryService', () => ({
  retrieveRelevant: jest.fn(),
  indexContentUnit: jest.fn(),
  persistOriginality: jest.fn(),
  getBrandMemory: jest.fn(),
  upsertBrandMemory: jest.fn(),
}));

import { computeFingerprint } from '../../../lib/content/originality/fingerprint';
import type { ContentMemoryRecord } from '../../services/content/contentMemoryService';
import { retrieveRelevant } from '../../services/content/contentMemoryService';
import { assertOriginality } from '../../services/content/originalityGate';

const mockRetrieve = retrieveRelevant as jest.MockedFunction<typeof retrieveRelevant>;

/** Build a ContentMemoryRecord from text, mirroring how indexing stores it. */
function recordFor(
  id: string,
  text: string,
  overrides: Partial<ContentMemoryRecord> = {},
): ContentMemoryRecord {
  const fp = computeFingerprint(text);
  return {
    id,
    companyId: 'co-1',
    contentId: null,
    campaignId: null,
    contentType: 'post',
    platform: null,
    lifecycleStatus: 'published',
    exactHash: fp.exactHash,
    normalizedHash: fp.normalizedHash,
    simhash: fp.simhash,
    minhash: fp.minhash,
    structuralShape: fp.structuralShape,
    tokenSummary: fp.tokenSummary,
    embedding: null,
    intelligence: null,
    textExcerpt: text.slice(0, 280),
    createdAt: '2026-07-18T00:00:00.000Z',
    ...overrides,
  };
}

const base = {
  companyId: 'co-1',
  contentType: 'post',
};

beforeEach(() => {
  mockRetrieve.mockReset();
});

describe('assertOriginality — staged cascade', () => {
  test('identical candidate → duplicate, early-terminates at the exact stage', async () => {
    const text = 'Our new AI platform helps busy teams write better content faster.';
    mockRetrieve.mockResolvedValue([recordFor('mem-1', text)]);

    const result = await assertOriginality({ ...base, candidateText: text });

    expect(result.decision).toBe('duplicate');
    expect(result.isOriginal).toBe(false);
    expect(result.score).toBe(0);
    expect(result.nearestMatches[0]).toMatchObject({ memoryId: 'mem-1', dimension: 'exact' });
    // Early termination proof: only the exact axis was ever evaluated.
    expect(Object.keys(result.dimensions)).toEqual(['exact']);
    expect(result.dimensions.semantic).toBeUndefined();
    expect(result.dimensions.structural).toBeUndefined();
  });

  test('paraphrase / near-duplicate → duplicate at the token/simhash stage', async () => {
    const remembered = 'Our new AI platform helps busy teams write better content faster.';
    // High token overlap (one extra trailing word) but not byte-identical.
    const candidate = 'Our new AI platform helps busy teams write better content faster today.';
    mockRetrieve.mockResolvedValue([recordFor('mem-2', remembered)]);

    const result = await assertOriginality({ ...base, candidateText: candidate });

    expect(result.decision).toBe('duplicate');
    expect(result.isOriginal).toBe(false);
    // Not an exact/normalized hit — it was caught by a fuzzy (semantic) stage.
    expect(result.nearestMatches[0].dimension).toBe('semantic');
    expect(result.nearestMatches[0].memoryId).toBe('mem-2');
    expect(result.dimensions.exact).toBeUndefined();
  });

  test('unrelated candidate → accepted, original', async () => {
    const remembered = 'A cozy recipe for chocolate chip cookies with toasted walnuts.';
    const candidate = 'Quarterly revenue exceeded forecasts across every enterprise region.';
    mockRetrieve.mockResolvedValue([recordFor('mem-3', remembered)]);

    const result = await assertOriginality({ ...base, candidateText: candidate });

    expect(result.decision).toBe('accepted');
    expect(result.isOriginal).toBe(true);
    expect(result.score).toBeGreaterThanOrEqual(0.82);
  });

  test('empty memory → accepted, original', async () => {
    mockRetrieve.mockResolvedValue([]);
    const result = await assertOriginality({ ...base, candidateText: 'Anything at all.' });
    expect(result.decision).toBe('accepted');
    expect(result.isOriginal).toBe(true);
    expect(result.nearestMatches).toEqual([]);
  });
});

describe('assertOriginality — fail-open', () => {
  test('memory retrieval throws → bypassed, original (never throws)', async () => {
    mockRetrieve.mockRejectedValue(new Error('db down'));

    const result = await assertOriginality({ ...base, candidateText: 'Some candidate text.' });

    expect(result.decision).toBe('bypassed');
    expect(result.isOriginal).toBe(true);
    expect(result.score).toBe(1);
    expect(result.nearestMatches).toEqual([]);
    // The fingerprint is still populated for downstream persistence.
    expect(result.fingerprint.exactHash).toBe(computeFingerprint('Some candidate text.').exactHash);
  });
});

describe('assertOriginality — embedding stage flag gate', () => {
  test('embedding stage is skipped when no embed() is provided', async () => {
    const remembered = 'A cozy recipe for chocolate chip cookies with toasted walnuts.';
    const candidate = 'Quarterly revenue exceeded forecasts across every enterprise region.';
    mockRetrieve.mockResolvedValue([
      recordFor('mem-4', remembered, { embedding: [0.1, 0.2, 0.3] }),
    ]);

    // embeddingEnabled true but NO embed function ⇒ stage must not run.
    const result = await assertOriginality({
      ...base,
      candidateText: candidate,
      options: { embeddingEnabled: true },
    });

    expect(result.dimensions.embedding).toBeUndefined();
    expect('embedding' in result.dimensions).toBe(false);
  });

  test('embedding stage runs only when embed() is injected', async () => {
    const remembered = 'A cozy recipe for chocolate chip cookies with toasted walnuts.';
    const candidate = 'Quarterly revenue exceeded forecasts across every enterprise region.';
    const embed = jest.fn(async () => [1, 0, 0]);
    mockRetrieve.mockResolvedValue([
      recordFor('mem-5', remembered, { embedding: [1, 0, 0] }),
    ]);

    const result = await assertOriginality({
      ...base,
      candidateText: candidate,
      options: { embeddingEnabled: true, embed },
    });

    expect(embed).toHaveBeenCalledTimes(1);
    // Identical embeddings ⇒ cosine 1 ⇒ embedding stage confidently duplicates.
    expect(result.decision).toBe('duplicate');
    expect(result.nearestMatches[0].dimension).toBe('embedding');
  });
});
