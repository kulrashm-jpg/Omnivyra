/**
 * CANONICAL PROVIDER IDENTITY (PB-006 · Program B · Platform · Zone P).
 *
 * WHY. The repository speaks TWO provider vocabularies and they are not the same:
 *
 *   PRODUCT  (`AIProviderId`,      backend/services/intelligence/providerInterfaces.ts)
 *            'chatgpt' | 'gemini' | 'claude' | 'perplexity' | 'copilot'
 *   PLATFORM (`GatewayProviderId`, backend/services/aiGatewayDispatcher.ts)
 *            'openai'  | 'anthropic' | 'gemini' | 'perplexity' | 'copilot'
 *
 * Three of five ids coincide ('gemini', 'perplexity', 'copilot'); two do NOT
 * ('chatgpt' ≠ 'openai', 'claude' ≠ 'anthropic'). That partial overlap is the whole
 * hazard: code written and tested against a coinciding provider looks correct, and
 * then FAILS SILENTLY on the two that differ. PB-005 surfaced exactly this class of
 * defect — a naive `supportsCapability(this.id, …)` from a Product adapter answers
 * `false` for two of five providers, disabling features with no error, no log and no
 * exception. A wrong answer that never raises is the worst possible failure mode.
 *
 * PB-006 makes that mistake IMPOSSIBLE TO MAKE SILENTLY:
 *
 *   toPlatformProviderId('chatgpt')       // → 'openai'   (typed 'openai' statically)
 *   toPlatformProviderId('ChatGPT')       // → THROWS ProviderIdentityError
 *   tryToPlatformProviderId('ChatGPT')    // → undefined  (explicit opt-in, no throw)
 *   resolvePlatformProviderId('ChatGPT')  // → { ok: false, reason: 'unknown_provider' }
 *
 * There is deliberately NO third variant that returns a plausible-but-wrong id, and
 * no "default provider" fallback. Every path either yields a VALIDATED id, throws, or
 * says `undefined` / `ok: false` at a call site that explicitly asked for that.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE PB-004 BOUNDARY — strict gate in FRONT of a graceful registry.
 *
 * `aiGatewayCapabilities.ts` (PB-004) is MANDATED never to throw: unknown providers
 * and unknown capabilities degrade to `undefined` / `false` / `[]`. That mandate is
 * correct and is NOT changed by this module — PB-006 edits nothing in the registry.
 *
 * The two are complementary layers, not competing policies:
 *
 *   untrusted id ──▶ [ PB-006 identity layer: STRICT — rejects loudly ]
 *                              │ validated GatewayProviderId
 *                              ▼
 *                    [ PB-004 capability registry: GRACEFUL — never throws ]
 *
 * Validation belongs at the boundary where an identifier ENTERS the Platform; the
 * registry is a pure lookup over already-validated ids and stays total/non-throwing
 * so that a newer consumer querying an older Platform degrades instead of crashing.
 * Callers that must not throw use `tryTo…` / `resolve…` and handle the failure
 * explicitly — they never get a silent substitution.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * SCOPE / NON-SCOPE.
 *   - DATA + PURE FUNCTIONS ONLY. No routing, no selection, no gating, no network,
 *     no I/O, no config, no env, no flags, no schema. Loading this module cannot
 *     change what any provider does.
 *   - NOTHING consumes it. Product adoption is a separate, independently-gated
 *     package.
 *   - NO THIRD UNION. Both id sets are imported TYPE-ONLY from their existing owners
 *     and re-aliased for readability (`ProductProviderId` / `PlatformProviderId` are
 *     the SAME types, not new vocabularies). Type-only imports are erased at compile
 *     time, so the Platform carries ZERO runtime dependency on Product code — nothing
 *     from `intelligence/**` is loaded by importing this file.
 *
 * COMPILE-TIME TOTALITY. Both maps are declared `as const satisfies Record<…>` over
 * the canonical unions, so adding a provider to EITHER union without mapping it is a
 * COMPILE ERROR, never a silent gap — the same technique PB-004 used with
 * `Record<GatewayProviderId, …>`. Exported type-level proofs additionally assert key
 * exactness, value surjectivity and ROUND-TRIP identity in both directions, so a
 * mis-typed mapping cannot compile either.
 */
// Type-only imports: erased at compile time — no runtime coupling in either
// direction (the Platform does not load Product code, and this module does not pull
// in the dispatcher, the transports, the OpenAI SDK, supabase or config).
import type { AIProviderId } from './intelligence/providerInterfaces';
import type { GatewayProviderId } from './aiGatewayDispatcher';

// ── Contract version ──────────────────────────────────────────────────────────

/**
 * Version of the identity-mapping MECHANISM (not of any provider). Bumped only by a
 * breaking change to the shape/semantics of this contract; adding a provider is
 * additive and does NOT bump it.
 */
export const PROVIDER_IDENTITY_CONTRACT_VERSION = 1 as const;

// ── Vocabulary aliases (NOT new unions) ───────────────────────────────────────

/** The PRODUCT vocabulary. Alias of `AIProviderId` — same type, clearer name here. */
export type ProductProviderId = AIProviderId;

/** The PLATFORM vocabulary. Alias of `GatewayProviderId` — same type, clearer name. */
export type PlatformProviderId = GatewayProviderId;

// ── Canonical mapping (frozen, data-only) ─────────────────────────────────────

/**
 * PRODUCT → PLATFORM. `satisfies Record<ProductProviderId, PlatformProviderId>`
 * makes a missing product id, an extra key, or a value outside the platform union a
 * COMPILE ERROR, while `as const` preserves the literal types the proofs below and
 * the statically-precise overloads depend on.
 */
const PRODUCT_TO_PLATFORM_LITERAL = {
  chatgpt: 'openai',
  gemini: 'gemini',
  claude: 'anthropic',
  perplexity: 'perplexity',
  copilot: 'copilot',
} as const satisfies Record<ProductProviderId, PlatformProviderId>;

/**
 * PLATFORM → PRODUCT. The exact inverse; totality enforced against the PLATFORM
 * union, so a provider added to the dispatcher without a product identity is a
 * COMPILE ERROR here.
 */
const PLATFORM_TO_PRODUCT_LITERAL = {
  openai: 'chatgpt',
  anthropic: 'claude',
  gemini: 'gemini',
  perplexity: 'perplexity',
  copilot: 'copilot',
} as const satisfies Record<PlatformProviderId, ProductProviderId>;

// ── Compile-time proofs (bijection + round-trip) ──────────────────────────────
//
// These aliases produce no runtime code. They are exported only so they can never
// be pruned as "unused" — each one is a standing assertion that fails the build the
// moment the mapping stops being a total bijection.

/** `true` iff A and B are the exact same type (invariant comparison). */
type Equals<A, B> = (<G>() => G extends A ? 1 : 2) extends <G>() => G extends B ? 1 : 2
  ? true
  : false;

/** Compiles only when `T` is `true`. */
type AssertTrue<T extends true> = T;

/** The forward map's keys are EXACTLY the product union (no missing, no extra). */
export type _ProviderIdentityForwardKeysExact = AssertTrue<
  Equals<keyof typeof PRODUCT_TO_PLATFORM_LITERAL, ProductProviderId>
>;

/** The forward map's values COVER the whole platform union (surjective ⇒ bijective). */
export type _ProviderIdentityForwardValuesExact = AssertTrue<
  Equals<(typeof PRODUCT_TO_PLATFORM_LITERAL)[ProductProviderId], PlatformProviderId>
>;

/** The reverse map's keys are EXACTLY the platform union. */
export type _ProviderIdentityReverseKeysExact = AssertTrue<
  Equals<keyof typeof PLATFORM_TO_PRODUCT_LITERAL, PlatformProviderId>
>;

/** The reverse map's values COVER the whole product union. */
export type _ProviderIdentityReverseValuesExact = AssertTrue<
  Equals<(typeof PLATFORM_TO_PRODUCT_LITERAL)[PlatformProviderId], ProductProviderId>
>;

/** product → platform → product is the identity for EVERY product id. */
export type _ProviderIdentityProductRoundTrip = AssertTrue<
  Equals<
    {
      [K in ProductProviderId]: (typeof PLATFORM_TO_PRODUCT_LITERAL)[(typeof PRODUCT_TO_PLATFORM_LITERAL)[K]];
    },
    { [K in ProductProviderId]: K }
  >
>;

/** platform → product → platform is the identity for EVERY platform id. */
export type _ProviderIdentityPlatformRoundTrip = AssertTrue<
  Equals<
    {
      [K in PlatformProviderId]: (typeof PRODUCT_TO_PLATFORM_LITERAL)[(typeof PLATFORM_TO_PRODUCT_LITERAL)[K]];
    },
    { [K in PlatformProviderId]: K }
  >
>;

// ── Immutable, prototype-safe map construction ────────────────────────────────

/**
 * Frozen copy on a NULL PROTOTYPE. Two guarantees:
 *   1. the map cannot be mutated (frozen), and
 *   2. `map['toString']` / `map['constructor']` / `map['__proto__']` are `undefined`
 *      rather than inherited members, so a prototype key can never masquerade as a
 *      declared provider even for a caller that indexes the map directly.
 */
function frozenNullProtoMap<T extends object>(literal: T): Readonly<T> {
  return Object.freeze(Object.assign(Object.create(null) as T, literal));
}

/** THE canonical PRODUCT → PLATFORM map. Frozen, null-prototype, data-only. */
export const PRODUCT_TO_PLATFORM_PROVIDER: Readonly<typeof PRODUCT_TO_PLATFORM_LITERAL> =
  frozenNullProtoMap(PRODUCT_TO_PLATFORM_LITERAL);

/** THE canonical PLATFORM → PRODUCT map. Frozen, null-prototype, data-only. */
export const PLATFORM_TO_PRODUCT_PROVIDER: Readonly<typeof PLATFORM_TO_PRODUCT_LITERAL> =
  frozenNullProtoMap(PLATFORM_TO_PRODUCT_LITERAL);

/**
 * Every PRODUCT provider id, frozen. Derived from the map (single source of truth) —
 * this is NOT a new union, and it is deliberately not imported from
 * `providerInterfaces.AI_PROVIDERS`, which would create a runtime Platform→Product
 * dependency.
 */
export const PRODUCT_PROVIDER_IDS: readonly ProductProviderId[] = Object.freeze(
  Object.keys(PRODUCT_TO_PLATFORM_LITERAL) as ProductProviderId[],
);

/**
 * Every PLATFORM provider id, frozen. Derived from the map — deliberately not
 * imported from `aiGatewayDispatcher.GATEWAY_PROVIDER_IDS`, which would pull the
 * dispatcher (and with it the transports and the OpenAI SDK) into this module's
 * runtime graph. The type-only import already forces the two to agree at compile
 * time, and `_ProviderIdentityReverseKeysExact` proves it.
 */
export const PLATFORM_PROVIDER_IDS: readonly PlatformProviderId[] = Object.freeze(
  Object.keys(PLATFORM_TO_PRODUCT_LITERAL) as PlatformProviderId[],
);

/** The platform id for a STATICALLY-KNOWN product id (`'chatgpt'` → `'openai'`). */
export type PlatformProviderIdFor<P extends ProductProviderId> =
  (typeof PRODUCT_TO_PLATFORM_LITERAL)[P];

/** The product id for a STATICALLY-KNOWN platform id (`'anthropic'` → `'claude'`). */
export type ProductProviderIdFor<P extends PlatformProviderId> =
  (typeof PLATFORM_TO_PRODUCT_LITERAL)[P];

// ── Failure vocabulary ────────────────────────────────────────────────────────

/** Which direction a resolution was attempted in. */
export type ProviderIdentityDirection = 'product_to_platform' | 'platform_to_product';

/**
 * Why a resolution failed.
 *   - `not_a_string`     — the input was not a string at all (null/undefined/object/number).
 *   - `empty`            — the empty string.
 *   - `unknown_provider` — a non-empty string that is not an EXACT canonical id.
 *                          Wrong case (`'ChatGPT'`), surrounding/embedded whitespace
 *                          (`' chatgpt'`), an id from the OTHER vocabulary, and
 *                          prototype keys (`'__proto__'`, `'constructor'`,
 *                          `'toString'`) all land here.
 */
export type ProviderIdentityFailureReason = 'not_a_string' | 'empty' | 'unknown_provider';

/**
 * Explicit, non-throwing resolution outcome. Discriminated on `ok`; the failure arm
 * also carries `reason`, so `'reason' in result` narrows even in contexts where a
 * generic `.ok` check does not.
 */
export type ProviderIdentityResolution<T extends string> =
  | { readonly ok: true; readonly value: T }
  | {
      readonly ok: false;
      readonly reason: ProviderIdentityFailureReason;
      readonly direction: ProviderIdentityDirection;
      readonly received: unknown;
    };

/** Render an arbitrary input for an error message without invoking user code. */
function describeReceived(value: unknown): string {
  if (typeof value === 'string') return JSON.stringify(value);
  if (value === null) return 'null';
  if (value === undefined) return 'undefined';
  if (typeof value === 'object' || typeof value === 'function') {
    return Object.prototype.toString.call(value);
  }
  return `${typeof value}(${String(value)})`;
}

function failureMessage(
  reason: ProviderIdentityFailureReason,
  direction: ProviderIdentityDirection,
  received: unknown,
  expected: readonly string[],
): string {
  const what =
    direction === 'product_to_platform' ? 'product provider id' : 'platform provider id';
  const detail =
    reason === 'not_a_string'
      ? 'expected a string'
      : reason === 'empty'
        ? 'the empty string is never a provider id'
        : 'exact match required — no case-folding, no trimming, no fuzzy matching';
  return `[ai-gateway] invalid ${what} ${describeReceived(received)} (${reason}: ${detail}); expected one of ${expected.join(' | ')}`;
}

/**
 * The typed error thrown by the STRICT resolvers. Carries the direction, the reason,
 * the raw input and the accepted vocabulary, so a caller (or a log line) can act on
 * the failure without re-parsing the message.
 */
export class ProviderIdentityError extends Error {
  readonly reason: ProviderIdentityFailureReason;
  readonly direction: ProviderIdentityDirection;
  readonly received: unknown;
  readonly expected: readonly string[];

  constructor(
    reason: ProviderIdentityFailureReason,
    direction: ProviderIdentityDirection,
    received: unknown,
    expected: readonly string[],
  ) {
    super(failureMessage(reason, direction, received, expected));
    this.name = 'ProviderIdentityError';
    this.reason = reason;
    this.direction = direction;
    this.received = received;
    this.expected = Object.freeze([...expected]);
    // Preserve `instanceof` across down-level/transpiled targets.
    Object.setPrototypeOf(this, ProviderIdentityError.prototype);
  }
}

// ── Core lookup (EXACT match only) ────────────────────────────────────────────
//
// No normalization of ANY kind: no `.trim()`, no `.toLowerCase()`, no alias table,
// no nearest-match. An id that is not byte-identical to a canonical id is unknown.
// Own-property reads on null-prototype maps mean prototype keys are structurally
// incapable of resolving.

function lookupExact(
  map: Readonly<Record<string, string>>,
  key: string,
): string | undefined {
  return Object.prototype.hasOwnProperty.call(map, key) ? map[key] : undefined;
}

function classify(
  map: Readonly<Record<string, string>>,
  value: unknown,
): { readonly reason: ProviderIdentityFailureReason } | { readonly resolved: string } {
  if (typeof value !== 'string') return { reason: 'not_a_string' };
  if (value === '') return { reason: 'empty' };
  const resolved = lookupExact(map, value);
  if (typeof resolved !== 'string') return { reason: 'unknown_provider' };
  return { resolved };
}

function resolve<T extends string>(
  map: Readonly<Record<string, string>>,
  value: unknown,
  direction: ProviderIdentityDirection,
): ProviderIdentityResolution<T> {
  const outcome = classify(map, value);
  if ('resolved' in outcome) return { ok: true, value: outcome.resolved as T };
  return { ok: false, reason: outcome.reason, direction, received: value };
}

function resolveOrThrow<T extends string>(
  map: Readonly<Record<string, string>>,
  value: unknown,
  direction: ProviderIdentityDirection,
  expected: readonly string[],
): T {
  const outcome = classify(map, value);
  if ('resolved' in outcome) return outcome.resolved as T;
  throw new ProviderIdentityError(outcome.reason, direction, value, expected);
}

// ── Type guards ───────────────────────────────────────────────────────────────

/** True ONLY for an exact canonical PRODUCT id. Never throws. */
export function isProductProviderId(value: unknown): value is ProductProviderId {
  return typeof value === 'string' && lookupExact(PRODUCT_TO_PLATFORM_PROVIDER, value) !== undefined;
}

/** True ONLY for an exact canonical PLATFORM id. Never throws. */
export function isPlatformProviderId(value: unknown): value is PlatformProviderId {
  return typeof value === 'string' && lookupExact(PLATFORM_TO_PRODUCT_PROVIDER, value) !== undefined;
}

// ── STRICT resolvers (throw · the "no silent fallback" guarantee) ─────────────
//
// USE THESE BY DEFAULT. An unmappable provider id is a programming/config error, and
// the only safe response is to fail loudly: a silent substitution or a default would
// reintroduce exactly the class of defect PB-006 exists to eliminate.

/**
 * PRODUCT id → PLATFORM id. Throws {@link ProviderIdentityError} for anything that is
 * not an exact canonical product id.
 *
 * The first overload gives a statically-known argument a statically-known result
 * (`toPlatformProviderId('chatgpt')` is typed `'openai'`), so a mismatch can also be
 * caught at compile time.
 */
export function toPlatformProviderId<P extends ProductProviderId>(
  productProviderId: P,
): PlatformProviderIdFor<P>;
export function toPlatformProviderId(productProviderId: unknown): PlatformProviderId;
export function toPlatformProviderId(productProviderId: unknown): PlatformProviderId {
  return resolveOrThrow<PlatformProviderId>(
    PRODUCT_TO_PLATFORM_PROVIDER,
    productProviderId,
    'product_to_platform',
    PRODUCT_PROVIDER_IDS,
  );
}

/**
 * PLATFORM id → PRODUCT id. Throws {@link ProviderIdentityError} for anything that is
 * not an exact canonical platform id.
 */
export function toProductProviderId<P extends PlatformProviderId>(
  platformProviderId: P,
): ProductProviderIdFor<P>;
export function toProductProviderId(platformProviderId: unknown): ProductProviderId;
export function toProductProviderId(platformProviderId: unknown): ProductProviderId {
  return resolveOrThrow<ProductProviderId>(
    PLATFORM_TO_PRODUCT_PROVIDER,
    platformProviderId,
    'platform_to_product',
    PLATFORM_PROVIDER_IDS,
  );
}

// ── EXPLICIT non-throwing variants ───────────────────────────────────────────
//
// For callers that genuinely must not throw (batch loops, telemetry, tolerant
// deserialization of stored ids). They return `undefined` / `ok: false` — NEVER a
// substituted or defaulted id. Choosing one of these is an explicit, visible
// decision at the call site to handle the failure yourself.

/** PRODUCT → PLATFORM, or `undefined` when unmappable. Never throws. */
export function tryToPlatformProviderId(value: unknown): PlatformProviderId | undefined {
  const outcome = classify(PRODUCT_TO_PLATFORM_PROVIDER, value);
  return 'resolved' in outcome ? (outcome.resolved as PlatformProviderId) : undefined;
}

/** PLATFORM → PRODUCT, or `undefined` when unmappable. Never throws. */
export function tryToProductProviderId(value: unknown): ProductProviderId | undefined {
  const outcome = classify(PLATFORM_TO_PRODUCT_PROVIDER, value);
  return 'resolved' in outcome ? (outcome.resolved as ProductProviderId) : undefined;
}

/**
 * PRODUCT → PLATFORM as a discriminated result carrying WHY it failed. Never throws.
 * Use when the caller must report or branch on the failure reason.
 */
export function resolvePlatformProviderId(
  value: unknown,
): ProviderIdentityResolution<PlatformProviderId> {
  return resolve<PlatformProviderId>(
    PRODUCT_TO_PLATFORM_PROVIDER,
    value,
    'product_to_platform',
  );
}

/** PLATFORM → PRODUCT as a discriminated result carrying WHY it failed. Never throws. */
export function resolveProductProviderId(
  value: unknown,
): ProviderIdentityResolution<ProductProviderId> {
  return resolve<ProductProviderId>(
    PLATFORM_TO_PRODUCT_PROVIDER,
    value,
    'platform_to_product',
  );
}

// ── Diagnostics (read-only) ───────────────────────────────────────────────────

/** One canonical identity pair. */
export type ProviderIdentityPair = {
  readonly product: ProductProviderId;
  readonly platform: PlatformProviderId;
};

/** Every canonical pair, frozen. Ordered by the product map's declaration order. */
export function listProviderIdentityPairs(): readonly ProviderIdentityPair[] {
  return Object.freeze(
    PRODUCT_PROVIDER_IDS.map((product) =>
      Object.freeze({
        product,
        platform: PRODUCT_TO_PLATFORM_PROVIDER[product] as PlatformProviderId,
      }),
    ),
  );
}

/**
 * A plain, JSON-serializable snapshot of the mapping, for logs and diagnostics.
 * Frozen and detached from the module's internals.
 */
export function serializeProviderIdentityMap(): Readonly<{
  version: typeof PROVIDER_IDENTITY_CONTRACT_VERSION;
  productToPlatform: Readonly<Record<string, string>>;
  platformToProduct: Readonly<Record<string, string>>;
}> {
  const productToPlatform: Record<string, string> = {};
  for (const product of PRODUCT_PROVIDER_IDS) {
    productToPlatform[product] = PRODUCT_TO_PLATFORM_PROVIDER[product];
  }
  const platformToProduct: Record<string, string> = {};
  for (const platform of PLATFORM_PROVIDER_IDS) {
    platformToProduct[platform] = PLATFORM_TO_PRODUCT_PROVIDER[platform];
  }
  return Object.freeze({
    version: PROVIDER_IDENTITY_CONTRACT_VERSION,
    productToPlatform: Object.freeze(productToPlatform),
    platformToProduct: Object.freeze(platformToProduct),
  });
}
