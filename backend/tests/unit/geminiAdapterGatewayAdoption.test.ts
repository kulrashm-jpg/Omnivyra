/**
 * PA-005 — Gemini visibility adapter → Platform gateway dispatcher.
 *
 * Mirrors PA-004, adapted to Gemini's protocol: candidates[].content.parts[].text
 * answer shape and usageMetadata.promptTokenCount/candidatesTokenCount. Covers the
 * flag, the reshape, flag-gated routing (ON → dispatcher, OFF → base legacy), and
 * probe parity.
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
  GeminiAdapter,
  geminiGatewayTransportEnabled,
  reshapeCompletionToGeminiResponse,
} from '../../services/intelligence/adapters/geminiAdapter';
import { dispatchTransport } from '../../services/aiGatewayDispatcher';
import { fetchProduction } from '../../services/intelligence/productionPrimitives';

const dispatchMock = dispatchTransport as unknown as jest.Mock;
const fetchProdMock = fetchProduction as unknown as jest.Mock;

const PROBE = { provider: 'gemini', query_class: 'commercial', queries: ['best crm for teams'], brandName: 'Brand X' };

beforeEach(() => {
  jest.clearAllMocks();
  process.env.GEMINI_API_KEY = 'test-key';
  delete process.env.GEMINI_ADAPTER_GATEWAY_TRANSPORT;
});

describe('PA-005 — flag + reshape (pure)', () => {
  it('flag defaults OFF and reads the env truthy set', () => {
    delete process.env.GEMINI_ADAPTER_GATEWAY_TRANSPORT;
    expect(geminiGatewayTransportEnabled()).toBe(false);
    for (const v of ['true', '1', 'on', 'yes']) {
      process.env.GEMINI_ADAPTER_GATEWAY_TRANSPORT = v;
      expect(geminiGatewayTransportEnabled()).toBe(true);
    }
    process.env.GEMINI_ADAPTER_GATEWAY_TRANSPORT = 'no';
    expect(geminiGatewayTransportEnabled()).toBe(false);
  });

  it('reshape maps completion → Gemini shape (parts[].text + usageMetadata)', () => {
    const r = reshapeCompletionToGeminiResponse(
      { content: 'gemini answer', usage: { prompt_tokens: 6, completion_tokens: 9, total_tokens: 15 } },
      'gemini-1.5-flash',
    );
    expect(r.candidates?.[0]?.content?.parts?.[0]?.text).toBe('gemini answer');
    expect(r.usageMetadata).toEqual({ promptTokenCount: 6, candidatesTokenCount: 9, totalTokenCount: 15 });
    expect(r.modelVersion).toBe('gemini-1.5-flash');
  });

  it('reshape omits usageMetadata when the completion has none', () => {
    const r = reshapeCompletionToGeminiResponse({ content: 'x', usage: null }, 'm');
    expect(r.usageMetadata).toBeUndefined();
    expect(r.candidates?.[0]?.content?.parts?.[0]?.text).toBe('x');
  });
});

describe('PA-005 — flag-gated routing + parity', () => {
  it('flag ON routes transport through the gateway dispatcher (gemini)', async () => {
    process.env.GEMINI_ADAPTER_GATEWAY_TRANSPORT = 'true';
    dispatchMock.mockResolvedValue({
      content: 'Brand X is widely recommended',
      usage: { prompt_tokens: 6, completion_tokens: 9, total_tokens: 15 },
    });
    const result = await new GeminiAdapter().probe(PROBE as never);
    expect(dispatchMock).toHaveBeenCalledTimes(1);
    expect(dispatchMock).toHaveBeenCalledWith(
      'gemini',
      expect.objectContaining({ temperature: 0, max_tokens: 600, apiKey: 'test-key' }),
    );
    expect(fetchProdMock).not.toHaveBeenCalled();
    expect(result.state).toBe('measured');
    expect(result.citation_rate).toBe(1);
  });

  it('flag OFF uses the base legacy direct-transport path (not the dispatcher)', async () => {
    delete process.env.GEMINI_ADAPTER_GATEWAY_TRANSPORT;
    fetchProdMock.mockResolvedValue({
      json: async () => ({
        candidates: [{ content: { parts: [{ text: 'Brand X is widely recommended' }] } }],
        usageMetadata: { promptTokenCount: 6, candidatesTokenCount: 9 },
        modelVersion: 'gemini-1.5-flash',
      }),
    });
    const result = await new GeminiAdapter().probe(PROBE as never);
    expect(fetchProdMock).toHaveBeenCalledTimes(1);
    expect(dispatchMock).not.toHaveBeenCalled();
    expect(result.state).toBe('measured');
    expect(result.citation_rate).toBe(1);
  });

  it('probe parity: gateway and legacy produce the same scored result for the same answer', async () => {
    const answer = 'Brand X is widely recommended';
    process.env.GEMINI_ADAPTER_GATEWAY_TRANSPORT = 'true';
    dispatchMock.mockResolvedValue({ content: answer, usage: { prompt_tokens: 6, completion_tokens: 9, total_tokens: 15 } });
    const viaGateway = await new GeminiAdapter().probe(PROBE as never);

    jest.clearAllMocks();
    process.env.GEMINI_API_KEY = 'test-key';
    delete process.env.GEMINI_ADAPTER_GATEWAY_TRANSPORT;
    fetchProdMock.mockResolvedValue({ json: async () => ({ candidates: [{ content: { parts: [{ text: answer }] } }], usageMetadata: { promptTokenCount: 6, candidatesTokenCount: 9 }, modelVersion: 'gemini-1.5-flash' }) });
    const viaLegacy = await new GeminiAdapter().probe(PROBE as never);

    expect(viaGateway.state).toBe(viaLegacy.state);
    expect(viaGateway.citation_rate).toBe(viaLegacy.citation_rate);
    expect(viaGateway.mean_prominence).toBe(viaLegacy.mean_prominence);
    expect(viaGateway.mentions.length).toBe(viaLegacy.mentions.length);
  });
});
