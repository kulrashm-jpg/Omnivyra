/**
 * PMF-001 §4/§5/§7/§9 — the migrated Content Writer executes through AIC-001:
 * knowledge from CKC only, inference via executeCapability, byte-equivalent prompt
 * and output, capability events flowing.
 */

jest.mock('../../security/audit/SecurityAuditService', () => ({ logSecurityEvent: jest.fn(async () => undefined) }));
jest.mock('../../observability', () => ({ recordRawCounter: jest.fn(), recordRawHistogram: jest.fn() }));
jest.mock('../../services/signupEventService', () => ({ SIGNUP_EVENT_SCHEMA_VERSION: '1.1', ensureSignupCorrelationId: jest.fn(async () => null) }));
jest.mock('../../services/crawl/crawlEventService', () => ({ resolveCrawlCorrelationId: jest.fn(async () => 'company:org1') }));
// CKC is the ONLY knowledge source — mock the consumer to observe the request.
jest.mock('../../services/knowledgeConsumption/companyKnowledgeConsumer', () => ({ getKnowledgeContext: jest.fn() }));
// The gateway is the single LLM path — capture what the migrated model runner sends.
jest.mock('../../services/aiGateway', () => ({ runCompletionWithOperation: jest.fn() }));

import { logSecurityEvent } from '../../security/audit/SecurityAuditService';
import { getKnowledgeContext } from '../../services/knowledgeConsumption/companyKnowledgeConsumer';
import { runCompletionWithOperation } from '../../services/aiGateway';
import { generateWorkspaceVariants } from '../../services/contentWriter/contentWriterCapability';

const mockLog = logSecurityEvent as jest.MockedFunction<typeof logSecurityEvent>;
const mockKnowledge = getKnowledgeContext as jest.Mock;
const mockGateway = runCompletionWithOperation as jest.Mock;
const NOW = '2026-07-13T00:00:00.000Z';

function knowledgeFixture() {
  const dom = (domain: string, fields: Record<string, unknown>) => ({ domain, fields, confidence: 80, sourceFields: [] });
  return {
    companyId: 'org1', consumer: 'CONTENT_WRITER',
    knowledge: {
      IDENTITY: dom('IDENTITY', { name: 'Acme' }),
      INDUSTRY: dom('INDUSTRY', { industry: 'SaaS' }),
      BRAND: dom('BRAND', { brand_voice: 'Bold' }),
      AUDIENCE: dom('AUDIENCE', { target_audience: 'Founders' }),
    },
    metadata: {
      version: 5, lifecycle: 'ACTIVE', confidence: { overall: 80, byDomain: { IDENTITY: 90 } }, provenance: null,
      freshness: { createdAt: NOW, ageMs: 0, fresh: true }, language: 'en', languageMatch: true, mode: 'summary',
      domainsIncluded: ['IDENTITY', 'INDUSTRY', 'BRAND', 'AUDIENCE'], domainsDropped: [], tokens: { served: 10, full: 20, saved: 10 },
    },
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockKnowledge.mockResolvedValue(knowledgeFixture());
  mockGateway.mockResolvedValue({
    output: JSON.stringify({ LinkedIn: 'A LinkedIn post', X: 'A tweet', bogus: 123 }),
    metadata: { provider: 'direct-openai', model: 'gpt-4o-mini', token_usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 }, reasoning_trace_id: 't' },
  });
});

describe('PMF-001 §4 — migrated inference through executeCapability', () => {
  test('generates variants; CKC is the only knowledge source; gateway called with legacy params', async () => {
    const res = await generateWorkspaceVariants({ companyId: 'org1', userId: 'u1', topic: 'Launch', platforms: ['linkedin', 'x'], now: NOW });

    expect(res.status).toBe('completed');
    // output compatibility: lowercased keys, non-strings dropped
    expect(res.variants).toEqual({ linkedin: 'A LinkedIn post', x: 'A tweet' });
    expect(res.knowledgeVersion).toBe(5);

    // knowledge came from CKC (only), as the CONTENT_WRITER consumer
    expect(mockKnowledge).toHaveBeenCalledTimes(1);
    expect(mockKnowledge.mock.calls[0][0].consumer).toBe('CONTENT_WRITER');

    // gateway called once with the exact legacy model/operation/temperature
    expect(mockGateway).toHaveBeenCalledTimes(1);
    const arg = mockGateway.mock.calls[0][0];
    expect(arg.model).toBe('gpt-4o-mini');
    expect(arg.temperature).toBe(0.72);
    expect(arg.operation).toBe('generatePlatformVariants');
    expect(arg.response_format).toEqual({ type: 'json_object' });
  });

  test('the prompt carries CKC-derived brand context and the platform blocks', async () => {
    await generateWorkspaceVariants({ companyId: 'org1', userId: 'u1', topic: 'Launch', platforms: ['linkedin'], now: NOW });
    const messages = mockGateway.mock.calls[0][0].messages as Array<{ role: string; content: string }>;
    const system = messages.find((m) => m.role === 'system')!.content;
    const user = messages.find((m) => m.role === 'user')!.content;
    expect(system).toContain('You are an expert social media content strategist');
    expect(user).toContain('BRAND CONTEXT:\nCompany: Acme');
    expect(user).toContain('Industry: SaaS');
    expect(user).toContain('Tone of voice: Bold');
    expect(user).toContain('=== LINKEDIN ===');
    expect(user).toContain('TOPIC / ANGLE:\nLaunch');
  });

  test('§9 — capability events flow through the migrated path', async () => {
    await generateWorkspaceVariants({ companyId: 'org1', userId: 'u1', topic: 'Launch', platforms: ['linkedin'], now: NOW });
    const caps = mockLog.mock.calls.map((c) => (c[0] as any).capability);
    expect(caps).toContain('capability.CapabilityStarted');
    expect(caps).toContain('capability.CapabilityCompleted');
  });

  test('§7 — invalid model JSON surfaces an error (parity with legacy JSON.parse failure)', async () => {
    mockGateway.mockResolvedValue({ output: 'not json', metadata: { provider: 'direct-openai', model: 'gpt-4o-mini', token_usage: {}, reasoning_trace_id: 't' } });
    await expect(generateWorkspaceVariants({ companyId: 'org1', userId: 'u1', topic: 'Launch', platforms: ['linkedin'], now: NOW })).rejects.toThrow();
  });
});
