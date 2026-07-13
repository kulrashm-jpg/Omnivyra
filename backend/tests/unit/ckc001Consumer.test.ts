/**
 * CKC-001 §1/§6/§8 — the canonical consumer gateway: cache hit/miss, version
 * selection, invalidation, events, and backward-compatible fail-safe behavior.
 */

jest.mock('../../db/supabaseClient', () => ({ supabase: { from: jest.fn() } }));
jest.mock('../../security/audit/SecurityAuditService', () => ({ logSecurityEvent: jest.fn(async () => undefined) }));
jest.mock('../../observability', () => ({ recordRawCounter: jest.fn(), recordRawHistogram: jest.fn() }));
jest.mock('../../services/signupEventService', () => ({
  SIGNUP_EVENT_SCHEMA_VERSION: '1.1', ensureSignupCorrelationId: jest.fn(async () => null),
}));
// Force the context cache onto its deterministic in-memory tier.
jest.mock('../../queue/standaloneRedisClient', () => ({
  getInstrumentedStandaloneRedisClient: () => { throw new Error('no-redis-in-test'); },
  isSharedStandaloneRedisAvailable: () => false,
}));
jest.mock('../../services/knowledge/companyKnowledgeService', () => ({
  getCurrentKnowledge: jest.fn(),
  getKnowledgeByVersion: jest.fn(),
}));
jest.mock('../../services/crawl/knowledgeVersionStore', () => ({
  getKnowledgeState: jest.fn(async () => ({ version: { version: 7 }, history: [] })),
}));

import { logSecurityEvent } from '../../security/audit/SecurityAuditService';
import { getCurrentKnowledge, getKnowledgeByVersion } from '../../services/knowledge/companyKnowledgeService';
import {
  getKnowledgeContext, invalidateKnowledgeContext,
} from '../../services/knowledgeConsumption/companyKnowledgeConsumer';
import { clearContextMemoryCache } from '../../services/knowledgeConsumption/knowledgeContextCache';
import type { KnowledgeDomain, KnowledgeDomainId } from '../../services/knowledge/companyKnowledgeModel';

const mockLog = logSecurityEvent as jest.MockedFunction<typeof logSecurityEvent>;
const mockCurrent = getCurrentKnowledge as jest.Mock;
const mockByVersion = getKnowledgeByVersion as jest.Mock;
const NOW = '2026-07-13T00:00:00.000Z';

function fixture(version: number) {
  const domains = {} as Record<KnowledgeDomainId, KnowledgeDomain>;
  domains.IDENTITY = { domain: 'IDENTITY', fields: { name: 'Acme', language: 'en' }, sourceFields: ['name'] };
  domains.BRAND = { domain: 'BRAND', fields: { brand_voice: 'friendly' }, sourceFields: ['brand_voice'] };
  domains.AUDIENCE = { domain: 'AUDIENCE', fields: { target_audience: 'SMB' }, sourceFields: ['target_audience'] };
  const entity = {
    companyId: 'org1', version, createdAt: NOW, createdBy: null, refreshReason: 'r', refreshPolicy: 'EXECUTE_REFRESH',
    sourceFingerprints: null, provenance: null, confidence: { overall: 80, byDomain: { IDENTITY: 90, BRAND: 80, AUDIENCE: 70 } },
    dependencies: [], lifecycle: 'ACTIVE',
  };
  return { entity, domains };
}

function capabilities(): string[] { return mockLog.mock.calls.map((c) => (c[0] as any).capability); }

beforeEach(() => {
  jest.clearAllMocks();
  clearContextMemoryCache();
  mockCurrent.mockResolvedValue(fixture(7));
  mockByVersion.mockResolvedValue({ ...fixture(4) });
});

describe('CKC-001 §1/§6/§8 — gateway pipeline', () => {
  test('first request: miss → assemble → serve, with the full event trail', async () => {
    const ctx = await getKnowledgeContext({ companyId: 'org1', consumer: 'CONTENT_WRITER', domains: ['IDENTITY', 'BRAND'], now: NOW });
    expect(ctx).not.toBeNull();
    expect(ctx!.metadata.version).toBe(7);
    expect(ctx!.metadata.domainsIncluded).toEqual(['IDENTITY', 'BRAND']);
    const caps = capabilities();
    expect(caps).toContain('consumption.ContextRequested');
    expect(caps).toContain('consumption.ContextCacheMiss');
    expect(caps).toContain('consumption.ContextAssembled');
    expect(caps).toContain('consumption.ContextServed');
  });

  test('second identical request: cache hit (no re-resolve)', async () => {
    const req = { companyId: 'org1', consumer: 'CONTENT_WRITER' as const, domains: ['IDENTITY'] as KnowledgeDomainId[], now: NOW };
    await getKnowledgeContext(req);
    mockCurrent.mockClear();
    const ctx2 = await getKnowledgeContext(req);
    expect(ctx2).not.toBeNull();
    expect(mockCurrent).not.toHaveBeenCalled(); // served from cache
    expect(capabilities()).toContain('consumption.ContextCacheHit');
  });

  test('invalidation clears the cache and emits ContextInvalidated; next request misses again', async () => {
    const req = { companyId: 'org1', consumer: 'CONTENT_WRITER' as const, domains: ['IDENTITY'] as KnowledgeDomainId[], now: NOW };
    await getKnowledgeContext(req);
    const removed = await invalidateKnowledgeContext('org1', 'test');
    expect(removed).toBeGreaterThanOrEqual(1);
    expect(capabilities()).toContain('consumption.ContextInvalidated');
    mockCurrent.mockClear();
    await getKnowledgeContext(req);
    expect(mockCurrent).toHaveBeenCalled(); // re-resolved after invalidation
  });

  test('specific version selector reads the versioned snapshot', async () => {
    const ctx = await getKnowledgeContext({ companyId: 'org1', consumer: 'SEO', version: { kind: 'specific', version: 4 }, domains: ['IDENTITY'], now: NOW });
    expect(mockByVersion).toHaveBeenCalledWith('org1', 4);
    expect(ctx!.metadata.version).toBe(4);
  });

  test('noCache bypasses read but still serves and populates', async () => {
    const req = { companyId: 'org1', consumer: 'CONTENT_WRITER' as const, domains: ['IDENTITY'] as KnowledgeDomainId[], now: NOW, noCache: true };
    const ctx = await getKnowledgeContext(req);
    expect(ctx).not.toBeNull();
    // populated despite bypass → a subsequent cached read (without noCache) hits.
    const ctx2 = await getKnowledgeContext({ ...req, noCache: false });
    expect(ctx2).not.toBeNull();
  });

  test('no knowledge → null, never throws', async () => {
    mockCurrent.mockResolvedValue(null);
    const ctx = await getKnowledgeContext({ companyId: 'org1', consumer: 'CONTENT_WRITER', now: NOW });
    expect(ctx).toBeNull();
  });

  test('missing companyId → null', async () => {
    const ctx = await getKnowledgeContext({ companyId: '', consumer: 'CONTENT_WRITER', now: NOW });
    expect(ctx).toBeNull();
  });
});
