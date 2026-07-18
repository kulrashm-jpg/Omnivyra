/**
 * Writer Wave 3 — GenerationRuntime pipeline unit tests.
 *
 * The heavy dependencies (generation primitives, originality gate, canonical
 * persistence, context resolver, memory) are MOCKED so these tests assert the
 * ORCHESTRATION contract, not the primitives:
 *   1. the 8 canonical stages run IN ORDER,
 *   2. every stage reuses the expected existing service,
 *   3. everything AFTER generation is FAIL-OPEN (persistence / variants failures
 *      never break the call),
 *   4. generate() returns a well-formed GenerationOutput.
 *
 * The Wave-3 glue (task policy, retry, prompt assembler, deterministic formatter,
 * runtime metrics, originality regeneration) is left REAL so the real pipeline is
 * exercised end-to-end over mocked primitives.
 */

// ── heavy-dependency mocks ────────────────────────────────────────────────────

jest.mock('../../services/contentGenerationPipeline', () => ({
  generateMasterContentFromIntent: jest.fn(),
  buildPlatformVariantsFromMaster: jest.fn(),
}));

jest.mock('../../services/context/canonicalContentContextResolver', () => ({
  resolveContentContext: jest.fn(),
}));

jest.mock('../../services/content/contentMemoryService', () => ({
  getBrandMemory: jest.fn(),
  retrieveRelevant: jest.fn(),
  indexContentUnit: jest.fn(),
  persistOriginality: jest.fn(),
}));

jest.mock('../../services/content/originalityGate', () => ({
  assertOriginality: jest.fn(),
}));

jest.mock('../../services/content/contentService', () => ({
  createContent: jest.fn(),
}));

import { generate, RUNTIME_STAGES } from '../../services/content/runtime/generationRuntime';
import {
  generateMasterContentFromIntent,
  buildPlatformVariantsFromMaster,
} from '../../services/contentGenerationPipeline';
import { resolveContentContext } from '../../services/context/canonicalContentContextResolver';
import {
  getBrandMemory,
  retrieveRelevant,
  indexContentUnit,
  persistOriginality,
} from '../../services/content/contentMemoryService';
import { assertOriginality } from '../../services/content/originalityGate';
import { createContent } from '../../services/content/contentService';
import type { GenerationRequest } from '../../services/content/runtime/contracts';
import type { OriginalityResult } from '../../../lib/content/originality/types';

const mGenerateMaster = generateMasterContentFromIntent as jest.MockedFunction<
  typeof generateMasterContentFromIntent
>;
const mBuildVariants = buildPlatformVariantsFromMaster as jest.MockedFunction<
  typeof buildPlatformVariantsFromMaster
>;
const mResolveContext = resolveContentContext as jest.MockedFunction<typeof resolveContentContext>;
const mGetBrandMemory = getBrandMemory as jest.MockedFunction<typeof getBrandMemory>;
const mRetrieveRelevant = retrieveRelevant as jest.MockedFunction<typeof retrieveRelevant>;
const mIndexContentUnit = indexContentUnit as jest.MockedFunction<typeof indexContentUnit>;
const mPersistOriginality = persistOriginality as jest.MockedFunction<typeof persistOriginality>;
const mAssertOriginality = assertOriginality as jest.MockedFunction<typeof assertOriginality>;
const mCreateContent = createContent as jest.MockedFunction<typeof createContent>;

// ── fixtures ──────────────────────────────────────────────────────────────────

const MASTER = {
  id: 'master-1',
  generated_at: new Date('2026-07-18T00:00:00.000Z').toISOString(),
  content: 'Master body content for the onboarding topic.',
  generation_status: 'generated' as const,
  generation_source: 'ai' as const,
  content_type_mode: 'text' as const,
};

const VARIANT = {
  platform: 'linkedin',
  content_type: 'post',
  generated_content: 'LinkedIn adapted variant body.',
  generation_status: 'generated' as const,
  locked_variant: false,
};

const ORIGINALITY_ACCEPTED: OriginalityResult = {
  isOriginal: true,
  score: 1,
  decision: 'accepted',
  nearestMatches: [],
  dimensions: {},
  fingerprint: {
    exactHash: 'exacthash',
    normalizedHash: 'normhash',
    simhash: '0000000000000000',
    minhash: [],
    structuralShape: '',
    tokenSummary: { tokens: [], shingles: [] },
  },
};

const NORM_CONTEXT = {
  companyId: 'co-1',
  profile: null,
  identity: {},
  brand: 'Acme',
  identityNames: ['Acme'],
  audience: 'B2B operators',
  tone: 'Direct and practical',
  objective: 'Increase activation',
  businessContext: 'Onboarding platform',
  creatorCompany: {} as any,
  contextBlock: 'COMPANY CONTEXT: Acme — onboarding platform.',
  adaptation: null,
};

const REQUEST: GenerationRequest = {
  companyId: 'co-1',
  contentType: 'post',
  topic: 'Customer onboarding',
  objective: 'Increase activation',
  audience: 'B2B operators',
  tone: 'Direct',
  campaignId: 'camp-1',
  // extra (allowed via GenerationRequest index signature)
  targetPlatforms: ['linkedin', 'x'],
} as GenerationRequest;

function primeHappyPath(): void {
  mResolveContext.mockResolvedValue(NORM_CONTEXT as any);
  mGetBrandMemory.mockResolvedValue(null);
  mRetrieveRelevant.mockResolvedValue([]);
  mGenerateMaster.mockResolvedValue(MASTER);
  mBuildVariants.mockResolvedValue([VARIANT]);
  mAssertOriginality.mockResolvedValue(ORIGINALITY_ACCEPTED);
  mCreateContent.mockResolvedValue({ id: 'content-1', lifecycleStatus: 'draft' } as any);
  mIndexContentUnit.mockResolvedValue(null);
  mPersistOriginality.mockResolvedValue({ id: 'orig-1' });
}

beforeEach(() => {
  jest.clearAllMocks();
  primeHappyPath();
});

describe('generationRuntime.generate', () => {
  it('runs the 8 canonical stages in order and returns a GenerationOutput', async () => {
    const out = await generate(REQUEST);

    // (4) returns a well-formed GenerationOutput
    expect(out.master).toEqual(MASTER);
    expect(Array.isArray(out.variants)).toBe(true);
    expect(out.variants).toHaveLength(1);
    expect(out.contentId).toBe('content-1');
    expect(out.originality).toEqual(ORIGINALITY_ACCEPTED);
    expect(out.metrics).toBeDefined();

    // (1) the 8 stages ran IN ORDER
    const metrics = out.metrics as Record<string, unknown>;
    expect(metrics.stages).toEqual([...RUNTIME_STAGES]);
    expect(metrics.failures).toEqual([]);
  });

  it('reuses the expected existing service at each stage', async () => {
    await generate(REQUEST);

    // Stage 1 — context resolution
    expect(mResolveContext).toHaveBeenCalledWith('co-1', { objective: 'Increase activation' });
    expect(mGetBrandMemory).toHaveBeenCalledWith('co-1');
    // Stage 3 — originality preparation (light retrieval)
    expect(mRetrieveRelevant).toHaveBeenCalledTimes(1);
    // Stage 4 — generation primitive
    expect(mGenerateMaster).toHaveBeenCalledTimes(1);
    // Stage 5 — originality validation
    expect(mAssertOriginality).toHaveBeenCalledTimes(1);
    expect(mAssertOriginality).toHaveBeenCalledWith(
      expect.objectContaining({ companyId: 'co-1', contentType: 'post', candidateText: MASTER.content }),
    );
    // Stage 6 — persistence trio
    expect(mCreateContent).toHaveBeenCalledTimes(1);
    expect(mIndexContentUnit).toHaveBeenCalledTimes(1);
    expect(mPersistOriginality).toHaveBeenCalledTimes(1);
    // Stage 7 — variant generation
    expect(mBuildVariants).toHaveBeenCalledTimes(1);
  });

  it('generation runs BEFORE originality validation (stage ordering)', async () => {
    const order: string[] = [];
    mGenerateMaster.mockImplementation(async () => {
      order.push('generate');
      return MASTER;
    });
    mAssertOriginality.mockImplementation(async () => {
      order.push('assert');
      return ORIGINALITY_ACCEPTED;
    });
    await generate(REQUEST);
    expect(order).toEqual(['generate', 'assert']);
  });

  it('FAIL-OPEN: a persistence failure never breaks generation', async () => {
    mCreateContent.mockRejectedValue(new Error('db down'));

    const out = await generate(REQUEST);

    // Master + variants still produced; contentId degraded to null.
    expect(out.master).toEqual(MASTER);
    expect(out.variants).toHaveLength(1);
    expect(out.contentId).toBeNull();

    const metrics = out.metrics as Record<string, unknown>;
    expect(metrics.failures).toContain('persistence');
    // All 8 stages still ran — the pipeline did not abort.
    expect(metrics.stages).toEqual([...RUNTIME_STAGES]);
    // Variant generation still happened after the persistence failure.
    expect(mBuildVariants).toHaveBeenCalledTimes(1);
  });

  it('FAIL-OPEN: a variant-generation failure never breaks generation', async () => {
    mBuildVariants.mockRejectedValue(new Error('variant provider exploded'));

    const out = await generate(REQUEST);

    expect(out.master).toEqual(MASTER);
    expect(out.variants).toEqual([]);
    // Persistence still succeeded.
    expect(out.contentId).toBe('content-1');

    const metrics = out.metrics as Record<string, unknown>;
    expect(metrics.failures).toContain('variants');
    expect(metrics.stages).toEqual([...RUNTIME_STAGES]);
  });

  it('a GENERATION failure (stage 4) propagates — the pipeline is not fail-open before/at generation', async () => {
    // A fatal (non-retryable) error must surface, not be swallowed.
    const fatal = Object.assign(new Error('bad request'), { status: 400 });
    mGenerateMaster.mockRejectedValue(fatal);

    await expect(generate(REQUEST)).rejects.toThrow('bad request');
    // Nothing downstream of generation ran.
    expect(mCreateContent).not.toHaveBeenCalled();
    expect(mBuildVariants).not.toHaveBeenCalled();
  });
});
