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
  extractCitation: (args: { provider: string; query: string; query_class: string; answer: string; observedAt: string }) => ({
    provider: args.provider,
    query: args.query,
    query_class: args.query_class,
    appeared: /brand x/i.test(args.answer),
    prominence: 1,
    evidence_excerpt: null,
    observed_at: args.observedAt,
  }),
}));
jest.mock('../../services/intelligence/queryOrchestrator', () => ({
  formatQueryForProvider: (q: string) => ({ system: null, user: q }),
}));

import {
  PerplexityAdapter,
  perplexityGatewayTransportEnabled,
  reshapeCompletionToPerplexityResponse,
} from '../../services/intelligence/adapters/perplexityAdapter';
import { dispatchTransport } from '../../services/aiGatewayDispatcher';
import { fetchProduction } from '../../services/intelligence/productionPrimitives';

const dispatchMock = dispatchTransport as unknown as jest.Mock;
const fetchProdMock = fetchProduction as unknown as jest.Mock;

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

  it('reshape maps completion → Perplexity shape (choices + usage + model), no citations', () => {
    const r = reshapeCompletionToPerplexityResponse(
      { content: 'perplexity answer', usage: { prompt_tokens: 5, completion_tokens: 7, total_tokens: 12 } },
      'sonar',
    );
    expect(r.choices?.[0]?.message?.content).toBe('perplexity answer');
    expect(r.usage).toEqual({ prompt_tokens: 5, completion_tokens: 7, total_tokens: 12 });
    expect(r.model).toBe('sonar');
    expect(r.citations).toBeUndefined(); // documented parity gap
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
