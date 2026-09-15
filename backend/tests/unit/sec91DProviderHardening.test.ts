/**
 * SEC91-D (STEP 3AH-91) — direct provider paths outside the gateway.
 *
 *   D8  the Gemini API key is sent in the `x-goog-api-key` header, never in the
 *       request URL (URLs land in access logs, proxies, tracing and errors).
 *   D5  the creator render provider's raw fetches and the embedding client are
 *       time-bounded (they had no timeout / the SDK's 10-minute default).
 *
 * Provider HTTP and SDKs are stubs; nothing leaves the process.
 */
const mockEmbeddingCtorOpts: Array<Record<string, unknown>> = [];
jest.mock('openai', () => ({
  __esModule: true,
  default: class MockOpenAI {
    embeddings = { create: async () => ({ data: [{ embedding: new Array(1536).fill(0) }], usage: { prompt_tokens: 3, total_tokens: 3 } }) };
    constructor(opts: Record<string, unknown>) { mockEmbeddingCtorOpts.push(opts); }
  },
}));
jest.mock('../../services/pricingService', () => ({
  assertModelPricingExists: jest.fn(async () => undefined),
  recordCostAnomaly: jest.fn(async () => undefined),
  estimateEmbeddingCostUsd: jest.fn(() => 0),
}));
jest.mock('../../services/usageLedgerService', () => ({
  logUsageEvent: jest.fn(async () => undefined),
  resolveEmbeddingCost: jest.fn(async () => ({ total_cost_usd: 0, final_price_usd: 0, pricing_snapshot: null })),
}));
jest.mock('../../services/billing/platformUsageLedgerService', () => ({ recordPlatformUsage: jest.fn(async () => undefined) }));
jest.mock('../../services/intelligence/queryOrchestrator', () => ({
  formatQueryForProvider: (q: string) => ({ system: 'sys', user: q }),
}));

import { callGemini } from '../../services/aiGatewayTransports';
import { GeminiAdapter } from '../../services/intelligence/adapters/geminiAdapter';
import {
  createOpenAIRenderProvider, OPENAI_RENDER_TIMEOUT_MS, REFERENCE_FETCH_TIMEOUT_MS,
} from '../../services/creator/rendering/providers/openAIRenderProvider';
import { generateTopicEmbedding, EMBEDDING_REQUEST_TIMEOUT_MS } from '../../services/signalEmbeddingService';

const GEMINI_KEY = 'AIza-SECRET-GEMINI-KEY-123';

describe('SEC91-D8 Gemini key never in the URL', () => {
  const realFetch = global.fetch;
  afterEach(() => { global.fetch = realFetch; });

  it('gateway transport callGemini: key only in x-goog-api-key', async () => {
    const fetchMock = jest.fn(async (..._a: unknown[]) => ({
      ok: true,
      json: async () => ({ candidates: [{ content: { parts: [{ text: 'hi' }] } }], usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1 } }),
    }));
    global.fetch = fetchMock as never;
    const out = await callGemini({ apiKey: GEMINI_KEY, model: 'gemini-1.5-flash', temperature: 0, messages: [{ role: 'user', content: 'q' }] });
    expect(out.content).toBe('hi');
    const [url, init] = fetchMock.mock.calls[0] as [string, { headers: Record<string, string> }];
    expect(url).toContain(':generateContent');
    expect(url).not.toContain(GEMINI_KEY);
    expect(url).not.toMatch(/[?&]key=/);
    expect(init.headers['x-goog-api-key']).toBe(GEMINI_KEY);
  });

  it('visibility adapter legacy request: key only in x-goog-api-key', () => {
    const req = (new GeminiAdapter() as unknown as {
      buildRequest(a: { apiKey: string; query: string }): { url: string; init: { headers: Record<string, string> } };
    }).buildRequest({ apiKey: GEMINI_KEY, query: 'best crm' });
    expect(req.url).not.toContain(GEMINI_KEY);
    expect(req.url).not.toMatch(/[?&]key=/);
    expect(req.init.headers['x-goog-api-key']).toBe(GEMINI_KEY);
  });
});

describe('SEC91-D5 creator render provider requests are time-bounded', () => {
  const spec = (referenceUrl?: string) => ({
    render_modality: 'image',
    canonical_asset_family: 'image',
    platform_projection: { resolution: { w: 1080, h: 1080 } },
    blueprint_projection: { visual_prompt: 'a lighthouse', scene_direction: 'dawn', reference_image_url: referenceUrl ?? null },
  }) as never;

  it('generation carries an AbortSignal', async () => {
    const fetchImpl = jest.fn(async (..._a: unknown[]) => ({ ok: true, json: async () => ({ data: [{ url: 'https://img/1.png' }] }) }));
    const p = createOpenAIRenderProvider({ apiKey: 'sk-test', fetchImpl: fetchImpl as never });
    await p.submit(spec(), 'idem-1');
    const [url, init] = fetchImpl.mock.calls[0] as [string, { signal?: unknown }];
    expect(url).toContain('/images/generations');
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(OPENAI_RENDER_TIMEOUT_MS).toBeGreaterThan(0);
  });

  it('reference fetch and images/edits carry AbortSignals when reference mode is on', async () => {
    const prev = process.env.CREATOR_IMAGE_REFERENCE_MODE;
    process.env.CREATOR_IMAGE_REFERENCE_MODE = 'edit';
    try {
      const fetchImpl = jest.fn(async (url: unknown) => (String(url).includes('/images/edits')
        ? { ok: true, json: async () => ({ data: [{ url: 'https://img/edited.png' }] }) }
        : { ok: true, arrayBuffer: async () => new ArrayBuffer(4) }));
      const p = createOpenAIRenderProvider({ apiKey: 'sk-test', fetchImpl: fetchImpl as never });
      const handle = await p.submit(spec('https://cdn.example/showcase.webp'), 'idem-2');
      expect((handle.provider_metadata as { mode?: string }).mode).toBe('edit-reference');
      expect(fetchImpl).toHaveBeenCalledTimes(2);
      for (const call of fetchImpl.mock.calls) {
        expect((call as unknown as [string, { signal?: unknown }])[1]?.signal).toBeInstanceOf(AbortSignal);
      }
      expect(REFERENCE_FETCH_TIMEOUT_MS).toBeLessThan(OPENAI_RENDER_TIMEOUT_MS);
    } finally {
      if (prev === undefined) delete process.env.CREATOR_IMAGE_REFERENCE_MODE; else process.env.CREATOR_IMAGE_REFERENCE_MODE = prev;
    }
  });
});

describe('SEC91-D5 embedding client timeout', () => {
  it('the OpenAI embeddings client is built with an explicit bounded timeout', async () => {
    const prev = process.env.OPENAI_API_KEY;
    process.env.OPENAI_API_KEY = 'sk-test-embeddings';
    try {
      await generateTopicEmbedding('pricing strategy', { companyId: 'co-1' });
    } finally {
      if (prev === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = prev;
    }
    expect(mockEmbeddingCtorOpts).toHaveLength(1);
    expect(mockEmbeddingCtorOpts[0].timeout).toBe(EMBEDDING_REQUEST_TIMEOUT_MS);
    expect(EMBEDDING_REQUEST_TIMEOUT_MS).toBeLessThanOrEqual(60_000);
  });
});
