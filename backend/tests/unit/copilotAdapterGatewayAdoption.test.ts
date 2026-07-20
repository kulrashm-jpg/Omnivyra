/**
 * PA-007 — Copilot visibility adapter → Platform gateway dispatcher.
 *
 * Architectural-consistency migration: the gateway seam callCopilot is a
 * not-yet-implemented stub (GatewayTransportNotImplementedError), so the flag-ON
 * path resolves to a graceful `unavailable`. Covers flag, forward-ready reshape,
 * flag-gated routing (ON → dispatcher/stub → unavailable; OFF → legacy Azure), and
 * the no-credential short-circuit (the production stub reality).
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
  CopilotAdapter,
  copilotGatewayTransportEnabled,
  reshapeCompletionToAzureResponse,
} from '../../services/intelligence/adapters/copilotAdapter';
import { dispatchTransport } from '../../services/aiGatewayDispatcher';
import { fetchProduction } from '../../services/intelligence/productionPrimitives';
import { GatewayTransportNotImplementedError } from '../../services/aiGatewayTransports';

const dispatchMock = dispatchTransport as unknown as jest.Mock;
const fetchProdMock = fetchProduction as unknown as jest.Mock;

const PROBE = { provider: 'copilot', query_class: 'commercial', queries: ['best crm for teams'], brandName: 'Brand X' };

beforeEach(() => {
  jest.clearAllMocks();
  process.env.AZURE_COPILOT_API_KEY = 'test-key';
  process.env.AZURE_COPILOT_ENDPOINT = 'https://example.openai.azure.com';
  delete process.env.COPILOT_ADAPTER_GATEWAY_TRANSPORT;
});

describe('PA-007 — flag + reshape (pure)', () => {
  it('flag defaults OFF and reads the env truthy set', () => {
    delete process.env.COPILOT_ADAPTER_GATEWAY_TRANSPORT;
    expect(copilotGatewayTransportEnabled()).toBe(false);
    for (const v of ['true', '1', 'on', 'yes']) {
      process.env.COPILOT_ADAPTER_GATEWAY_TRANSPORT = v;
      expect(copilotGatewayTransportEnabled()).toBe(true);
    }
    process.env.COPILOT_ADAPTER_GATEWAY_TRANSPORT = 'false';
    expect(copilotGatewayTransportEnabled()).toBe(false);
  });

  it('forward-ready reshape maps completion → Azure/OpenAI shape', () => {
    const r = reshapeCompletionToAzureResponse(
      { content: 'copilot answer', usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 } },
      'gpt-4o-mini',
    );
    expect(r.choices?.[0]?.message?.content).toBe('copilot answer');
    expect(r.usage).toEqual({ prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 });
    expect(r.model).toBe('gpt-4o-mini');
  });
});

describe('PA-007 — flag-gated routing + stub semantics', () => {
  it('flag ON routes to the dispatcher; the stub throws → graceful unavailable', async () => {
    process.env.COPILOT_ADAPTER_GATEWAY_TRANSPORT = 'true';
    dispatchMock.mockRejectedValue(new GatewayTransportNotImplementedError('copilot'));
    const result = await new CopilotAdapter().probe(PROBE as never);
    expect(dispatchMock).toHaveBeenCalled();
    expect(dispatchMock).toHaveBeenCalledWith('copilot', expect.objectContaining({ temperature: 0, max_tokens: 600 }));
    expect(fetchProdMock).not.toHaveBeenCalled();
    expect(result.state).toBe('unavailable');
    expect(result.reason_unavailable).toBeTruthy();
  });

  it('flag OFF uses the base legacy Azure scaffolding (not the dispatcher)', async () => {
    delete process.env.COPILOT_ADAPTER_GATEWAY_TRANSPORT;
    fetchProdMock.mockResolvedValue({
      json: async () => ({
        choices: [{ message: { content: 'Brand X is featured' } }],
        usage: { prompt_tokens: 4, completion_tokens: 3 },
        model: 'gpt-4o-mini',
      }),
    });
    const result = await new CopilotAdapter().probe(PROBE as never);
    expect(fetchProdMock).toHaveBeenCalledTimes(1);
    expect(dispatchMock).not.toHaveBeenCalled();
    expect(result.state).toBe('measured');
    expect(result.citation_rate).toBe(1);
  });

  it('no Azure credential → unavailable before any transport (production stub reality)', async () => {
    delete process.env.AZURE_COPILOT_API_KEY;
    process.env.COPILOT_ADAPTER_GATEWAY_TRANSPORT = 'true';
    const result = await new CopilotAdapter().probe(PROBE as never);
    expect(dispatchMock).not.toHaveBeenCalled();
    expect(fetchProdMock).not.toHaveBeenCalled();
    expect(result.state).toBe('unavailable');
  });
});
