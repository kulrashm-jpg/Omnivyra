/**
 * @jest-environment jsdom
 *
 * Creator System-Prompt Governance Integration — focused tests:
 *
 *   Phase 1  buildSystemPromptGovernancePreamble shape
 *   Phase 2  blueprintGenerator's system prompt prepends the preamble
 *            for every governed industry (healthcare, finance,
 *            insurance, legal)
 *   Phase 3  platformVariantGenerator system prompt prepends the
 *            preamble (batch path)
 *   Phase 4  SaaS / no-governance → byte-identical system prompts vs.
 *            legacy callers
 *   Phase 5  Restricted-strategy adds maximum-discipline line
 *
 * The aiGateway + companyProfileService + languageRefinementService
 * dependencies are mocked so the tests capture the system prompt
 * messages without exercising the LLM / DB.
 */

import '@testing-library/jest-dom';

// Capture every system prompt sent to the gateway.
const systemPrompts: Array<{ operation: string; system: string }> = [];
jest.mock('../../services/aiGateway', () => ({
  runCompletionWithOperation: jest.fn(async (params: any) => {
    const sys = (params.messages || []).find((m: any) => m.role === 'system');
    systemPrompts.push({ operation: String(params.operation || ''), system: String(sys?.content || '') });
    return {
      output: JSON.stringify({
        master_content: 'OK',
        platform_variants: { linkedin_post: 'OK', x_post: 'OK' },
      }),
      metadata: { token_usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } },
    };
  }),
}));

// Stub companyProfileService — identity resolution is orthogonal.
jest.mock('../../services/companyProfileService', () => ({
  getProfile: jest.fn(async () => null),
}));

// Stub language refinement — returns input unchanged so behavior is
// deterministic.
jest.mock('../../services/languageRefinementService', () => ({
  refineLanguageOutput: jest.fn(async ({ content }: any) => ({ refined: content })),
}));

// Stub validation services that consume the gateway output.
jest.mock('../../services/aiOutputValidationService', () => ({
  validateContentBlueprint: jest.fn(() => ({ valid: true, reasons: [] })),
  validatePlatformVariants: jest.fn((input: any) => ({ valid: true, reasons: [], normalized: input })),
}));

// Stub the content blueprint cache so cache reads don't short-circuit
// the test.
jest.mock('../../services/contentBlueprintCache', () => ({
  getCachedBlueprint: jest.fn(() => null),
  setCachedBlueprint: jest.fn(),
}));

// Stub the unified content processor used by platform variant
// generation downstream.
jest.mock('../../services/unifiedContentProcessor', () => ({
  processContent: jest.fn((s: string) => s),
}));

// Stub discoverability helpers.
jest.mock('../../services/contentGeneration/discoverabilityHelpers', () => ({
  optimizeDiscoverabilityForPlatform: jest.fn(async () => null),
  buildMediaSearchIntent: jest.fn(),
  normalizeLegacyMediaSearchIntent: jest.fn(),
}));

import {
  buildGovernancePromptContext,
  buildSystemPromptGovernancePreamble,
  buildSystemPromptGovernancePreambleFromItem,
} from '../../services/creator/strategyGovernancePromptContext';
import {
  generateContentBlueprint,
  generateMasterContentFromIntent,
} from '../../services/contentGeneration/blueprintGenerator';

beforeEach(() => {
  systemPrompts.length = 0;
});

/* ── Phase 1 — Preamble builder shape ───────────────────────────── */

describe('Phase 1 — buildSystemPromptGovernancePreamble', () => {
  test('null context → null preamble (no-op)', () => {
    expect(buildSystemPromptGovernancePreamble(null)).toBeNull();
    expect(buildSystemPromptGovernancePreamble(undefined)).toBeNull();
  });

  test('industry=none → null preamble', () => {
    const ctx = buildGovernancePromptContext({
      companyContext: { industry: 'SaaS' },
      contentType: 'image',
      selectedStrategy: 'promotional',
    });
    expect(buildSystemPromptGovernancePreamble(ctx)).toBeNull();
  });

  test('healthcare → preamble with non-negotiable policy header', () => {
    const ctx = buildGovernancePromptContext({
      companyContext: { industry: 'Healthcare' },
      contentType: 'image',
      selectedStrategy: 'educational',
    });
    const preamble = buildSystemPromptGovernancePreamble(ctx)!;
    expect(preamble).toMatch(/COMPLIANCE POLICY \(healthcare industry, risk: high\) — non-negotiable/i);
    expect(preamble).toMatch(/clinical claim/i);
    expect(preamble).toMatch(/treatment guarantee/i);
    expect(preamble).toMatch(/constraints, not suggestions/i);
  });

  test('finance → preamble with guaranteed-return + guaranteed-outcome', () => {
    const ctx = buildGovernancePromptContext({
      companyContext: { industry: 'Finance' },
      contentType: 'image',
      selectedStrategy: 'educational',
    });
    const preamble = buildSystemPromptGovernancePreamble(ctx)!;
    expect(preamble).toMatch(/COMPLIANCE POLICY \(finance industry/i);
    expect(preamble).toMatch(/guaranteed return/i);
    expect(preamble).toMatch(/guaranteed outcome/i);
  });

  test('insurance → coverage + suitability lines', () => {
    const ctx = buildGovernancePromptContext({
      companyContext: { industry: 'Insurance' },
      contentType: 'image',
      selectedStrategy: 'educational',
    });
    const preamble = buildSystemPromptGovernancePreamble(ctx)!;
    expect(preamble).toMatch(/coverage guarantee/i);
    expect(preamble).toMatch(/suitability claim/i);
  });

  test('legal → legal-guarantee + implied-outcome lines', () => {
    const ctx = buildGovernancePromptContext({
      companyContext: { industry: 'Law' },
      contentType: 'image',
      selectedStrategy: 'educational',
    });
    const preamble = buildSystemPromptGovernancePreamble(ctx)!;
    expect(preamble).toMatch(/legal guarantee/i);
    expect(preamble).toMatch(/implied outcome/i);
  });

  test('restricted strategy adds maximum-discipline line', () => {
    const ctx = buildGovernancePromptContext({
      companyContext: { industry: 'Healthcare' },
      contentType: 'image',
      selectedStrategy: 'promotional',
    });
    const preamble = buildSystemPromptGovernancePreamble(ctx)!;
    expect(preamble).toMatch(/maximum compliance discipline/i);
  });

  test('buildSystemPromptGovernancePreambleFromItem reads item.governance', () => {
    const ctx = buildGovernancePromptContext({
      companyContext: { industry: 'Finance' },
      contentType: 'image',
      selectedStrategy: 'educational',
    });
    const item = { governance: ctx };
    expect(buildSystemPromptGovernancePreambleFromItem(item)).toMatch(/COMPLIANCE POLICY/i);
    expect(buildSystemPromptGovernancePreambleFromItem({})).toBeNull();
    expect(buildSystemPromptGovernancePreambleFromItem(null)).toBeNull();
  });
});

/* ── Phase 2 — blueprintGenerator threads preamble ──────────────── */

describe('Phase 2 — blueprintGenerator system-prompt preamble', () => {
  test('healthcare item → blueprint system prompt contains compliance policy', async () => {
    const ctx = buildGovernancePromptContext({
      companyContext: { industry: 'Healthcare' },
      contentType: 'image',
      selectedStrategy: 'educational',
    });
    await generateContentBlueprint({
      execution_id: 'test-1',
      company_id: 'co-hc',
      content_type: 'post',
      topic: 'sample topic',
      governance: ctx,
    } as any);
    const blueprintCall = systemPrompts.find((p) => p.operation === 'generateContentBlueprint');
    expect(blueprintCall).toBeDefined();
    expect(blueprintCall!.system).toMatch(/COMPLIANCE POLICY \(healthcare industry/i);
    expect(blueprintCall!.system).toMatch(/clinical claim/i);
    expect(blueprintCall!.system).toMatch(/treatment guarantee/i);
  });

  test('finance item → blueprint system prompt contains finance policy', async () => {
    const ctx = buildGovernancePromptContext({
      companyContext: { industry: 'Finance' },
      contentType: 'image',
      selectedStrategy: 'educational',
    });
    await generateContentBlueprint({
      execution_id: 'test-2',
      company_id: 'co-fi',
      content_type: 'post',
      topic: 'fin topic',
      governance: ctx,
    } as any);
    const blueprintCall = systemPrompts.find((p) => p.operation === 'generateContentBlueprint');
    expect(blueprintCall!.system).toMatch(/COMPLIANCE POLICY \(finance industry/i);
    expect(blueprintCall!.system).toMatch(/guaranteed return/i);
  });

  test('insurance + legal items receive their respective policies', async () => {
    systemPrompts.length = 0;
    const insCtx = buildGovernancePromptContext({
      companyContext: { industry: 'Insurance' },
      contentType: 'image',
      selectedStrategy: 'educational',
    });
    await generateContentBlueprint({
      execution_id: 'test-3',
      company_id: 'co-ins',
      content_type: 'post',
      topic: 'ins topic',
      governance: insCtx,
    } as any);
    const insCall = systemPrompts.find((p) => p.operation === 'generateContentBlueprint');
    expect(insCall!.system).toMatch(/COMPLIANCE POLICY \(insurance industry/i);

    systemPrompts.length = 0;
    const legalCtx = buildGovernancePromptContext({
      companyContext: { industry: 'Law' },
      contentType: 'image',
      selectedStrategy: 'educational',
    });
    await generateContentBlueprint({
      execution_id: 'test-4',
      company_id: 'co-lg',
      content_type: 'post',
      topic: 'legal topic',
      governance: legalCtx,
    } as any);
    const legalCall = systemPrompts.find((p) => p.operation === 'generateContentBlueprint');
    expect(legalCall!.system).toMatch(/COMPLIANCE POLICY \(legal industry/i);
    expect(legalCall!.system).toMatch(/legal guarantee/i);
  });
});

/* ── Phase 3 — master content generation threads governance ─────── */

function masterItem(overrides: Record<string, unknown>): any {
  return {
    execution_id: 'master-test',
    company_id: 'co-x',
    content_type: 'post',
    topic: 'sample topic',
    intent: { target_audience: 'audience' },
    ...overrides,
  };
}

describe('Phase 3 — generateMasterContentFromIntent threads governance', () => {
  test('healthcare item → master system prompt contains compliance policy', async () => {
    const ctx = buildGovernancePromptContext({
      companyContext: { industry: 'Healthcare' },
      contentType: 'image',
      selectedStrategy: 'educational',
    });
    await generateMasterContentFromIntent(masterItem({ governance: ctx }));
    const masterCall = systemPrompts.find((p) => p.operation === 'generateMasterContent');
    expect(masterCall).toBeDefined();
    expect(masterCall!.system).toMatch(/COMPLIANCE POLICY \(healthcare industry/i);
    expect(masterCall!.system).toMatch(/clinical claim/i);
  });

  test('finance item → master system prompt contains finance policy', async () => {
    const ctx = buildGovernancePromptContext({
      companyContext: { industry: 'Finance' },
      contentType: 'image',
      selectedStrategy: 'educational',
    });
    await generateMasterContentFromIntent(masterItem({ governance: ctx }));
    const masterCall = systemPrompts.find((p) => p.operation === 'generateMasterContent');
    expect(masterCall!.system).toMatch(/COMPLIANCE POLICY \(finance industry/i);
    expect(masterCall!.system).toMatch(/guaranteed return/i);
  });

  test('item without governance → no compliance header in master system prompt', async () => {
    await generateMasterContentFromIntent(masterItem({}));
    const masterCall = systemPrompts.find((p) => p.operation === 'generateMasterContent');
    expect(masterCall).toBeDefined();
    expect(masterCall!.system).not.toMatch(/COMPLIANCE POLICY/i);
  });

  test('SaaS governance → no compliance header (industry=none)', async () => {
    const ctx = buildGovernancePromptContext({
      companyContext: { industry: 'SaaS' },
      contentType: 'image',
      selectedStrategy: 'promotional',
    });
    await generateMasterContentFromIntent(masterItem({ governance: ctx }));
    const masterCall = systemPrompts.find((p) => p.operation === 'generateMasterContent');
    expect(masterCall!.system).not.toMatch(/COMPLIANCE POLICY/i);
  });
});

/* ── Phase 4 — Validation: byte-identical no-governance vs SaaS ─── */

describe('Phase 4 — byte-identical system prompts when no policy applies', () => {
  test('legacy caller (no governance) and SaaS-governance produce identical master system prompts', async () => {
    await generateMasterContentFromIntent(masterItem({ topic: 'fixed-topic' }));
    const legacy = systemPrompts.find((p) => p.operation === 'generateMasterContent')!.system;

    systemPrompts.length = 0;
    await generateMasterContentFromIntent(masterItem({
      topic: 'fixed-topic',
      governance: buildGovernancePromptContext({
        companyContext: { industry: 'SaaS' },
        contentType: 'image',
        selectedStrategy: 'promotional',
      }),
    }));
    const withSaas = systemPrompts.find((p) => p.operation === 'generateMasterContent')!.system;

    expect(withSaas).toBe(legacy);
  });

  test('healthcare governance produces a STRICTLY LONGER master system prompt than legacy', async () => {
    await generateMasterContentFromIntent(masterItem({}));
    const legacy = systemPrompts.find((p) => p.operation === 'generateMasterContent')!.system;

    systemPrompts.length = 0;
    await generateMasterContentFromIntent(masterItem({
      governance: buildGovernancePromptContext({
        companyContext: { industry: 'Healthcare' },
        contentType: 'image',
        selectedStrategy: 'educational',
      }),
    }));
    const governed = systemPrompts.find((p) => p.operation === 'generateMasterContent')!.system;

    expect(governed.length).toBeGreaterThan(legacy.length);
    expect(governed.endsWith(legacy)).toBe(true); // preamble was PREPENDED
  });
});
