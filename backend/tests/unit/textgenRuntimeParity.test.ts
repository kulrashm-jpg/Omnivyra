/**
 * WS-1c-2 (PMO-ADR-08) — #7 textGenerationOrchestrator convergence A/B PARITY.
 *
 * Proves that routing `runTextGeneration` through the canonical GenerationRuntime
 * (TEXTGEN_RUNTIME_DELEGATION_ENABLED=on, persist:false + runOriginality:false)
 * is FAITHFUL to the legacy inline body (flag off) for representative inputs.
 *
 * WHAT IS COMPARED — the parity contract callers depend on:
 *   1. RETURN SHAPE — success / contentType / primaryPlatform / templateUsed /
 *      governance metadata / master present / variant present + platform.
 *   2. GENERATION ITEM — the DailyExecutionItemLike each path feeds the shared
 *      primitive `generateMasterContentFromIntent`. Because the mock provider (and
 *      the real one) derive their TEXT from this item, item-equivalence on the
 *      prompt-determining fields (topic / objective / audience / tone / cta /
 *      extra_instruction / governance / platform) is the strongest deterministic
 *      parity proof — stronger than free-text equality (which is a mock-seed
 *      artifact, per WRITER-CERT-006). `execution_id` (a Date.now() timestamp) is
 *      excluded as non-semantic.
 *
 * The heavy seams (generation primitives + the runtime's context/memory reads) are
 * MOCKED so the test is hermetic and deterministic; the REAL orchestrator +
 * REAL runtime + REAL prompt-assembler item construction run over them.
 */

// ── generation primitives — SHARED by orchestrator + runtime (same module) ────
const capturedItems: Array<Record<string, unknown>> = [];
jest.mock('../../services/contentGenerationPipeline', () => ({
  generateMasterContentFromIntent: jest.fn(async (item: Record<string, unknown>) => {
    capturedItems.push(item);
    return {
      id: 'master-parity',
      generated_at: '2026-07-20T00:00:00.000Z',
      content: 'Deterministic master body for parity.',
      generation_status: 'generated',
      generation_source: 'ai',
    };
  }),
  buildPlatformVariantsFromMaster: jest.fn(async (item: Record<string, unknown>) => {
    const targets = (item.active_platform_targets as Array<{ platform: string; content_type: string }>) ?? [];
    const primary = targets[0] ?? { platform: 'linkedin', content_type: 'post' };
    return [
      {
        platform: String(primary.platform),
        content_type: String(primary.content_type),
        generated_content: 'Deterministic variant body for parity.',
        generation_status: 'generated',
        locked_variant: false,
      },
    ];
  }),
}));

// ── runtime DB-touching seams — mocked so delegation is hermetic ──────────────
jest.mock('../../services/context/canonicalContentContextResolver', () => ({
  resolveContentContext: jest.fn(async (_companyId: string, opts?: { objective?: string | null }) => ({
    companyId: 'co-parity',
    profile: null,
    identity: {},
    brand: '',
    identityNames: [],
    // NB: the resolver NEVER sources audience/tone from a per-request field here —
    // it would read them from a profile. We return '' so the assembler falls back
    // to the request-provided (or defaulted) values, exactly like the legacy path.
    audience: '',
    tone: '',
    objective: typeof opts?.objective === 'string' && opts.objective.trim() ? opts.objective.trim() : null,
    businessContext: '',
    creatorCompany: {},
    contextBlock: '',
    adaptation: null,
  })),
}));

jest.mock('../../services/content/contentMemoryService', () => ({
  getBrandMemory: jest.fn(async () => null),
  retrieveRelevant: jest.fn(async () => []),
  indexContentUnit: jest.fn(async () => null),
  persistOriginality: jest.fn(async () => null),
  isContentMemoryWriteEnabled: jest.fn(() => false),
}));

jest.mock('../../services/content/contentService', () => ({
  createContent: jest.fn(async () => ({ id: 'should-not-be-called', lifecycleStatus: 'draft' })),
}));

import { runTextGeneration, type TextGenerationInput } from '../../services/content/textGenerationOrchestrator';
import { createContent } from '../../services/content/contentService';

const FLAG = 'TEXTGEN_RUNTIME_DELEGATION_ENABLED';

/** Project the prompt-determining fields of a captured generation item. */
function projectItem(item: Record<string, unknown>) {
  const intent = (item.intent ?? {}) as Record<string, unknown>;
  return {
    company_id: item.company_id ?? null,
    topic: item.topic ?? null,
    title: item.title ?? null,
    content_type: item.content_type ?? null,
    platform: item.platform ?? null,
    objective: intent.objective ?? null,
    target_audience: intent.target_audience ?? null,
    tone: intent.tone ?? null,
    cta_type: intent.cta_type ?? null,
    extra_instruction: item.extra_instruction ?? null,
    governance: item.governance ?? null,
    active_platform_targets: item.active_platform_targets ?? null,
  };
}

async function runOnce(mode: 'legacy' | 'delegated', input: TextGenerationInput) {
  if (mode === 'legacy') delete process.env[FLAG];
  else process.env[FLAG] = '1';
  capturedItems.length = 0;
  const res = await runTextGeneration(input);
  return {
    result: {
      success: res.success,
      origin: res.origin,
      contentType: res.contentType,
      templateUsed: res.templateUsed,
      primaryPlatform: res.primaryPlatform,
      hasMaster: !!res.masterContent?.content,
      hasVariant: !!res.platformVariant?.generated_content,
      variantPlatform: res.platformVariant?.platform ?? null,
      variantContentType: res.platformVariant?.content_type ?? null,
      governance: res.governance,
    },
    // The FIRST captured item is the primary master generation for this run.
    item: capturedItems.length ? projectItem(capturedItems[0]!) : null,
  };
}

// Representative, single-platform corpus (the #7 callers pass one platform).
const CORPUS: TextGenerationInput[] = [
  {
    origin: 'thread-api', companyId: 'co-parity', topic: 'shipping speed vs quality',
    contentType: 'post', targetPlatforms: ['linkedin'], objective: 'drive signups',
    audience: 'founders', tone: 'direct', cta: 'Start free',
  },
  {
    origin: 'thread-api', companyId: 'co-parity', topic: 'the cost of over-building',
    contentType: 'post', targetPlatforms: ['x'], audience: 'engineers', tone: 'punchy',
  },
  {
    origin: 'thread-api', companyId: 'co-parity', topic: 'why most roadmaps fail',
    contentType: 'thread', targetPlatforms: ['x'], objective: 'grow followers',
    audience: 'PMs', tone: 'direct',
  },
  {
    // thread with NO tone — exercises the thread-specific tone default path.
    origin: 'thread-api', companyId: 'co-parity', topic: 'lessons from a failed launch',
    contentType: 'thread', targetPlatforms: ['linkedin'], objective: 'educate',
    templateName: 'story',
  },
  {
    // no objective — proves objective OMISSION parity (never fabricated).
    origin: 'thread-api', companyId: 'co-parity', topic: 'positioning against incumbents',
    contentType: 'post', targetPlatforms: ['linkedin'],
    extraInstruction: 'Use a contrarian hook and one concrete number.',
  },
];

afterEach(() => {
  delete process.env[FLAG];
});

describe('WS-1c-2 #7 textGenerationOrchestrator — A/B runtime delegation parity', () => {
  it.each(CORPUS.map((c) => [`${c.contentType}/${c.targetPlatforms[0]}/${c.topic.slice(0, 24)}`, c] as const))(
    'legacy vs delegated parity — %s',
    async (_name, input) => {
      const legacy = await runOnce('legacy', input);
      const delegated = await runOnce('delegated', input);

      // (1) Return-shape parity — the caller-facing contract.
      expect(delegated.result).toEqual(legacy.result);

      // (2) Generation-item parity — the prompt-determining input to the shared
      // primitive is reconstructed IDENTICALLY by the runtime's prompt assembler.
      expect(delegated.item).toEqual(legacy.item);

      // The delegated path must NOT persist (no-persist mode) — a double-persist guard.
      expect(createContent).not.toHaveBeenCalled();
    },
  );

  it('delegated path never persists across the whole corpus (no double-persist)', async () => {
    for (const input of CORPUS) {
      await runOnce('delegated', input);
    }
    expect(createContent).not.toHaveBeenCalled();
  });
});
