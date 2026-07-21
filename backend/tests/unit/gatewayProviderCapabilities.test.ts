/**
 * CANONICAL PROVIDER CAPABILITY REGISTRY (PB-004 · Program B · Platform · Zone P) —
 * unit tests.
 *
 * Proves:
 *   - REGISTRATION      — every canonical provider registers declaratively at load.
 *   - LOOKUP            — profile / single-capability / predicate / list / inverse.
 *   - UNKNOWN PROVIDER  — degrades to undefined / false / [] (never throws).
 *   - UNKNOWN CAPABILITY— degrades to undefined / false (never throws).
 *   - IMMUTABILITY      — declarations + returned collections are deep-frozen and
 *                         mutation attempts cannot corrupt the registry.
 *   - SERIALIZATION     — a plain JSON-round-trippable snapshot.
 *   - BACKWARD COMPAT   — additive extension leaves existing answers untouched;
 *                         the known-true perplexity→citations fact holds.
 *   - DESCRIPTIVE ONLY  — no probing, no I/O, no routing side effects.
 *
 * Pure: no network, no I/O.
 */
import {
  BUILT_IN_PROVIDER_CAPABILITIES,
  PROVIDER_CAPABILITIES,
  PROVIDER_CAPABILITY_NAMES,
  PROVIDER_CAPABILITY_REGISTRY_VERSION,
  defineProviderCapabilities,
  findProvidersWithCapability,
  getProviderCapabilities,
  getProviderCapability,
  getProviderCapabilityProfile,
  isKnownCapability,
  listCapabilityProviders,
  listProviderCapabilities,
  listProviderCapabilityProfiles,
  listSupportedCapabilities,
  resetProviderCapabilityRegistry,
  serializeProviderCapabilities,
  supportsCapability,
} from '../../services/aiGatewayCapabilities';

/** The canonical provider ids the dispatcher routes (aiGatewayDispatcher). */
const CANONICAL_PROVIDERS = ['openai', 'anthropic', 'gemini', 'perplexity', 'copilot'] as const;

afterEach(() => resetProviderCapabilityRegistry());

// ── Registration ──────────────────────────────────────────────────────────────

describe('provider registration (declarative, at module load)', () => {
  it('registers every canonical provider id', () => {
    const providers = listCapabilityProviders();
    for (const p of CANONICAL_PROVIDERS) expect(providers).toContain(p);
  });

  it('exposes a built-in profile per canonical provider', () => {
    for (const p of CANONICAL_PROVIDERS) {
      expect(BUILT_IN_PROVIDER_CAPABILITIES[p]).toBeDefined();
      expect(BUILT_IN_PROVIDER_CAPABILITIES[p].provider).toBe(p);
    }
    expect(listProviderCapabilityProfiles().length).toBeGreaterThanOrEqual(
      CANONICAL_PROVIDERS.length,
    );
  });

  it('requires evidence on EVERY declaration (no unevidenced claims)', () => {
    for (const p of CANONICAL_PROVIDERS) {
      const declarations = listProviderCapabilities(p);
      expect(declarations.length).toBeGreaterThan(0);
      for (const d of declarations) {
        expect(typeof d.evidence).toBe('string');
        expect(d.evidence.trim().length).toBeGreaterThan(0);
        expect(typeof d.supported).toBe('boolean');
      }
    }
  });

  it('only declares canonical capability names', () => {
    for (const p of CANONICAL_PROVIDERS) {
      for (const d of listProviderCapabilities(p)) {
        expect(isKnownCapability(d.capability)).toBe(true);
      }
    }
  });

  it('registration is declarative data only — re-registering is idempotent', () => {
    const before = serializeProviderCapabilities();
    resetProviderCapabilityRegistry();
    resetProviderCapabilityRegistry();
    expect(serializeProviderCapabilities()).toEqual(before);
  });

  it('a later registration for the same provider replaces (last-wins), not merges', () => {
    defineProviderCapabilities({
      provider: 'perplexity',
      capabilities: [
        { capability: PROVIDER_CAPABILITIES.STREAMING, supported: true, evidence: 'test override' },
      ],
    });
    expect(supportsCapability('perplexity', PROVIDER_CAPABILITIES.STREAMING)).toBe(true);
    // The replaced profile no longer declares citations at all → no claim.
    expect(getProviderCapability('perplexity', PROVIDER_CAPABILITIES.CITATIONS)).toBeUndefined();
  });

  it('duplicate capability entries in one spec resolve last-wins, deterministically', () => {
    defineProviderCapabilities({
      provider: 'dup-provider',
      capabilities: [
        { capability: PROVIDER_CAPABILITIES.SEARCH, supported: false, evidence: 'first' },
        { capability: PROVIDER_CAPABILITIES.SEARCH, supported: true, evidence: 'second' },
      ],
    });
    expect(supportsCapability('dup-provider', PROVIDER_CAPABILITIES.SEARCH)).toBe(true);
    expect(listProviderCapabilities('dup-provider')).toHaveLength(1);
  });
});

// ── Capability lookup ─────────────────────────────────────────────────────────

describe('capability lookup', () => {
  it('perplexity supports citations (PB-001/PB-002 established fact)', () => {
    expect(supportsCapability('perplexity', PROVIDER_CAPABILITIES.CITATIONS)).toBe(true);
    const decl = getProviderCapability('perplexity', PROVIDER_CAPABILITIES.CITATIONS);
    expect(decl?.supported).toBe(true);
    expect(decl?.evidence).toMatch(/PERPLEXITY_CITATIONS_V1/);
  });

  it('no other provider claims citations', () => {
    expect(findProvidersWithCapability(PROVIDER_CAPABILITIES.CITATIONS)).toEqual(['perplexity']);
  });

  it('distinguishes an explicit false from an undeclared capability', () => {
    // Explicit, evidenced negative.
    expect(getProviderCapability('anthropic', PROVIDER_CAPABILITIES.SEED)?.supported).toBe(false);
    expect(supportsCapability('anthropic', PROVIDER_CAPABILITIES.SEED)).toBe(false);
    // Undeclared → the Platform makes NO claim.
    expect(getProviderCapability('anthropic', PROVIDER_CAPABILITIES.REASONING)).toBeUndefined();
    expect(supportsCapability('anthropic', PROVIDER_CAPABILITIES.REASONING)).toBe(false);
  });

  it('reports the streaming split (openai/anthropic yes; seam transports no)', () => {
    expect(supportsCapability('openai', PROVIDER_CAPABILITIES.STREAMING)).toBe(true);
    expect(supportsCapability('anthropic', PROVIDER_CAPABILITIES.STREAMING)).toBe(true);
    expect(supportsCapability('gemini', PROVIDER_CAPABILITIES.STREAMING)).toBe(false);
    expect(supportsCapability('perplexity', PROVIDER_CAPABILITIES.STREAMING)).toBe(false);
    expect(supportsCapability('copilot', PROVIDER_CAPABILITIES.STREAMING)).toBe(false);
  });

  it('reports structured output + seed as OpenAI-only', () => {
    expect(findProvidersWithCapability(PROVIDER_CAPABILITIES.STRUCTURED_OUTPUT)).toEqual(['openai']);
    expect(findProvidersWithCapability(PROVIDER_CAPABILITIES.SEED)).toEqual(['openai']);
  });

  it('reports copilot as not text-capable (stub transport)', () => {
    expect(supportsCapability('copilot', PROVIDER_CAPABILITIES.TEXT_COMPLETION)).toBe(false);
    expect(listSupportedCapabilities('copilot')).toEqual([]);
    expect(getProviderCapabilityProfile('copilot')?.notes).toMatch(/stub/i);
  });

  it('listSupportedCapabilities returns only positives', () => {
    const supported = listSupportedCapabilities('perplexity');
    expect(supported).toContain(PROVIDER_CAPABILITIES.CITATIONS);
    expect(supported).toContain(PROVIDER_CAPABILITIES.TEXT_COMPLETION);
    expect(supported).not.toContain(PROVIDER_CAPABILITIES.STREAMING);
  });

  it('getProviderCapabilities returns the frozen capability map', () => {
    const map = getProviderCapabilities('gemini');
    expect(map[PROVIDER_CAPABILITIES.SYSTEM_PROMPT].supported).toBe(true);
    expect(Object.isFrozen(map)).toBe(true);
  });

  it('never declares a capability the tree does not evidence', () => {
    for (const cap of [
      PROVIDER_CAPABILITIES.GROUNDING,
      PROVIDER_CAPABILITIES.REASONING,
      PROVIDER_CAPABILITIES.PROVENANCE,
      PROVIDER_CAPABILITIES.SAFETY_METADATA,
      PROVIDER_CAPABILITIES.TOOL_CALLING,
    ]) {
      expect(findProvidersWithCapability(cap)).toEqual([]);
    }
  });
});

// ── Unknown providers ─────────────────────────────────────────────────────────

describe('unknown providers degrade gracefully', () => {
  const UNKNOWN = 'a-provider-that-does-not-exist';

  it('getProviderCapabilityProfile → undefined', () => {
    expect(getProviderCapabilityProfile(UNKNOWN)).toBeUndefined();
  });

  it('getProviderCapabilities → empty frozen map', () => {
    const map = getProviderCapabilities(UNKNOWN);
    expect(map).toEqual({});
    expect(Object.isFrozen(map)).toBe(true);
  });

  it('getProviderCapability → undefined; supportsCapability → false', () => {
    expect(getProviderCapability(UNKNOWN, PROVIDER_CAPABILITIES.CITATIONS)).toBeUndefined();
    expect(supportsCapability(UNKNOWN, PROVIDER_CAPABILITIES.CITATIONS)).toBe(false);
  });

  it('list APIs → empty, never throwing', () => {
    expect(listProviderCapabilities(UNKNOWN)).toEqual([]);
    expect(listSupportedCapabilities(UNKNOWN)).toEqual([]);
  });

  it('no lookup throws for odd inputs', () => {
    for (const p of [UNKNOWN, '', 'OPENAI', 'openai ']) {
      expect(() => getProviderCapabilityProfile(p)).not.toThrow();
      expect(() => supportsCapability(p, PROVIDER_CAPABILITIES.STREAMING)).not.toThrow();
      expect(() => listProviderCapabilities(p)).not.toThrow();
    }
    // Provider ids are exact — no case folding, no trimming, no guessing.
    expect(supportsCapability('OPENAI', PROVIDER_CAPABILITIES.STREAMING)).toBe(false);
  });
});

// ── Unknown capabilities ──────────────────────────────────────────────────────

describe('unknown capabilities degrade gracefully', () => {
  const FUTURE = 'someCapabilityInventedInTheFuture';

  it('is not a canonical name', () => {
    expect(isKnownCapability(FUTURE)).toBe(false);
    for (const name of PROVIDER_CAPABILITY_NAMES) expect(isKnownCapability(name)).toBe(true);
  });

  it('supportsCapability → false on a KNOWN provider (never throws)', () => {
    expect(supportsCapability('openai', FUTURE)).toBe(false);
    expect(getProviderCapability('openai', FUTURE)).toBeUndefined();
  });

  it('findProvidersWithCapability → empty', () => {
    expect(findProvidersWithCapability(FUTURE)).toEqual([]);
  });

  it('an empty-string capability is handled like any other unknown', () => {
    expect(supportsCapability('openai', '')).toBe(false);
    expect(findProvidersWithCapability('')).toEqual([]);
  });

  it('does not resolve through the prototype chain (toString/constructor are not capabilities)', () => {
    for (const key of ['toString', 'constructor', 'hasOwnProperty', '__proto__']) {
      expect(supportsCapability('openai', key)).toBe(false);
      expect(getProviderCapability('openai', key)).toBeUndefined();
    }
  });
});

// ── Immutability ──────────────────────────────────────────────────────────────

describe('immutability', () => {
  it('profiles and their declarations are deep-frozen', () => {
    const profile = getProviderCapabilityProfile('perplexity')!;
    expect(Object.isFrozen(profile)).toBe(true);
    expect(Object.isFrozen(profile.capabilities)).toBe(true);
    for (const d of Object.values(profile.capabilities)) expect(Object.isFrozen(d)).toBe(true);
  });

  it('mutating a returned declaration cannot change the registry answer', () => {
    const decl = getProviderCapability('anthropic', PROVIDER_CAPABILITIES.SEED)!;
    try {
      (decl as { supported: boolean }).supported = true;
    } catch {
      /* strict mode throws — either way the value must not change */
    }
    expect(supportsCapability('anthropic', PROVIDER_CAPABILITIES.SEED)).toBe(false);
  });

  it('mutating the returned capability map cannot inject a capability', () => {
    const map = getProviderCapabilities('gemini') as Record<string, unknown>;
    try {
      map[PROVIDER_CAPABILITIES.CITATIONS] = {
        capability: PROVIDER_CAPABILITIES.CITATIONS,
        supported: true,
        evidence: 'injected',
      };
    } catch {
      /* frozen */
    }
    expect(supportsCapability('gemini', PROVIDER_CAPABILITIES.CITATIONS)).toBe(false);
  });

  it('returned lists are frozen and detached from internals', () => {
    const list = listProviderCapabilities('openai');
    expect(Object.isFrozen(list)).toBe(true);
    try {
      (list as ProviderCapabilityDeclarationArray).push({
        capability: 'x',
        supported: true,
        evidence: 'e',
      });
    } catch {
      /* frozen */
    }
    expect(listProviderCapabilities('openai')).toEqual(list);
    expect(Object.isFrozen(listSupportedCapabilities('openai'))).toBe(true);
    expect(Object.isFrozen(listCapabilityProviders())).toBe(true);
    expect(Object.isFrozen(findProvidersWithCapability(PROVIDER_CAPABILITIES.CITATIONS))).toBe(true);
  });

  it('the built-in profile table is frozen', () => {
    expect(Object.isFrozen(BUILT_IN_PROVIDER_CAPABILITIES)).toBe(true);
    expect(Object.isFrozen(PROVIDER_CAPABILITY_NAMES)).toBe(true);
  });

  it('mutating a spec array after registration does not affect the profile', () => {
    const caps = [
      { capability: PROVIDER_CAPABILITIES.SEARCH, supported: true, evidence: 'spec' },
    ];
    defineProviderCapabilities({ provider: 'mutable-spec', capabilities: caps });
    caps.push({ capability: PROVIDER_CAPABILITIES.CITATIONS, supported: true, evidence: 'late' });
    expect(supportsCapability('mutable-spec', PROVIDER_CAPABILITIES.CITATIONS)).toBe(false);
    expect(listProviderCapabilities('mutable-spec')).toHaveLength(1);
  });
});

type ProviderCapabilityDeclarationArray = Array<{
  capability: string;
  supported: boolean;
  evidence: string;
}>;

// ── Serialization ─────────────────────────────────────────────────────────────

describe('serialization', () => {
  it('produces a plain provider → capability → boolean snapshot', () => {
    const snapshot = serializeProviderCapabilities();
    expect(snapshot.perplexity[PROVIDER_CAPABILITIES.CITATIONS]).toBe(true);
    expect(snapshot.copilot[PROVIDER_CAPABILITIES.TEXT_COMPLETION]).toBe(false);
    for (const p of CANONICAL_PROVIDERS) expect(snapshot[p]).toBeDefined();
  });

  it('JSON round-trips structurally', () => {
    const snapshot = serializeProviderCapabilities();
    expect(JSON.parse(JSON.stringify(snapshot))).toEqual(snapshot);
  });

  it('the snapshot is frozen and detached from the registry', () => {
    const snapshot = serializeProviderCapabilities();
    expect(Object.isFrozen(snapshot)).toBe(true);
    try {
      (snapshot as Record<string, Record<string, boolean>>).perplexity[
        PROVIDER_CAPABILITIES.CITATIONS
      ] = false;
    } catch {
      /* frozen */
    }
    expect(supportsCapability('perplexity', PROVIDER_CAPABILITIES.CITATIONS)).toBe(true);
  });

  it('a full profile JSON round-trips (evidence included)', () => {
    const profile = getProviderCapabilityProfile('perplexity')!;
    expect(JSON.parse(JSON.stringify(profile))).toEqual(profile);
  });
});

// ── Backward / forward compatibility ──────────────────────────────────────────

describe('compatibility', () => {
  it('declares a stable mechanism version', () => {
    expect(PROVIDER_CAPABILITY_REGISTRY_VERSION).toBe(1);
  });

  it('adding a NEW provider leaves every existing answer unchanged', () => {
    const before = serializeProviderCapabilities();
    defineProviderCapabilities({
      provider: 'future-provider',
      capabilities: [
        { capability: PROVIDER_CAPABILITIES.SEARCH, supported: true, evidence: 'hypothetical' },
      ],
    });
    const after = serializeProviderCapabilities();
    for (const p of CANONICAL_PROVIDERS) expect(after[p]).toEqual(before[p]);
    expect(supportsCapability('future-provider', PROVIDER_CAPABILITIES.SEARCH)).toBe(true);
  });

  it('adding a NEW capability to a provider is additive', () => {
    const existing = listProviderCapabilities('openai');
    defineProviderCapabilities({
      provider: 'openai',
      capabilities: [
        ...existing,
        { capability: 'aBrandNewCapability', supported: true, evidence: 'hypothetical' },
      ],
    });
    expect(supportsCapability('openai', PROVIDER_CAPABILITIES.STREAMING)).toBe(true);
    expect(supportsCapability('openai', 'aBrandNewCapability')).toBe(true);
  });

  it('a consumer written against an older Platform still compiles + answers', () => {
    // Older consumer knows only 'citations' — unknown-to-it capabilities are simply
    // never queried, and its query is unaffected by newer declarations.
    expect(supportsCapability('perplexity', 'citations')).toBe(true);
    expect(supportsCapability('openai', 'citations')).toBe(false);
  });

  it('reset restores the built-in baseline exactly', () => {
    const baseline = serializeProviderCapabilities();
    defineProviderCapabilities({
      provider: 'perplexity',
      capabilities: [{ capability: 'junk', supported: true, evidence: 'junk' }],
    });
    expect(serializeProviderCapabilities()).not.toEqual(baseline);
    resetProviderCapabilityRegistry();
    expect(serializeProviderCapabilities()).toEqual(baseline);
  });
});

// ── Descriptive-only guarantee ────────────────────────────────────────────────

describe('descriptive only', () => {
  it('performs no network or filesystem I/O (no fetch during lookups)', () => {
    const originalFetch = global.fetch;
    const spy = jest.fn();
    (global as { fetch: unknown }).fetch = spy;
    try {
      resetProviderCapabilityRegistry();
      for (const p of CANONICAL_PROVIDERS) {
        listProviderCapabilities(p);
        supportsCapability(p, PROVIDER_CAPABILITIES.CITATIONS);
        getProviderCapabilityProfile(p);
      }
      serializeProviderCapabilities();
      expect(spy).not.toHaveBeenCalled();
    } finally {
      (global as { fetch: unknown }).fetch = originalFetch;
    }
  });

  it('repeated lookups are pure — identical answers, no accumulation', () => {
    const first = serializeProviderCapabilities();
    for (let i = 0; i < 25; i += 1) {
      supportsCapability('perplexity', PROVIDER_CAPABILITIES.CITATIONS);
      listSupportedCapabilities('openai');
    }
    expect(serializeProviderCapabilities()).toEqual(first);
    expect(listCapabilityProviders()).toHaveLength(CANONICAL_PROVIDERS.length);
  });
});
