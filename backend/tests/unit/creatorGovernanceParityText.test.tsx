/**
 * @jest-environment jsdom
 *
 * Creator Governance Parity For Text Content — focused tests:
 *
 *   Phase 1+2  runTextGeneration consumes the same
 *              GovernancePromptContext the visual composer does
 *   Phase 3    Thread path reuses the same orchestrator + directives
 *   Phase 4    generateCreatorThemeTreatment receives + threads the
 *              same governance context
 *   Phase 5    All three paths expose `governance` metadata matching
 *              the visual composer shape
 *   Phase 6    SaaS content is byte-identical to no-governance legacy
 *
 * The contentGenerationPipeline + aiGateway dependencies are mocked
 * so the tests exercise the orchestrator's prompt-construction layer
 * (not the LLM).
 */

import '@testing-library/jest-dom';

// Mock the pipeline so we can capture the `item` envelope the
// orchestrator passes through. The mock records each call's input.
const pipelineCalls: Array<{ kind: 'master' | 'variants'; item: any }> = [];
jest.mock('../../services/contentGenerationPipeline', () => ({
  generateMasterContentFromIntent: jest.fn(async (item: any) => {
    pipelineCalls.push({ kind: 'master', item });
    return { content: 'sample master content', decision_trace: { hook: 'h' } };
  }),
  buildPlatformVariantsFromMaster: jest.fn(async (item: any) => {
    pipelineCalls.push({ kind: 'variants', item });
    return [{ generated_content: 'sample variant', discoverability_meta: { hashtags: [] } }];
  }),
}));

// Mock aiGateway so the theme-treatment call returns deterministic JSON.
const aiGatewayCalls: Array<{ messages: any }> = [];
jest.mock('../../services/aiGateway', () => ({
  runCompletionWithOperation: jest.fn(async ({ messages }: any) => {
    aiGatewayCalls.push({ messages });
    return {
      output: JSON.stringify({
        hook_scene: { text: 'open with curiosity' },
        scenes: [{ dialogue: 'beat 1' }],
        cta_scene: { text: 'watch the next one', platform_cta: 'Subscribe' },
        platform_notes: {},
        duration_seconds: 60,
        production_notes: 'shoot with natural light',
        production_checklist: ['confirm lighting'],
        talking_points: ['point a'],
        b_roll_ideas: ['idea a'],
        hashtags: ['#tag'],
      }),
    };
  }),
}));

// Mock the brand-kit + system prompt resolvers — they're orthogonal.
jest.mock('../../services/creatorBrandKit', () => ({
  resolveCreatorBrandKit: jest.fn(() => ({ companyName: 'Acme', tone: 'neutral' })),
}));
jest.mock('../../prompts/creatorContentPromptsV1', () => ({
  CREATOR_CONTENT_SYSTEM_PROMPTS: {
    video_script: (_ctx: any) => 'SYSTEM PROMPT',
  },
}));
jest.mock('@/config', () => ({ config: { OPENAI_MODEL: 'gpt-4o' } }));

import { runTextGeneration } from '../../services/content/textGenerationOrchestrator';
import { generateCreatorThemeTreatment } from '../../services/creatorThemeTreatmentService';
import { buildGovernancePromptContext } from '../../services/creator/strategyGovernancePromptContext';

const BASE_TEXT_INPUT = {
  origin: 'direct-api' as const,
  companyId: 'co-x',
  topic: 'sample topic',
  targetPlatforms: ['linkedin'],
};

const BASE_THEME_INPUT = {
  companyId: 'co-x',
  topic: 'sample topic',
  targetPlatforms: ['instagram_reels'],
};

beforeEach(() => {
  pipelineCalls.length = 0;
  aiGatewayCalls.length = 0;
});

/* ── Phase 1+2 — Post governance ─────────────────────────────────── */

describe('Phase 1+2 — runTextGeneration post governance', () => {
  test('healthcare post: pipeline receives compliance directives in extra_instruction', async () => {
    const ctx = buildGovernancePromptContext({
      companyContext: { industry: 'Healthcare' },
      contentType: 'image',
      selectedStrategy: 'educational',
    });
    await runTextGeneration({
      ...BASE_TEXT_INPUT,
      contentType: 'post',
      governance: ctx,
    });
    const masterCall = pipelineCalls.find((c) => c.kind === 'master');
    expect(masterCall).toBeDefined();
    const instruction = String(masterCall!.item.extra_instruction || '');
    expect(instruction).toMatch(/Compliance directives \(healthcare industry policy/i);
    expect(instruction).toMatch(/clinical claim/i);
    expect(instruction).toMatch(/treatment guarantee/i);
    expect(instruction).toMatch(/outcome guarantee/i);
  });

  test('finance post: pipeline receives guaranteed-return + unsupported-claim directives', async () => {
    const ctx = buildGovernancePromptContext({
      companyContext: { industry: 'Finance' },
      contentType: 'image',
      selectedStrategy: 'educational',
    });
    await runTextGeneration({
      ...BASE_TEXT_INPUT,
      contentType: 'post',
      governance: ctx,
    });
    const masterCall = pipelineCalls.find((c) => c.kind === 'master');
    const instruction = String(masterCall!.item.extra_instruction || '');
    expect(instruction).toMatch(/guaranteed return/i);
    expect(instruction).toMatch(/unsupported financial claim/i);
  });

  test('insurance post: coverage / suitability directives', async () => {
    const ctx = buildGovernancePromptContext({
      companyContext: { industry: 'Insurance' },
      contentType: 'image',
      selectedStrategy: 'educational',
    });
    await runTextGeneration({
      ...BASE_TEXT_INPUT,
      contentType: 'post',
      governance: ctx,
    });
    const instruction = String(pipelineCalls.find((c) => c.kind === 'master')!.item.extra_instruction || '');
    expect(instruction).toMatch(/coverage guarantee/i);
    expect(instruction).toMatch(/suitability claim/i);
  });

  test('legal post: legal-guarantee / client-result directives', async () => {
    const ctx = buildGovernancePromptContext({
      companyContext: { industry: 'Law' },
      contentType: 'image',
      selectedStrategy: 'educational',
    });
    await runTextGeneration({
      ...BASE_TEXT_INPUT,
      contentType: 'post',
      governance: ctx,
    });
    const instruction = String(pipelineCalls.find((c) => c.kind === 'master')!.item.extra_instruction || '');
    expect(instruction).toMatch(/legal guarantee/i);
    expect(instruction).toMatch(/client-result/i);
  });

  test('restricted-strategy caution line is appended', async () => {
    const ctx = buildGovernancePromptContext({
      companyContext: { industry: 'Healthcare' },
      contentType: 'image',
      selectedStrategy: 'promotional', // restricted in healthcare image
    });
    await runTextGeneration({
      ...BASE_TEXT_INPUT,
      contentType: 'post',
      governance: ctx,
    });
    const instruction = String(pipelineCalls.find((c) => c.kind === 'master')!.item.extra_instruction || '');
    expect(instruction).toMatch(/extra caution/i);
    expect(instruction).toMatch(/governed by industry policy/i);
    expect(instruction).toMatch(/promotional/);
  });
});

/* ── Phase 3 — Thread parity ─────────────────────────────────────── */

describe('Phase 3 — runTextGeneration thread governance', () => {
  test('healthcare thread reuses identical directives as post', async () => {
    const ctx = buildGovernancePromptContext({
      companyContext: { industry: 'Healthcare' },
      contentType: 'image',
      selectedStrategy: 'educational',
    });
    await runTextGeneration({
      ...BASE_TEXT_INPUT,
      contentType: 'thread',
      governance: ctx,
    });
    const instruction = String(pipelineCalls.find((c) => c.kind === 'master')!.item.extra_instruction || '');
    expect(instruction).toMatch(/Compliance directives \(healthcare industry policy/i);
    expect(instruction).toMatch(/clinical claim/i);
  });

  test('finance thread receives finance directives', async () => {
    const ctx = buildGovernancePromptContext({
      companyContext: { industry: 'Finance' },
      contentType: 'image',
      selectedStrategy: 'educational',
    });
    await runTextGeneration({
      ...BASE_TEXT_INPUT,
      contentType: 'thread',
      governance: ctx,
    });
    const instruction = String(pipelineCalls.find((c) => c.kind === 'master')!.item.extra_instruction || '');
    expect(instruction).toMatch(/guaranteed return/i);
  });

  test('caller extraInstruction is preserved alongside governance', async () => {
    const ctx = buildGovernancePromptContext({
      companyContext: { industry: 'Healthcare' },
      contentType: 'image',
      selectedStrategy: 'educational',
    });
    await runTextGeneration({
      ...BASE_TEXT_INPUT,
      contentType: 'thread',
      governance: ctx,
      extraInstruction: 'Key message: shorten the body',
    });
    const instruction = String(pipelineCalls.find((c) => c.kind === 'master')!.item.extra_instruction || '');
    expect(instruction).toMatch(/Compliance directives/i);
    expect(instruction).toMatch(/Key message: shorten the body/);
    // Governance block comes BEFORE the caller's instruction.
    expect(instruction.indexOf('Compliance directives')).toBeLessThan(
      instruction.indexOf('Key message'),
    );
  });
});

/* ── Phase 4 — Theme treatment governance ────────────────────────── */

describe('Phase 4 — generateCreatorThemeTreatment governance', () => {
  test('healthcare theme treatment: user prompt receives compliance directives', async () => {
    const ctx = buildGovernancePromptContext({
      companyContext: { industry: 'Healthcare' },
      contentType: 'image',
      selectedStrategy: 'educational',
    });
    await generateCreatorThemeTreatment({
      ...BASE_THEME_INPUT,
      contentType: 'video',
      governance: ctx,
    });
    const lastCall = aiGatewayCalls[aiGatewayCalls.length - 1];
    const userMsg = lastCall.messages.find((m: any) => m.role === 'user');
    const userPrompt: string = userMsg.content;
    expect(userPrompt).toMatch(/Compliance directives \(healthcare industry policy/i);
    expect(userPrompt).toMatch(/clinical claim/i);
  });

  test('finance theme treatment: user prompt receives finance directives', async () => {
    const ctx = buildGovernancePromptContext({
      companyContext: { industry: 'Finance' },
      contentType: 'image',
      selectedStrategy: 'educational',
    });
    await generateCreatorThemeTreatment({
      ...BASE_THEME_INPUT,
      contentType: 'reel',
      governance: ctx,
    });
    const userPrompt: string = aiGatewayCalls[aiGatewayCalls.length - 1].messages.find((m: any) => m.role === 'user').content;
    expect(userPrompt).toMatch(/guaranteed return/i);
  });

  test('no governance → user prompt is byte-identical to legacy callers', async () => {
    await generateCreatorThemeTreatment({ ...BASE_THEME_INPUT, contentType: 'video' });
    const baselinePrompt: string = aiGatewayCalls[0].messages.find((m: any) => m.role === 'user').content;
    expect(baselinePrompt).not.toMatch(/Compliance directives/);
    // SaaS context (industry='none') also produces no governance prefix.
    aiGatewayCalls.length = 0;
    await generateCreatorThemeTreatment({
      ...BASE_THEME_INPUT,
      contentType: 'video',
      governance: buildGovernancePromptContext({
        companyContext: { industry: 'SaaS' },
        contentType: 'image',
        selectedStrategy: 'promotional',
      }),
    });
    const saasPrompt: string = aiGatewayCalls[0].messages.find((m: any) => m.role === 'user').content;
    expect(saasPrompt).toBe(baselinePrompt);
  });
});

/* ── Phase 5 — Explainability ────────────────────────────────────── */

describe('Phase 5 — governance metadata exposed across all text surfaces', () => {
  test('runTextGeneration returns governance metadata (industry / risk / warnings)', async () => {
    const ctx = buildGovernancePromptContext({
      companyContext: { industry: 'Healthcare' },
      contentType: 'image',
      selectedStrategy: 'promotional',
    });
    const result = await runTextGeneration({
      ...BASE_TEXT_INPUT,
      contentType: 'post',
      governance: ctx,
    });
    expect(result.governance.industry).toBe('healthcare');
    expect(result.governance.riskLevel).toBe('high');
    expect(result.governance.selectedStrategy).toBe('promotional');
    expect(result.governance.selectedStrategyIsRestricted).toBe(true);
    expect(result.governance.warningsApplied).toBeGreaterThan(0);
  });

  test('runTextGeneration with no governance returns industry=none / warnings=0', async () => {
    const result = await runTextGeneration({
      ...BASE_TEXT_INPUT,
      contentType: 'post',
    });
    expect(result.governance.industry).toBe('none');
    expect(result.governance.riskLevel).toBe('none');
    expect(result.governance.warningsApplied).toBe(0);
    expect(result.governance.selectedStrategyIsRestricted).toBe(false);
  });

  test('theme treatment output carries governance metadata', async () => {
    const ctx = buildGovernancePromptContext({
      companyContext: { industry: 'Finance' },
      contentType: 'image',
      selectedStrategy: 'educational',
    });
    const result = await generateCreatorThemeTreatment({
      ...BASE_THEME_INPUT,
      contentType: 'reel',
      governance: ctx,
    });
    expect(result.governance.industry).toBe('finance');
    expect(result.governance.riskLevel).toBe('high');
    expect(result.governance.warningsApplied).toBeGreaterThan(0);
  });

  test('theme treatment with no governance → industry=none', async () => {
    const result = await generateCreatorThemeTreatment({
      ...BASE_THEME_INPUT,
      contentType: 'video',
    });
    expect(result.governance.industry).toBe('none');
    expect(result.governance.warningsApplied).toBe(0);
  });

  test('theme treatment mirrors governance onto media_bundle.metadata', async () => {
    const ctx = buildGovernancePromptContext({
      companyContext: { industry: 'Healthcare' },
      contentType: 'image',
      selectedStrategy: 'educational',
    });
    const result = await generateCreatorThemeTreatment({
      ...BASE_THEME_INPUT,
      contentType: 'video',
      governance: ctx,
    });
    const mediaMeta = result.asset_payload.media_bundle.metadata as any;
    expect(mediaMeta.governance).toBeDefined();
    expect(mediaMeta.governance.industry).toBe('healthcare');
    expect(mediaMeta.governance.warningsApplied).toBeGreaterThan(0);
  });
});

/* ── Phase 6 — Validation pins ───────────────────────────────────── */

describe('Validation — pinned scenarios', () => {
  test('SaaS post: extra_instruction does NOT contain compliance directives', async () => {
    const ctx = buildGovernancePromptContext({
      companyContext: { industry: 'SaaS' },
      contentType: 'image',
      selectedStrategy: 'promotional',
    });
    await runTextGeneration({
      ...BASE_TEXT_INPUT,
      contentType: 'post',
      governance: ctx,
    });
    const instruction = String(pipelineCalls.find((c) => c.kind === 'master')!.item.extra_instruction || '');
    expect(instruction).not.toMatch(/Compliance directives/i);
  });

  test('no-governance vs SaaS-governance produce identical pipeline calls', async () => {
    await runTextGeneration({
      ...BASE_TEXT_INPUT,
      contentType: 'post',
      extraInstruction: 'baseline',
    });
    const baseline = pipelineCalls.find((c) => c.kind === 'master')!.item.extra_instruction;
    pipelineCalls.length = 0;
    await runTextGeneration({
      ...BASE_TEXT_INPUT,
      contentType: 'post',
      extraInstruction: 'baseline',
      governance: buildGovernancePromptContext({
        companyContext: { industry: 'SaaS' },
        contentType: 'image',
        selectedStrategy: 'promotional',
      }),
    });
    const withGov = pipelineCalls.find((c) => c.kind === 'master')!.item.extra_instruction;
    expect(withGov).toBe(baseline);
  });

  test('parity: post and thread receive the same directive set under healthcare', async () => {
    const ctx = buildGovernancePromptContext({
      companyContext: { industry: 'Healthcare' },
      contentType: 'image',
      selectedStrategy: 'educational',
    });
    await runTextGeneration({ ...BASE_TEXT_INPUT, contentType: 'post', governance: ctx });
    const postInstr = String(pipelineCalls.find((c) => c.kind === 'master')!.item.extra_instruction || '');
    pipelineCalls.length = 0;
    await runTextGeneration({ ...BASE_TEXT_INPUT, contentType: 'thread', governance: ctx });
    const threadInstr = String(pipelineCalls.find((c) => c.kind === 'master')!.item.extra_instruction || '');
    expect(postInstr).toBe(threadInstr);
  });
});
