/**
 * Canonical Provider Metadata Contract (PB-001, Program B · Platform · Zone P) —
 * unit tests.
 *
 * Proves the additive provider-metadata extension of `NormalizedCompletion`:
 *   - BACKWARD COMPAT   — a legacy `{ content, usage }` completion is still valid;
 *                         consumers reading only those fields are unchanged.
 *   - METADATA ABSENT   — no `providerMetadata` key ⇒ getProviderMetadata → undefined;
 *                         callPerplexity with no citations returns the legacy shape.
 *   - METADATA PRESENT  — callPerplexity preserves grounded citations into a
 *                         version-tagged, provider-scoped envelope.
 *   - SERIALIZATION     — JSON round-trips the envelope structurally.
 *   - CLONING           — the envelope + its nested data are deep-frozen
 *                         (immutability preserved); a structural clone is intact.
 *   - PROVIDER ISOLATION — one provider's metadata never leaks into another's slot.
 *
 * No network: `global.fetch` is mocked per case.
 */
import {
  freezeProviderMetadata,
  attachProviderMetadata,
  getProviderMetadata,
  PROVIDER_METADATA_CONTRACT_VERSION,
  PERPLEXITY_METADATA_VERSION,
  type NormalizedCompletion,
  type ProviderMetadataEnvelope,
  type PerplexityCompletionMetadataV1,
} from '../../services/aiGatewayCore';
import { callPerplexity, type GatewayTransportParams } from '../../services/aiGatewayTransports';

const baseParams = (over: Partial<GatewayTransportParams> = {}): GatewayTransportParams => ({
  apiKey: 'test-key',
  model: 'sonar',
  temperature: 0,
  messages: [{ role: 'user', content: 'is brand X visible?' }],
  operation: 'test.probe',
  ...over,
});

function mockFetchOnce(json: unknown): jest.Mock {
  const fn = jest.fn().mockImplementationOnce(async () => ({ ok: true, json: async () => json }));
  (global as unknown as { fetch: unknown }).fetch = fn;
  return fn;
}

afterEach(() => jest.restoreAllMocks());

describe('PB-001 — provider metadata contract (core helpers)', () => {
  it('backward compatibility: a legacy { content, usage } completion is still a valid NormalizedCompletion', () => {
    // If the extension were non-additive this object literal would not typecheck.
    const legacy: NormalizedCompletion = {
      content: 'hello',
      usage: { prompt_tokens: 1, completion_tokens: 2, total_tokens: 3 },
    };
    expect(legacy.content).toBe('hello');
    // The optional field is simply absent.
    expect('providerMetadata' in legacy).toBe(false);
    expect(legacy.providerMetadata).toBeUndefined();
  });

  it('metadata absent: getProviderMetadata returns undefined on a bare completion', () => {
    const completion: NormalizedCompletion = { content: 'x', usage: null };
    expect(getProviderMetadata(completion, 'perplexity')).toBeUndefined();
    expect(getProviderMetadata(completion, 'anything')).toBeUndefined();
  });

  it('attachProviderMetadata is a no-op (returns the same reference) when no envelopes are supplied', () => {
    const completion: NormalizedCompletion = { content: 'x', usage: null };
    expect(attachProviderMetadata(completion)).toBe(completion);
  });

  it('metadata present: attaches a version-tagged, provider-scoped envelope without mutating the input', () => {
    const input: NormalizedCompletion = { content: 'answer', usage: null };
    const env = freezeProviderMetadata<'perplexity', PerplexityCompletionMetadataV1>(
      'perplexity',
      PERPLEXITY_METADATA_VERSION,
      { citations: ['https://a.example', 'https://b.example'] },
    );
    const out = attachProviderMetadata(input, env);

    // Input is untouched (purity).
    expect(input.providerMetadata).toBeUndefined();
    // Output carries the envelope, keyed by provider.
    const read = getProviderMetadata(out, 'perplexity') as
      | ProviderMetadataEnvelope<'perplexity', PerplexityCompletionMetadataV1>
      | undefined;
    expect(read?.provider).toBe('perplexity');
    expect(read?.version).toBe(1);
    expect(read?.data.citations).toEqual(['https://a.example', 'https://b.example']);
    // Core fields survive unchanged.
    expect(out.content).toBe('answer');
    expect(out.usage).toBeNull();
    // Contract mechanism version is exposed.
    expect(PROVIDER_METADATA_CONTRACT_VERSION).toBe(1);
  });

  it('cloning / immutability: envelope + nested data + the map are deep-frozen', () => {
    const env = freezeProviderMetadata('perplexity', 1, { citations: ['https://a.example'] });
    expect(Object.isFrozen(env)).toBe(true);
    expect(Object.isFrozen(env.data)).toBe(true);
    expect(Object.isFrozen((env.data as PerplexityCompletionMetadataV1).citations)).toBe(true);

    const out = attachProviderMetadata({ content: 'x', usage: null }, env);
    expect(Object.isFrozen(out.providerMetadata)).toBe(true);

    // Mutation attempts never change the value (frozen). Under strict mode the
    // write throws; either way the invariant is that the value is unchanged.
    try {
      (env as unknown as { version: number }).version = 999;
    } catch {
      /* strict-mode TypeError on a frozen write is expected */
    }
    expect(env.version).toBe(1);
    // A structural clone is intact and equal.
    const cloned = JSON.parse(JSON.stringify(env)) as typeof env;
    expect(cloned).toEqual(env);
  });

  it('serialization: an envelope round-trips through JSON structurally', () => {
    const env = freezeProviderMetadata<'perplexity', PerplexityCompletionMetadataV1>(
      'perplexity',
      PERPLEXITY_METADATA_VERSION,
      { citations: ['https://a.example', 'https://b.example'] },
    );
    const completion = attachProviderMetadata({ content: 'a', usage: null }, env);
    const round = JSON.parse(JSON.stringify(completion)) as NormalizedCompletion;
    expect(round.content).toBe('a');
    expect(round.providerMetadata?.perplexity).toEqual({
      provider: 'perplexity',
      version: 1,
      data: { citations: ['https://a.example', 'https://b.example'] },
    });
  });

  it('provider isolation: one provider metadata never leaks into another slot', () => {
    const perplexity = freezeProviderMetadata('perplexity', 1, { citations: ['https://p.example'] });
    const gemini = freezeProviderMetadata('gemini', 1, { grounding: ['https://g.example'] });
    const out = attachProviderMetadata({ content: 'x', usage: null }, perplexity, gemini);

    expect(getProviderMetadata(out, 'perplexity')?.data).toEqual({ citations: ['https://p.example'] });
    expect(getProviderMetadata(out, 'gemini')?.data).toEqual({ grounding: ['https://g.example'] });
    // Cross-read returns the OTHER provider's data — not a merge, not a leak.
    expect(getProviderMetadata(out, 'perplexity')).not.toEqual(getProviderMetadata(out, 'gemini'));
    // An unknown provider key is undefined, not a fallback to some other provider.
    expect(getProviderMetadata(out, 'openai')).toBeUndefined();
  });

  it('provider isolation: re-attaching one provider replaces only its own slot', () => {
    const p1 = freezeProviderMetadata('perplexity', 1, { citations: ['old'] });
    const gemini = freezeProviderMetadata('gemini', 1, { grounding: ['g'] });
    const first = attachProviderMetadata({ content: 'x', usage: null }, p1, gemini);
    const p2 = freezeProviderMetadata('perplexity', 1, { citations: ['new'] });
    const second = attachProviderMetadata(first, p2);

    expect(getProviderMetadata(second, 'perplexity')?.data).toEqual({ citations: ['new'] });
    // Gemini's slot is untouched by the perplexity re-attach.
    expect(getProviderMetadata(second, 'gemini')?.data).toEqual({ grounding: ['g'] });
    // The earlier completion is unchanged (purity).
    expect(getProviderMetadata(first, 'perplexity')?.data).toEqual({ citations: ['old'] });
  });
});

describe('PB-001 — Perplexity citations survive normalization (gateway transport)', () => {
  it('preserves grounded citations into a perplexity envelope', async () => {
    mockFetchOnce({
      choices: [{ message: { content: 'grounded answer' }, finish_reason: 'stop' }],
      citations: ['https://one.example', 'https://two.example'],
      usage: { prompt_tokens: 4, completion_tokens: 1, total_tokens: 5 },
    });
    const r = await callPerplexity(baseParams());
    // Core normalization is unchanged.
    expect(r.content).toBe('grounded answer');
    expect(r.usage).toEqual({ prompt_tokens: 4, completion_tokens: 1, total_tokens: 5 });
    // Citations survived, provider-scoped + version-tagged + frozen.
    const env = getProviderMetadata(r, 'perplexity') as
      | ProviderMetadataEnvelope<'perplexity', PerplexityCompletionMetadataV1>
      | undefined;
    expect(env?.provider).toBe('perplexity');
    expect(env?.version).toBe(PERPLEXITY_METADATA_VERSION);
    expect(env?.data.citations).toEqual(['https://one.example', 'https://two.example']);
    expect(Object.isFrozen(env)).toBe(true);
  });

  it('backward compatible: no citations ⇒ legacy shape (no providerMetadata key)', async () => {
    mockFetchOnce({
      choices: [{ message: { content: 'ungrounded' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 4, completion_tokens: 1, total_tokens: 5 },
    });
    const r = await callPerplexity(baseParams());
    expect(r.content).toBe('ungrounded');
    expect(r.usage).toEqual({ prompt_tokens: 4, completion_tokens: 1, total_tokens: 5 });
    expect('providerMetadata' in r).toBe(false);
    expect(getProviderMetadata(r, 'perplexity')).toBeUndefined();
  });

  it('robustness: a non-array / non-string citations payload is ignored (no throw, legacy shape)', async () => {
    mockFetchOnce({
      choices: [{ message: { content: 'x' }, finish_reason: 'stop' }],
      citations: 'not-an-array',
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    });
    const r = await callPerplexity(baseParams());
    expect(getProviderMetadata(r, 'perplexity')).toBeUndefined();

    mockFetchOnce({
      choices: [{ message: { content: 'y' }, finish_reason: 'stop' }],
      citations: ['https://ok.example', 123, null, 'https://ok2.example'],
    });
    const r2 = await callPerplexity(baseParams());
    // Only the string citations survive; non-strings filtered out.
    expect(
      (getProviderMetadata(r2, 'perplexity')?.data as PerplexityCompletionMetadataV1).citations,
    ).toEqual(['https://ok.example', 'https://ok2.example']);
  });
});
