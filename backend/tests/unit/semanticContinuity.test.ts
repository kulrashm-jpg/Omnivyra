/**
 * WS-1b (OMNIVYRA-PMO-001 · PMO-ADR-06) — SEMANTIC CONTINUITY tests.
 *
 * Proves the Semantic Root is a LIVING runtime concept: the SAME semanticRootId +
 * communicationIntent are present on the brief, the master text, the visual brief,
 * the image prompt spec, and EVERY platform variant (flag ON); a missing/invalid
 * root under flag-ON produces a DETERMINISTIC, OBSERVABLE failure (never a silent
 * fresh root); and flag-OFF is byte-identical to today.
 *
 * Heavy primitives are mocked (as in generationRuntime.test.ts) so these tests
 * assert the CONTINUITY contract over the real spine/guard, not the primitives.
 */

// ── heavy-dependency mocks (mirrors generationRuntime.test.ts) ────────────────
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
  isContentMemoryWriteEnabled: jest.fn(() => false),
}));
jest.mock('../../services/content/originalityGate', () => ({
  assertOriginality: jest.fn(),
}));
jest.mock('../../services/content/contentService', () => ({
  createContent: jest.fn(),
}));

import { generate } from '../../services/content/runtime/generationRuntime';
import * as semanticSpine from '../../services/content/runtime/semanticSpine';
import {
  buildSemanticRoot,
  deriveVisualBrief,
  deriveImagePromptSpec,
} from '../../services/content/runtime/semanticSpine';
import {
  assertValidSemanticRoot,
  assertStageContinuity,
  assertVariantsPreserveIntent,
  checkArtifactInheritsRoot,
  stampVariantSemanticIdentity,
  isSemanticContinuityError,
  SemanticContinuityError,
} from '../../services/content/runtime/semanticContinuityGuard';
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
import { isSemanticRootId } from '../../platform/intelligence';
import type { GenerationRequest, SemanticRoot } from '../../services/content/runtime/contracts';
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
  generated_at: new Date('2026-07-20T00:00:00.000Z').toISOString(),
  content: 'Master body content for the onboarding topic.',
  generation_status: 'generated' as const,
  generation_source: 'ai' as const,
  content_type_mode: 'text' as const,
};
const VARIANT_LI = {
  platform: 'linkedin',
  content_type: 'post',
  generated_content: 'LinkedIn adapted variant body.',
  generation_status: 'generated' as const,
  locked_variant: false,
};
const VARIANT_X = {
  platform: 'x',
  content_type: 'post',
  generated_content: 'X adapted variant body.',
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
  objective: 'Drive trial signups this quarter',
  businessContext: 'Onboarding platform',
  creatorCompany: {} as unknown,
  contextBlock: 'COMPANY CONTEXT: Acme — onboarding platform.',
  adaptation: null,
};
const REQUEST: GenerationRequest = {
  companyId: 'co-1',
  contentType: 'post',
  topic: 'Customer onboarding',
  objective: 'Drive trial signups this quarter',
  audience: 'B2B operators',
  tone: 'Direct',
  campaignId: 'camp-1',
  targetPlatforms: ['linkedin', 'x'],
} as GenerationRequest;

function primeHappyPath(): void {
  mResolveContext.mockResolvedValue(NORM_CONTEXT as never);
  mGetBrandMemory.mockResolvedValue(null as never);
  mRetrieveRelevant.mockResolvedValue([] as never);
  mGenerateMaster.mockResolvedValue(MASTER);
  mBuildVariants.mockResolvedValue([VARIANT_LI, VARIANT_X]);
  mAssertOriginality.mockResolvedValue(ORIGINALITY_ACCEPTED);
  mCreateContent.mockResolvedValue({ id: 'content-1', lifecycleStatus: 'draft' } as never);
  mIndexContentUnit.mockResolvedValue(null as never);
  mPersistOriginality.mockResolvedValue({ id: 'orig-1' } as never);
}

beforeEach(() => {
  jest.restoreAllMocks();
  jest.clearAllMocks();
  primeHappyPath();
});

// ── The FULL pipeline preserves the Semantic Root (flag ON) ───────────────────
describe('semantic continuity — full pipeline (flag ON)', () => {
  beforeEach(() => {
    process.env.SEMANTIC_ROOT_ENABLED = '1';
  });
  afterEach(() => {
    delete process.env.SEMANTIC_ROOT_ENABLED;
  });

  it('the SAME semanticRootId + communicationIntent flow through brief → master → visual → image → EVERY variant', async () => {
    const out = await generate(REQUEST);

    const root = out.semanticRoot as SemanticRoot;
    expect(root).toBeDefined();
    expect(isSemanticRootId(root.semanticRootId)).toBe(true);
    const rootId = root.semanticRootId;
    const intent = root.communicationIntent;

    // content_brief → the immutable root carries the brief.
    expect(root.contentBrief.objective).toBe('Drive trial signups this quarter');

    // generated_text → the generation item inherited the SAME root id.
    const itemArg = mGenerateMaster.mock.calls[0][0] as Record<string, unknown>;
    expect(itemArg.semantic_root_id).toBe(rootId);

    // continuity/lineage record → same identity.
    expect(out.semanticContinuity?.semanticRootId).toBe(rootId);
    expect(out.semanticContinuity?.communicationIntent).toBe(intent);
    expect(out.semanticContinuity?.contentId).toBe('content-1');
    expect(out.semanticContinuity?.generationLineageRef.store).toBe('publication_lineage');

    // visual_brief ← root; image_prompt_spec ← visual_brief.
    expect(out.visualBrief?.semanticRootId).toBe(rootId);
    expect(out.visualBrief?.communicationIntent).toBe(intent);
    expect(out.imagePromptSpec?.semanticRootId).toBe(rootId);

    // platform adaptations → every variant carries the SAME identity (presentation differs).
    expect(out.variants).toHaveLength(2);
    for (const v of out.variants as Array<Record<string, unknown>>) {
      expect(v.semantic_root_id).toBe(rootId);
      expect(v.communication_intent).toBe(intent);
    }
    // …and each variant KEPT its platform-specific presentation.
    const platforms = (out.variants as Array<Record<string, unknown>>).map((v) => v.platform);
    expect(platforms).toEqual(['linkedin', 'x']);

    // No continuity failure was recorded on the happy path.
    const metrics = out.metrics as Record<string, unknown>;
    expect(metrics.failures).toEqual([]);
    expect(metrics.semanticRootId).toBe(rootId);
  });
});

// ── FAIL-CLOSED: missing/invalid root under flag ON is deterministic + observable
describe('semantic continuity — fail-closed enforcement (flag ON)', () => {
  beforeEach(() => {
    process.env.SEMANTIC_ROOT_ENABLED = '1';
  });
  afterEach(() => {
    delete process.env.SEMANTIC_ROOT_ENABLED;
    jest.restoreAllMocks();
  });

  it('an invalid Semantic Root throws a typed SemanticContinuityError and NEVER mints a fresh root / persists', async () => {
    // Force the spine to yield a root with a non-canonical id (simulating a
    // corrupted/missing identity). Enforcement must refuse to proceed.
    jest.spyOn(semanticSpine, 'buildSemanticRoot').mockReturnValue({
      semanticRootId: 'not-a-valid-root',
      generationInstanceId: 'sgen_x',
      topic: 'Customer onboarding',
      communicationIntent: 'other',
      coreMessage: 'x',
      contentBrief: { topic: 'Customer onboarding' },
      createdAt: new Date().toISOString(),
    } as SemanticRoot);

    await expect(generate(REQUEST)).rejects.toBeInstanceOf(SemanticContinuityError);

    // Nothing downstream ran: no generation, no persistence, NO fresh root minted.
    expect(mGenerateMaster).not.toHaveBeenCalled();
    expect(mCreateContent).not.toHaveBeenCalled();
  });

  it('the thrown error carries the stage + continuity code (observable/deterministic)', async () => {
    jest.spyOn(semanticSpine, 'buildSemanticRoot').mockReturnValue({
      semanticRootId: 'bad',
      generationInstanceId: 'sgen_x',
      topic: 't',
      communicationIntent: 'other',
      coreMessage: 'x',
      contentBrief: { topic: 't' },
      createdAt: new Date().toISOString(),
    } as SemanticRoot);

    await generate(REQUEST).then(
      () => {
        throw new Error('expected a SemanticContinuityError');
      },
      (err: unknown) => {
        expect(isSemanticContinuityError(err)).toBe(true);
        expect((err as SemanticContinuityError).stage).toBe('content_brief');
        expect((err as SemanticContinuityError).code).toBe('SEMANTIC_CONTINUITY_VIOLATION');
      },
    );
  });
});

// ── FLAG OFF: byte-identical to pre-WS-1b (no semantic artifacts, unstamped variants)
describe('semantic continuity — flag OFF is unchanged', () => {
  it('produces NO semantic artifacts and leaves variants unstamped', async () => {
    delete process.env.SEMANTIC_ROOT_ENABLED;
    const out = await generate(REQUEST);

    expect(out.semanticRoot).toBeUndefined();
    expect(out.semanticContinuity).toBeUndefined();
    expect(out.visualBrief).toBeUndefined();
    expect(out.imagePromptSpec).toBeUndefined();

    // Variants are the raw payloads — never stamped with identity fields.
    for (const v of out.variants as Array<Record<string, unknown>>) {
      expect(v.semantic_root_id).toBeUndefined();
      expect(v.communication_intent).toBeUndefined();
    }
    const metrics = out.metrics as Record<string, unknown>;
    expect(metrics.semanticRootId).toBeUndefined();
    expect(metrics.failures).toEqual([]);
  });
});

// ── Guard primitives (pure, deterministic) ────────────────────────────────────
describe('semanticContinuityGuard primitives', () => {
  const validRoot = (): SemanticRoot =>
    buildSemanticRoot({
      companyId: 'co-1',
      contentType: 'post',
      campaignId: 'camp-1',
      objective: 'Drive trial signups this quarter',
      raw: { topic: 'Customer onboarding' },
    });

  it('assertValidSemanticRoot throws for a missing root (no mint)', () => {
    expect(() => assertValidSemanticRoot(undefined, 'content_brief')).toThrow(
      SemanticContinuityError,
    );
  });

  it('assertValidSemanticRoot throws for a non-canonical id', () => {
    expect(() =>
      assertValidSemanticRoot({ ...validRoot(), semanticRootId: 'nope' } as SemanticRoot, 'content_brief'),
    ).toThrow(SemanticContinuityError);
  });

  it('assertValidSemanticRoot accepts a well-formed root', () => {
    expect(() => assertValidSemanticRoot(validRoot(), 'content_brief')).not.toThrow();
  });

  it('assertStageContinuity throws when the parent lineage diverges from the root', () => {
    const root = validRoot();
    expect(() =>
      assertStageContinuity('generated_text', {
        root,
        parentSemanticRootId: 'sroot_ffffffffffffffffffffffff',
      }),
    ).toThrow(SemanticContinuityError);
  });

  it('assertStageContinuity throws when the parent intent diverges', () => {
    const root = validRoot();
    expect(() =>
      assertStageContinuity('visual_brief', {
        root,
        parentSemanticRootId: root.semanticRootId,
        parentCommunicationIntent: 'promote',
      }),
    ).toThrow(SemanticContinuityError);
  });

  it('stampVariantSemanticIdentity preserves presentation and adds the identity', () => {
    const root = validRoot();
    const stamped = stampVariantSemanticIdentity(VARIANT_LI, root);
    expect(stamped.generated_content).toBe(VARIANT_LI.generated_content);
    expect(stamped.platform).toBe('linkedin');
    expect(stamped.semantic_root_id).toBe(root.semanticRootId);
    expect(stamped.communication_intent).toBe(root.communicationIntent);
  });

  it('assertVariantsPreserveIntent flags a tampered variant deterministically', () => {
    const root = validRoot();
    const good = stampVariantSemanticIdentity(VARIANT_LI, root);
    const bad = { ...stampVariantSemanticIdentity(VARIANT_X, root), semantic_root_id: 'sroot_tampered' };
    const res = assertVariantsPreserveIntent(root, [good, bad]);
    expect(res.ok).toBe(false);
    expect(res.violations).toEqual([1]);
  });

  it('checkArtifactInheritsRoot returns ok for a derived artifact and a reason for a mismatch', () => {
    const root = validRoot();
    const vb = deriveVisualBrief(root);
    expect(checkArtifactInheritsRoot(root, vb, 'visual_brief').ok).toBe(true);
    const bad = checkArtifactInheritsRoot(root, { semanticRootId: 'sroot_other' }, 'visual_brief');
    expect(bad.ok).toBe(false);
    expect(bad.reason).toContain('visual_brief');
  });
});

// ── TD-15 residual — image prompt narrates a HUMAN-READABLE objective ─────────
describe('TD-15 — deriveImagePromptSpec narrates a human-readable objective (not the enum token)', () => {
  it('uses the free-form objective and does NOT narrate the canonical communicationIntent token', () => {
    const root = buildSemanticRoot({
      companyId: 'co-1',
      contentType: 'post',
      objective: 'Drive trial signups this quarter',
      raw: { topic: 'Customer onboarding' },
    });
    const vb = deriveVisualBrief(root);
    const spec = deriveImagePromptSpec(vb, 'Some grounded generated copy.');

    expect(vb.objective).toBe('Drive trial signups this quarter');
    expect(spec.imagePrompt).toContain('Objective: Drive trial signups this quarter.');
    // The canonical grouping token must NOT be narrated as "Communication intent".
    expect(spec.imagePrompt).not.toContain('Communication intent:');
    // Continuity still keyed by the root id.
    expect(spec.semanticRootId).toBe(root.semanticRootId);
  });
});
