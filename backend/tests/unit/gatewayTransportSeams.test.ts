/**
 * Gateway Transport Seams (PA-001, Program A · Platform Convergence) — unit tests.
 *
 * Covers:
 *   - seam creation (callGemini/callPerplexity/callCopilot + GATEWAY_TRANSPORTS)
 *   - provider capability metadata (implemented seams vs the copilot stub)
 *   - transport contract: NormalizedCompletion { content, usage } via mocked fetch
 *   - error propagation (!response.ok → .status; aborted signal → GatewayAbortError;
 *     stub → GatewayTransportNotImplementedError)
 *   - backward compatibility: the untouched core still exports callOpenAi/callAnthropic
 *
 * No network: `global.fetch` is mocked per case.
 */
import {
  callGemini,
  callPerplexity,
  callCopilot,
  GATEWAY_TRANSPORTS,
  GATEWAY_TRANSPORT_CAPABILITIES,
  GatewayTransportNotImplementedError,
  type GatewayTransportParams,
} from '../../services/aiGatewayTransports';
import { GatewayAbortError, callOpenAi, callAnthropic } from '../../services/aiGatewayCore';

const baseParams = (over: Partial<GatewayTransportParams> = {}): GatewayTransportParams => ({
  apiKey: 'test-key',
  model: 'test-model',
  temperature: 0.2,
  messages: [
    { role: 'system', content: 'you are a probe' },
    { role: 'user', content: 'is brand X visible?' },
  ],
  max_tokens: 128,
  operation: 'test.probe',
  ...over,
});

function mockFetchOnce(impl: () => Promise<unknown>): jest.Mock {
  const fn = jest.fn().mockImplementationOnce(impl);
  (global as unknown as { fetch: unknown }).fetch = fn;
  return fn;
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe('PA-001 — gateway transport seams', () => {
  it('exposes a seam for every future provider (creation + registry)', () => {
    expect(typeof callGemini).toBe('function');
    expect(typeof callPerplexity).toBe('function');
    expect(typeof callCopilot).toBe('function');
    expect(Object.keys(GATEWAY_TRANSPORTS).sort()).toEqual(['copilot', 'gemini', 'perplexity']);
    expect(GATEWAY_TRANSPORTS.gemini).toBe(callGemini);
    expect(GATEWAY_TRANSPORTS.perplexity).toBe(callPerplexity);
    expect(GATEWAY_TRANSPORTS.copilot).toBe(callCopilot);
  });

  it('publishes uniform capability metadata (implemented seams vs stub)', () => {
    expect(GATEWAY_TRANSPORT_CAPABILITIES.gemini.implemented).toBe(true);
    expect(GATEWAY_TRANSPORT_CAPABILITIES.gemini.endpoint).toContain('generativelanguage');
    expect(GATEWAY_TRANSPORT_CAPABILITIES.perplexity.implemented).toBe(true);
    expect(GATEWAY_TRANSPORT_CAPABILITIES.perplexity.endpoint).toContain('perplexity');
    expect(GATEWAY_TRANSPORT_CAPABILITIES.copilot.implemented).toBe(false);
    expect(GATEWAY_TRANSPORT_CAPABILITIES.copilot.endpoint).toBeNull();
  });

  it('gemini returns a NormalizedCompletion (content + normalized usage)', async () => {
    const fetchMock = mockFetchOnce(async () => ({
      ok: true,
      json: async () => ({
        candidates: [{ content: { parts: [{ text: 'hello world' }] }, finishReason: 'STOP' }],
        usageMetadata: { promptTokenCount: 3, candidatesTokenCount: 2, totalTokenCount: 5 },
      }),
    }));
    const r = await callGemini(baseParams());
    expect(r.content).toBe('hello world');
    expect(r.usage).toEqual({ prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 });
    // system → systemInstruction; endpoint carries the model + key
    const url = fetchMock.mock.calls[0][0] as string;
    expect(url).toContain(':generateContent');
    expect(url).toContain('test-model');
  });

  it('perplexity returns a NormalizedCompletion (OpenAI-compatible shape)', async () => {
    mockFetchOnce(async () => ({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: 'pong' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 4, completion_tokens: 1, total_tokens: 5 },
      }),
    }));
    const r = await callPerplexity(baseParams());
    expect(r.content).toBe('pong');
    expect(r.usage).toEqual({ prompt_tokens: 4, completion_tokens: 1, total_tokens: 5 });
  });

  it('propagates a non-ok HTTP response as an error carrying .status', async () => {
    mockFetchOnce(async () => ({ ok: false, status: 429, text: async () => 'rate limited' }));
    await expect(callPerplexity(baseParams())).rejects.toMatchObject({ status: 429 });
  });

  it('throws GatewayAbortError (not a generic error) on an already-aborted signal, without fetching', async () => {
    const ac = new AbortController();
    ac.abort();
    const fetchSpy = jest.fn();
    (global as unknown as { fetch: unknown }).fetch = fetchSpy;
    await expect(callGemini(baseParams({ signal: ac.signal }))).rejects.toBeInstanceOf(GatewayAbortError);
    await expect(callPerplexity(baseParams({ signal: ac.signal }))).rejects.toBeInstanceOf(GatewayAbortError);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('copilot is a clearly-typed stub until PA-006 wires a transport', async () => {
    await expect(callCopilot(baseParams())).rejects.toBeInstanceOf(GatewayTransportNotImplementedError);
  });

  it('backward compatibility: the untouched core still exports callOpenAi/callAnthropic', () => {
    expect(typeof callOpenAi).toBe('function');
    expect(typeof callAnthropic).toBe('function');
  });
});
