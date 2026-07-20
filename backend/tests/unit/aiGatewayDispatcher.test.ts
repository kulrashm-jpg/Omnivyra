/**
 * Canonical Gateway Dispatcher (PA-002) — unit tests.
 *
 * Covers: dispatcher resolution, registry lookup (identity with the PA-001
 * GATEWAY_TRANSPORTS), provider routing (mocked fetch), unsupported-provider
 * handling, capability metadata, and backward compatibility (dispatcher adds no
 * transformation vs the untouched core caller; core still exports its callers).
 *
 * No network: `global.fetch` is mocked.
 */
import {
  dispatchTransport,
  resolveTransport,
  isProviderSupported,
  listSupportedProviders,
  getProviderCapabilities,
  GatewayUnsupportedProviderError,
  GATEWAY_PROVIDER_IDS,
  type GatewayDispatchParams,
  type GatewayProviderId,
} from '../../services/aiGatewayDispatcher';
import { GATEWAY_TRANSPORTS } from '../../services/aiGatewayTransports';
import { callOpenAi, callAnthropic } from '../../services/aiGatewayCore';

const baseParams = (over: Partial<GatewayDispatchParams> = {}): GatewayDispatchParams => ({
  apiKey: 'test-key',
  model: 'test-model',
  temperature: 0.2,
  messages: [
    { role: 'system', content: 'you are a probe' },
    { role: 'user', content: 'is brand X visible?' },
  ],
  max_tokens: 128,
  operation: 'test.dispatch',
  ...over,
});

function setFetch(impl: () => Promise<unknown>): jest.Mock {
  const fn = jest.fn().mockImplementation(impl);
  (global as unknown as { fetch: unknown }).fetch = fn;
  return fn;
}

afterEach(() => jest.restoreAllMocks());

describe('PA-002 — canonical gateway dispatcher', () => {
  it('supports exactly the five providers (resolution + membership)', () => {
    expect([...listSupportedProviders()].sort()).toEqual(
      ['anthropic', 'copilot', 'gemini', 'openai', 'perplexity'],
    );
    for (const id of GATEWAY_PROVIDER_IDS) {
      expect(typeof resolveTransport(id)).toBe('function');
    }
    expect(isProviderSupported('gemini')).toBe(true);
    expect(isProviderSupported('bogus')).toBe(false);
  });

  it('resolves seam providers THROUGH the PA-001 transport registry (identity)', () => {
    expect(resolveTransport('gemini')).toBe(GATEWAY_TRANSPORTS.gemini);
    expect(resolveTransport('perplexity')).toBe(GATEWAY_TRANSPORTS.perplexity);
    expect(resolveTransport('copilot')).toBe(GATEWAY_TRANSPORTS.copilot);
  });

  it('routes a request to the selected seam transport (perplexity, mocked fetch)', async () => {
    setFetch(async () => ({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: 'routed-ok' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 4, completion_tokens: 1, total_tokens: 5 },
      }),
    }));
    const r = await dispatchTransport('perplexity', baseParams());
    expect(r.content).toBe('routed-ok');
    expect(r.usage).toEqual({ prompt_tokens: 4, completion_tokens: 1, total_tokens: 5 });
  });

  it('throws GatewayUnsupportedProviderError for an unknown provider', async () => {
    expect(() => resolveTransport('nope' as GatewayProviderId)).toThrow(GatewayUnsupportedProviderError);
    await expect(dispatchTransport('nope' as GatewayProviderId, baseParams())).rejects.toBeInstanceOf(
      GatewayUnsupportedProviderError,
    );
  });

  it('publishes capability metadata for every provider (core + seams)', () => {
    expect(getProviderCapabilities('openai').implemented).toBe(true);
    expect(getProviderCapabilities('openai').id).toBe('openai');
    expect(getProviderCapabilities('anthropic').implemented).toBe(true);
    expect(getProviderCapabilities('copilot').implemented).toBe(false);
  });

  it('backward compatibility: dispatching anthropic adds NO transformation vs the core caller', async () => {
    setFetch(async () => ({
      ok: true,
      json: async () => ({
        content: [{ text: 'byte-equivalent' }],
        usage: { input_tokens: 3, output_tokens: 2 },
        stop_reason: 'end_turn',
      }),
    }));
    const viaDispatcher = await dispatchTransport('anthropic', baseParams());
    const viaCore = await callAnthropic(baseParams());
    expect(viaDispatcher).toEqual(viaCore);
    expect(viaDispatcher.content).toBe('byte-equivalent');
    expect(viaDispatcher.usage).toEqual({ prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 });
  });

  it('backward compatibility: the untouched core still exports its callers', () => {
    expect(typeof callOpenAi).toBe('function');
    expect(typeof callAnthropic).toBe('function');
    // openai routing is by identity through the core caller (not invoked here to
    // avoid the OpenAI SDK); resolution returns a callable.
    expect(typeof resolveTransport('openai')).toBe('function');
  });
});
