/**
 * PMF-004 §2/§8/§10/§11 — Creator Capability Profile, registration, platform runtime
 * output parity, safety-net (zero regression), observability, determinism.
 */

jest.mock('../../observability', () => ({ recordRawCounter: jest.fn(), recordRawHistogram: jest.fn() }));
jest.mock('../../services/aiCapability/aiCapabilityRuntime', () => ({ executeCapability: jest.fn() }));

import { recordRawCounter } from '../../observability';
import {
  CREATOR_CAPABILITY_IDS, resolveCreatorProfile, profileForAssetType,
} from '../../services/creatorCapability/creatorCapabilityProfile';
import { getCreatorRuntimeMode, shouldRunPlatform } from '../../services/creatorCapability/creatorMigrationFlag';
import { runCreatorCapability } from '../../services/creatorCapability/creatorPlatformRuntime';

const NOW = '2026-07-13T00:00:00.000Z';

function capResult(result: unknown, over: Record<string, unknown> = {}) {
  return {
    status: 'completed', capability: 'CREATOR_ASSET', result, confidence: 0,
    sources: [{ kind: 'knowledge', ref: 'k' }], knowledgeVersion: 7,
    execution: { capability: 'CREATOR_ASSET', startedAt: NOW, finishedAt: NOW, durationMs: 0, model: 'gpt-4o-mini', attempts: 1, resumed: false, stagesCompleted: [], knowledgeVersion: 7, tokens: { input: 3, output: 3 }, cacheUsed: false },
    tools: { calls: [], totalMs: 0, okCount: 0, failedCount: 0 }, validation: { ok: true, checks: [], failures: 0 },
    ...over,
  };
}

// Mimics AIC: runs the modelRunner (→ asset pipeline), returns completed with parsed result.
const completingExecutor = jest.fn(async (_req: any, deps: any) => {
  await deps.modelRunner({});
  return capResult(deps.outputParser({}, ''));
});

beforeEach(() => { jest.clearAllMocks(); delete process.env.CREATOR_RUNTIME; });

describe('PMF-004 §2 — creator capability profiles', () => {
  test('all eight asset types registered with strategy fields', () => {
    expect(CREATOR_CAPABILITY_IDS.sort()).toEqual(['BANNER', 'CAROUSEL', 'IMAGE', 'INFOGRAPHIC', 'PDF', 'PRESENTATION', 'SOCIAL_GRAPHIC', 'THUMBNAIL']);
    const carousel = resolveCreatorProfile('CAROUSEL')!;
    expect(carousel.assetType).toBe('carousel');
    expect(carousel.knowledge.consumer).toBe('CONTENT_CREATOR');
    expect(carousel.validationStrategy).toContain('brand_governance');
    expect(carousel.assetRules).toContain('publishing_prep');
    expect(carousel.executionMetadata.multiStep).toBe(true);
    // Presentation opts into asset review (AIA candidate).
    expect(resolveCreatorProfile('PRESENTATION')!.executionMetadata.assetReview).toBe(true);
  });
  test('profileForAssetType maps types + aliases', () => {
    expect(profileForAssetType('image')?.id).toBe('IMAGE');
    expect(profileForAssetType('social_graphic')?.id).toBe('SOCIAL_GRAPHIC');
    expect(profileForAssetType('deck')?.id).toBe('PRESENTATION');    // alias
    expect(profileForAssetType('thumb')?.id).toBe('THUMBNAIL');      // alias
    expect(profileForAssetType('nope')).toBeNull();
  });
});

describe('PMF-004 §10 — reversible flag', () => {
  test('defaults to legacy; platform/dual run platform; unknown → legacy', () => {
    expect(getCreatorRuntimeMode()).toBe('legacy');
    expect(shouldRunPlatform()).toBe(false);
    process.env.CREATOR_RUNTIME = 'platform';
    expect(shouldRunPlatform()).toBe(true);
    process.env.CREATOR_RUNTIME = 'dual';
    expect(shouldRunPlatform()).toBe(true);
    process.env.CREATOR_RUNTIME = 'garbage';
    expect(getCreatorRuntimeMode()).toBe('legacy');
  });
});

describe('PMF-004 §8/§11 — platform runtime output parity + observability', () => {
  test('serves the EXACT asset result (identity) and records platform telemetry', async () => {
    const ASSET = { assetId: 'a1', url: 'https://cdn/x.png', metadata: { w: 1080 } };
    const generate = jest.fn(async () => ASSET);
    const out = await runCreatorCapability({ assetType: 'image', companyId: 'org1', generate, now: NOW }, { capabilityExecutor: completingExecutor as any });
    expect(out).toBe(ASSET); // exact object, no reshape
    expect(generate).toHaveBeenCalledTimes(1);
    const counters = (recordRawCounter as jest.Mock).mock.calls.map((c) => c[0]);
    expect(counters).toContain('creator.runtime_usage');
    expect(counters).toContain('creator.migration_coverage');
    expect(counters).toContain('creator.knowledge_version_usage');
  });

  test('deterministic: identical generation → identical result', async () => {
    const generate = jest.fn(async () => ({ a: 1, layers: [2, 3] }));
    const a = await runCreatorCapability({ assetType: 'banner', companyId: 'org1', generate, now: NOW }, { capabilityExecutor: completingExecutor as any });
    const b = await runCreatorCapability({ assetType: 'banner', companyId: 'org1', generate, now: NOW }, { capabilityExecutor: completingExecutor as any });
    expect(a).toEqual(b);
  });
});

describe('PMF-004 §8 — safety net (zero regression)', () => {
  test('pipeline failure before asset runs → asset pipeline executed directly', async () => {
    const ASSET = { assetId: 'direct' };
    const generate = jest.fn(async () => ASSET);
    const failingExecutor = jest.fn(async () => capResult(null, { status: 'failed' }));
    const out = await runCreatorCapability({ assetType: 'image', companyId: 'org1', generate, now: NOW }, { capabilityExecutor: failingExecutor as any });
    expect(out).toBe(ASSET);
    expect(generate).toHaveBeenCalledTimes(1);
  });

  test('pipeline throw → asset pipeline executed directly (never worse than legacy)', async () => {
    const ASSET = { assetId: 'recovered' };
    const generate = jest.fn(async () => ASSET);
    const throwingExecutor = jest.fn(async () => { throw new Error('pipeline boom'); });
    const out = await runCreatorCapability({ assetType: 'pdf', companyId: 'org1', generate, now: NOW }, { capabilityExecutor: throwingExecutor as any });
    expect(out).toBe(ASSET);
    expect(generate).toHaveBeenCalledTimes(1);
  });
});
