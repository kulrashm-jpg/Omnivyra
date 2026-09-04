/**
 * B5 — runtime integration (§16 C, D, H, I, K, P; §8 tier authority; §15).
 *
 * Proves the wiring, not the algorithm (that is platformNoveltyServiceB5).
 * The decisive assertions are the negative ones: with the flag OFF the platform
 * service is never called and no platform DB interaction occurs, and a rejected
 * candidate never reaches the fingerprint write.
 */

const mockEvaluate = jest.fn();
const mockRecord = jest.fn();
const mockEnabled = jest.fn();
jest.mock('../../services/content/platformNoveltyService', () => ({
  evaluatePlatformNovelty: (...a: unknown[]) => mockEvaluate(...a),
  recordPlatformFingerprint: (...a: unknown[]) => mockRecord(...a),
  isPlatformUniquenessEnabled: () => mockEnabled(),
}));

const mockGenerateMaster = jest.fn();
const mockBuildVariants = jest.fn();
jest.mock('../../services/contentGenerationPipeline', () => ({
  generateMasterContentFromIntent: (...a: unknown[]) => mockGenerateMaster(...a),
  buildPlatformVariantsFromMaster: (...a: unknown[]) => mockBuildVariants(...a),
}));
jest.mock('../../services/context/canonicalContentContextResolver', () => ({
  resolveContentContext: jest.fn(async () => ({ objective: null, audience: null, tone: null })),
}));
jest.mock('../../services/content/originalityGate', () => ({
  assertOriginality: jest.fn(async () => ({ isOriginal: true, score: 1, decision: 'accepted', nearestMatches: [], dimensions: {}, fingerprint: {} })),
}));
const mockCreateContent = jest.fn();
jest.mock('../../services/content/contentService', () => ({
  createContent: (...a: unknown[]) => mockCreateContent(...a),
}));

const mockIndexContentUnit = jest.fn(async () => null);
const mockPersistOriginality = jest.fn(async () => null);
jest.mock('../../services/content/contentMemoryService', () => ({
  indexContentUnit: (...a: unknown[]) => mockIndexContentUnit(...a),
  persistOriginality: (...a: unknown[]) => mockPersistOriginality(...a),
  retrieveRelevant: jest.fn(async () => []),
  getBrandMemory: jest.fn(async () => null),
}));

import { generationRuntime } from '../../services/content/runtime/generationRuntime';

const COMPANY = '11111111-1111-1111-1111-111111111111';
const PRIOR = process.env.CANONICAL_PERSISTENCE_ENABLED;

const baseReq = () => ({
  companyId: COMPANY,
  contentType: 'post' as const,
  topic: 'pipeline signals',
  persist: true,
});

beforeEach(() => {
  jest.clearAllMocks();
  process.env.CANONICAL_PERSISTENCE_ENABLED = 'true';
  mockEnabled.mockReturnValue(false);
  mockEvaluate.mockResolvedValue({ band: 'novel', score: 1, dimensions: {} });
  mockRecord.mockResolvedValue(true);
  mockCreateContent.mockResolvedValue({ id: 'content-1', lifecycleStatus: 'generated' });
  mockGenerateMaster.mockResolvedValue({ content: 'Three signals tell you a pipeline is stalling before revenue does.' });
  mockBuildVariants.mockResolvedValue([]);
});

afterAll(() => {
  if (PRIOR === undefined) delete process.env.CANONICAL_PERSISTENCE_ENABLED;
  else process.env.CANONICAL_PERSISTENCE_ENABLED = PRIOR;
});

/* ── §16 C — flag OFF ──────────────────────────────────────────────────── */

describe('B5 · C — flag OFF ⇒ zero platform interaction', () => {
  it('the platform service is never evaluated', async () => {
    mockEnabled.mockReturnValue(false);
    await generationRuntime.generate(baseReq() as never).catch(() => undefined);
    expect(mockEvaluate).not.toHaveBeenCalled();
  });

  it('no platform fingerprint is written', async () => {
    mockEnabled.mockReturnValue(false);
    await generationRuntime.generate(baseReq() as never).catch(() => undefined);
    expect(mockRecord).not.toHaveBeenCalled();
  });

  it('no platform_novelty stage is recorded', async () => {
    mockEnabled.mockReturnValue(false);
    const out = await generationRuntime.generate(baseReq() as never).catch(() => null);
    const stages = (out?.metrics as { stages?: string[] } | undefined)?.stages ?? [];
    expect(stages).not.toContain('platform_novelty');
  });

  it('no platformNovelty appears in metrics', async () => {
    mockEnabled.mockReturnValue(false);
    const out = await generationRuntime.generate(baseReq() as never).catch(() => null);
    expect((out?.metrics as Record<string, unknown> | undefined)?.platformNovelty).toBeUndefined();
  });
});

/* ── §16 D — flag ON (isolated) ────────────────────────────────────────── */

describe('B5 · D — flag ON ⇒ advisory evaluation, no tenant identifier passed', () => {
  it('evaluates and records the stage', async () => {
    mockEnabled.mockReturnValue(true);
    const out = await generationRuntime.generate(baseReq() as never).catch(() => null);
    expect(mockEvaluate).toHaveBeenCalledTimes(1);
    const stages = (out?.metrics as { stages?: string[] } | undefined)?.stages ?? [];
    expect(stages).toContain('platform_novelty');
  });

  it('passes ONLY a fingerprint + contentType — never companyId/campaignId', async () => {
    mockEnabled.mockReturnValue(true);
    await generationRuntime.generate(baseReq() as never).catch(() => undefined);
    const arg = mockEvaluate.mock.calls[0][0] as Record<string, unknown>;
    expect(Object.keys(arg).sort()).toEqual(['contentType', 'fingerprint']);
    expect(arg.companyId).toBeUndefined();
    expect(arg.campaignId).toBeUndefined();
    expect(arg.contentId).toBeUndefined();
  });

  it('surfaces the signal in metrics with no identifying field', async () => {
    mockEnabled.mockReturnValue(true);
    mockEvaluate.mockResolvedValue({ band: 'adjacent', score: 0.4, dimensions: { simhash: 0.6 } });
    const out = await generationRuntime.generate(baseReq() as never).catch(() => null);
    const sig = (out?.metrics as Record<string, unknown> | undefined)?.platformNovelty as Record<string, unknown>;
    expect(sig).toBeDefined();
    expect(Object.keys(sig).sort()).toEqual(['band', 'dimensions', 'score']);
  });
});

/* ── §16 H/I + §7 — advisory only, never blocks ────────────────────────── */

describe('B5 · H/I — a platform collision never blocks generation', () => {
  it('a saturated band still produces content', async () => {
    mockEnabled.mockReturnValue(true);
    mockEvaluate.mockResolvedValue({ band: 'saturated', score: 0.05, dimensions: { simhash: 0.95 } });
    const out = await generationRuntime.generate(baseReq() as never);
    expect(out).toBeDefined();
    expect(out.master).toBeDefined();
  });

  it('an evaluation that throws is swallowed and generation continues', async () => {
    mockEnabled.mockReturnValue(true);
    mockEvaluate.mockRejectedValue(new Error('platform store down'));
    await expect(generationRuntime.generate(baseReq() as never)).resolves.toBeDefined();
  });

  it('a saturated band does not suppress the canonical persistence path', async () => {
    mockEnabled.mockReturnValue(true);
    mockEvaluate.mockResolvedValue({ band: 'saturated', score: 0, dimensions: {} });
    await generationRuntime.generate(baseReq() as never);
    expect(mockCreateContent).toHaveBeenCalled();
  });
});

/* ── §16 J — write failure swallowed ───────────────────────────────────── */

describe('B5 · J — a fingerprint write failure never disturbs the artifact', () => {
  it('a rejecting recorder does not fail generation', async () => {
    mockEnabled.mockReturnValue(true);
    mockRecord.mockRejectedValue(new Error('write failed'));
    const out = await generationRuntime.generate(baseReq() as never);
    expect(out.contentId).toBe('content-1');   // artifact remains accepted
  });

  it('a false return is tolerated', async () => {
    mockEnabled.mockReturnValue(true);
    mockRecord.mockResolvedValue(false);
    await expect(generationRuntime.generate(baseReq() as never)).resolves.toBeDefined();
  });
});

/* ── §15 / §16 P — acceptance-only persistence ─────────────────────────── */

describe('B5 · P — the fingerprint is written only after acceptance', () => {
  it('a successful persist writes exactly one fingerprint', async () => {
    mockEnabled.mockReturnValue(true);
    await generationRuntime.generate(baseReq() as never);
    expect(mockRecord).toHaveBeenCalledTimes(1);
  });

  it('the write happens AFTER createContent, never before', async () => {
    mockEnabled.mockReturnValue(true);
    const order: string[] = [];
    mockCreateContent.mockImplementation(async () => {
      order.push('createContent');
      return { id: 'content-1', lifecycleStatus: 'generated' };
    });
    mockRecord.mockImplementation(async () => { order.push('recordFingerprint'); return true; });
    await generationRuntime.generate(baseReq() as never);
    expect(order).toEqual(['createContent', 'recordFingerprint']);
  });

  it('a REJECTED candidate (createContent throws) writes NO fingerprint', async () => {
    mockEnabled.mockReturnValue(true);
    mockCreateContent.mockRejectedValue(new Error('canonical persistence disabled'));
    await generationRuntime.generate(baseReq() as never).catch(() => undefined);
    expect(mockRecord).not.toHaveBeenCalled();
  });

  it('persist:false writes NO fingerprint (no acceptance occurred)', async () => {
    mockEnabled.mockReturnValue(true);
    await generationRuntime.generate({ ...baseReq(), persist: false } as never);
    expect(mockRecord).not.toHaveBeenCalled();
    expect(mockCreateContent).not.toHaveBeenCalled();
  });
});

/* ── §8 / §16 K — existing tiers stay authoritative ────────────────────── */

describe('B5 · K — the platform tier does not displace the existing tiers', () => {
  it('platform evaluation happens AFTER originality validation', async () => {
    mockEnabled.mockReturnValue(true);
    const out = await generationRuntime.generate(baseReq() as never);
    const stages = (out.metrics as { stages: string[] }).stages;
    const iPlatform = stages.indexOf('platform_novelty');
    const iPersist = stages.indexOf('persistence');
    expect(iPlatform).toBeGreaterThan(-1);
    // Platform sits between the generation/originality stages and persistence.
    expect(iPlatform).toBeLessThan(iPersist);
    expect(stages.indexOf('generation')).toBeLessThan(iPlatform);
  });

  it('the company-scoped memory index still receives the tenant identifiers', async () => {
    mockEnabled.mockReturnValue(true);
    await generationRuntime.generate(baseReq() as never);
    const arg = mockIndexContentUnit.mock.calls[0]?.[0] as Record<string, unknown> | undefined;
    expect(arg?.companyId).toBe(COMPANY);   // intra-company tier unchanged
  });
});
