/**
 * WS-1c-3b (PMO-ADR-09) — TASK-PROFILE CAPABILITY unit tests.
 *
 * Proves the ADDITIVE capability:
 *   1. selectTaskProfile routes ONLY on an explicit, registered key (absent /
 *      'master' / unknown ⇒ null ⇒ default master path).
 *   2. generationRuntime.generate() with a registered profile key delegates to the
 *      profile execution path: it reuses the ONE canonical context read + the ONE
 *      gateway, produces the profile's structured output on `master`, and NEVER
 *      touches the master primitive or canonical persistence (no double-persist).
 *   3. generationRuntime.generate() with NO profile key runs the DEFAULT master
 *      body (calls the master primitive) — the guard is inert for existing callers.
 */

// ── master-path heavy deps (mirrors generationRuntime.test.ts) ────────────────
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
jest.mock('../../services/content/originalityGate', () => ({ assertOriginality: jest.fn() }));
jest.mock('../../services/content/contentService', () => ({ createContent: jest.fn() }));
// ── the ONE gateway (profile path) ────────────────────────────────────────────
jest.mock('../../services/aiGateway', () => ({
  runCompletionWithOperation: jest.fn(),
}));

import { generate } from '../../services/content/runtime/generationRuntime';
import {
  selectTaskProfile,
  registeredTaskProfileKeys,
} from '../../services/content/runtime/taskProfiles/registry';
import {
  generateMasterContentFromIntent,
  buildPlatformVariantsFromMaster,
} from '../../services/contentGenerationPipeline';
import { resolveContentContext } from '../../services/context/canonicalContentContextResolver';
import {
  getBrandMemory,
  retrieveRelevant,
} from '../../services/content/contentMemoryService';
import { assertOriginality } from '../../services/content/originalityGate';
import { createContent } from '../../services/content/contentService';
import { runCompletionWithOperation } from '../../services/aiGateway';
import type { GenerationRequest } from '../../services/content/runtime/contracts';

const mGenerateMaster = generateMasterContentFromIntent as jest.MockedFunction<typeof generateMasterContentFromIntent>;
const mBuildVariants = buildPlatformVariantsFromMaster as jest.MockedFunction<typeof buildPlatformVariantsFromMaster>;
const mResolveContext = resolveContentContext as jest.MockedFunction<typeof resolveContentContext>;
const mGetBrandMemory = getBrandMemory as jest.MockedFunction<typeof getBrandMemory>;
const mRetrieveRelevant = retrieveRelevant as jest.MockedFunction<typeof retrieveRelevant>;
const mAssertOriginality = assertOriginality as jest.MockedFunction<typeof assertOriginality>;
const mCreateContent = createContent as jest.MockedFunction<typeof createContent>;
const mGateway = runCompletionWithOperation as jest.MockedFunction<typeof runCompletionWithOperation>;

const NORM = {
  companyId: 'co-1', profile: null, identity: { companyName: 'Acme', industry: 'SaaS' },
  brand: 'Acme', identityNames: ['Acme'], audience: 'B2B operators', tone: 'Direct',
  objective: 'Increase activation', businessContext: 'Onboarding platform',
  creatorCompany: {} as any, contextBlock: 'COMPANY: Acme\nINDUSTRY: SaaS', adaptation: null,
};

beforeEach(() => {
  jest.clearAllMocks();
  mResolveContext.mockResolvedValue(NORM as any);
  mGetBrandMemory.mockResolvedValue(null);
  mRetrieveRelevant.mockResolvedValue([]);
  mGenerateMaster.mockResolvedValue({
    id: 'm', generated_at: '2026-07-20T00:00:00.000Z', content: 'Master body.',
    generation_status: 'generated', generation_source: 'ai',
  } as any);
  mBuildVariants.mockResolvedValue([]);
  mAssertOriginality.mockResolvedValue({
    isOriginal: true, score: 1, decision: 'accepted', nearestMatches: [], dimensions: {},
    fingerprint: { exactHash: 'h', normalizedHash: 'n', simhash: '0', minhash: [], structuralShape: '', tokenSummary: { tokens: [], shingles: [] } },
  } as any);
  mCreateContent.mockResolvedValue({ id: 'c-1', lifecycleStatus: 'draft' } as any);
  mGateway.mockResolvedValue({ output: JSON.stringify({
    headline: 'H', caption: 'C', hook: 'Hk', callToAction: 'CTA', hashtags: ['#a'],
    tone: 'professional', reasoning: 'R',
  }) } as any);
});

describe('selectTaskProfile', () => {
  it('routes only on an explicit registered key', () => {
    expect(selectTaskProfile({ companyId: 'x', contentType: 'post' } as GenerationRequest)).toBeNull();
    expect(selectTaskProfile({ companyId: 'x', contentType: 'post', taskProfile: '' } as GenerationRequest)).toBeNull();
    expect(selectTaskProfile({ companyId: 'x', contentType: 'post', taskProfile: 'master' } as GenerationRequest)).toBeNull();
    expect(selectTaskProfile({ companyId: 'x', contentType: 'post', taskProfile: 'nope' } as GenerationRequest)).toBeNull();
    expect(selectTaskProfile({ companyId: 'x', contentType: 'post', taskProfile: 'day_content' } as GenerationRequest)).toBe('day_content');
    expect(selectTaskProfile({ companyId: 'x', contentType: 'post', taskProfile: 'blueprint' } as GenerationRequest)).toBe('blueprint');
  });
  it('registers both non-master profiles', () => {
    expect(registeredTaskProfileKeys().sort()).toEqual(['blueprint', 'day_content']);
  });
});

describe('generationRuntime.generate — profile routing', () => {
  it('day_content profile delegates to the gateway, reuses canonical context, and NEVER touches the master primitive or persistence', async () => {
    const out = await generate({
      companyId: 'co-1', contentType: 'post', taskProfile: 'day_content',
      platform: 'linkedin',
      taskProfileInput: { platform: 'linkedin', campaign: { id: 'k' }, weekPlan: {}, dayPlan: {}, trend: 'AI' },
    } as GenerationRequest);

    // Reused the ONE canonical context read + the ONE gateway.
    expect(mResolveContext).toHaveBeenCalledWith('co-1', { objective: null });
    expect(mGateway).toHaveBeenCalledTimes(1);
    // Structured object on master.
    expect((out.master as any).headline).toBe('H');
    expect((out.metrics as any).taskProfile).toBe('day_content');
    // The master primitive + persistence were NEVER invoked (no double-persist).
    expect(mGenerateMaster).not.toHaveBeenCalled();
    expect(mCreateContent).not.toHaveBeenCalled();
    expect(out.contentId).toBeNull();
    // The gateway prompt is grounded in the canonical context block, not a profile JSON dump.
    const call = mGateway.mock.calls[0]![0] as any;
    const userMsg = call.messages.find((m: any) => m.role === 'user').content as string;
    expect(userMsg).toContain('Company Context:');
    expect(userMsg).toContain('COMPANY: Acme');
    expect(call.operation).toBe('generateContentForDay');
  });

  it('NO profile key runs the DEFAULT master body (guard inert)', async () => {
    await generate({
      companyId: 'co-1', contentType: 'post', topic: 'Onboarding', platform: 'linkedin',
    } as GenerationRequest);
    // Master primitive ran; the gateway (profile path) did not.
    expect(mGenerateMaster).toHaveBeenCalledTimes(1);
    expect(mGateway).not.toHaveBeenCalled();
  });
});
