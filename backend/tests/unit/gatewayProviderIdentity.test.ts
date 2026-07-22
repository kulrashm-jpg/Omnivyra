/**
 * CANONICAL PROVIDER IDENTITY (PB-006 · Program B · Platform · Zone P) — unit tests.
 *
 * Proves:
 *   - VALID MAPPINGS     — all five product ids and all five platform ids resolve,
 *                          including the two that differ (chatgpt↔openai, claude↔anthropic).
 *   - INVALID MAPPINGS   — an id from the OTHER vocabulary is rejected, not coerced.
 *   - UNKNOWN IDS        — unknown strings, wrong case, whitespace, empty string,
 *                          prototype keys and non-strings all fail explicitly.
 *   - NO SILENT FALLBACK — for EVERY bad input, EVERY resolver either throws a typed
 *                          error or returns undefined / { ok: false }. Never a
 *                          plausible-but-wrong id, never a default.
 *   - ROUND TRIP         — product→platform→product and platform→product→platform are
 *                          the identity, in both directions, for every provider.
 *   - IMMUTABILITY       — maps are frozen, null-prototype, and detached from internals.
 *   - PB-004 BOUNDARY    — the capability registry still degrades gracefully and still
 *                          never throws; importing this module changes nothing.
 *   - BACKWARD COMPAT    — pure, side-effect-free, nothing consumes it.
 *
 * Pure: no network, no I/O.
 */
import * as identity from '../../services/aiGatewayProviderIdentity';
import {
  PLATFORM_PROVIDER_IDS,
  PLATFORM_TO_PRODUCT_PROVIDER,
  PRODUCT_PROVIDER_IDS,
  PRODUCT_TO_PLATFORM_PROVIDER,
  PROVIDER_IDENTITY_CONTRACT_VERSION,
  ProviderIdentityError,
  isPlatformProviderId,
  isProductProviderId,
  listProviderIdentityPairs,
  resolvePlatformProviderId,
  resolveProductProviderId,
  serializeProviderIdentityMap,
  toPlatformProviderId,
  toProductProviderId,
  tryToPlatformProviderId,
  tryToProductProviderId,
  type PlatformProviderId,
  type ProductProviderId,
} from '../../services/aiGatewayProviderIdentity';
// Product vocabulary, imported HERE (in the test) to prove the Platform mapping agrees
// with the Product union at runtime. The module under test imports it TYPE-ONLY.
import { AI_PROVIDERS } from '../../services/intelligence/providerInterfaces';
// PB-004 registry — used only to prove its graceful-degradation mandate is untouched.
import {
  PROVIDER_CAPABILITIES,
  getProviderCapabilityProfile,
  listProviderCapabilities,
  supportsCapability,
} from '../../services/aiGatewayCapabilities';

/** The canonical platform ids the dispatcher routes (aiGatewayDispatcher:44). */
const CANONICAL_PLATFORM_IDS = ['openai', 'anthropic', 'gemini', 'perplexity', 'copilot'] as const;

/** The canonical product ids (intelligence/providerInterfaces:18). */
const CANONICAL_PRODUCT_IDS = ['chatgpt', 'gemini', 'claude', 'perplexity', 'copilot'] as const;

/** THE frozen truth table this package exists to establish. */
const EXPECTED_PAIRS: ReadonlyArray<readonly [ProductProviderId, PlatformProviderId]> = [
  ['chatgpt', 'openai'],
  ['claude', 'anthropic'],
  ['gemini', 'gemini'],
  ['perplexity', 'perplexity'],
  ['copilot', 'copilot'],
];

// ── Valid mappings ────────────────────────────────────────────────────────────

describe('valid mappings (product ↔ platform)', () => {
  it.each(EXPECTED_PAIRS)('maps product %s → platform %s', (product, platform) => {
    expect(toPlatformProviderId(product)).toBe(platform);
    expect(tryToPlatformProviderId(product)).toBe(platform);
    expect(resolvePlatformProviderId(product)).toEqual({ ok: true, value: platform });
  });

  it.each(EXPECTED_PAIRS)('maps the platform counterpart of %s back to it', (product, platform) => {
    expect(toProductProviderId(platform)).toBe(product);
    expect(tryToProductProviderId(platform)).toBe(product);
    expect(resolveProductProviderId(platform)).toEqual({ ok: true, value: product });
  });

  it('resolves the TWO ids that differ — the whole reason PB-006 exists', () => {
    expect(toPlatformProviderId('chatgpt')).toBe('openai');
    expect(toPlatformProviderId('claude')).toBe('anthropic');
    expect(toProductProviderId('openai')).toBe('chatgpt');
    expect(toProductProviderId('anthropic')).toBe('claude');
  });

  it('leaves the THREE coinciding ids unchanged', () => {
    for (const id of ['gemini', 'perplexity', 'copilot'] as const) {
      expect(toPlatformProviderId(id)).toBe(id);
      expect(toProductProviderId(id)).toBe(id);
    }
  });

  it('covers exactly the two canonical vocabularies, with no third union', () => {
    expect([...PRODUCT_PROVIDER_IDS].sort()).toEqual([...CANONICAL_PRODUCT_IDS].sort());
    expect([...PLATFORM_PROVIDER_IDS].sort()).toEqual([...CANONICAL_PLATFORM_IDS].sort());
    // Agreement with the PRODUCT owner's own exported list.
    expect([...PRODUCT_PROVIDER_IDS].sort()).toEqual([...AI_PROVIDERS].sort());
  });

  it('is a bijection: five pairs, no duplicate targets on either side', () => {
    expect(PRODUCT_PROVIDER_IDS).toHaveLength(5);
    expect(PLATFORM_PROVIDER_IDS).toHaveLength(5);
    expect(new Set(Object.values(PRODUCT_TO_PLATFORM_PROVIDER)).size).toBe(5);
    expect(new Set(Object.values(PLATFORM_TO_PRODUCT_PROVIDER)).size).toBe(5);
  });

  it('exposes the pair list and a serializable snapshot', () => {
    const pairs = listProviderIdentityPairs();
    expect(pairs).toHaveLength(5);
    for (const [product, platform] of EXPECTED_PAIRS) {
      expect(pairs).toContainEqual({ product, platform });
    }
    const snapshot = serializeProviderIdentityMap();
    expect(snapshot.version).toBe(PROVIDER_IDENTITY_CONTRACT_VERSION);
    expect(snapshot.productToPlatform.chatgpt).toBe('openai');
    expect(snapshot.platformToProduct.anthropic).toBe('claude');
    expect(JSON.parse(JSON.stringify(snapshot))).toEqual({
      version: 1,
      productToPlatform: {
        chatgpt: 'openai',
        gemini: 'gemini',
        claude: 'anthropic',
        perplexity: 'perplexity',
        copilot: 'copilot',
      },
      platformToProduct: {
        openai: 'chatgpt',
        anthropic: 'claude',
        gemini: 'gemini',
        perplexity: 'perplexity',
        copilot: 'copilot',
      },
    });
  });
});

// ── Round trip (BOTH directions) ──────────────────────────────────────────────

describe('round-trip resolution', () => {
  it('product → platform → product is the identity for all five', () => {
    for (const product of PRODUCT_PROVIDER_IDS) {
      expect(toProductProviderId(toPlatformProviderId(product))).toBe(product);
    }
  });

  it('platform → product → platform is the identity for all five', () => {
    for (const platform of PLATFORM_PROVIDER_IDS) {
      expect(toPlatformProviderId(toProductProviderId(platform))).toBe(platform);
    }
  });

  it('round-trips through the non-throwing variants too', () => {
    for (const product of PRODUCT_PROVIDER_IDS) {
      expect(tryToProductProviderId(tryToPlatformProviderId(product))).toBe(product);
    }
    for (const platform of PLATFORM_PROVIDER_IDS) {
      expect(tryToPlatformProviderId(tryToProductProviderId(platform))).toBe(platform);
    }
  });

  it('round-trips ten times without drift (idempotent, stateless)', () => {
    for (const product of PRODUCT_PROVIDER_IDS) {
      let current: ProductProviderId = product;
      for (let i = 0; i < 10; i += 1) {
        current = toProductProviderId(toPlatformProviderId(current));
      }
      expect(current).toBe(product);
    }
  });

  it('the two maps are exact inverses of one another', () => {
    for (const [product, platform] of Object.entries(PRODUCT_TO_PLATFORM_PROVIDER)) {
      expect(PLATFORM_TO_PRODUCT_PROVIDER[platform as PlatformProviderId]).toBe(product);
    }
    for (const [platform, product] of Object.entries(PLATFORM_TO_PRODUCT_PROVIDER)) {
      expect(PRODUCT_TO_PLATFORM_PROVIDER[product as ProductProviderId]).toBe(platform);
    }
  });
});

// ── Invalid mappings: the OTHER vocabulary ────────────────────────────────────

describe('invalid mappings (cross-vocabulary)', () => {
  it('rejects platform ids passed as product ids', () => {
    for (const platformOnly of ['openai', 'anthropic'] as const) {
      expect(() => toPlatformProviderId(platformOnly as unknown as string)).toThrow(
        ProviderIdentityError,
      );
      expect(tryToPlatformProviderId(platformOnly)).toBeUndefined();
      expect(resolvePlatformProviderId(platformOnly)).toEqual({
        ok: false,
        reason: 'unknown_provider',
        direction: 'product_to_platform',
        received: platformOnly,
      });
      expect(isProductProviderId(platformOnly)).toBe(false);
    }
  });

  it('rejects product ids passed as platform ids', () => {
    for (const productOnly of ['chatgpt', 'claude'] as const) {
      expect(() => toProductProviderId(productOnly as unknown as string)).toThrow(
        ProviderIdentityError,
      );
      expect(tryToProductProviderId(productOnly)).toBeUndefined();
      expect(resolveProductProviderId(productOnly)).toEqual({
        ok: false,
        reason: 'unknown_provider',
        direction: 'platform_to_product',
        received: productOnly,
      });
      expect(isPlatformProviderId(productOnly)).toBe(false);
    }
  });

  it('never coerces a near-miss into its counterpart', () => {
    // 'openai' must NOT be silently treated as 'chatgpt' in the product direction.
    expect(tryToPlatformProviderId('openai')).toBeUndefined();
    expect(tryToProductProviderId('chatgpt')).toBeUndefined();
  });
});

// ── Unknown / malformed identifiers ───────────────────────────────────────────

/** Every input that MUST be rejected, with the reason it must be rejected for. */
const REJECTED: ReadonlyArray<readonly [string, unknown, identity.ProviderIdentityFailureReason]> = [
  ['empty string', '', 'empty'],
  ['whitespace only', '   ', 'unknown_provider'],
  ['leading whitespace', ' chatgpt', 'unknown_provider'],
  ['trailing whitespace', 'chatgpt ', 'unknown_provider'],
  ['tab-padded', '\tchatgpt\n', 'unknown_provider'],
  ['inner space', 'chat gpt', 'unknown_provider'],
  ['wrong case (Title)', 'ChatGPT', 'unknown_provider'],
  ['wrong case (upper)', 'OPENAI', 'unknown_provider'],
  ['wrong case (mixed)', 'Gemini', 'unknown_provider'],
  ['unknown provider', 'mistral', 'unknown_provider'],
  ['unknown provider 2', 'llama', 'unknown_provider'],
  ['near-miss typo', 'chatgtp', 'unknown_provider'],
  ['prefix', 'chat', 'unknown_provider'],
  ['suffix', 'chatgpt-4o', 'unknown_provider'],
  ['prototype key __proto__', '__proto__', 'unknown_provider'],
  ['prototype key constructor', 'constructor', 'unknown_provider'],
  ['prototype key toString', 'toString', 'unknown_provider'],
  ['prototype key valueOf', 'valueOf', 'unknown_provider'],
  ['prototype key hasOwnProperty', 'hasOwnProperty', 'unknown_provider'],
  ['prototype key prototype', 'prototype', 'unknown_provider'],
  ['null', null, 'not_a_string'],
  ['undefined', undefined, 'not_a_string'],
  ['number', 0, 'not_a_string'],
  ['boolean', true, 'not_a_string'],
  ['object', { id: 'chatgpt' }, 'not_a_string'],
  ['array', ['chatgpt'], 'not_a_string'],
  ['String object', new String('chatgpt'), 'not_a_string'],
  ['function', () => 'chatgpt', 'not_a_string'],
];

describe('unknown / invalid identifiers are rejected explicitly', () => {
  it.each(REJECTED)('strict product→platform throws for %s', (_label, value, reason) => {
    expect(() => toPlatformProviderId(value as string)).toThrow(ProviderIdentityError);
    try {
      toPlatformProviderId(value as string);
      throw new Error('expected ProviderIdentityError');
    } catch (err) {
      expect(err).toBeInstanceOf(ProviderIdentityError);
      const e = err as ProviderIdentityError;
      expect(e.reason).toBe(reason);
      expect(e.direction).toBe('product_to_platform');
      expect(e.received).toBe(value);
    }
  });

  it.each(REJECTED)('strict platform→product throws for %s', (_label, value, reason) => {
    try {
      toProductProviderId(value as string);
      throw new Error('expected ProviderIdentityError');
    } catch (err) {
      expect(err).toBeInstanceOf(ProviderIdentityError);
      const e = err as ProviderIdentityError;
      expect(e.reason).toBe(reason);
      expect(e.direction).toBe('platform_to_product');
    }
  });

  it.each(REJECTED)('non-throwing variants return undefined for %s', (_label, value) => {
    expect(tryToPlatformProviderId(value)).toBeUndefined();
    expect(tryToProductProviderId(value)).toBeUndefined();
  });

  it.each(REJECTED)('resolve* reports ok:false with the reason for %s', (_label, value, reason) => {
    const forward = resolvePlatformProviderId(value);
    expect(forward.ok).toBe(false);
    expect(forward).toMatchObject({ ok: false, reason, direction: 'product_to_platform' });
    const reverse = resolveProductProviderId(value);
    expect(reverse.ok).toBe(false);
    expect(reverse).toMatchObject({ ok: false, reason, direction: 'platform_to_product' });
  });

  it.each(REJECTED)('type guards answer false for %s', (_label, value) => {
    expect(isProductProviderId(value)).toBe(false);
    expect(isPlatformProviderId(value)).toBe(false);
  });

  it('performs NO normalization — no trim, no case-folding, no fuzzy matching', () => {
    // If any normalization existed, at least one of these would resolve.
    for (const variant of ['CHATGPT', 'chatgpt ', ' chatgpt', 'Chatgpt', 'chat_gpt', 'chat-gpt']) {
      expect(tryToPlatformProviderId(variant)).toBeUndefined();
    }
    for (const variant of ['OPENAI', 'OpenAI', 'open ai', 'open-ai', ' openai']) {
      expect(tryToProductProviderId(variant)).toBeUndefined();
    }
  });
});

// ── No silent fallback (the core guarantee) ───────────────────────────────────

describe('no silent fallback, ever', () => {
  const RESOLVERS = [
    ['toPlatformProviderId', toPlatformProviderId],
    ['toProductProviderId', toProductProviderId],
    ['tryToPlatformProviderId', tryToPlatformProviderId],
    ['tryToProductProviderId', tryToProductProviderId],
    ['resolvePlatformProviderId', resolvePlatformProviderId],
    ['resolveProductProviderId', resolveProductProviderId],
  ] as const;

  it('every resolver either throws or reports failure for every bad input', () => {
    for (const [, fn] of RESOLVERS) {
      for (const [, value] of REJECTED) {
        let threw = false;
        let out: unknown;
        try {
          out = (fn as unknown as (v: unknown) => unknown)(value);
        } catch (err) {
          threw = true;
          expect(err).toBeInstanceOf(ProviderIdentityError);
        }
        if (!threw) {
          const failed =
            out === undefined ||
            (typeof out === 'object' && out !== null && (out as { ok: boolean }).ok === false);
          expect(failed).toBe(true);
          // and never a canonical id smuggled through
          expect(typeof out === 'string').toBe(false);
        }
      }
    }
  });

  it('exports no lenient/defaulting resolver', () => {
    const forbidden = /(fallback|default|coerce|normalize|guess|fuzzy|lenient|orElse)/i;
    const offenders = Object.keys(identity).filter((k) => forbidden.test(k));
    expect(offenders).toEqual([]);
  });

  it('accepts neither vocabulary interchangeably (no "accept anything" mode)', () => {
    // A single function that accepted BOTH vocabularies would hide exactly the class
    // of defect PB-006 removes. Assert the two directions stay separate.
    expect(tryToPlatformProviderId('anthropic')).toBeUndefined();
    expect(tryToProductProviderId('claude')).toBeUndefined();
  });
});

// ── Typed error ───────────────────────────────────────────────────────────────

describe('ProviderIdentityError', () => {
  it('is a real Error subclass with a stable name and instanceof', () => {
    const err = (() => {
      try {
        toPlatformProviderId('nope');
        return null;
      } catch (e) {
        return e as ProviderIdentityError;
      }
    })();
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(ProviderIdentityError);
    expect(err?.name).toBe('ProviderIdentityError');
    expect(typeof err?.stack).toBe('string');
  });

  it('carries actionable, machine-readable context', () => {
    try {
      toProductProviderId('ChatGPT');
      throw new Error('unreachable');
    } catch (e) {
      const err = e as ProviderIdentityError;
      expect(err.reason).toBe('unknown_provider');
      expect(err.direction).toBe('platform_to_product');
      expect(err.received).toBe('ChatGPT');
      expect([...err.expected].sort()).toEqual([...CANONICAL_PLATFORM_IDS].sort());
      expect(Object.isFrozen(err.expected)).toBe(true);
      expect(err.message).toContain('ChatGPT');
      expect(err.message).toContain('no case-folding');
    }
  });

  it('describes non-string input without invoking it', () => {
    const hostile = {
      toString() {
        throw new Error('toString must not be called');
      },
    };
    expect(() => toPlatformProviderId(hostile as unknown as string)).toThrow(
      ProviderIdentityError,
    );
  });
});

// ── Immutability & prototype safety ───────────────────────────────────────────

describe('immutability and prototype safety', () => {
  it('freezes both maps', () => {
    expect(Object.isFrozen(PRODUCT_TO_PLATFORM_PROVIDER)).toBe(true);
    expect(Object.isFrozen(PLATFORM_TO_PRODUCT_PROVIDER)).toBe(true);
    expect(Object.isFrozen(PRODUCT_PROVIDER_IDS)).toBe(true);
    expect(Object.isFrozen(PLATFORM_PROVIDER_IDS)).toBe(true);
  });

  it('survives a mutation attempt with its answers unchanged', () => {
    try {
      (PRODUCT_TO_PLATFORM_PROVIDER as unknown as Record<string, string>).chatgpt = 'gemini';
    } catch {
      /* frozen in strict mode — either outcome is acceptable */
    }
    try {
      (PRODUCT_TO_PLATFORM_PROVIDER as unknown as Record<string, string>).mistral = 'openai';
    } catch {
      /* ignored */
    }
    expect(toPlatformProviderId('chatgpt')).toBe('openai');
    expect(tryToPlatformProviderId('mistral')).toBeUndefined();
  });

  it('uses a null prototype so inherited members cannot masquerade as ids', () => {
    expect(Object.getPrototypeOf(PRODUCT_TO_PLATFORM_PROVIDER)).toBeNull();
    expect(Object.getPrototypeOf(PLATFORM_TO_PRODUCT_PROVIDER)).toBeNull();
    const asAny = PRODUCT_TO_PLATFORM_PROVIDER as unknown as Record<string, unknown>;
    expect(asAny.toString).toBeUndefined();
    expect(asAny.constructor).toBeUndefined();
    expect(asAny.hasOwnProperty).toBeUndefined();
    expect(Object.keys(PRODUCT_TO_PLATFORM_PROVIDER)).toHaveLength(5);
  });

  it('returns detached snapshots that cannot corrupt the module', () => {
    const snapshot = serializeProviderIdentityMap();
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(snapshot.productToPlatform)).toBe(true);
    const pairs = listProviderIdentityPairs();
    expect(Object.isFrozen(pairs)).toBe(true);
    expect(pairs.every((p) => Object.isFrozen(p))).toBe(true);
    // a fresh array each call
    expect(listProviderIdentityPairs()).not.toBe(pairs);
    expect(listProviderIdentityPairs()).toEqual(pairs);
  });
});

// ── PB-004 boundary ───────────────────────────────────────────────────────────

describe('PB-004 boundary — strict gate in front of a graceful registry', () => {
  it('the capability registry still NEVER throws for unknown providers', () => {
    expect(() => supportsCapability('mistral', PROVIDER_CAPABILITIES.CITATIONS)).not.toThrow();
    expect(supportsCapability('mistral', PROVIDER_CAPABILITIES.CITATIONS)).toBe(false);
    expect(getProviderCapabilityProfile('mistral')).toBeUndefined();
    expect(listProviderCapabilities('mistral')).toEqual([]);
  });

  it('the registry still answers false for PRODUCT ids — which is exactly the defect', () => {
    // Unchanged legacy behaviour: a raw product id yields a silent `false`.
    expect(supportsCapability('chatgpt', PROVIDER_CAPABILITIES.TEXT_COMPLETION)).toBe(false);
    expect(supportsCapability('claude', PROVIDER_CAPABILITIES.TEXT_COMPLETION)).toBe(false);
  });

  it('translating first makes the SAME query correct', () => {
    expect(
      supportsCapability(toPlatformProviderId('chatgpt'), PROVIDER_CAPABILITIES.TEXT_COMPLETION),
    ).toBe(true);
    expect(
      supportsCapability(toPlatformProviderId('claude'), PROVIDER_CAPABILITIES.TEXT_COMPLETION),
    ).toBe(true);
    expect(
      supportsCapability(toPlatformProviderId('perplexity'), PROVIDER_CAPABILITIES.CITATIONS),
    ).toBe(true);
  });

  it('a validated id always has a registry profile', () => {
    for (const product of PRODUCT_PROVIDER_IDS) {
      expect(getProviderCapabilityProfile(toPlatformProviderId(product))).toBeDefined();
    }
  });
});

// ── Purity / backward compatibility ───────────────────────────────────────────

describe('purity and backward compatibility', () => {
  it('is stateless — repeated calls give identical answers', () => {
    for (let i = 0; i < 3; i += 1) {
      expect(toPlatformProviderId('chatgpt')).toBe('openai');
      expect(tryToPlatformProviderId('ChatGPT')).toBeUndefined();
      expect(serializeProviderIdentityMap()).toEqual(serializeProviderIdentityMap());
    }
  });

  it('re-importing the module yields the very same frozen objects (no re-registration)', () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires, global-require
    const again = require('../../services/aiGatewayProviderIdentity');
    expect(again.PRODUCT_TO_PLATFORM_PROVIDER).toBe(PRODUCT_TO_PLATFORM_PROVIDER);
    expect(again.PLATFORM_TO_PRODUCT_PROVIDER).toBe(PLATFORM_TO_PRODUCT_PROVIDER);
  });

  it('exports only data + pure functions (no mutators, no registry)', () => {
    const mutators = Object.keys(identity).filter((k) =>
      /^(register|define|set|reset|clear|configure|install)/i.test(k),
    );
    expect(mutators).toEqual([]);
  });

  it('declares a stable contract version', () => {
    expect(PROVIDER_IDENTITY_CONTRACT_VERSION).toBe(1);
  });
});
