/**
 * EC-R2 — Campaign Content Uniqueness Enforcement contract tests.
 *
 * Exercises the REAL guard + REAL originality gate + REAL regeneration engine +
 * REAL fingerprint/similarity primitives against a MOCKED content-memory layer.
 * Mocking only the memory module keeps supabase/env out of the unit while
 * leaving every decision path genuinely executed — a duplicate is rejected here
 * by the same code that will reject it in production.
 *
 * Test IDs map to the EC-R2 brief §7.2 (A–J).
 */

jest.mock('../../services/content/contentMemoryService', () => ({
  retrieveRelevant: jest.fn(),
  indexContentUnit: jest.fn(),
  persistOriginality: jest.fn(),
  getBrandMemory: jest.fn(),
  upsertBrandMemory: jest.fn(),
}));

import { computeFingerprint } from '../../../lib/content/originality/fingerprint';
import type { ContentMemoryRecord } from '../../services/content/contentMemoryService';
import {
  retrieveRelevant,
  indexContentUnit,
  persistOriginality,
} from '../../services/content/contentMemoryService';
import {
  assertBriefNotDegenerate,
  buildCampaignNegativeContext,
  generateUniqueCampaignMaster,
  CampaignBriefDegenerateError,
  CampaignDuplicateContentError,
  DEGENERATE_BRIEF_DEFAULTS,
} from '../../services/content/campaignUniquenessGuard';

const mockRetrieve = retrieveRelevant as jest.MockedFunction<typeof retrieveRelevant>;
const mockIndex = indexContentUnit as jest.MockedFunction<typeof indexContentUnit>;
const mockPersist = persistOriginality as jest.MockedFunction<typeof persistOriginality>;

const WEEK_1_POST =
  'Most B2B teams measure pipeline weekly but review positioning yearly. ' +
  'That mismatch is why messaging drifts from what buyers actually ask in calls. ' +
  'Start by reading twenty recent discovery transcripts before touching the deck.';

const WEEK_3_NEAR_DUPLICATE =
  'Most B2B teams measure pipeline weekly but review positioning annually. ' +
  'That mismatch is why messaging drifts from what buyers really ask in calls. ' +
  'Begin by reading twenty recent discovery transcripts before touching the deck.';

const GENUINELY_DIFFERENT_POST =
  'Procurement rejected our renewal twice before we noticed the security questionnaire ' +
  'was routed to an unstaffed inbox. Three deals slipped a quarter for a mailbox rule. ' +
  'Audit every hand-off that has no owner on the org chart.';

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
    campaignId: 'camp-1',
    contentType: 'post',
    platform: null,
    lifecycleStatus: 'scheduled',
    exactHash: fp.exactHash,
    normalizedHash: fp.normalizedHash,
    simhash: fp.simhash,
    minhash: fp.minhash,
    structuralShape: fp.structuralShape,
    tokenSummary: fp.tokenSummary,
    embedding: null,
    intelligence: null,
    textExcerpt: text.slice(0, 280),
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

/** A brief carrying real campaign signal. */
function realBrief(): Record<string, unknown> {
  return {
    topic: 'Why positioning reviews lag pipeline reviews',
    intent: {
      objective: 'Show the cost of stale positioning',
      pain_point: 'Messaging drifts from buyer language',
      outcome_promise: 'A concrete review cadence',
      cta_type: 'Book a positioning teardown',
      target_audience: 'B2B revenue leaders',
    },
    writer_content_brief: { writingIntent: 'Contrarian, evidence-led' },
  };
}

/** A brief where every field collapsed to the generic defaults. */
function degenerateBrief(): Record<string, unknown> {
  return {
    topic: 'TBD',
    intent: {
      objective: DEGENERATE_BRIEF_DEFAULTS.objective,
      pain_point: DEGENERATE_BRIEF_DEFAULTS.painPoint,
      outcome_promise: DEGENERATE_BRIEF_DEFAULTS.outcomePromise,
      cta_type: DEGENERATE_BRIEF_DEFAULTS.ctaType,
      target_audience: DEGENERATE_BRIEF_DEFAULTS.targetAudience,
    },
    writer_content_brief: {},
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockRetrieve.mockResolvedValue([]);
  mockIndex.mockResolvedValue(null);
  mockPersist.mockResolvedValue({ id: 'orig-1' });
});

describe('EC-R2 · A — identical briefs must not yield accepted identical content', () => {
  it('rejects a week-3 candidate byte-identical to week-1 accepted content', async () => {
    mockRetrieve.mockResolvedValue([recordFor('mem-w1', WEEK_1_POST)]);

    await expect(
      generateUniqueCampaignMaster({
        companyId: 'co-1',
        campaignId: 'camp-1',
        contentType: 'post',
        // Every attempt returns the SAME text — exactly what a degenerate brief
        // plus an exact-key cache hit produces today.
        generate: async () => ({ text: WEEK_1_POST, result: { content: WEEK_1_POST } }),
      }),
    ).rejects.toBeInstanceOf(CampaignDuplicateContentError);

    // The duplicate must never be written to campaign memory.
    expect(mockIndex).not.toHaveBeenCalled();
  });
});

describe('EC-R2 · B — near duplicates are rejected', () => {
  it('rejects a candidate above the originality threshold', async () => {
    mockRetrieve.mockResolvedValue([recordFor('mem-w1', WEEK_1_POST)]);

    await expect(
      generateUniqueCampaignMaster({
        companyId: 'co-1',
        campaignId: 'camp-1',
        contentType: 'post',
        generate: async () => ({
          text: WEEK_3_NEAR_DUPLICATE,
          result: { content: WEEK_3_NEAR_DUPLICATE },
        }),
      }),
    ).rejects.toBeInstanceOf(CampaignDuplicateContentError);

    expect(mockIndex).not.toHaveBeenCalled();
  });
});

describe('EC-R2 · C — comparison is campaign-scoped', () => {
  it('scopes retrieval to the current campaign', async () => {
    await generateUniqueCampaignMaster({
      companyId: 'co-1',
      campaignId: 'camp-1',
      contentType: 'post',
      generate: async () => ({
        text: GENUINELY_DIFFERENT_POST,
        result: { content: GENUINELY_DIFFERENT_POST },
      }),
    });

    expect(mockRetrieve).toHaveBeenCalledWith(
      'co-1',
      expect.objectContaining({ campaignId: 'camp-1' }),
    );
  });

  it('does not reject campaign B because campaign A said something similar', async () => {
    // The gate only ever sees what retrieveRelevant returns; scoped to camp-2
    // the other campaign's memory is simply absent.
    mockRetrieve.mockResolvedValue([]);

    const outcome = await generateUniqueCampaignMaster({
      companyId: 'co-1',
      campaignId: 'camp-2',
      contentType: 'post',
      generate: async () => ({ text: WEEK_1_POST, result: { content: WEEK_1_POST } }),
    });

    expect(outcome.originality.isOriginal).toBe(true);
    expect(mockRetrieve).toHaveBeenCalledWith(
      'co-1',
      expect.objectContaining({ campaignId: 'camp-2' }),
    );
  });
});

describe('EC-R2 · D — negative context from existing campaign memory', () => {
  it('summarises prior hooks, CTAs and excerpts', async () => {
    mockRetrieve.mockResolvedValue([
      recordFor('mem-w1', WEEK_1_POST, {
        intelligence: {
          hooks: ['Most B2B teams measure pipeline weekly'],
          ctas: ['Book a positioning teardown'],
          narratives: ['positioning drift'],
          keyMessages: [],
        } as unknown as ContentMemoryRecord['intelligence'],
      }),
    ]);

    const ctx = await buildCampaignNegativeContext({
      companyId: 'co-1',
      campaignId: 'camp-1',
      contentType: 'post',
    });

    expect(ctx).toBeTruthy();
    expect(ctx).toContain('CAMPAIGN UNIQUENESS');
    expect(ctx).toContain('Most B2B teams measure pipeline weekly');
    expect(ctx).toContain('Book a positioning teardown');
    expect(ctx).toContain('positioning drift');
  });

  it('returns null when the campaign has no memory yet', async () => {
    mockRetrieve.mockResolvedValue([]);
    await expect(
      buildCampaignNegativeContext({ companyId: 'co-1', campaignId: 'camp-1' }),
    ).resolves.toBeNull();
  });

  it('is fail-safe when memory retrieval throws', async () => {
    mockRetrieve.mockRejectedValue(new Error('db down'));
    await expect(
      buildCampaignNegativeContext({ companyId: 'co-1', campaignId: 'camp-1' }),
    ).resolves.toBeNull();
  });
});

describe('EC-R2 · E — degenerate briefs fail loudly', () => {
  it('throws when topic and every intent field are generic', () => {
    expect(() =>
      assertBriefNotDegenerate(degenerateBrief(), { campaignId: 'camp-1', weekNumber: 2 }),
    ).toThrow(CampaignBriefDegenerateError);
  });

  it('names the campaign and week so the failure is actionable', () => {
    try {
      assertBriefNotDegenerate(degenerateBrief(), { campaignId: 'camp-9', weekNumber: 4 });
      throw new Error('expected a degenerate-brief failure');
    } catch (err) {
      expect(err).toBeInstanceOf(CampaignBriefDegenerateError);
      expect((err as Error).message).toContain('camp-9');
      expect((err as Error).message).toContain('week 4');
    }
  });

  it('accepts a brief with a real topic even when intent fields defaulted', () => {
    const brief = degenerateBrief();
    brief.topic = 'Why positioning reviews lag pipeline reviews';
    expect(() => assertBriefNotDegenerate(brief)).not.toThrow();
  });

  it('accepts a brief with any single real intent field', () => {
    const brief = degenerateBrief();
    (brief.intent as Record<string, unknown>).pain_point = 'Messaging drifts from buyer language';
    expect(() => assertBriefNotDegenerate(brief)).not.toThrow();
  });

  it('accepts a placeholder-topic brief that still carries writer-brief signal', () => {
    const brief = degenerateBrief();
    brief.writer_content_brief = { writingIntent: 'Contrarian, evidence-led' };
    expect(() => assertBriefNotDegenerate(brief)).not.toThrow();
  });

  it('leaves a fully specified brief alone', () => {
    expect(() => assertBriefNotDegenerate(realBrief())).not.toThrow();
  });
});

describe('EC-R2 · F — verdicts are persisted', () => {
  it('records an accepted verdict with the gate score and fingerprint', async () => {
    await generateUniqueCampaignMaster({
      companyId: 'co-1',
      campaignId: 'camp-1',
      contentType: 'post',
      generate: async () => ({
        text: GENUINELY_DIFFERENT_POST,
        result: { content: GENUINELY_DIFFERENT_POST },
      }),
    });

    expect(mockPersist).toHaveBeenCalledTimes(1);
    expect(mockPersist).toHaveBeenCalledWith(
      expect.objectContaining({
        companyId: 'co-1',
        decision: 'accepted',
        regenerationCount: 0,
      }),
    );
    const arg = mockPersist.mock.calls[0]![0];
    expect(typeof arg.originalityScore).toBe('number');
    expect(arg.generationFingerprint).toBeTruthy();
  });

  it('records the verdict even when the candidate is rejected', async () => {
    mockRetrieve.mockResolvedValue([recordFor('mem-w1', WEEK_1_POST)]);

    await expect(
      generateUniqueCampaignMaster({
        companyId: 'co-1',
        campaignId: 'camp-1',
        contentType: 'post',
        generate: async () => ({ text: WEEK_1_POST, result: { content: WEEK_1_POST } }),
      }),
    ).rejects.toBeInstanceOf(CampaignDuplicateContentError);

    expect(mockPersist).toHaveBeenCalledWith(
      expect.objectContaining({ decision: 'duplicate' }),
    );
  });
});

describe('EC-R2 · G — bounded regeneration', () => {
  it('regenerates a duplicate and accepts the fresh attempt', async () => {
    mockRetrieve.mockResolvedValue([recordFor('mem-w1', WEEK_1_POST)]);
    const texts = [WEEK_1_POST, GENUINELY_DIFFERENT_POST];
    const generate = jest.fn(async (attempt: number) => {
      const text = texts[attempt - 1]!;
      return { text, result: { content: text } };
    });

    const outcome = await generateUniqueCampaignMaster({
      companyId: 'co-1',
      campaignId: 'camp-1',
      contentType: 'post',
      generate,
    });

    expect(generate).toHaveBeenCalledTimes(2);
    expect(outcome.regenerated).toBe(true);
    expect(outcome.attempts).toBe(2);
    expect(outcome.originality.decision).toBe('regenerated');
    expect(outcome.text).toBe(GENUINELY_DIFFERENT_POST);
    expect(mockPersist).toHaveBeenCalledWith(
      expect.objectContaining({ regenerationCount: 1 }),
    );
  });

  it('does not loop unboundedly when every attempt duplicates', async () => {
    mockRetrieve.mockResolvedValue([recordFor('mem-w1', WEEK_1_POST)]);
    const generate = jest.fn(async () => ({
      text: WEEK_1_POST,
      result: { content: WEEK_1_POST },
    }));

    await expect(
      generateUniqueCampaignMaster({
        companyId: 'co-1',
        campaignId: 'camp-1',
        contentType: 'post',
        generate,
      }),
    ).rejects.toBeInstanceOf(CampaignDuplicateContentError);

    // The engine's own bounded policy — no new retry policy introduced here.
    expect(generate).toHaveBeenCalledTimes(2);
  });
});

describe('EC-R2 · H — valid diversity still passes', () => {
  it('accepts genuinely distinct content and indexes it for the next week', async () => {
    mockRetrieve.mockResolvedValue([recordFor('mem-w1', WEEK_1_POST)]);
    mockIndex.mockResolvedValue(recordFor('mem-w2', GENUINELY_DIFFERENT_POST));

    const outcome = await generateUniqueCampaignMaster({
      companyId: 'co-1',
      campaignId: 'camp-1',
      contentType: 'post',
      generate: async () => ({
        text: GENUINELY_DIFFERENT_POST,
        result: { content: GENUINELY_DIFFERENT_POST },
      }),
    });

    expect(outcome.originality.isOriginal).toBe(true);
    expect(outcome.regenerated).toBe(false);
    expect(outcome.indexed).toBe(true);
    // Indexed under a committed lifecycle so the gate's default retrieval
    // filter actually sees it on the next candidate.
    expect(mockIndex).toHaveBeenCalledWith(
      expect.objectContaining({
        companyId: 'co-1',
        campaignId: 'camp-1',
        lifecycleStatus: 'scheduled',
        text: GENUINELY_DIFFERENT_POST,
      }),
    );
  });
});

describe('EC-R2 · I — the AI cache is untouched', () => {
  it('enforces at the acceptance boundary, not by perturbing generation', async () => {
    mockRetrieve.mockResolvedValue([recordFor('mem-w1', WEEK_1_POST)]);
    // Declared with the REAL callback signature (attempt: number) so
    // `generate.mock.calls` is typed as the guard actually calls it. Declaring
    // it zero-arg narrowed calls to a 0-tuple, which made the assertions below
    // statically impossible rather than meaningful.
    const generate = jest.fn(async (_attempt: number) => ({
      text: WEEK_1_POST,
      result: { content: WEEK_1_POST },
    }));

    await expect(
      generateUniqueCampaignMaster({
        companyId: 'co-1',
        campaignId: 'camp-1',
        contentType: 'post',
        generate,
      }),
    ).rejects.toBeInstanceOf(CampaignDuplicateContentError);

    // The guard passes only an attempt number — it injects no nonce, seed or
    // cache-busting argument. A deterministic generator stays deterministic;
    // the duplicate is stopped by the gate, not by randomising the prompt.
    for (const call of generate.mock.calls) {
      expect(call.length).toBeLessThanOrEqual(1);
      if (call.length === 1) expect(typeof call[0]).toBe('number');
    }
  });
});

describe('EC-R2 · J — tenant isolation', () => {
  it('never retrieves memory for a different company', async () => {
    await generateUniqueCampaignMaster({
      companyId: 'co-TENANT-A',
      campaignId: 'camp-1',
      contentType: 'post',
      generate: async () => ({
        text: GENUINELY_DIFFERENT_POST,
        result: { content: GENUINELY_DIFFERENT_POST },
      }),
    });

    expect(mockRetrieve).toHaveBeenCalledTimes(1);
    expect(mockRetrieve.mock.calls[0]![0]).toBe('co-TENANT-A');
  });

  it('bypasses (never cross-compares) when the tenant cannot be resolved', async () => {
    const outcome = await generateUniqueCampaignMaster({
      companyId: null,
      campaignId: 'camp-1',
      contentType: 'post',
      generate: async () => ({ text: WEEK_1_POST, result: { content: WEEK_1_POST } }),
    });

    expect(outcome.originality.decision).toBe('bypassed');
    expect(mockRetrieve).not.toHaveBeenCalled();
    expect(mockIndex).not.toHaveBeenCalled();
  });
});
