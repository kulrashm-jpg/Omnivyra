/**
 * PMF-003 §1/§2/§8/§10/§11 — Long-form Capability Profile, registration, platform
 * runtime output parity, safety-net (zero regression), observability, determinism.
 */

jest.mock('../../observability', () => ({ recordRawCounter: jest.fn(), recordRawHistogram: jest.fn() }));
jest.mock('../../services/aiCapability/aiCapabilityRuntime', () => ({ executeCapability: jest.fn() }));

import { recordRawCounter } from '../../observability';
import {
  LONG_FORM_CAPABILITY_IDS, resolveLongFormProfile, profileForEngineContentType,
} from '../../services/longFormCapability/longFormCapabilityProfile';
import {
  getLongFormRuntimeMode, shouldRunPlatform,
} from '../../services/longFormCapability/longFormMigrationFlag';
import { runLongFormCapability } from '../../services/longFormCapability/longFormPlatformRuntime';

const NOW = '2026-07-13T00:00:00.000Z';

function capResult(result: unknown, over: Record<string, unknown> = {}) {
  return {
    status: 'completed', capability: 'LONG_FORM_CONTENT', result, confidence: 0,
    sources: [{ kind: 'knowledge', ref: 'k' }], knowledgeVersion: 9,
    execution: { capability: 'LONG_FORM_CONTENT', startedAt: NOW, finishedAt: NOW, durationMs: 0, model: 'gpt-4o-mini', attempts: 1, resumed: false, stagesCompleted: [], knowledgeVersion: 9, tokens: { input: 5, output: 5 }, cacheUsed: false },
    tools: { calls: [], totalMs: 0, okCount: 0, failedCount: 0 }, validation: { ok: true, checks: [], failures: 0 },
    ...over,
  };
}

// Executor that mimics AIC: runs the modelRunner (→ engine), returns completed with parsed result.
const completingExecutor = jest.fn(async (_req: any, deps: any) => {
  await deps.modelRunner({});
  return capResult(deps.outputParser({}, ''));
});

beforeEach(() => { jest.clearAllMocks(); delete process.env.LONG_FORM_RUNTIME; });

describe('PMF-003 §1/§2 — capability profiles', () => {
  test('all ten long-form types registered', () => {
    expect(LONG_FORM_CAPABILITY_IDS.sort()).toEqual(['ARTICLE', 'BLOG', 'CASE_STUDY', 'EBOOK', 'GUIDE', 'LANDING_PAGE', 'NEWSLETTER', 'PILLAR_PAGE', 'STORY', 'WHITEPAPER']);
    const blog = resolveLongFormProfile('BLOG')!;
    expect(blog.engineContentType).toBe('blog');
    expect(blog.knowledge.consumer).toBe('CONTENT_WRITER');
    expect(blog.validationStrategy).toContain('DUPLICATION_DETECTOR');
    expect(blog.qualityGates).toContain('THOUGHT_LEADERSHIP_VALIDATOR');
    expect(resolveLongFormProfile('STORY')!.postProcessing).toEqual(['POST_PROCESSING_STORY']);
  });
  test('profileForEngineContentType maps the engine content type', () => {
    expect(profileForEngineContentType('blog')?.id).toBe('BLOG');
    expect(profileForEngineContentType('case-study')?.id).toBe('CASE_STUDY');
    expect(profileForEngineContentType('nope')).toBeNull();
  });
});

describe('PMF-003 §10 — reversible flag', () => {
  test('defaults to legacy; platform/dual run platform', () => {
    expect(getLongFormRuntimeMode()).toBe('legacy');
    expect(shouldRunPlatform()).toBe(false);
    process.env.LONG_FORM_RUNTIME = 'platform';
    expect(shouldRunPlatform()).toBe(true);
    process.env.LONG_FORM_RUNTIME = 'dual';
    expect(shouldRunPlatform()).toBe(true);
    process.env.LONG_FORM_RUNTIME = 'garbage';
    expect(getLongFormRuntimeMode()).toBe('legacy');
  });
});

describe('PMF-003 §8/§11 — platform runtime output parity + observability', () => {
  test('serves the EXACT engine result (identity) and records platform telemetry', async () => {
    const CANNED = { needs_clarification: false, mode: 'full', result: { title: 'T', content_html: '<p>x</p>' } };
    const engineRunner = jest.fn(async () => CANNED);
    const out = await runLongFormCapability(
      { engineContentType: 'blog', engineRequest: { topic: 'x', company_id: 'org1' }, companyId: 'org1', now: NOW },
      { engineRunner, capabilityExecutor: completingExecutor as any },
    );
    expect(out).toBe(CANNED); // exact object, no round-trip
    expect(engineRunner).toHaveBeenCalledTimes(1);
    expect(engineRunner).toHaveBeenCalledWith({ topic: 'x', company_id: 'org1' });
    const counters = (recordRawCounter as jest.Mock).mock.calls.map((c) => c[0]);
    expect(counters).toContain('longform.runtime_usage');
    expect(counters).toContain('longform.migration_coverage');
    expect(counters).toContain('longform.knowledge_version_usage');
  });

  test('deterministic: identical engine → identical result', async () => {
    const engineRunner = jest.fn(async () => ({ a: 1, b: [2, 3] }));
    const a = await runLongFormCapability({ engineContentType: 'guide', engineRequest: {}, companyId: 'org1', now: NOW }, { engineRunner, capabilityExecutor: completingExecutor as any });
    const b = await runLongFormCapability({ engineContentType: 'guide', engineRequest: {}, companyId: 'org1', now: NOW }, { engineRunner, capabilityExecutor: completingExecutor as any });
    expect(a).toEqual(b);
  });
});

describe('PMF-003 §8 — safety net (zero regression)', () => {
  test('pipeline failure before engine runs → engine executed directly', async () => {
    const CANNED = { result: 'engine-direct' };
    const engineRunner = jest.fn(async () => CANNED);
    // Executor fails WITHOUT invoking the modelRunner (mimics grounding-guard fail).
    const failingExecutor = jest.fn(async () => capResult(null, { status: 'failed' }));
    const out = await runLongFormCapability({ engineContentType: 'blog', engineRequest: {}, companyId: 'org1', now: NOW }, { engineRunner, capabilityExecutor: failingExecutor as any });
    expect(out).toBe(CANNED);
    expect(engineRunner).toHaveBeenCalledTimes(1); // safety net ran it
  });

  test('pipeline throw → engine executed directly (never worse than legacy)', async () => {
    const CANNED = { result: 'recovered' };
    const engineRunner = jest.fn(async () => CANNED);
    const throwingExecutor = jest.fn(async () => { throw new Error('pipeline boom'); });
    const out = await runLongFormCapability({ engineContentType: 'article', engineRequest: {}, companyId: 'org1', now: NOW }, { engineRunner, capabilityExecutor: throwingExecutor as any });
    expect(out).toBe(CANNED);
    expect(engineRunner).toHaveBeenCalledTimes(1);
  });
});
