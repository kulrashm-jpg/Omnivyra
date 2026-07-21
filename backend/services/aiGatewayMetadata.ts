/**
 * PROVIDER METADATA CONSUMER FRAMEWORK (PB-003R · Program B · Platform · Zone P).
 *
 * PB-001 guaranteed that provider-native extras SURVIVE normalization
 * (`NormalizedCompletion.providerMetadata`). PB-002 — the first and only consumer
 * — proved the container works, and paid for it with five lines of provider-agnostic
 * boilerplate that EVERY future adopter would otherwise re-implement:
 *
 *     const envelope = getProviderMetadata(completion, 'perplexity');
 *     if (!envelope || envelope.version !== PERPLEXITY_METADATA_VERSION) return [];
 *     const data = envelope.data as Partial<PerplexityCompletionMetadataV1>;   // hand-cast
 *     const citations = data?.citations;                                       // hand-validate
 *     return Array.isArray(citations) ? citations.filter(isString) : [];       // hand-filter
 *
 * This module absorbs that friction into the Platform:
 *
 *   1. TYPED RETRIEVAL   — `readProviderMetadata(completion, DESCRIPTOR)` returns
 *                          `D | undefined`, fully typed. No casts at the call site.
 *   2. CENTRAL VALIDATION— null-check, version-check, shape-validation, filtering and
 *                          defensive parsing live in ONE registered decoder per
 *                          (provider, kind, version), shared by the WRITE side
 *                          (transports) and the READ side (consumers).
 *   3. REGISTRY          — `(provider, kind, version) → { validate, decode }`.
 *   4. EVOLUTION         — lookup by (provider), (provider+kind) and
 *                          (provider+kind+version). Grounding · Reasoning · Safety ·
 *                          Provenance · Diagnostics coexist independently for the
 *                          same provider and version independently.
 *
 * ADDITIVE BY CONSTRUCTION. The PB-001 map stays provider-keyed: the DEFAULT kind
 * occupies the bare provider slot (so `getProviderMetadata(c, 'perplexity')` is
 * byte-identical), and every additional kind occupies `"<provider>::<kind>"`. No
 * PB-001 symbol changed shape or signature; no existing producer or consumer needs
 * an edit to keep working.
 *
 * PURE. No I/O, no flags, no schema, no provider behavior change.
 */
import {
  DEFAULT_PROVIDER_METADATA_KIND,
  PERPLEXITY_METADATA_VERSION,
  attachProviderMetadata,
  deepFreezeProviderMetadata,
  freezeProviderMetadata,
  providerMetadataSlotKey,
  type NormalizedCompletion,
  type PerplexityCompletionMetadataV1,
  type ProviderMetadataEnvelope,
} from './aiGatewayCore';

// ── Contract ──────────────────────────────────────────────────────────────────

/** Version of the CONSUMER FRAMEWORK mechanism (distinct from any payload version). */
export const PROVIDER_METADATA_FRAMEWORK_VERSION = 1 as const;

/**
 * Canonical metadata KINDS. A kind names an INDEPENDENT payload a provider can
 * emit; several kinds coexist for the same provider and version independently.
 * Open by design — a new kind is just a new string plus a descriptor.
 */
export const PROVIDER_METADATA_KINDS = {
  /** Source URLs the provider grounded the answer in (Perplexity `citations[]`). */
  CITATIONS: 'citations',
  /** Retrieval / grounding evidence chunks (Gemini grounding, search attributions). */
  GROUNDING: 'grounding',
  /** Reasoning traces or reasoning-token summaries. */
  REASONING: 'reasoning',
  /** Safety / moderation annotations returned by the provider. */
  SAFETY: 'safety',
  /** Search or content provenance (where the material came from). */
  PROVENANCE: 'provenance',
  /** Provider-side diagnostics (routing, cache hits, latency breakdowns). */
  DIAGNOSTICS: 'diagnostics',
} as const;

export type ProviderMetadataKind =
  (typeof PROVIDER_METADATA_KINDS)[keyof typeof PROVIDER_METADATA_KINDS] | string;

/** A lookup coordinate: (provider) · (provider+kind) · (provider+kind+version). */
export type ProviderMetadataRef = {
  readonly provider: string;
  /** Omitted → the provider's DEFAULT slot / its legacy-default descriptor. */
  readonly kind?: ProviderMetadataKind;
  /** Omitted → any version (descriptor resolution picks the highest registered). */
  readonly version?: number;
};

/**
 * A registered (provider, kind, version) payload contract. `validate` answers "is
 * this payload valid?"; `decode` additionally NORMALIZES it (filtering, coercion,
 * defaulting) into the typed payload — or `undefined` when the payload cannot be
 * trusted. Both sides of the wire use the SAME decoder, which is what removes the
 * PB-002 read/write duplication.
 */
export type ProviderMetadataDescriptor<D> = {
  readonly provider: string;
  readonly kind: ProviderMetadataKind;
  readonly version: number;
  /**
   * When true this kind occupies the provider's DEFAULT slot and its envelopes
   * omit the `kind` key — the shape PB-001/PB-002 already ship. This is the bridge
   * that lets a legacy single-kind producer become kind-aware with NO wire change.
   */
  readonly legacyDefault: boolean;
  readonly validate: (data: unknown) => boolean;
  readonly decode: (data: unknown) => D | undefined;
};

/** Input to {@link defineProviderMetadataKind}. At least one of validate/decode. */
export type ProviderMetadataKindSpec<D> = {
  readonly provider: string;
  readonly kind: ProviderMetadataKind;
  readonly version: number;
  readonly legacyDefault?: boolean;
  readonly validate?: (data: unknown) => boolean;
  readonly decode?: (data: unknown) => D | undefined;
};

// ── Registry ──────────────────────────────────────────────────────────────────

const registryKey = (provider: string, kind: string, version: number): string =>
  `${provider}${'::'}${kind}${'::'}${version}`;

const REGISTRY = new Map<string, ProviderMetadataDescriptor<unknown>>();

/**
 * Register a descriptor under (provider, kind, version). Idempotent per key —
 * re-registering the same coordinate replaces the entry, so a package can own its
 * own kind without coordinating module load order.
 */
export function registerProviderMetadataKind<D>(
  descriptor: ProviderMetadataDescriptor<D>,
): ProviderMetadataDescriptor<D> {
  REGISTRY.set(
    registryKey(descriptor.provider, descriptor.kind, descriptor.version),
    descriptor as ProviderMetadataDescriptor<unknown>,
  );
  return descriptor;
}

/**
 * Build + register a (provider, kind, version) descriptor. Supplying only
 * `decode` derives `validate`; supplying only `validate` derives an identity
 * `decode`. Returns the frozen descriptor — hold it and pass it to
 * {@link readProviderMetadata} for fully typed, zero-cast retrieval.
 */
export function defineProviderMetadataKind<D>(
  spec: ProviderMetadataKindSpec<D>,
): ProviderMetadataDescriptor<D> {
  if (!spec.validate && !spec.decode) {
    throw new Error(
      `[ai-gateway] provider metadata kind ${spec.provider}/${spec.kind} v${spec.version} needs a validate or a decode`,
    );
  }
  const decode: (data: unknown) => D | undefined =
    spec.decode ?? ((data: unknown) => (spec.validate?.(data) ? (data as D) : undefined));
  const validate: (data: unknown) => boolean =
    spec.validate ?? ((data: unknown) => decode(data) !== undefined);
  const descriptor: ProviderMetadataDescriptor<D> = Object.freeze({
    provider: spec.provider,
    kind: spec.kind,
    version: spec.version,
    legacyDefault: spec.legacyDefault === true,
    validate: (data: unknown) => {
      try {
        return validate(data) === true;
      } catch {
        return false;
      }
    },
    decode: (data: unknown) => {
      try {
        return decode(data);
      } catch {
        return undefined;
      }
    },
  });
  return registerProviderMetadataKind(descriptor);
}

/** Every registered descriptor, optionally narrowed to one provider. */
export function listProviderMetadataDescriptors(
  provider?: string,
): ReadonlyArray<ProviderMetadataDescriptor<unknown>> {
  const all = [...REGISTRY.values()];
  return provider === undefined ? all : all.filter((d) => d.provider === provider);
}

/**
 * Resolve a descriptor from a lookup coordinate.
 *
 *   (provider, kind, version) → the exact registration.
 *   (provider, kind)          → the HIGHEST registered version of that kind.
 *   (provider)                → the provider's legacy-default descriptor; failing
 *                               that, its only descriptor. Ambiguity (several kinds,
 *                               none legacy-default) resolves to `undefined` rather
 *                               than guessing.
 */
export function resolveProviderMetadataDescriptor(
  ref: ProviderMetadataRef,
): ProviderMetadataDescriptor<unknown> | undefined {
  const candidates = listProviderMetadataDescriptors(ref.provider);
  if (candidates.length === 0) return undefined;

  if (ref.kind === undefined) {
    const legacy = candidates.filter((d) => d.legacyDefault);
    if (legacy.length > 0) return highestVersion(legacy);
    return candidates.length === 1 ? candidates[0] : undefined;
  }

  const ofKind = candidates.filter((d) => d.kind === ref.kind);
  if (ofKind.length === 0) return undefined;
  if (ref.version === undefined) return highestVersion(ofKind);
  return ofKind.find((d) => d.version === ref.version);
}

function highestVersion(
  descriptors: ReadonlyArray<ProviderMetadataDescriptor<unknown>>,
): ProviderMetadataDescriptor<unknown> {
  return descriptors.reduce((best, d) => (d.version > best.version ? d : best));
}

/** Clear the registry and restore the Platform's built-in descriptors. Test support. */
export function resetProviderMetadataRegistry(): void {
  REGISTRY.clear();
  registerBuiltInProviderMetadataKinds();
}

// ── Envelope resolution (provider · provider+kind · provider+kind+version) ─────

/**
 * Resolve the envelope a lookup coordinate points at, or `undefined`.
 *
 * Resolution order for a kinded lookup:
 *   1. the dedicated `"<provider>::<kind>"` slot;
 *   2. failing that, the provider's DEFAULT slot when that envelope either declares
 *      the same `kind`, or is kind-less AND the registry marks this kind as the
 *      provider's legacy default (this is how a PB-001-era envelope answers a
 *      modern kinded read without any wire change).
 *
 * PROVIDER ISOLATION is enforced twice: the slot key is prefixed by the provider
 * id, AND the envelope's own `provider` field must match the request.
 */
export function getProviderMetadataEnvelope(
  completion: NormalizedCompletion,
  ref: ProviderMetadataRef,
): ProviderMetadataEnvelope | undefined {
  const map = completion?.providerMetadata;
  if (!map) return undefined;

  const kind = ref.kind === DEFAULT_PROVIDER_METADATA_KIND ? undefined : ref.kind;
  let envelope: ProviderMetadataEnvelope | undefined;

  if (kind === undefined) {
    envelope = map[ref.provider];
  } else {
    envelope = map[providerMetadataSlotKey(ref.provider, kind)];
    if (!envelope) {
      const fallback = map[ref.provider];
      if (fallback && (fallback.kind === kind || (fallback.kind === undefined && isLegacyDefaultKind(ref.provider, kind)))) {
        envelope = fallback;
      }
    }
  }

  if (!envelope || typeof envelope !== 'object') return undefined;
  // Isolation guard: a mis-keyed slot never surfaces another provider's payload.
  if (envelope.provider !== ref.provider) return undefined;
  if (ref.version !== undefined && envelope.version !== ref.version) return undefined;
  return envelope;
}

function isLegacyDefaultKind(provider: string, kind: string): boolean {
  return listProviderMetadataDescriptors(provider).some((d) => d.legacyDefault && d.kind === kind);
}

/** True when the completion carries an envelope at the given coordinate. */
export function hasProviderMetadata(
  completion: NormalizedCompletion,
  ref: ProviderMetadataRef,
): boolean {
  return getProviderMetadataEnvelope(completion, ref) !== undefined;
}

/**
 * Every envelope one provider contributed, with its RESOLVED kind (kind-less
 * envelopes report the provider's legacy-default kind when one is registered, else
 * the DEFAULT sentinel). This is the coexistence view: citations, grounding, safety
 * … all listed side by side, each with its own version.
 */
export function listProviderMetadataEnvelopes(
  completion: NormalizedCompletion,
  provider: string,
): ReadonlyArray<{ readonly kind: string; readonly envelope: ProviderMetadataEnvelope }> {
  const map = completion?.providerMetadata;
  if (!map) return [];
  const prefix = providerMetadataSlotKey(provider, '');
  const out: Array<{ kind: string; envelope: ProviderMetadataEnvelope }> = [];
  for (const [slot, envelope] of Object.entries(map)) {
    const belongs = slot === provider || slot.startsWith(prefix);
    if (!belongs || !envelope || envelope.provider !== provider) continue;
    out.push({ kind: envelope.kind ?? legacyDefaultKindOf(provider), envelope });
  }
  return out;
}

function legacyDefaultKindOf(provider: string): string {
  const legacy = listProviderMetadataDescriptors(provider).find((d) => d.legacyDefault);
  return legacy?.kind ?? DEFAULT_PROVIDER_METADATA_KIND;
}

// ── Typed, validated retrieval (the consumer-facing API) ──────────────────────

/**
 * THE consumer API. Given a descriptor, return the provider's VALIDATED, TYPED,
 * deep-frozen payload — or `undefined`. Every guard PB-002 hand-rolled (absent
 * metadata · wrong provider · wrong version · wrong shape · junk entries) is
 * applied here, once, for every consumer.
 *
 *     const cites = readProviderMetadata(completion, PERPLEXITY_CITATIONS_V1)?.citations ?? [];
 */
export function readProviderMetadata<D>(
  completion: NormalizedCompletion,
  descriptor: ProviderMetadataDescriptor<D>,
): D | undefined {
  const envelope = getProviderMetadataEnvelope(completion, {
    provider: descriptor.provider,
    kind: descriptor.kind,
    version: descriptor.version,
  });
  if (!envelope) return undefined;
  const decoded = descriptor.decode(envelope.data);
  return decoded === undefined ? undefined : deepFreezeProviderMetadata(decoded);
}

/** {@link readProviderMetadata} with a caller-supplied fallback (never undefined). */
export function readProviderMetadataOr<D>(
  completion: NormalizedCompletion,
  descriptor: ProviderMetadataDescriptor<D>,
  fallback: D,
): D {
  return readProviderMetadata(completion, descriptor) ?? fallback;
}

/**
 * Typed retrieval by COORDINATE instead of by descriptor handle — resolves the
 * descriptor through the registry first. Useful for generic/dynamic readers
 * (observability, debugging, cross-provider sweeps).
 */
export function readProviderMetadataByRef<D = unknown>(
  completion: NormalizedCompletion,
  ref: ProviderMetadataRef,
): D | undefined {
  const descriptor = resolveProviderMetadataDescriptor(ref);
  if (!descriptor) return undefined;
  return readProviderMetadata(completion, descriptor as ProviderMetadataDescriptor<D>);
}

// ── Producer side (same validator, one implementation) ────────────────────────

/**
 * Build an immutable envelope for a descriptor from a RAW provider payload,
 * validating + normalizing through the SAME decoder consumers use. Returns
 * `undefined` when the payload is absent or untrustworthy — which is what keeps
 * "no metadata" meaning "no key at all".
 */
export function buildProviderMetadataEnvelope<D>(
  descriptor: ProviderMetadataDescriptor<D>,
  raw: unknown,
): ProviderMetadataEnvelope<string, D> | undefined {
  const decoded = descriptor.decode(raw);
  if (decoded === undefined) return undefined;
  return freezeProviderMetadata<string, D>(
    descriptor.provider,
    descriptor.version,
    decoded,
    descriptor.legacyDefault ? undefined : descriptor.kind,
  );
}

/**
 * Attach a descriptor's metadata to a completion, validating first. NO-OP
 * (returns the input reference) when the payload is absent or invalid, preserving
 * the byte-identical legacy shape for providers that emit nothing.
 */
export function attachTypedProviderMetadata<D>(
  completion: NormalizedCompletion,
  descriptor: ProviderMetadataDescriptor<D>,
  raw: unknown,
): NormalizedCompletion {
  const envelope = buildProviderMetadataEnvelope(descriptor, raw);
  return envelope ? attachProviderMetadata(completion, envelope) : completion;
}

// ── Built-in descriptors ──────────────────────────────────────────────────────

/**
 * Perplexity grounded citations, v1 — the payload PB-001 introduced and PB-002
 * consumes. `legacyDefault: true` means its envelopes keep the exact PB-001 shape
 * (provider slot, no `kind` key), so this descriptor describes the ALREADY-SHIPPED
 * wire format rather than a new one.
 */
export const PERPLEXITY_CITATIONS_V1 = defineProviderMetadataKind<PerplexityCompletionMetadataV1>({
  provider: 'perplexity',
  kind: PROVIDER_METADATA_KINDS.CITATIONS,
  version: PERPLEXITY_METADATA_VERSION,
  legacyDefault: true,
  decode: (raw) => {
    const citations = (raw as { citations?: unknown } | null | undefined)?.citations;
    if (!Array.isArray(citations)) return undefined;
    const urls = citations.filter((c): c is string => typeof c === 'string');
    return urls.length > 0 ? { citations: urls } : undefined;
  },
});

/** (Re-)register the Platform's built-in descriptors. Called by the registry reset. */
export function registerBuiltInProviderMetadataKinds(): void {
  registerProviderMetadataKind(PERPLEXITY_CITATIONS_V1);
}
