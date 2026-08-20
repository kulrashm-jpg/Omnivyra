/**
 * WS-1c-3b (PMO-ADR-09) — FAMILY #10 blueprint profile QUALITY (module-level).
 *
 * #10's LIVE cutover of the @deprecated unifiedContentGenerationEngine.generateMasterContent
 * is DEFERRED (see the deliverable report). This harness proves the capability
 * GENERALIZES beyond #9: the "blueprint" task profile, driven through the ONE runtime,
 * grounds a blueprint in the ONE canonical context read (norm.identity) + a supplied
 * angle, and produces a STRUCTURALLY-COMPLETE blueprint. This de-risks the future
 * wiring — only the in-file flag branch + angle threading remain.
 *
 * The output DIFFERS from legacy by design (canonical identity vs the family's own
 * extract+auto-fetch precedence): validated for QUALITY (structure/grounding), not bytes.
 */

const gatewayCalls: Array<{ operation: string; user: string; system: string; temperature: number }> = [];
jest.mock('../../services/aiGateway', () => ({
  runCompletionWithOperation: jest.fn(async (req: any) => {
    gatewayCalls.push({
      operation: req.operation,
      temperature: req.temperature,
      system: req.messages.find((m: any) => m.role === 'system')?.content ?? '',
      user: req.messages.find((m: any) => m.role === 'user')?.content ?? '',
    });
    return {
      output: JSON.stringify({
        hook: 'The onboarding metric most teams ignore is costing them growth.',
        key_points: [
          'Activation, not signups, predicts retention.',
          'Day-one friction compounds across the funnel.',
          'A 3-step fix recovers most of the leak.',
        ],
        cta: 'Audit your day-one flow this week.',
      }),
    };
  }),
}));

jest.mock('../../services/context/canonicalContentContextResolver', () => ({
  // Preserve the real identity builders (buildContextBlock / buildCompetitorIdentityContext)
  // that lib/content/companyContextBlock's leaf builders delegate back to; override only
  // the profile fetch.
  ...jest.requireActual('../../services/context/canonicalContentContextResolver'),
  resolveContentContext: jest.fn(async (companyId: string) => ({
    companyId, profile: null,
    identity: {
      companyName: 'Acme', industry: 'SaaS', targetAudience: 'B2B activation leads',
      coreProblem: 'onboarding leaks activation', uniqueValue: 'fastest time-to-value',
      competitiveAdvantages: 'native activation analytics',
    },
    brand: 'Acme', identityNames: ['Acme'], audience: 'B2B activation leads',
    tone: 'Direct', objective: null, businessContext: 'Onboarding automation',
    creatorCompany: {}, contextBlock: 'COMPANY: Acme', adaptation: null,
  })),
}));

// Runtime leaf deps loaded at import — mocked (blueprint path never calls them).
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

import { generate } from '../../services/content/runtime/generationRuntime';
import type { GenerationRequest } from '../../services/content/runtime/contracts';
import { createContent } from '../../services/content/contentService';

beforeEach(() => { gatewayCalls.length = 0; jest.clearAllMocks(); });

const ANGLE = {
  type: 'contrarian', label: 'Contrarian',
  angle_summary: 'Signups are a vanity metric; activation is the real lever.',
  hook: 'Everyone celebrates signups. The winners obsess over activation.',
};

describe('WS-1c-3b #10 blueprint profile — capability generalization (quality)', () => {
  it('produces a structurally-complete blueprint grounded in canonical identity + the supplied angle', async () => {
    const out = await generate({
      companyId: 'co-1', contentType: 'blog', taskProfile: 'blueprint',
      taskProfileInput: {
        content_type: 'blog', topic: 'Why activation beats signups',
        intent: 'authority', audience: 'B2B activation leads', angle: ANGLE,
        tone_preference: 'authoritative',
      },
    } as GenerationRequest);

    const bp = out.master as any;
    // Structural completeness.
    expect(typeof bp.hook).toBe('string');
    expect(bp.hook.trim().length).toBeGreaterThan(0);
    expect(Array.isArray(bp.key_points)).toBe(true);
    expect(bp.key_points.length).toBeGreaterThanOrEqual(2);
    expect(bp.key_points.every((k: string) => k.trim().length > 0)).toBe(true);
    expect(typeof bp.cta).toBe('string');
    expect(bp.cta.trim().length).toBeGreaterThan(0);

    // Metadata assembled from CANONICAL identity (not a caller-supplied profile).
    expect(bp.metadata.company_context.companyName).toBe('Acme');
    expect(bp.metadata.selected_angle.type).toBe('contrarian');
    expect(bp.metadata.decision_trace.source_topic).toBe('Why activation beats signups');

    // Policy + prompt: faithful operation, angle threaded, canonical identity grounded.
    expect(out.metrics && (out.metrics as any).taskProfile).toBe('blueprint');
    expect(gatewayCalls[0]!.operation).toBe('generateMasterContent');
    expect(gatewayCalls[0]!.user).toContain('HOOK TO USE');
    expect(gatewayCalls[0]!.user).toContain('Everyone celebrates signups');
    expect(gatewayCalls[0]!.user).toContain('COMPANY CONTEXT');
    expect(gatewayCalls[0]!.system).toContain('Acme');

    // Persistence-free (family owns persistence) — no double-persist.
    expect(createContent).not.toHaveBeenCalled();
    expect(out.contentId).toBeNull();
  });

  it('degrades gracefully on empty model output (fallback shape still complete)', async () => {
    const { runCompletionWithOperation } = require('../../services/aiGateway');
    (runCompletionWithOperation as jest.Mock).mockResolvedValueOnce({ output: '' });
    const out = await generate({
      companyId: 'co-1', contentType: 'post', taskProfile: 'blueprint',
      taskProfileInput: { content_type: 'post', topic: 'Fallback topic', intent: 'awareness', angle: ANGLE },
    } as GenerationRequest);
    const bp = out.master as any;
    expect(bp.hook).toContain('Fallback topic');
    expect(Array.isArray(bp.key_points)).toBe(true);
    expect(bp.key_points.length).toBeGreaterThanOrEqual(1);
    expect(bp.cta.trim().length).toBeGreaterThan(0);
  });
});
