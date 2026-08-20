/**
 * WS-1c-3b (PMO-ADR-09) — FAMILY #9 day_content convergence QUALITY-A/B.
 *
 * Convergence for #9 is QUALITY-gated, NOT byte-parity: the runtime-delegated path
 * grounds the model in the ONE canonical context read instead of an embedded
 * `JSON.stringify(companyProfile)`, so the PROMPT (and thus the generation) DIFFERS
 * from legacy by design. This harness validates the delegated output is:
 *   1. STRUCTURALLY COMPLETE — every schema field present + required fields non-empty.
 *   2. ON-TOPIC / COHERENT — the delegated prompt carries the SAME planning inputs
 *      (campaign / day / trend / platform) AND is grounded in the canonical company
 *      context block; it does NOT fall back to the legacy profile-JSON dump.
 *   3. CONVERGED — flag ON reuses the ONE canonical context read (resolveContentContext)
 *      + the ONE gateway; no bespoke company-context assembly remains reachable.
 *   4. NON-DOUBLE-PERSISTING — the function still returns the object for the caller
 *      to persist (it never persists itself), identical to legacy.
 *
 * Heavy seams (gateway, canonical context, refinement) are mocked so the REAL family
 * + REAL runtime + REAL day_content profile run over them, deterministically.
 */

const gatewayCalls: Array<{ operation: string; user: string; system: string; model: string; temperature: number }> = [];
jest.mock('../../services/aiGateway', () => ({
  runCompletionWithOperation: jest.fn(async (req: any) => {
    gatewayCalls.push({
      operation: req.operation,
      model: req.model,
      temperature: req.temperature,
      system: req.messages.find((m: any) => m.role === 'system')?.content ?? '',
      user: req.messages.find((m: any) => m.role === 'user')?.content ?? '',
    });
    return {
      output: JSON.stringify({
        headline: 'Ship faster without breaking trust',
        caption: 'How Acme keeps onboarding tight while scaling.',
        hook: 'Most onboarding flows leak activation on day one.',
        callToAction: 'See the 3-step fix',
        hashtags: ['#onboarding', '#activation'],
        tone: 'professional',
        reasoning: 'Grounded in Acme onboarding context and the weekly plan.',
      }),
    };
  }),
}));

jest.mock('../../services/context/canonicalContentContextResolver', () => ({
  resolveContentContext: jest.fn(async (companyId: string) => ({
    companyId, profile: null,
    identity: { companyName: 'Acme', industry: 'SaaS' },
    brand: 'Acme', identityNames: ['Acme'],
    audience: 'B2B activation leads', tone: 'Direct and practical',
    objective: null, businessContext: 'Onboarding automation platform',
    creatorCompany: {}, contextBlock: 'COMPANY: Acme\nINDUSTRY: SaaS\nUNIQUE VALUE: fastest onboarding',
    adaptation: null,
  })),
}));

// Runtime leaf deps loaded at module import — mocked to keep the test hermetic
// (the day_content profile path never calls them, but the module imports them).
jest.mock('../../services/content/contentMemoryService', () => ({
  getBrandMemory: jest.fn(async () => null),
  retrieveRelevant: jest.fn(async () => []),
  indexContentUnit: jest.fn(async () => null),
  persistOriginality: jest.fn(async () => null),
  isContentMemoryWriteEnabled: jest.fn(() => false),
}));
jest.mock('../../services/content/originalityGate', () => ({ assertOriginality: jest.fn() }));
jest.mock('../../services/content/contentService', () => ({ createContent: jest.fn() }));
jest.mock('../../services/contentGenerationPipeline', () => ({
  generateMasterContentFromIntent: jest.fn(),
  buildPlatformVariantsFromMaster: jest.fn(),
}));

// Family downstream shaping — mock to identity so structural completeness is the
// pure signal (refinement is proven-shared, not re-tested here).
jest.mock('../../services/contentOverlapService', () => ({
  detectContentOverlap: jest.fn(async () => ({ similarityScore: 0.1 })),
}));
jest.mock('../../services/languageRefinementService', () => ({
  refineLanguageOutput: jest.fn(async (req: any) => ({ refined: req.content })),
}));
jest.mock('../../services/editorialTextRefinementService', () => ({
  refineGeneratedText: jest.fn((text: string) => text),
}));

import { generateContentForDay } from '../../services/contentGenerationService';

const FLAG = 'CONTENTGEN_DAY_RUNTIME_DELEGATION_ENABLED';

const REQUIRED = ['headline', 'caption', 'hook', 'callToAction', 'tone', 'reasoning'] as const;
function assertStructurallyComplete(obj: any) {
  for (const k of REQUIRED) {
    expect(typeof obj[k]).toBe('string');
    expect(String(obj[k]).trim().length).toBeGreaterThan(0);
  }
  expect(Array.isArray(obj.hashtags)).toBe(true);
}

const CORPUS = [
  {
    companyProfile: { company_id: 'co-1', name: 'Acme', target_audience: 'B2B ops' } as any,
    campaign: { objective: 'Grow activation', id: 'camp-1' },
    weekPlan: { week_number: 1, theme: 'Onboarding' },
    dayPlan: { date: '2026-07-21', content_type: 'post', topic: 'Day-one activation' },
    trend: 'AI onboarding',
    platform: 'linkedin',
    forcedContext: null,
    campaignMemory: { pastThemes: [], pastTopics: [], pastHooks: [], pastTrendsUsed: [], pastPlatforms: [], pastContentSummaries: [] },
  },
  {
    companyProfile: { company_id: 'co-1', name: 'Acme' } as any,
    campaign: { objective: 'Drive demo signups', id: 'camp-2' },
    weekPlan: { week_number: 2, theme: 'Proof' },
    dayPlan: { date: '2026-07-22', content_type: 'post', topic: 'Case study teaser' },
    trend: null,
    platform: 'instagram',
    forcedContext: null,
  },
] as const;

afterEach(() => { delete process.env[FLAG]; });
beforeEach(() => { gatewayCalls.length = 0; });

describe('WS-1c-3b #9 day_content — legacy vs delegated QUALITY-A/B', () => {
  it.each(CORPUS.map((c, i) => [`${c.platform}/${i}`, c] as const))(
    'both paths produce structurally-complete content; delegated is canonically grounded — %s',
    async (_name, input) => {
      // A) legacy (flag OFF)
      delete process.env[FLAG];
      gatewayCalls.length = 0;
      const legacy = await generateContentForDay({ ...(input as any) });
      const legacyPrompt = gatewayCalls[0]!.user;

      // B) delegated (flag ON)
      process.env[FLAG] = '1';
      gatewayCalls.length = 0;
      const delegated = await generateContentForDay({ ...(input as any) });
      const delegatedPrompt = gatewayCalls[0]!.user;

      // (1) STRUCTURAL COMPLETENESS — both.
      assertStructurallyComplete(legacy);
      assertStructurallyComplete(delegated);

      // (2) POLICY faithful — same operation/temperature the family always used.
      expect(gatewayCalls[0]!.operation).toBe('generateContentForDay');
      expect(gatewayCalls[0]!.temperature).toBe(0);

      // (3) CONVERGENCE — delegated prompt is grounded in the CANONICAL context block,
      //     NOT the legacy `Company Profile:` JSON dump.
      expect(delegatedPrompt).toContain('Company Context:');
      expect(delegatedPrompt).toContain('COMPANY: Acme');
      expect(delegatedPrompt).not.toContain('Company Profile:');
      // Legacy, by contrast, embeds the raw profile JSON dump.
      expect(legacyPrompt).toContain('Company Profile:');

      // (4) ON-TOPIC — the delegated prompt still carries the SAME planning inputs.
      expect(delegatedPrompt).toContain(input.platform);
      expect(delegatedPrompt).toContain(String(input.dayPlan.topic));
      expect(delegatedPrompt).toContain('Campaign:');
      expect(delegatedPrompt).toContain('Day Plan:');
    },
  );

  it('delegated path never persists (caller-persist contract preserved — no double-persist)', async () => {
    const { createContent } = require('../../services/content/contentService');
    process.env[FLAG] = '1';
    await generateContentForDay({ ...(CORPUS[0] as any) });
    expect(createContent).not.toHaveBeenCalled();
  });

  it('FALL-BACK-SAFE — a runtime/gateway throw under the flag falls through to legacy and still returns content', async () => {
    const { runCompletionWithOperation } = require('../../services/aiGateway');
    process.env[FLAG] = '1';
    // First gateway call (delegated) throws; the legacy fall-through call succeeds.
    (runCompletionWithOperation as jest.Mock)
      .mockRejectedValueOnce(new Error('provider down'));
    const out = await generateContentForDay({ ...(CORPUS[0] as any) });
    assertStructurallyComplete(out);
  });
});
