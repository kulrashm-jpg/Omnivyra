/**
 * PA-004 — Anthropic (Claude) visibility adapter → Platform gateway dispatcher.
 *
 * Mirrors PA-003, adapted to Claude's protocol: usage.input_tokens/output_tokens,
 * content[].text answer shape, and the shared-base transport seam override.
 * Covers the flag, the reshape, flag-gated routing (ON → dispatcher, OFF → base's
 * legacy fetchProduction), and probe parity.
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
  AnthropicClaudeAdapter,
  anthropicGatewayTransportEnabled,
  reshapeCompletionToClaudeResponse,
} from '../../services/intelligence/adapters/anthropicAdapter';
import { dispatchTransport } from '../../services/aiGatewayDispatcher';
import { fetchProduction } from '../../services/intelligence/productionPrimitives';

const dispatchMock = dispatchTransport as unknown as jest.Mock;
const fetchProdMock = fetchProduction as unknown as jest.Mock;

const PROBE = { provider: 'claude', query_class: 'commercial', queries: ['best crm for teams'], brandName: 'Brand X' };

beforeEach(() => {
  jest.clearAllMocks();
  process.env.ANTHROPIC_API_KEY = 'test-key';
  delete process.env.ANTHROPIC_ADAPTER_GATEWAY_TRANSPORT;
});

describe('PA-004 — flag + reshape (pure)', () => {
  it('flag defaults OFF and reads the env truthy set', () => {
    delete process.env.ANTHROPIC_ADAPTER_GATEWAY_TRANSPORT;
    expect(anthropicGatewayTransportEnabled()).toBe(false);
    for (const v of ['true', '1', 'on', 'yes']) {
      process.env.ANTHROPIC_ADAPTER_GATEWAY_TRANSPORT = v;
      expect(anthropicGatewayTransportEnabled()).toBe(true);
    }
    process.env.ANTHROPIC_ADAPTER_GATEWAY_TRANSPORT = 'off';
    expect(anthropicGatewayTransportEnabled()).toBe(false);
  });

  it('reshape maps completion → Claude shape (content[].text + input/output tokens)', () => {
    const r = reshapeCompletionToClaudeResponse(
      { content: 'claude answer', usage: { prompt_tokens: 8, completion_tokens: 4, total_tokens: 12 } },
      'claude-haiku-4-5-20251001',
    );
    expect(r.content?.[0]).toEqual({ type: 'text', text: 'claude answer' });
    expect(r.usage).toEqual({ input_tokens: 8, output_tokens: 4 });
    expect(r.model).toBe('claude-haiku-4-5-20251001');
  });

  it('reshape omits usage when the completion has none', () => {
    const r = reshapeCompletionToClaudeResponse({ content: 'x', usage: null }, 'm');
    expect(r.usage).toBeUndefined();
    expect(r.content?.[0]?.text).toBe('x');
  });
});

describe('PA-004 — flag-gated routing + parity', () => {
  it('flag ON routes transport through the gateway dispatcher (anthropic)', async () => {
    process.env.ANTHROPIC_ADAPTER_GATEWAY_TRANSPORT = 'true';
    dispatchMock.mockResolvedValue({
      content: 'Brand X leads the category',
      usage: { prompt_tokens: 9, completion_tokens: 6, total_tokens: 15 },
    });
    const result = await new AnthropicClaudeAdapter().probe(PROBE as never);
    expect(dispatchMock).toHaveBeenCalledTimes(1);
    expect(dispatchMock).toHaveBeenCalledWith(
      'anthropic',
      expect.objectContaining({ temperature: 0, max_tokens: 600, apiKey: 'test-key' }),
    );
    expect(fetchProdMock).not.toHaveBeenCalled();
    expect(result.state).toBe('measured');
    expect(result.citation_rate).toBe(1);
  });

  it('flag OFF uses the base legacy direct-transport path (not the dispatcher)', async () => {
    delete process.env.ANTHROPIC_ADAPTER_GATEWAY_TRANSPORT;
    fetchProdMock.mockResolvedValue({
      json: async () => ({
        content: [{ type: 'text', text: 'Brand X leads the category' }],
        usage: { input_tokens: 9, output_tokens: 6 },
        model: 'claude-haiku-4-5-20251001',
      }),
    });
    const result = await new AnthropicClaudeAdapter().probe(PROBE as never);
    expect(fetchProdMock).toHaveBeenCalledTimes(1);
    expect(dispatchMock).not.toHaveBeenCalled();
    expect(result.state).toBe('measured');
    expect(result.citation_rate).toBe(1);
  });

  it('probe parity: gateway and legacy produce the same scored result for the same answer', async () => {
    const answer = 'Brand X leads the category';
    process.env.ANTHROPIC_ADAPTER_GATEWAY_TRANSPORT = 'true';
    dispatchMock.mockResolvedValue({ content: answer, usage: { prompt_tokens: 9, completion_tokens: 6, total_tokens: 15 } });
    const viaGateway = await new AnthropicClaudeAdapter().probe(PROBE as never);

    jest.clearAllMocks();
    process.env.ANTHROPIC_API_KEY = 'test-key';
    delete process.env.ANTHROPIC_ADAPTER_GATEWAY_TRANSPORT;
    fetchProdMock.mockResolvedValue({ json: async () => ({ content: [{ type: 'text', text: answer }], usage: { input_tokens: 9, output_tokens: 6 }, model: 'claude-haiku-4-5-20251001' }) });
    const viaLegacy = await new AnthropicClaudeAdapter().probe(PROBE as never);

    expect(viaGateway.state).toBe(viaLegacy.state);
    expect(viaGateway.citation_rate).toBe(viaLegacy.citation_rate);
    expect(viaGateway.mean_prominence).toBe(viaLegacy.mean_prominence);
    expect(viaGateway.mentions.length).toBe(viaLegacy.mentions.length);
  });
});
