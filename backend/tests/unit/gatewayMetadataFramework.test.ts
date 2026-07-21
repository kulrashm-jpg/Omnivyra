/**
 * PROVIDER METADATA CONSUMER FRAMEWORK (PB-003R · Program B · Platform · Zone P) —
 * unit tests.
 *
 * Proves the framework layered ADDITIVELY over the PB-001 provider-keyed map:
 *   - TYPED RETRIEVAL      — descriptor-driven reads return typed payloads, no casts.
 *   - CENTRAL VALIDATION   — absent / wrong-provider / wrong-version / malformed /
 *                            junk-entry payloads are all handled by the Platform.
 *   - REGISTRY             — (provider, kind, version) → { validate, decode }.
 *   - EVOLUTION            — lookup by (provider), (provider+kind), (provider+kind+version).
 *   - COEXISTENCE          — grounding · reasoning · safety · provenance · diagnostics
 *                            live side by side for ONE provider and version independently.
 *   - INVARIANTS PRESERVED — deep freeze · provider isolation · immutability ·
 *                            attach no-op · backward compatibility with PB-001/PB-002.
 *
 * Pure: no network, no I/O.
 */
import {
  DEFAULT_PROVIDER_METADATA_KIND,
  PERPLEXITY_METADATA_VERSION,
  attachProviderMetadata,
  freezeProviderMetadata,
  getProviderMetadata,
  providerMetadataSlotKey,
  type NormalizedCompletion,
  type PerplexityCompletionMetadataV1,
} from '../../services/aiGatewayCore';
import {
  PERPLEXITY_CITATIONS_V1,
  PROVIDER_METADATA_FRAMEWORK_VERSION,
  PROVIDER_METADATA_KINDS,
  attachTypedProviderMetadata,
  buildProviderMetadataEnvelope,
  defineProviderMetadataKind,
  getProviderMetadataEnvelope,
  hasProviderMetadata,
  listProviderMetadataDescriptors,
  listProviderMetadataEnvelopes,
  readProviderMetadata,
  readProviderMetadataByRef,
  readProviderMetadataOr,
  resetProviderMetadataRegistry,
  resolveProviderMetadataDescriptor,
} from '../../services/aiGatewayMetadata';

const bare = (): NormalizedCompletion => ({ content: 'answer', usage: null });

/** A PB-001/PB-002-era completion literal — exactly what the shipped adapter sees. */
const legacyPerplexityCompletion = (citations: unknown): NormalizedCompletion =>
  ({
    content: 'answer',
    usage: null,
    providerMetadata: { perplexity: { provider: 'perplexity', version: 1, data: { citations } } },
  }) as unknown as NormalizedCompletion;

type GroundingV1 = { readonly chunks: readonly string[] };
type SafetyV1 = { readonly blocked: boolean };
type ReasoningV2 = { readonly summary: string };

afterEach(() => resetProviderMetadataRegistry());

describe('PB-003R — registry: (provider, kind, version) → { validate, decode }', () => {
  it('defineProviderMetadataKind registers and returns a frozen descriptor', () => {
    const d = defineProviderMetadataKind<GroundingV1>({
      provider: 'gemini',
      kind: PROVIDER_METADATA_KINDS.GROUNDING,
      version: 1,
      decode: (raw) => {
        const chunks = (raw as { chunks?: unknown })?.chunks;
        return Array.isArray(chunks) ? { chunks: chunks.filter((c): c is string => typeof c === 'string') } : undefined;
      },
    });
    expect(Object.isFrozen(d)).toBe(true);
    expect(d.provider).toBe('gemini');
    expect(d.kind).toBe('grounding');
    expect(d.version).toBe(1);
    expect(d.legacyDefault).toBe(false);
    expect(listProviderMetadataDescriptors('gemini')).toContain(d);
    expect(PROVIDER_METADATA_FRAMEWORK_VERSION).toBe(1);
  });

  it('derives validate from decode, and decode from validate', () => {
    const fromDecode = defineProviderMetadataKind<SafetyV1>({
      provider: 'x', kind: 'safety', version: 1,
      decode: (raw) => (typeof (raw as { blocked?: unknown })?.blocked === 'boolean' ? { blocked: (raw as SafetyV1).blocked } : undefined),
    });
    expect(fromDecode.validate({ blocked: true })).toBe(true);
    expect(fromDecode.validate({ blocked: 'nope' })).toBe(false);

    const fromValidate = defineProviderMetadataKind<SafetyV1>({
      provider: 'y', kind: 'safety', version: 1,
      validate: (raw) => typeof (raw as { blocked?: unknown })?.blocked === 'boolean',
    });
    expect(fromValidate.decode({ blocked: false })).toEqual({ blocked: false });
    expect(fromValidate.decode({})).toBeUndefined();
  });

  it('a descriptor with neither validate nor decode is rejected', () => {
    expect(() =>
      defineProviderMetadataKind({ provider: 'z', kind: 'safety', version: 1 } as never),
    ).toThrow(/validate or a decode/);
  });

  it('a throwing validator/decoder is contained (defensive parsing lives in the Platform)', () => {
    const d = defineProviderMetadataKind<SafetyV1>({
      provider: 'boom', kind: 'safety', version: 1,
      decode: () => { throw new Error('hostile payload'); },
    });
    expect(d.decode({ blocked: true })).toBeUndefined();
    expect(d.validate({ blocked: true })).toBe(false);
    const c = attachProviderMetadata(bare(), freezeProviderMetadata('boom', 1, { blocked: true }, 'safety'));
    expect(readProviderMetadata(c, d)).toBeUndefined();
  });

  it('re-registering the same coordinate replaces (idempotent per provider/kind/version)', () => {
    defineProviderMetadataKind<SafetyV1>({ provider: 'p', kind: 'safety', version: 1, validate: () => false });
    const second = defineProviderMetadataKind<SafetyV1>({ provider: 'p', kind: 'safety', version: 1, validate: () => true });
    expect(listProviderMetadataDescriptors('p')).toHaveLength(1);
    expect(resolveProviderMetadataDescriptor({ provider: 'p', kind: 'safety', version: 1 })).toBe(second);
  });
});

describe('PB-003R — descriptor resolution: (provider) · (provider+kind) · (provider+kind+version)', () => {
  beforeEach(() => {
    defineProviderMetadataKind<GroundingV1>({ provider: 'gemini', kind: 'grounding', version: 1, validate: () => true });
    defineProviderMetadataKind<ReasoningV2>({ provider: 'gemini', kind: 'reasoning', version: 1, validate: () => true });
    defineProviderMetadataKind<ReasoningV2>({ provider: 'gemini', kind: 'reasoning', version: 2, validate: () => true });
  });

  it('(provider + kind + version) resolves the exact registration', () => {
    expect(resolveProviderMetadataDescriptor({ provider: 'gemini', kind: 'reasoning', version: 1 })?.version).toBe(1);
    expect(resolveProviderMetadataDescriptor({ provider: 'gemini', kind: 'reasoning', version: 2 })?.version).toBe(2);
    expect(resolveProviderMetadataDescriptor({ provider: 'gemini', kind: 'reasoning', version: 9 })).toBeUndefined();
  });

  it('(provider + kind) resolves the highest registered version', () => {
    expect(resolveProviderMetadataDescriptor({ provider: 'gemini', kind: 'reasoning' })?.version).toBe(2);
    expect(resolveProviderMetadataDescriptor({ provider: 'gemini', kind: 'grounding' })?.version).toBe(1);
  });

  it('(provider) alone resolves the legacy-default descriptor, and is undefined when ambiguous', () => {
    // gemini has two kinds and no legacy default → ambiguous, resolves to undefined (never a guess).
    expect(resolveProviderMetadataDescriptor({ provider: 'gemini' })).toBeUndefined();
    // perplexity's built-in citations descriptor IS the legacy default.
    expect(resolveProviderMetadataDescriptor({ provider: 'perplexity' })).toBe(PERPLEXITY_CITATIONS_V1);
    // an unknown provider resolves to nothing.
    expect(resolveProviderMetadataDescriptor({ provider: 'nobody' })).toBeUndefined();
  });

  it('(provider) resolves a sole registration even without a legacy default', () => {
    defineProviderMetadataKind<SafetyV1>({ provider: 'solo', kind: 'safety', version: 3, validate: () => true });
    expect(resolveProviderMetadataDescriptor({ provider: 'solo' })?.kind).toBe('safety');
  });
});

describe('PB-003R — typed, validated retrieval (the consumer API)', () => {
  it('returns the typed payload with NO cast at the call site', () => {
    const completion = attachTypedProviderMetadata(bare(), PERPLEXITY_CITATIONS_V1, {
      citations: ['https://a.example', 'https://b.example'],
    });
    // `data` is typed PerplexityCompletionMetadataV1 — `.citations` compiles directly.
    const data = readProviderMetadata(completion, PERPLEXITY_CITATIONS_V1);
    const citations: readonly string[] = data?.citations ?? [];
    expect(citations).toEqual(['https://a.example', 'https://b.example']);
  });

  it('centralizes every guard PB-002 hand-rolled', () => {
    // absent metadata
    expect(readProviderMetadata(bare(), PERPLEXITY_CITATIONS_V1)).toBeUndefined();
    // wrong version (version-safe)
    const wrongVersion = {
      content: 'x', usage: null,
      providerMetadata: { perplexity: { provider: 'perplexity', version: 999, data: { citations: ['https://a.example'] } } },
    } as unknown as NormalizedCompletion;
    expect(readProviderMetadata(wrongVersion, PERPLEXITY_CITATIONS_V1)).toBeUndefined();
    // wrong provider in the slot (isolation)
    const leaky = {
      content: 'x', usage: null,
      providerMetadata: { perplexity: { provider: 'openai', version: 1, data: { citations: ['https://leak.example'] } } },
    } as unknown as NormalizedCompletion;
    expect(readProviderMetadata(leaky, PERPLEXITY_CITATIONS_V1)).toBeUndefined();
    // malformed payloads
    expect(readProviderMetadata(legacyPerplexityCompletion('not-an-array'), PERPLEXITY_CITATIONS_V1)).toBeUndefined();
    expect(readProviderMetadata(legacyPerplexityCompletion(null), PERPLEXITY_CITATIONS_V1)).toBeUndefined();
    expect(readProviderMetadata(legacyPerplexityCompletion([]), PERPLEXITY_CITATIONS_V1)).toBeUndefined();
  });

  it('filters junk entries centrally (the read-side filtering PB-002 duplicated)', () => {
    const mixed = legacyPerplexityCompletion(['https://a.example', 42, null, {}, 'https://b.example']);
    expect(readProviderMetadata(mixed, PERPLEXITY_CITATIONS_V1)?.citations).toEqual([
      'https://a.example',
      'https://b.example',
    ]);
  });

  it('readProviderMetadataOr supplies a safe default without a guard', () => {
    expect(readProviderMetadataOr(bare(), PERPLEXITY_CITATIONS_V1, { citations: [] }).citations).toEqual([]);
  });

  it('readProviderMetadataByRef resolves the descriptor from the registry', () => {
    const c = attachTypedProviderMetadata(bare(), PERPLEXITY_CITATIONS_V1, { citations: ['https://a.example'] });
    expect(readProviderMetadataByRef<PerplexityCompletionMetadataV1>(c, { provider: 'perplexity' })?.citations).toEqual([
      'https://a.example',
    ]);
    expect(
      readProviderMetadataByRef<PerplexityCompletionMetadataV1>(c, { provider: 'perplexity', kind: 'citations', version: 1 })
        ?.citations,
    ).toEqual(['https://a.example']);
    // Unregistered coordinate → undefined, never a raw unvalidated blob.
    expect(readProviderMetadataByRef(c, { provider: 'perplexity', kind: 'safety' })).toBeUndefined();
  });

  it('the decoded payload is deep-frozen (immutability)', () => {
    const c = attachTypedProviderMetadata(bare(), PERPLEXITY_CITATIONS_V1, { citations: ['https://a.example'] });
    const data = readProviderMetadata(c, PERPLEXITY_CITATIONS_V1)!;
    expect(Object.isFrozen(data)).toBe(true);
    expect(Object.isFrozen(data.citations)).toBe(true);
    try {
      (data.citations as string[]).push('https://injected.example');
    } catch {
      /* strict-mode TypeError on a frozen write is expected */
    }
    expect(data.citations).toEqual(['https://a.example']);
  });
});

describe('PB-003R — multiple kinds coexist independently for ONE provider', () => {
  const G = () => defineProviderMetadataKind<GroundingV1>({
    provider: 'gemini', kind: PROVIDER_METADATA_KINDS.GROUNDING, version: 1,
    decode: (raw) => {
      const chunks = (raw as { chunks?: unknown })?.chunks;
      return Array.isArray(chunks) ? { chunks: chunks.filter((c): c is string => typeof c === 'string') } : undefined;
    },
  });
  const S = () => defineProviderMetadataKind<SafetyV1>({
    provider: 'gemini', kind: PROVIDER_METADATA_KINDS.SAFETY, version: 1,
    decode: (raw) => (typeof (raw as { blocked?: unknown })?.blocked === 'boolean' ? { blocked: (raw as SafetyV1).blocked } : undefined),
  });
  const R2 = () => defineProviderMetadataKind<ReasoningV2>({
    provider: 'gemini', kind: PROVIDER_METADATA_KINDS.REASONING, version: 2,
    decode: (raw) => (typeof (raw as { summary?: unknown })?.summary === 'string' ? { summary: (raw as ReasoningV2).summary } : undefined),
  });

  it('grounding + safety + reasoning + provenance + diagnostics all survive on one completion', () => {
    const grounding = G(); const safety = S(); const reasoning = R2();
    const provenance = defineProviderMetadataKind<{ readonly source: string }>({
      provider: 'gemini', kind: PROVIDER_METADATA_KINDS.PROVENANCE, version: 1,
      decode: (raw) => (typeof (raw as { source?: unknown })?.source === 'string' ? { source: (raw as { source: string }).source } : undefined),
    });
    const diagnostics = defineProviderMetadataKind<{ readonly cacheHit: boolean }>({
      provider: 'gemini', kind: PROVIDER_METADATA_KINDS.DIAGNOSTICS, version: 1,
      decode: (raw) => (typeof (raw as { cacheHit?: unknown })?.cacheHit === 'boolean' ? { cacheHit: (raw as { cacheHit: boolean }).cacheHit } : undefined),
    });

    let c = bare();
    c = attachTypedProviderMetadata(c, grounding, { chunks: ['https://g.example'] });
    c = attachTypedProviderMetadata(c, safety, { blocked: false });
    c = attachTypedProviderMetadata(c, reasoning, { summary: 'chain' });
    c = attachTypedProviderMetadata(c, provenance, { source: 'web' });
    c = attachTypedProviderMetadata(c, diagnostics, { cacheHit: true });

    expect(readProviderMetadata(c, grounding)).toEqual({ chunks: ['https://g.example'] });
    expect(readProviderMetadata(c, safety)).toEqual({ blocked: false });
    expect(readProviderMetadata(c, reasoning)).toEqual({ summary: 'chain' });
    expect(readProviderMetadata(c, provenance)).toEqual({ source: 'web' });
    expect(readProviderMetadata(c, diagnostics)).toEqual({ cacheHit: true });
    // Five independent slots, none overwriting another.
    expect(listProviderMetadataEnvelopes(c, 'gemini').map((e) => e.kind).sort()).toEqual([
      'diagnostics', 'grounding', 'provenance', 'reasoning', 'safety',
    ]);
  });

  it('kinds version INDEPENDENTLY — bumping one leaves the others untouched', () => {
    const grounding = G(); const reasoning = R2();
    let c = attachTypedProviderMetadata(bare(), grounding, { chunks: ['https://g.example'] });
    c = attachTypedProviderMetadata(c, reasoning, { summary: 'v2 chain' });

    // Reading grounding at v1 works; asking for a v2 grounding (not emitted) does not
    // disturb the reasoning payload that IS at v2.
    expect(getProviderMetadataEnvelope(c, { provider: 'gemini', kind: 'grounding', version: 1 })?.version).toBe(1);
    expect(getProviderMetadataEnvelope(c, { provider: 'gemini', kind: 'grounding', version: 2 })).toBeUndefined();
    expect(getProviderMetadataEnvelope(c, { provider: 'gemini', kind: 'reasoning', version: 2 })?.version).toBe(2);
    expect(readProviderMetadata(c, reasoning)).toEqual({ summary: 'v2 chain' });
  });

  it('re-attaching one kind replaces only that kind\'s slot', () => {
    const grounding = G(); const safety = S();
    let c = attachTypedProviderMetadata(bare(), grounding, { chunks: ['old'] });
    c = attachTypedProviderMetadata(c, safety, { blocked: true });
    const updated = attachTypedProviderMetadata(c, grounding, { chunks: ['new'] });

    expect(readProviderMetadata(updated, grounding)).toEqual({ chunks: ['new'] });
    expect(readProviderMetadata(updated, safety)).toEqual({ blocked: true });
    // purity — the earlier completion is untouched
    expect(readProviderMetadata(c, grounding)).toEqual({ chunks: ['old'] });
  });

  it('kinded slots are provider-prefixed, so cross-provider kinds never collide', () => {
    const geminiGrounding = G();
    const otherGrounding = defineProviderMetadataKind<GroundingV1>({
      provider: 'perplexity', kind: 'grounding', version: 1,
      decode: (raw) => {
        const chunks = (raw as { chunks?: unknown })?.chunks;
        return Array.isArray(chunks) ? { chunks: chunks.filter((c): c is string => typeof c === 'string') } : undefined;
      },
    });
    let c = attachTypedProviderMetadata(bare(), geminiGrounding, { chunks: ['gemini'] });
    c = attachTypedProviderMetadata(c, otherGrounding, { chunks: ['perplexity'] });

    expect(providerMetadataSlotKey('gemini', 'grounding')).toBe('gemini::grounding');
    expect(readProviderMetadata(c, geminiGrounding)).toEqual({ chunks: ['gemini'] });
    expect(readProviderMetadata(c, otherGrounding)).toEqual({ chunks: ['perplexity'] });
    expect(listProviderMetadataEnvelopes(c, 'gemini')).toHaveLength(1);
    expect(listProviderMetadataEnvelopes(c, 'perplexity')).toHaveLength(1);
  });
});

describe('PB-003R — backward compatibility with PB-001 / PB-002 (additive proof)', () => {
  it('a legacy kind-less envelope answers a modern (provider+kind) read', () => {
    const legacy = legacyPerplexityCompletion(['https://a.example']);
    // The wire shape has NO `kind` key, yet the kinded coordinate resolves it,
    // because the built-in citations descriptor is the provider's legacy default.
    expect(getProviderMetadataEnvelope(legacy, { provider: 'perplexity', kind: 'citations' })?.version).toBe(1);
    expect(readProviderMetadata(legacy, PERPLEXITY_CITATIONS_V1)?.citations).toEqual(['https://a.example']);
    expect(hasProviderMetadata(legacy, { provider: 'perplexity' })).toBe(true);
    expect(listProviderMetadataEnvelopes(legacy, 'perplexity')[0]?.kind).toBe('citations');
  });

  it('the framework writes the EXACT PB-001 wire shape for a legacy-default kind', () => {
    const env = buildProviderMetadataEnvelope(PERPLEXITY_CITATIONS_V1, { citations: ['https://a.example'] })!;
    // No `kind` key: structurally identical to a PB-001 envelope.
    expect(env).toEqual({ provider: 'perplexity', version: PERPLEXITY_METADATA_VERSION, data: { citations: ['https://a.example'] } });
    expect('kind' in env).toBe(false);
    const c = attachProviderMetadata(bare(), env);
    // …and it lands in the bare provider slot, so the PB-002 provider-only read works.
    expect(getProviderMetadata(c, 'perplexity')?.version).toBe(1);
    expect(JSON.parse(JSON.stringify(c)).providerMetadata.perplexity).toEqual({
      provider: 'perplexity', version: 1, data: { citations: ['https://a.example'] },
    });
  });

  it('PB-002\'s exact hand-rolled read still works alongside the framework read', () => {
    const c = attachTypedProviderMetadata(bare(), PERPLEXITY_CITATIONS_V1, { citations: ['https://a.example', 7] });
    // ── PB-002 style (unchanged, still supported) ──
    const envelope = getProviderMetadata(c, 'perplexity');
    expect(envelope).toBeDefined();
    expect(envelope!.version).toBe(PERPLEXITY_METADATA_VERSION);
    const legacyRead = (envelope!.data as Partial<PerplexityCompletionMetadataV1>).citations;
    // ── PB-003R style ──
    const frameworkRead = readProviderMetadata(c, PERPLEXITY_CITATIONS_V1)?.citations;
    expect(frameworkRead).toEqual(legacyRead);
    expect(frameworkRead).toEqual(['https://a.example']);
  });

  it('DEFAULT kind sentinel is never written into an envelope and reads as the provider slot', () => {
    const env = freezeProviderMetadata('perplexity', 1, { citations: ['x'] }, DEFAULT_PROVIDER_METADATA_KIND);
    expect('kind' in env).toBe(false);
    const c = attachProviderMetadata(bare(), env);
    expect(Object.keys(c.providerMetadata!)).toEqual(['perplexity']);
    expect(getProviderMetadataEnvelope(c, { provider: 'perplexity', kind: DEFAULT_PROVIDER_METADATA_KIND })).toBe(env);
  });
});

describe('PB-003R — preserved invariants', () => {
  it('deep freeze: framework-built envelopes + nested data are frozen', () => {
    const env = buildProviderMetadataEnvelope(PERPLEXITY_CITATIONS_V1, { citations: ['https://a.example'] })!;
    expect(Object.isFrozen(env)).toBe(true);
    expect(Object.isFrozen(env.data)).toBe(true);
    expect(Object.isFrozen((env.data as PerplexityCompletionMetadataV1).citations)).toBe(true);
    const c = attachTypedProviderMetadata(bare(), PERPLEXITY_CITATIONS_V1, { citations: ['https://a.example'] });
    expect(Object.isFrozen(c.providerMetadata)).toBe(true);
  });

  it('provider isolation: a kinded read never crosses providers, even on a mis-keyed slot', () => {
    const safety = defineProviderMetadataKind<SafetyV1>({
      provider: 'gemini', kind: 'safety', version: 1, validate: () => true,
    });
    const spoofed = {
      content: 'x', usage: null,
      providerMetadata: { 'gemini::safety': { provider: 'openai', kind: 'safety', version: 1, data: { blocked: true } } },
    } as unknown as NormalizedCompletion;
    expect(readProviderMetadata(spoofed, safety)).toBeUndefined();
    expect(getProviderMetadataEnvelope(spoofed, { provider: 'gemini', kind: 'safety' })).toBeUndefined();
    expect(listProviderMetadataEnvelopes(spoofed, 'gemini')).toHaveLength(0);
  });

  it('attach no-op: nothing to attach ⇒ the SAME reference, and no providerMetadata key', () => {
    const input = bare();
    // zero envelopes (PB-001 guarantee)
    expect(attachProviderMetadata(input)).toBe(input);
    // invalid / absent payload through the framework (PB-003R guarantee)
    expect(attachTypedProviderMetadata(input, PERPLEXITY_CITATIONS_V1, undefined)).toBe(input);
    expect(attachTypedProviderMetadata(input, PERPLEXITY_CITATIONS_V1, { citations: [] })).toBe(input);
    expect(attachTypedProviderMetadata(input, PERPLEXITY_CITATIONS_V1, { citations: 'nope' })).toBe(input);
    expect(attachTypedProviderMetadata(input, PERPLEXITY_CITATIONS_V1, {})).toBe(input);
    expect('providerMetadata' in attachTypedProviderMetadata(input, PERPLEXITY_CITATIONS_V1, {})).toBe(false);
  });

  it('purity: attaching never mutates the input completion', () => {
    const input = bare();
    const out = attachTypedProviderMetadata(input, PERPLEXITY_CITATIONS_V1, { citations: ['https://a.example'] });
    expect(input.providerMetadata).toBeUndefined();
    expect(out).not.toBe(input);
    expect(out.content).toBe('answer');
    expect(out.usage).toBeNull();
  });

  it('serialization: kinded envelopes JSON round-trip and remain readable', () => {
    const grounding = defineProviderMetadataKind<GroundingV1>({
      provider: 'gemini', kind: 'grounding', version: 1,
      decode: (raw) => {
        const chunks = (raw as { chunks?: unknown })?.chunks;
        return Array.isArray(chunks) ? { chunks: chunks.filter((c): c is string => typeof c === 'string') } : undefined;
      },
    });
    const c = attachTypedProviderMetadata(bare(), grounding, { chunks: ['https://g.example'] });
    const round = JSON.parse(JSON.stringify(c)) as NormalizedCompletion;
    expect(round.providerMetadata?.['gemini::grounding']).toEqual({
      provider: 'gemini', kind: 'grounding', version: 1, data: { chunks: ['https://g.example'] },
    });
    expect(readProviderMetadata(round, grounding)).toEqual({ chunks: ['https://g.example'] });
  });

  it('a completion with no metadata is inert for every framework read', () => {
    const c = bare();
    expect(getProviderMetadataEnvelope(c, { provider: 'perplexity' })).toBeUndefined();
    expect(getProviderMetadataEnvelope(c, { provider: 'perplexity', kind: 'citations', version: 1 })).toBeUndefined();
    expect(hasProviderMetadata(c, { provider: 'perplexity' })).toBe(false);
    expect(listProviderMetadataEnvelopes(c, 'perplexity')).toEqual([]);
    expect(readProviderMetadataByRef(c, { provider: 'perplexity' })).toBeUndefined();
  });
});
