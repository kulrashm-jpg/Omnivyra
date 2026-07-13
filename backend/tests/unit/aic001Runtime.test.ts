/**
 * AIC-001 §1/§3/§4/§7/§9/§10 — the canonical runtime pipeline end-to-end:
 * knowledge → … → output, with cache/events, fallback recovery, determinism,
 * and the canonical output contract. All dependencies injected for determinism.
 */

jest.mock('../../security/audit/SecurityAuditService', () => ({ logSecurityEvent: jest.fn(async () => undefined) }));
jest.mock('../../observability', () => ({ recordRawCounter: jest.fn(), recordRawHistogram: jest.fn() }));
jest.mock('../../services/signupEventService', () => ({ SIGNUP_EVENT_SCHEMA_VERSION: '1.1', ensureSignupCorrelationId: jest.fn(async () => null) }));
jest.mock('../../services/crawl/crawlEventService', () => ({ resolveCrawlCorrelationId: jest.fn(async () => 'company:org1') }));
jest.mock('../../services/knowledgeConsumption/companyKnowledgeConsumer', () => ({ getKnowledgeContext: jest.fn(async () => null) }));

import { logSecurityEvent } from '../../security/audit/SecurityAuditService';
import { executeCapability, type CapabilityRuntimeDeps } from '../../services/aiCapability/aiCapabilityRuntime';
import type { ModelRunner } from '../../services/aiCapability/capabilityModelRunner';
import type { ToolRegistry } from '../../services/aiCapability/capabilityTools';

const mockLog = logSecurityEvent as jest.MockedFunction<typeof logSecurityEvent>;
const NOW = '2026-07-13T00:00:00.000Z';

function knowledge(version = 7, fresh = true, overall = 80) {
  return {
    companyId: 'org1', consumer: 'CONTENT_WRITER',
    knowledge: { IDENTITY: { domain: 'IDENTITY', fields: { name: 'Acme' }, confidence: 90, sourceFields: ['name'] } },
    metadata: {
      version, lifecycle: 'ACTIVE', confidence: { overall, byDomain: { IDENTITY: 90 } }, provenance: null,
      freshness: { createdAt: NOW, ageMs: 0, fresh }, language: 'en', languageMatch: true, mode: 'summary',
      domainsIncluded: ['IDENTITY'], domainsDropped: [], tokens: { served: 10, full: 20, saved: 10 },
    },
  } as any;
}

const modelReturning = (text: string): ModelRunner => async () => ({ text, tokens: { input: 10, output: 5 }, model: 'claude-sonnet-5', cacheUsed: false });

function baseDeps(overrides: Partial<CapabilityRuntimeDeps> = {}): CapabilityRuntimeDeps {
  return {
    knowledgeFetcher: async () => knowledge(),
    modelRunner: modelReturning(JSON.stringify({ body: 'Hello world' })),
    nowIso: () => NOW,
    clockMs: () => 0,
    ...overrides,
  };
}

function capabilities(): string[] { return mockLog.mock.calls.map((c) => (c[0] as any).capability); }

beforeEach(() => jest.clearAllMocks());

describe('AIC-001 §1/§4/§7 — happy path', () => {
  test('completed with the canonical output contract + full pipeline + events', async () => {
    const res = await executeCapability({ capability: 'CONTENT_WRITER', companyId: 'org1', input: { topic: 'x' }, now: NOW }, baseDeps());
    expect(res.status).toBe('completed');
    expect(res.result).toEqual({ body: 'Hello world' });
    expect(res.confidence).toBeGreaterThan(0);
    expect(res.knowledgeVersion).toBe(7);
    // canonical envelope
    expect(res.sources.length).toBeGreaterThan(0);
    expect(res.execution.model).toBe('claude-sonnet-5');
    expect(res.execution.stagesCompleted).toEqual(expect.arrayContaining(['knowledge', 'prompt_assembly', 'tool_execution', 'grounding', 'validation', 'confidence', 'output_assembly']));
    expect(res.validation.ok).toBe(true);
    // events
    const caps = capabilities();
    expect(caps).toContain('capability.CapabilityRequested');
    expect(caps).toContain('capability.CapabilityStarted');
    expect(caps).toContain('capability.CapabilityValidated');
    expect(caps).toContain('capability.CapabilityCompleted');
  });

  test('deterministic: identical inputs + injected clocks → identical result', async () => {
    const a = await executeCapability({ capability: 'CONTENT_WRITER', companyId: 'org1', input: { topic: 'x' }, now: NOW }, baseDeps());
    const b = await executeCapability({ capability: 'CONTENT_WRITER', companyId: 'org1', input: { topic: 'x' }, now: NOW }, baseDeps());
    expect(a).toEqual(b);
  });
});

describe('AIC-001 §8 — failure recovery', () => {
  test('validation failure exhausts attempts → failed (partial not allowed)', async () => {
    const res = await executeCapability({ capability: 'CONTENT_WRITER', companyId: 'org1', now: NOW }, baseDeps({ modelRunner: modelReturning(JSON.stringify({ body: '' })) }));
    expect(res.status).toBe('failed');
    expect(res.validation.ok).toBe(false);
    expect(capabilities()).toContain('capability.CapabilityFailed');
  });

  test('model error then fallback model succeeds → completed + recovered', async () => {
    let call = 0;
    const runner: ModelRunner = async (input) => {
      call++;
      if (input.model !== 'claude-haiku-4-5-20251001') throw new Error('primary_down');
      return { text: JSON.stringify({ body: 'recovered' }), tokens: { input: 4, output: 2 }, model: input.model, cacheUsed: false };
    };
    const res = await executeCapability({ capability: 'CONTENT_WRITER', companyId: 'org1', now: NOW }, baseDeps({ modelRunner: runner }));
    expect(res.status).toBe('completed');
    expect(res.recovered).toBe(true);
    expect(res.execution.model).toBe('claude-haiku-4-5-20251001');
    expect(call).toBeGreaterThanOrEqual(2);
    expect(capabilities()).toContain('capability.CapabilityRecovered');
  });

  test('no knowledge + no tools → failed (CONTENT_WRITER) / partial (CAMPAIGN_PLANNER)', async () => {
    const failed = await executeCapability({ capability: 'CONTENT_WRITER', companyId: 'org1', now: NOW }, baseDeps({ knowledgeFetcher: async () => null }));
    expect(failed.status).toBe('failed');
    expect(failed.error).toBe('no_grounding');
    const partial = await executeCapability({ capability: 'CAMPAIGN_PLANNER', companyId: 'org1', now: NOW }, baseDeps({ knowledgeFetcher: async () => null }));
    expect(partial.status).toBe('partial');
  });
});

describe('AIC-001 §2/§3 — guards', () => {
  test('unknown capability → blocked', async () => {
    const res = await executeCapability({ capability: 'NOPE', companyId: 'org1', now: NOW }, baseDeps());
    expect(res.status).toBe('blocked');
    expect(res.error).toBe('unknown_capability');
  });
  test('missing companyId → blocked', async () => {
    const res = await executeCapability({ capability: 'CONTENT_WRITER', companyId: '', now: NOW }, baseDeps());
    expect(res.status).toBe('blocked');
  });
});

describe('AIC-001 §5 — tool integration in the pipeline', () => {
  test('capability tool runs, feeds sources, and completes', async () => {
    const registry: ToolRegistry = {
      website_snapshot: { id: 'website_snapshot', run: async () => ({ ok: true, output: { title: 'Acme' }, sources: [{ kind: 'tool', ref: 'website_snapshot', tool: 'website_snapshot' }] }) },
    };
    const res = await executeCapability(
      { capability: 'SEO_INTELLIGENCE', companyId: 'org1', now: NOW },
      baseDeps({ knowledgeFetcher: async () => knowledge(), modelRunner: modelReturning(JSON.stringify({ summary: 'seo insights' })), toolRegistry: registry }),
    );
    expect(res.status).toBe('completed');
    expect(res.tools.calls.find((c) => c.tool === 'website_snapshot')?.ok).toBe(true);
    expect(res.sources.some((s) => s.kind === 'tool')).toBe(true);
  });
});
