/**
 * PA-003 — OpenAI visibility adapter → Platform gateway dispatcher adoption.
 *
 * Covers: the adapter-owned flag; the NormalizedCompletion→OpenAI-response reshape
 * (the fields extractProbeTokenUsage/answer-extraction read); flag-gated routing
 * (ON → dispatchTransport, OFF → legacy fetchProduction); and probe parity (both
 * transports yield the same scored result for the same answer).
 *
 * Transport-side collaborators are mocked so no network / DB is touched.
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
  formatQueryForProvider: (q: string) => ({ system: 'sys', user: q }),
}));

import {
  OpenAIChatGPTAdapter,
  openaiGatewayTransportEnabled,
  reshapeCompletionToOpenAiResponse,
} from '../../services/intelligence/adapters/openaiAdapter';
import { dispatchTransport } from '../../services/aiGatewayDispatcher';
import { fetchProduction } from '../../services/intelligence/productionPrimitives';

const dispatchMock = dispatchTransport as unknown as jest.Mock;
const fetchProdMock = fetchProduction as unknown as jest.Mock;

const PROBE = { provider: 'chatgpt', query_class: 'commercial', queries: ['best crm for teams'], brandName: 'Brand X' };

beforeEach(() => {
  jest.clearAllMocks();
  process.env.OPENAI_API_KEY = 'test-key';
  delete process.env.OPENAI_ADAPTER_GATEWAY_TRANSPORT;
});

describe('PA-003 — flag + reshape (pure)', () => {
  it('flag defaults OFF and reads the env truthy set', () => {
    delete process.env.OPENAI_ADAPTER_GATEWAY_TRANSPORT;
    expect(openaiGatewayTransportEnabled()).toBe(false);
    for (const v of ['true', '1', 'on', 'yes', 'TRUE']) {
      process.env.OPENAI_ADAPTER_GATEWAY_TRANSPORT = v;
      expect(openaiGatewayTransportEnabled()).toBe(true);
    }
    process.env.OPENAI_ADAPTER_GATEWAY_TRANSPORT = 'false';
    expect(openaiGatewayTransportEnabled()).toBe(false);
  });

  it('reshape preserves answer + usage + model (the fields cost/usage capture read)', () => {
    const r = reshapeCompletionToOpenAiResponse(
      { content: 'answer here', usage: { prompt_tokens: 7, completion_tokens: 3, total_tokens: 10 } },
      'gpt-4o-mini',
    );
    expect(r.choices?.[0]?.message?.content).toBe('answer here');
    expect(r.usage).toEqual({ prompt_tokens: 7, completion_tokens: 3, total_tokens: 10 });
    expect(r.model).toBe('gpt-4o-mini');
  });

  it('reshape omits usage when the completion has none', () => {
    const r = reshapeCompletionToOpenAiResponse({ content: 'x', usage: null }, 'm');
    expect(r.usage).toBeUndefined();
    expect(r.choices?.[0]?.message?.content).toBe('x');
  });
});

describe('PA-003 — flag-gated routing + parity', () => {
  it('flag ON routes transport through the gateway dispatcher (not direct HTTP)', async () => {
    process.env.OPENAI_ADAPTER_GATEWAY_TRANSPORT = 'true';
    dispatchMock.mockResolvedValue({
      content: 'Brand X is the top pick',
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
    });
    const result = await new OpenAIChatGPTAdapter().probe(PROBE as never);
    expect(dispatchMock).toHaveBeenCalledTimes(1);
    expect(dispatchMock).toHaveBeenCalledWith(
      'openai',
      expect.objectContaining({ temperature: 0, max_tokens: 600, apiKey: 'test-key' }),
    );
    expect(fetchProdMock).not.toHaveBeenCalled();
    expect(result.state).toBe('measured');
    expect(result.citation_rate).toBe(1);
  });

  it('flag OFF uses the legacy direct-transport path (not the dispatcher)', async () => {
    delete process.env.OPENAI_ADAPTER_GATEWAY_TRANSPORT;
    fetchProdMock.mockResolvedValue({
      json: async () => ({
        choices: [{ message: { content: 'Brand X is the top pick' } }],
        usage: { prompt_tokens: 10, completion_tokens: 5 },
        model: 'gpt-4o-mini',
      }),
    });
    const result = await new OpenAIChatGPTAdapter().probe(PROBE as never);
    expect(fetchProdMock).toHaveBeenCalledTimes(1);
    expect(dispatchMock).not.toHaveBeenCalled();
    expect(result.state).toBe('measured');
    expect(result.citation_rate).toBe(1);
  });

  it('probe parity: gateway and legacy produce the same scored result for the same answer', async () => {
    const answer = 'Brand X is the top pick';
    process.env.OPENAI_ADAPTER_GATEWAY_TRANSPORT = 'true';
    dispatchMock.mockResolvedValue({ content: answer, usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } });
    const viaGateway = await new OpenAIChatGPTAdapter().probe(PROBE as never);

    jest.clearAllMocks();
    process.env.OPENAI_API_KEY = 'test-key';
    delete process.env.OPENAI_ADAPTER_GATEWAY_TRANSPORT;
    fetchProdMock.mockResolvedValue({ json: async () => ({ choices: [{ message: { content: answer } }], usage: { prompt_tokens: 10, completion_tokens: 5 }, model: 'gpt-4o-mini' }) });
    const viaLegacy = await new OpenAIChatGPTAdapter().probe(PROBE as never);

    expect(viaGateway.state).toBe(viaLegacy.state);
    expect(viaGateway.citation_rate).toBe(viaLegacy.citation_rate);
    expect(viaGateway.mean_prominence).toBe(viaLegacy.mean_prominence);
    expect(viaGateway.mentions.length).toBe(viaLegacy.mentions.length);
  });
});
