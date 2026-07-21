/**
 * PA-006 — Perplexity visibility adapter → Platform gateway dispatcher.
 *
 * Perplexity is OpenAI-compatible (choices[0].message.content + usage.prompt_tokens
 * /completion_tokens). Covers flag, reshape, request compatibility (no max_tokens),
 * flag-gated routing, probe parity, and the documented citations parity gap.
 */
jest.mock('../../services/intelligence/productionPrimitives', () => ({
  withRetry: (_id: string, fn: () => Promise<unknown>) => fn(),
  fetchProduction: jest.fn(),
  getRateLimiter: () => ({ tryAcquire: () => true }),
  TtlCache: class {
    get(): undefined { return undefined; }
    set(): void {}
  },
  logProviderCall: () => {},
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
  perplexityGatewayTransportEnabled,
  reshapeCompletionToPerplexityResponse,
  extractPerplexityCitations,
} from '../../services/intelligence/adapters/perplexityAdapter';
import { dispatchTransport } from '../../services/aiGatewayDispatcher';
import { fetchProduction } from '../../services/intelligence/productionPrimitives';
import { extractCitation } from '../../services/intelligence/citationExtractor';
import type { NormalizedCompletion } from '../../services/aiGatewayCore';

const dispatchMock = dispatchTransport as unknown as jest.Mock;
const fetchProdMock = fetchProduction as unknown as jest.Mock;
const extractCitationMock = extractCitation as unknown as jest.Mock;

/** A gateway completion carrying PB-001 Perplexity citation metadata (v1). */
const withCitations = (citations: string[], content = 'Brand X ranks highly'): NormalizedCompletion => ({
  content,
  usage: { prompt_tokens: 5, completion_tokens: 7, total_tokens: 12 },
  providerMetadata: {
    perplexity: { provider: 'perplexity', version: 1, data: { citations } },
  },
});

/** The last answer string handed to the citation extractor (post-`extractAnswer`). */
const lastAnswer = (): string => extractCitationMock.mock.calls.at(-1)?.[0]?.answer ?? '';

const PROBE = { provider: 'perplexity', query_class: 'commercial', queries: ['best crm for teams'], brandName: 'Brand X' };

beforeEach(() => {
  jest.clearAllMocks();
  process.env.PERPLEXITY_API_KEY = 'test-key';
  delete process.env.PERPLEXITY_ADAPTER_GATEWAY_TRANSPORT;
});

describe('PA-006 — flag + reshape (pure)', () => {
  it('flag defaults OFF and reads the env truthy set', () => {
    delete process.env.PERPLEXITY_ADAPTER_GATEWAY_TRANSPORT;
    expect(perplexityGatewayTransportEnabled()).toBe(false);
    for (const v of ['true', '1', 'on', 'yes']) {
      process.env.PERPLEXITY_ADAPTER_GATEWAY_TRANSPORT = v;
      expect(perplexityGatewayTransportEnabled()).toBe(true);
    }
    process.env.PERPLEXITY_ADAPTER_GATEWAY_TRANSPORT = '0';
    expect(perplexityGatewayTransportEnabled()).toBe(false);
  });

  it('reshape maps completion → Perplexity shape (choices + usage + model); metadata absent ⇒ no citations key', () => {
    const r = reshapeCompletionToPerplexityResponse(
      { content: 'perplexity answer', usage: { prompt_tokens: 5, completion_tokens: 7, total_tokens: 12 } },
      'sonar',
    );
    expect(r.choices?.[0]?.message?.content).toBe('perplexity answer');
    expect(r.usage).toEqual({ prompt_tokens: 5, completion_tokens: 7, total_tokens: 12 });
    expect(r.model).toBe('sonar');
    expect(r.citations).toBeUndefined();          // no metadata ⇒ citation-free shape preserved
    expect('citations' in r).toBe(false);          // key OMITTED, not set to []
  });

  it('reshape omits usage when the completion has none', () => {
    const r = reshapeCompletionToPerplexityResponse({ content: 'x', usage: null }, 'm');
    expect(r.usage).toBeUndefined();
    expect(r.choices?.[0]?.message?.content).toBe('x');
  });
});

describe('PA-006 — flag-gated routing + parity', () => {
  it('flag ON routes through the gateway dispatcher WITHOUT max_tokens (request parity)', async () => {
    process.env.PERPLEXITY_ADAPTER_GATEWAY_TRANSPORT = 'true';
    dispatchMock.mockResolvedValue({
      content: 'Brand X ranks highly',
      usage: { prompt_tokens: 5, completion_tokens: 7, total_tokens: 12 },
    });
    const result = await new PerplexityAdapter().probe(PROBE as never);
    expect(dispatchMock).toHaveBeenCalledTimes(1);
    expect(dispatchMock).toHaveBeenCalledWith('perplexity', expect.objectContaining({ temperature: 0, apiKey: 'test-key' }));
    // legacy body has no max_tokens → the gateway call must omit it too
    expect(dispatchMock.mock.calls[0][1]).not.toHaveProperty('max_tokens');
    expect(fetchProdMock).not.toHaveBeenCalled();
    expect(result.state).toBe('measured');
    expect(result.citation_rate).toBe(1);
  });

  it('flag OFF uses the base legacy direct-transport path (not the dispatcher)', async () => {
    delete process.env.PERPLEXITY_ADAPTER_GATEWAY_TRANSPORT;
    fetchProdMock.mockResolvedValue({
      json: async () => ({
        choices: [{ message: { content: 'Brand X ranks highly' } }],
        usage: { prompt_tokens: 5, completion_tokens: 7 },
        model: 'sonar',
      }),
    });
    const result = await new PerplexityAdapter().probe(PROBE as never);
    expect(fetchProdMock).toHaveBeenCalledTimes(1);
    expect(dispatchMock).not.toHaveBeenCalled();
    expect(result.state).toBe('measured');
    expect(result.citation_rate).toBe(1);
  });

  it('probe parity (no citations): gateway and legacy produce the same scored result', async () => {
    const answer = 'Brand X ranks highly';
    process.env.PERPLEXITY_ADAPTER_GATEWAY_TRANSPORT = 'true';
    dispatchMock.mockResolvedValue({ content: answer, usage: { prompt_tokens: 5, completion_tokens: 7, total_tokens: 12 } });
    const viaGateway = await new PerplexityAdapter().probe(PROBE as never);

    jest.clearAllMocks();
    process.env.PERPLEXITY_API_KEY = 'test-key';
    delete process.env.PERPLEXITY_ADAPTER_GATEWAY_TRANSPORT;
    fetchProdMock.mockResolvedValue({ json: async () => ({ choices: [{ message: { content: answer } }], usage: { prompt_tokens: 5, completion_tokens: 7 }, model: 'sonar' }) });
    const viaLegacy = await new PerplexityAdapter().probe(PROBE as never);

    expect(viaGateway.state).toBe(viaLegacy.state);
    expect(viaGateway.citation_rate).toBe(viaLegacy.citation_rate);
    expect(viaGateway.mean_prominence).toBe(viaLegacy.mean_prominence);
    expect(viaGateway.mentions.length).toBe(viaLegacy.mentions.length);
  });
});

describe('PB-002 — metadata consumption + citation restoration (reshape, pure)', () => {
  it('restores citations from PB-001 metadata when present', () => {
    const r = reshapeCompletionToPerplexityResponse(withCitations(['https://a.com', 'https://b.com']), 'sonar');
    expect(r.citations).toEqual(['https://a.com', 'https://b.com']);
    expect(r.choices?.[0]?.message?.content).toBe('Brand X ranks highly');
  });

  it('omits citations (byte-identical) when the metadata envelope is absent', () => {
    const r = reshapeCompletionToPerplexityResponse({ content: 'x', usage: null }, 'm');
    expect('citations' in r).toBe(false);
  });

  it('extractPerplexityCitations reads the v1 envelope and filters non-strings', () => {
    const completion = {
      content: 'x', usage: null,
      providerMetadata: { perplexity: { provider: 'perplexity', version: 1, data: { citations: ['https://a.com', 42, null, 'https://b.com'] } } },
    } as unknown as NormalizedCompletion;
    expect(extractPerplexityCitations(completion)).toEqual(['https://a.com', 'https://b.com']);
  });

  it('ignores a metadata envelope with an unknown version (version-safe)', () => {
    const completion = {
      content: 'x', usage: null,
      providerMetadata: { perplexity: { provider: 'perplexity', version: 999, data: { citations: ['https://a.com'] } } },
    } as unknown as NormalizedCompletion;
    expect(extractPerplexityCitations(completion)).toEqual([]);
    expect('citations' in reshapeCompletionToPerplexityResponse(completion, 'm')).toBe(false);
  });

  it('never surfaces another provider\'s metadata (provider isolation)', () => {
    const completion = {
      content: 'x', usage: null,
      providerMetadata: { openai: { provider: 'openai', version: 1, data: { citations: ['https://leak.com'] } } },
    } as unknown as NormalizedCompletion;
    expect(extractPerplexityCitations(completion)).toEqual([]);
  });
});

describe('PB-002 — citation rendering across transports', () => {
  it('gateway path renders "Sources: …" from restored metadata citations', async () => {
    process.env.PERPLEXITY_ADAPTER_GATEWAY_TRANSPORT = 'true';
    dispatchMock.mockResolvedValue(withCitations(['https://a.com', 'https://b.com']));
    const result = await new PerplexityAdapter().probe(PROBE as never);
    expect(result.state).toBe('measured');
    expect(lastAnswer()).toBe('Brand X ranks highly\nSources: https://a.com, https://b.com');
  });

  it('legacy path still renders "Sources: …" from raw response citations', async () => {
    delete process.env.PERPLEXITY_ADAPTER_GATEWAY_TRANSPORT;
    fetchProdMock.mockResolvedValue({
      json: async () => ({
        choices: [{ message: { content: 'Brand X ranks highly' } }],
        citations: ['https://a.com', 'https://b.com'],
        usage: { prompt_tokens: 5, completion_tokens: 7 },
        model: 'sonar',
      }),
    });
    await new PerplexityAdapter().probe(PROBE as never);
    expect(lastAnswer()).toBe('Brand X ranks highly\nSources: https://a.com, https://b.com');
  });

  it('gateway (metadata) and legacy (raw) produce an IDENTICAL cited answer — parity restored', async () => {
    const citations = ['https://a.com', 'https://b.com'];
    process.env.PERPLEXITY_ADAPTER_GATEWAY_TRANSPORT = 'true';
    dispatchMock.mockResolvedValue(withCitations(citations));
    await new PerplexityAdapter().probe(PROBE as never);
    const gatewayAnswer = lastAnswer();

    jest.clearAllMocks();
    process.env.PERPLEXITY_API_KEY = 'test-key';
    delete process.env.PERPLEXITY_ADAPTER_GATEWAY_TRANSPORT;
    fetchProdMock.mockResolvedValue({ json: async () => ({ choices: [{ message: { content: 'Brand X ranks highly' } }], citations, usage: { prompt_tokens: 5, completion_tokens: 7 }, model: 'sonar' }) });
    await new PerplexityAdapter().probe(PROBE as never);
    expect(lastAnswer()).toBe(gatewayAnswer);
  });
});

describe('PB-002 — resilience (retry / unavailable paths preserved)', () => {
  it('gateway transport failure degrades to unavailable (retry-seam error path)', async () => {
    process.env.PERPLEXITY_ADAPTER_GATEWAY_TRANSPORT = 'true';
    dispatchMock.mockRejectedValue(new Error('perplexity 503'));
    const result = await new PerplexityAdapter().probe(PROBE as never);
    expect(result.state).toBe('unavailable');
    expect(result.mentions).toHaveLength(0);
  });

  it('no API key ⇒ unavailable (no transport attempted)', async () => {
    delete process.env.PERPLEXITY_API_KEY;
    const result = await new PerplexityAdapter().probe(PROBE as never);
    expect(result.state).toBe('unavailable');
    expect(dispatchMock).not.toHaveBeenCalled();
    expect(fetchProdMock).not.toHaveBeenCalled();
  });
});
