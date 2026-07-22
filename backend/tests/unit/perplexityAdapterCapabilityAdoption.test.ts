/**
 * PB-005 — Perplexity visibility adapter → canonical Provider Capability Registry (PB-004).
 *
 * The certification question this suite answers is NOT "does the adapter call the
 * registry?" — it is "can ANY registry state remove or degrade the citation behavior
 * PB-002 restored?". The answer must be NO, for every state: supported, explicitly
 * unsupported, undeclared, unknown provider, and a registry that cannot be read at all.
 *
 * The registry module is mocked with a switchable mode so each of those states can be
 * driven against the real adapter on BOTH transports.
 */

/** Registry behaviour under test. `mock`-prefixed so the jest factory may close over it. */
let mockCapabilityMode: 'real' | 'unsupported' | 'undeclared' | 'throws' = 'real';

jest.mock('../../services/aiGatewayCapabilities', () => {
  const actual = jest.requireActual<typeof import('../../services/aiGatewayCapabilities')>(
    '../../services/aiGatewayCapabilities',
  );
  return {
    ...actual,
    getProviderCapability: (provider: string, capability: string) => {
      switch (mockCapabilityMode) {
        case 'unsupported':
          // A registry mis-declaration / drift: the Platform denies the capability.
          return { capability, supported: false, evidence: 'test: registry mis-declaration' };
        case 'undeclared':
          // "The Platform makes no claim" (also what an unknown provider yields).
          return undefined;
        case 'throws':
          // Capability information unavailable.
          throw new Error('capability registry unavailable');
        default:
          return actual.getProviderCapability(provider, capability);
      }
    },
  };
});

jest.mock('../../services/intelligence/productionPrimitives', () => ({
  withRetry: (_id: string, fn: () => Promise<unknown>) => fn(),
  fetchProduction: jest.fn(),
  getRateLimiter: () => ({ tryAcquire: () => true }),
  TtlCache: class {
    get(): undefined { return undefined; }
    set(): void {}
  },
  logProviderCall: jest.fn(),
  reasonFromError: (_id: string, e: unknown) => String(e),
  freshnessFromTimestamp: () => 'fresh',
}));
jest.mock('../../services/aiGatewayDispatcher', () => ({ dispatchTransport: jest.fn() }));
jest.mock('../../services/intelligence/costGovernance', () => ({
  withinBudget: () => ({ ok: true }),
  recordUsage: jest.fn(),
  estimateCost: () => 0,
}));
jest.mock('../../services/intelligence/scanBudgetContext', () => ({ getActiveScanId: () => null }));
jest.mock('../../services/intelligence/probeCostCapture', () => ({
  captureProbeCost: jest.fn(() => Promise.resolve()),
  extractProbeTokenUsage: () => ({ inputTokens: 0, outputTokens: 0, model: null }),
}));
jest.mock('../../services/intelligence/citationExtractor', () => ({
  extractCitation: jest.fn((args: { provider: string; query: string; query_class: string; answer: string; observedAt: string }) => ({
    provider: args.provider,
    query: args.query,
    query_class: args.query_class,
    appeared: /brand x/i.test(args.answer),
    prominence: 1,
    evidence_excerpt: null,
    observed_at: args.observedAt,
  })),
}));
jest.mock('../../services/intelligence/queryOrchestrator', () => ({
  formatQueryForProvider: (q: string) => ({ system: null, user: q }),
}));

import {
  PerplexityAdapter,
  reshapeCompletionToPerplexityResponse,
  reconcileCitationCapability,
  shouldReportCapabilityReconciliation,
  PERPLEXITY_ADAPTER_CONSUMED_CAPABILITY,
} from '../../services/intelligence/adapters/perplexityAdapter';
import { dispatchTransport } from '../../services/aiGatewayDispatcher';
import { fetchProduction, logProviderCall } from '../../services/intelligence/productionPrimitives';
import { extractCitation } from '../../services/intelligence/citationExtractor';
import { PROVIDER_CAPABILITIES } from '../../services/aiGatewayCapabilities';
import type { NormalizedCompletion } from '../../services/aiGatewayCore';

const dispatchMock = dispatchTransport as unknown as jest.Mock;
const fetchProdMock = fetchProduction as unknown as jest.Mock;
const logMock = logProviderCall as unknown as jest.Mock;
const extractCitationMock = extractCitation as unknown as jest.Mock;

const CITATIONS = ['https://a.com', 'https://b.com'];
const CONTENT = 'Brand X ranks highly';
const CITED_ANSWER = `${CONTENT}\nSources: ${CITATIONS.join(', ')}`;
const PROBE = { provider: 'perplexity', query_class: 'commercial', queries: ['best crm for teams'], brandName: 'Brand X' };

const withCitations = (citations: string[] = CITATIONS): NormalizedCompletion => ({
  content: CONTENT,
  usage: { prompt_tokens: 5, completion_tokens: 7, total_tokens: 12 },
  providerMetadata: { perplexity: { provider: 'perplexity', version: 1, data: { citations } } },
});

const lastAnswer = (): string => extractCitationMock.mock.calls.at(-1)?.[0]?.answer ?? '';

/** Capability-reconciliation diagnostic lines only (the base logs probe status too). */
const reconcileLogs = (): Array<{ operation: string; reason?: string }> =>
  logMock.mock.calls
    .map((c) => c[0] as { operation: string; reason?: string })
    .filter((c) => c?.operation === 'visibility.probe.perplexity.capability_reconcile');

const ALL_MODES: Array<typeof mockCapabilityMode> = ['real', 'unsupported', 'undeclared', 'throws'];

async function probeViaGateway(citations: string[] = CITATIONS) {
  process.env.PERPLEXITY_ADAPTER_GATEWAY_TRANSPORT = 'true';
  dispatchMock.mockResolvedValue(withCitations(citations));
  return new PerplexityAdapter().probe(PROBE as never);
}

async function probeViaLegacy(citations: string[] = CITATIONS) {
  delete process.env.PERPLEXITY_ADAPTER_GATEWAY_TRANSPORT;
  fetchProdMock.mockResolvedValue({
    json: async () => ({
      choices: [{ message: { content: CONTENT } }],
      ...(citations.length > 0 ? { citations } : {}),
      usage: { prompt_tokens: 5, completion_tokens: 7 },
      model: 'sonar',
    }),
  });
  return new PerplexityAdapter().probe(PROBE as never);
}

beforeEach(() => {
  jest.clearAllMocks();
  mockCapabilityMode = 'real';
  process.env.PERPLEXITY_API_KEY = 'test-key';
  delete process.env.PERPLEXITY_ADAPTER_GATEWAY_TRANSPORT;
});

// ── Adoption surface ──────────────────────────────────────────────────────────

describe('PB-005 — capability expectation is consumed, never re-declared', () => {
  it('names the canonical Platform capability (vocabulary is Platform-owned)', () => {
    expect(PERPLEXITY_ADAPTER_CONSUMED_CAPABILITY).toBe(PROVIDER_CAPABILITIES.CITATIONS);
    expect(PERPLEXITY_ADAPTER_CONSUMED_CAPABILITY).toBe('citations');
  });

  it('the real registry agrees with the adapter expectation (registry↔product agreement)', () => {
    const actual = jest.requireActual<typeof import('../../services/aiGatewayCapabilities')>(
      '../../services/aiGatewayCapabilities',
    );
    expect(actual.supportsCapability('perplexity', PROVIDER_CAPABILITIES.CITATIONS)).toBe(true);
    expect(actual.getProviderCapability('perplexity', PROVIDER_CAPABILITIES.CITATIONS)?.evidence)
      .toEqual(expect.stringContaining('PB-001'));
  });
});

// ── Reconciliation (pure) ─────────────────────────────────────────────────────

describe('PB-005 — reconciliation: capability available', () => {
  it('declared supported ⇒ agreed, evidence carried, no drift, citations applied', () => {
    const r = reconcileCitationCapability(2);
    expect(r.provider).toBe('perplexity');
    expect(r.capability).toBe('citations');
    expect(r.declared).toBe(true);
    expect(r.observed).toBe(true);
    expect(r.agreement).toBe('agreed');
    expect(typeof r.evidence).toBe('string');
    expect(r.drift).toBe(false);
    expect(r.citationsApplied).toBe(true);
    expect(shouldReportCapabilityReconciliation(r)).toBe(false);
  });
});

describe('PB-005 — reconciliation: capability unavailable', () => {
  it('declared UNSUPPORTED ⇒ registry_contradicts + drift, citations still applied', () => {
    mockCapabilityMode = 'unsupported';
    const r = reconcileCitationCapability(2);
    expect(r.declared).toBe(false);
    expect(r.agreement).toBe('registry_contradicts');
    expect(r.drift).toBe(true);
    expect(r.citationsApplied).toBe(true);
    expect(shouldReportCapabilityReconciliation(r)).toBe(true);
  });

  it('UNDECLARED ⇒ registry_silent (the Platform makes no claim), citations still applied', () => {
    mockCapabilityMode = 'undeclared';
    const r = reconcileCitationCapability(2);
    expect(r.declared).toBeNull();
    expect(r.evidence).toBeNull();
    expect(r.agreement).toBe('registry_silent');
    expect(r.drift).toBe(true);
    expect(r.citationsApplied).toBe(true);
  });

  it('registry lookup THROWS ⇒ registry_unavailable, degrades safely, citations still applied', () => {
    mockCapabilityMode = 'throws';
    const r = reconcileCitationCapability(2);
    expect(r.declared).toBeNull();
    expect(r.agreement).toBe('registry_unavailable');
    expect(r.drift).toBe(false); // cannot claim drift against an unreadable registry
    expect(r.citationsApplied).toBe(true);
    expect(shouldReportCapabilityReconciliation(r)).toBe(true);
  });

  it('no observation ⇒ no drift is claimed, whatever the registry says', () => {
    mockCapabilityMode = 'unsupported';
    expect(reconcileCitationCapability(0).drift).toBe(false);
    mockCapabilityMode = 'undeclared';
    expect(reconcileCitationCapability(0).drift).toBe(false);
  });

  it('citationsApplied is true in EVERY registry state (fail-open invariant)', () => {
    for (const mode of ALL_MODES) {
      mockCapabilityMode = mode;
      expect(reconcileCitationCapability(2).citationsApplied).toBe(true);
      expect(reconcileCitationCapability(0).citationsApplied).toBe(true);
    }
  });

  it('never throws for any input, in any registry state', () => {
    for (const mode of ALL_MODES) {
      mockCapabilityMode = mode;
      expect(() => reconcileCitationCapability(-1, '')).not.toThrow();
      expect(() => reconcileCitationCapability(0, '__proto__')).not.toThrow();
    }
  });
});

describe('PB-005 — reconciliation: unknown provider', () => {
  it('an unknown provider id degrades to registry_silent, never an error', () => {
    const r = reconcileCitationCapability(2, 'not-a-provider');
    expect(r.provider).toBe('not-a-provider');
    expect(r.declared).toBeNull();
    expect(r.agreement).toBe('registry_silent');
    expect(r.citationsApplied).toBe(true);
  });

  it('documents the namespace hazard: PRODUCT provider ids are unknown to the registry', () => {
    // AIProviderId = chatgpt|gemini|claude|perplexity|copilot;
    // GatewayProviderId = openai|anthropic|gemini|perplexity|copilot.
    // This is exactly why the adapter passes the gateway literal, not `this.id`.
    expect(reconcileCitationCapability(1, 'chatgpt').agreement).toBe('registry_silent');
    expect(reconcileCitationCapability(1, 'claude').agreement).toBe('registry_silent');
    expect(reconcileCitationCapability(1).agreement).toBe('agreed');
  });
});

// ── The certification invariant ───────────────────────────────────────────────

describe('PB-005 — NO registry state can suppress citations', () => {
  it.each(ALL_MODES)('gateway transport renders "Sources: …" with registry mode %s', async (mode) => {
    mockCapabilityMode = mode;
    const result = await probeViaGateway();
    expect(result.state).toBe('measured');
    expect(result.citation_rate).toBe(1);
    expect(lastAnswer()).toBe(CITED_ANSWER);
  });

  it.each(ALL_MODES)('legacy transport renders "Sources: …" with registry mode %s', async (mode) => {
    mockCapabilityMode = mode;
    const result = await probeViaLegacy();
    expect(result.state).toBe('measured');
    expect(dispatchMock).not.toHaveBeenCalled();
    expect(lastAnswer()).toBe(CITED_ANSWER);
  });

  it.each(ALL_MODES)('reshape restores citations identically with registry mode %s', (mode) => {
    mockCapabilityMode = mode;
    const r = reshapeCompletionToPerplexityResponse(withCitations(), 'sonar');
    expect(r.citations).toEqual(CITATIONS);
    expect(r.choices?.[0]?.message?.content).toBe(CONTENT);
  });

  it.each(ALL_MODES)('gateway answer === legacy answer with registry mode %s (transport parity)', async (mode) => {
    mockCapabilityMode = mode;
    await probeViaGateway();
    const gatewayAnswer = lastAnswer();
    jest.clearAllMocks();
    process.env.PERPLEXITY_API_KEY = 'test-key';
    await probeViaLegacy();
    expect(lastAnswer()).toBe(gatewayAnswer);
    expect(gatewayAnswer).toBe(CITED_ANSWER);
  });

  it('metadata-absent completions stay citation-free in every registry state (no fabrication)', () => {
    for (const mode of ALL_MODES) {
      mockCapabilityMode = mode;
      const r = reshapeCompletionToPerplexityResponse({ content: 'x', usage: null }, 'm');
      expect('citations' in r).toBe(false);
    }
  });
});

// ── Diagnostics ───────────────────────────────────────────────────────────────

describe('PB-005 — capability diagnostics (out-of-band only)', () => {
  it('agreed registry ⇒ no reconciliation log (zero noise in the healthy case)', async () => {
    await probeViaGateway();
    expect(reconcileLogs()).toHaveLength(0);
  });

  it('registry drift ⇒ one diagnostic line, and the citations are still delivered', async () => {
    mockCapabilityMode = 'unsupported';
    await probeViaGateway();
    const logs = reconcileLogs();
    expect(logs).toHaveLength(1);
    expect(logs[0].reason).toContain('agreement=registry_contradicts');
    expect(logs[0].reason).toContain('drift=true');
    expect(logs[0].reason).toContain('citations_applied=true');
    expect(lastAnswer()).toBe(CITED_ANSWER);
  });

  it('unreadable registry ⇒ registry_unavailable diagnostic, citations still delivered', async () => {
    mockCapabilityMode = 'throws';
    await probeViaGateway();
    expect(reconcileLogs()[0]?.reason).toContain('agreement=registry_unavailable');
    expect(lastAnswer()).toBe(CITED_ANSWER);
  });

  it('no citations observed ⇒ no diagnostic even when the registry contradicts', async () => {
    mockCapabilityMode = 'unsupported';
    dispatchMock.mockResolvedValue({ content: CONTENT, usage: null });
    process.env.PERPLEXITY_ADAPTER_GATEWAY_TRANSPORT = 'true';
    await new PerplexityAdapter().probe(PROBE as never);
    expect(reconcileLogs()).toHaveLength(0);
    expect(lastAnswer()).toBe(CONTENT);
  });

  it('legacy transport emits no capability diagnostic at all (untouched path)', async () => {
    mockCapabilityMode = 'unsupported';
    await probeViaLegacy();
    expect(reconcileLogs()).toHaveLength(0);
    expect(lastAnswer()).toBe(CITED_ANSWER);
  });

  it('a throwing logger cannot break the probe (diagnostics fully swallowed)', async () => {
    mockCapabilityMode = 'unsupported';
    logMock.mockImplementation((p: { operation: string }) => {
      if (p?.operation === 'visibility.probe.perplexity.capability_reconcile') throw new Error('log sink down');
    });
    const result = await probeViaGateway();
    expect(result.state).toBe('measured');
    expect(result.citation_rate).toBe(1);
    expect(lastAnswer()).toBe(CITED_ANSWER);
    logMock.mockReset();
  });
});
