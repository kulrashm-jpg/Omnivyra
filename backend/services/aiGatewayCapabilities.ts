/**
 * CANONICAL PROVIDER CAPABILITY REGISTRY (PB-004 · Program B · Platform · Zone P).
 *
 * WHY. Program A unified transport (`aiGatewayDispatcher`) and PB-001..PB-003R
 * unified provider METADATA (`aiGatewayCore` / `aiGatewayMetadata`). What is still
 * missing is the ability to ASK the Platform what a provider can do. Today every
 * consumer that wants to know "does this provider return citations?" answers it from
 * implementation knowledge — by remembering that `callPerplexity` attaches an
 * envelope, or that `response_format` is only sent to OpenAI. That knowledge is
 * un-queryable, un-versioned and silently rots.
 *
 * PB-004 makes capabilities PLATFORM METADATA, not adapter knowledge:
 *
 *   supportsCapability('perplexity', PROVIDER_CAPABILITIES.CITATIONS)  // → true
 *   supportsCapability('anthropic',  PROVIDER_CAPABILITIES.SEED)       // → false
 *   listProviderCapabilities('gemini')                                 // → frozen list
 *
 * SCOPE / NON-SCOPE — this module is DESCRIPTIVE ONLY.
 *   - It describes providers. It does NOT route, select, gate, retry or call them.
 *   - Registration is DECLARATIVE and happens at module load from frozen literals.
 *     No runtime probing, no conditional discovery, no network, no I/O, no reading
 *     of live config, env or feature flags. Loading this module cannot change what
 *     any provider does.
 *   - NOTHING consumes it yet. Adoption is a separate, independently-gated package.
 *
 * ACCURACY OVER BREADTH. A capability registry that misreports is worse than no
 * registry. Every `true` below cites the in-tree evidence that establishes it. A
 * capability that could not be evidenced is simply NOT DECLARED — it degrades to
 * `supportsCapability(...) === false` / `getProviderCapability(...) === undefined`,
 * which reads as "the Platform does not claim this", never as a guess.
 *
 * RUNTIME ISOLATION. The only dependency on the rest of the gateway is a TYPE-ONLY
 * import of the canonical provider-id union, so tsc enforces that this registry and
 * the dispatcher agree on the provider set while the registry stays free of any
 * runtime coupling to routing (importing it does not pull in the transports, the
 * OpenAI SDK, supabase or config).
 */
// Type-only: erased at compile time. `GatewayProviderId` is the CANONICAL provider-id
// union ('openai' | 'anthropic' | 'gemini' | 'perplexity' | 'copilot'); it is reused
// rather than re-declared so a new provider cannot be added to the dispatcher without
// this registry failing to type-check. (Note: `ProviderName` in providerTokenBucket.ts
// is NOT the canonical id set — it covers only openai|anthropic.)
import type { GatewayProviderId } from './aiGatewayDispatcher';

// ── Contract version ──────────────────────────────────────────────────────────

/**
 * Version of the capability-registry MECHANISM (not of any provider's capability
 * set). Bumped only by a breaking change to the registry shape/semantics; adding
 * capabilities or providers is additive and does NOT bump it.
 */
export const PROVIDER_CAPABILITY_REGISTRY_VERSION = 1 as const;

// ── Canonical capability vocabulary (PLATFORM-OWNED) ──────────────────────────

/**
 * THE canonical capability names. Platform-owned: products never define, rename or
 * re-scope a capability — they consume these. Open by construction: a new capability
 * is one new entry here plus a declaration (with evidence) on the providers that have
 * it. Existing names never change meaning; a changed meaning is a NEW name.
 *
 * A capability answers "can this provider do X, as reachable from THIS platform",
 * and each declaration records where that was established.
 */
export const PROVIDER_CAPABILITIES = {
  /** Text completion is actually reachable (transport implemented, not a stub). */
  TEXT_COMPLETION: 'textCompletion',
  /** Incremental token streaming with partial-output salvage. */
  STREAMING: 'streaming',
  /** A server-enforced structured/JSON response mode is requested by the platform. */
  STRUCTURED_OUTPUT: 'structuredOutput',
  /** A dedicated system-prompt channel (not just a system-role message). */
  SYSTEM_PROMPT: 'systemPrompt',
  /** Deterministic sampling seed accepted and transmitted. */
  SEED: 'seed',
  /** Grounded source URLs returned with the answer. */
  CITATIONS: 'citations',
  /** Retrieval/grounding evidence chunks returned with the answer. */
  GROUNDING: 'grounding',
  /** Reasoning traces or reasoning-token summaries returned. */
  REASONING: 'reasoning',
  /** Content/search provenance returned (where the material came from). */
  PROVENANCE: 'provenance',
  /** Safety / moderation annotations returned by the provider. */
  SAFETY_METADATA: 'safetyMetadata',
  /** Provider-side tool / function calling. */
  TOOL_CALLING: 'toolCalling',
  /** Live web search performed by the provider as part of answering. */
  SEARCH: 'search',
  /** Image generation. */
  IMAGE_GENERATION: 'imageGeneration',
} as const;

/**
 * A capability name. Deliberately widened with `string`: an UNKNOWN capability is a
 * legitimate query (a newer consumer against an older Platform) and must degrade
 * gracefully rather than fail to compile or throw.
 */
export type ProviderCapability =
  (typeof PROVIDER_CAPABILITIES)[keyof typeof PROVIDER_CAPABILITIES] | (string & {});

/** Every canonical capability name, frozen. */
export const PROVIDER_CAPABILITY_NAMES: readonly ProviderCapability[] = Object.freeze(
  Object.values(PROVIDER_CAPABILITIES) as ProviderCapability[],
);

/** True when `name` is one of the Platform's canonical capability names. */
export function isKnownCapability(name: string): boolean {
  return (PROVIDER_CAPABILITY_NAMES as readonly string[]).includes(name);
}

// ── Declaration shape ─────────────────────────────────────────────────────────

/**
 * One provider's stance on one capability. `supported` is the answer; `evidence` is
 * the in-tree justification for it, carried at runtime so the claim is auditable
 * from a REPL, a log line or a test — not just from a comment.
 *
 * An UNDECLARED capability is NOT the same as `supported: false`: undeclared means
 * "the Platform makes no claim" (lookup → `undefined`), whereas an explicit
 * `supported: false` is a positive, evidenced statement that the provider does not
 * have it on this platform.
 */
export type ProviderCapabilityDeclaration = {
  readonly capability: ProviderCapability;
  readonly supported: boolean;
  /** Where this was established in-tree. Required — an unevidenced claim is a guess. */
  readonly evidence: string;
};

/** A provider's complete, frozen capability profile. */
export type ProviderCapabilityProfile = {
  readonly provider: GatewayProviderId | string;
  /** Capability name → declaration. Frozen; never exposes mutable internals. */
  readonly capabilities: Readonly<Record<string, ProviderCapabilityDeclaration>>;
  /** Free-text scope notes (e.g. "transport is a stub"). Never behavioral. */
  readonly notes?: string;
};

/** Input to {@link defineProviderCapabilities} — plain, declarative data. */
export type ProviderCapabilityProfileSpec = {
  readonly provider: GatewayProviderId | string;
  readonly capabilities: ReadonlyArray<ProviderCapabilityDeclaration>;
  readonly notes?: string;
};

// ── Immutability ──────────────────────────────────────────────────────────────

/** Recursively freeze a plain value. Cycle-safe; leaves non-objects untouched. */
function deepFreeze<T>(value: T, seen: WeakSet<object> = new WeakSet()): T {
  if (value === null || typeof value !== 'object') return value;
  const obj = value as unknown as object;
  if (seen.has(obj)) return value;
  seen.add(obj);
  for (const key of Object.keys(obj as Record<string, unknown>)) {
    deepFreeze((obj as Record<string, unknown>)[key], seen);
  }
  return Object.freeze(value);
}

// ── Registry ──────────────────────────────────────────────────────────────────

const REGISTRY = new Map<string, ProviderCapabilityProfile>();

/**
 * OWN-property read of a capability slot. Guards the prototype chain: a query for
 * `'toString'` / `'constructor'` / `'__proto__'` must read as "not declared", never
 * as an inherited object. Unknown capability names come from callers, so this is a
 * correctness guard, not a micro-optimization.
 */
function readDeclaration(
  profile: ProviderCapabilityProfile | undefined,
  capability: string,
): ProviderCapabilityDeclaration | undefined {
  if (!profile) return undefined;
  return Object.prototype.hasOwnProperty.call(profile.capabilities, capability)
    ? profile.capabilities[capability]
    : undefined;
}

/**
 * Build + register a provider's capability profile from declarative data. Returns
 * the deep-frozen profile. Idempotent per provider id — re-registering replaces the
 * entry, so a future provider package can own its own declaration without depending
 * on module load order.
 *
 * PURE + DECLARATIVE: no probing, no I/O, no config reads. Duplicate capability
 * entries for one provider resolve last-wins (deterministic, source-order).
 */
export function defineProviderCapabilities(
  spec: ProviderCapabilityProfileSpec,
): ProviderCapabilityProfile {
  // Null-prototype: a capability named `__proto__`/`constructor` becomes an ordinary
  // key instead of corrupting the object, and inherited members can never masquerade
  // as declarations.
  const capabilities: Record<string, ProviderCapabilityDeclaration> = Object.create(null);
  for (const decl of spec.capabilities) {
    capabilities[decl.capability] = {
      capability: decl.capability,
      supported: decl.supported === true,
      evidence: decl.evidence,
    };
  }
  const profile = deepFreeze<ProviderCapabilityProfile>({
    provider: spec.provider,
    capabilities,
    ...(spec.notes === undefined ? {} : { notes: spec.notes }),
  });
  REGISTRY.set(profile.provider, profile);
  return profile;
}

// ── Discovery API (READ-ONLY) ─────────────────────────────────────────────────
//
// Every function below is a pure lookup over frozen data. None mutates, none
// throws, and none can influence provider selection or behavior. Unknown providers
// and unknown capabilities degrade to undefined / false / [] — never an exception.

/**
 * A provider's frozen capability profile, or `undefined` for an unknown provider.
 *
 * NOTE ON NAMING: the dispatcher already exports `getProviderCapabilities(providerId)`
 * returning the TRANSPORT descriptor (endpoint / implemented / supportsStreaming…).
 * That is a different contract, so this registry deliberately does NOT reuse the
 * name — one name, one meaning.
 */
export function getProviderCapabilityProfile(
  provider: string,
): ProviderCapabilityProfile | undefined {
  return REGISTRY.get(provider);
}

/**
 * The frozen capability map for a provider (`{ [capability]: declaration }`), or an
 * empty frozen object for an unknown provider.
 */
export function getProviderCapabilities(
  provider: string,
): Readonly<Record<string, ProviderCapabilityDeclaration>> {
  return REGISTRY.get(provider)?.capabilities ?? EMPTY_CAPABILITY_MAP;
}

const EMPTY_CAPABILITY_MAP: Readonly<Record<string, ProviderCapabilityDeclaration>> =
  Object.freeze({});

const EMPTY_DECLARATION_LIST: readonly ProviderCapabilityDeclaration[] = Object.freeze([]);

/**
 * One declaration, or `undefined` when the provider is unknown OR the capability was
 * never declared for it. `undefined` means "the Platform makes no claim".
 */
export function getProviderCapability(
  provider: string,
  capability: ProviderCapability,
): ProviderCapabilityDeclaration | undefined {
  return readDeclaration(REGISTRY.get(provider), capability);
}

/**
 * THE consumer predicate. `true` ONLY for an explicitly declared, supported
 * capability. Unknown provider → `false`. Unknown/undeclared capability → `false`.
 * Never throws.
 */
export function supportsCapability(provider: string, capability: ProviderCapability): boolean {
  return readDeclaration(REGISTRY.get(provider), capability)?.supported === true;
}

/**
 * Every declaration for a provider (supported and explicitly-unsupported alike), in
 * a frozen array. Empty for an unknown provider.
 */
export function listProviderCapabilities(
  provider: string,
): readonly ProviderCapabilityDeclaration[] {
  const profile = REGISTRY.get(provider);
  if (!profile) return EMPTY_DECLARATION_LIST;
  return Object.freeze(Object.values(profile.capabilities));
}

/** Just the capability NAMES a provider positively supports. Frozen; empty if unknown. */
export function listSupportedCapabilities(provider: string): readonly ProviderCapability[] {
  return Object.freeze(
    listProviderCapabilities(provider)
      .filter((d) => d.supported)
      .map((d) => d.capability),
  );
}

/** Every provider id that has a registered profile. Frozen. */
export function listCapabilityProviders(): readonly string[] {
  return Object.freeze([...REGISTRY.keys()]);
}

/** Every registered profile. Frozen. */
export function listProviderCapabilityProfiles(): readonly ProviderCapabilityProfile[] {
  return Object.freeze([...REGISTRY.values()]);
}

/**
 * The inverse query: which providers positively support a capability. Empty (never
 * an error) for an unknown capability. Order follows registration order, so it is
 * deterministic — but it is a DESCRIPTIVE list, never a routing preference.
 */
export function findProvidersWithCapability(
  capability: ProviderCapability,
): readonly string[] {
  const out: string[] = [];
  for (const [provider, profile] of REGISTRY) {
    if (readDeclaration(profile, capability)?.supported === true) out.push(provider);
  }
  return Object.freeze(out);
}

/**
 * A plain, JSON-serializable snapshot of the whole registry:
 * `{ [provider]: { [capability]: boolean } }`. For diagnostics/observability — the
 * returned object is frozen and detached from registry internals.
 */
export function serializeProviderCapabilities(): Readonly<
  Record<string, Readonly<Record<string, boolean>>>
> {
  const out: Record<string, Record<string, boolean>> = {};
  for (const [provider, profile] of REGISTRY) {
    const row: Record<string, boolean> = {};
    for (const decl of Object.values(profile.capabilities)) row[decl.capability] = decl.supported;
    out[provider] = row;
  }
  return deepFreeze(out);
}

/** Clear the registry and restore the Platform's built-in profiles. Test support. */
export function resetProviderCapabilityRegistry(): void {
  REGISTRY.clear();
  registerBuiltInProviderCapabilities();
}

// ── Built-in declarations ─────────────────────────────────────────────────────
//
// EVIDENCE RULE: a `true` here is backed by a line of shipped code, read read-only.
// Anything that could not be evidenced is OMITTED (→ `undefined` / `false`), and an
// explicit `supported: false` is itself an evidenced statement.
//
// NOT DECLARED for ANY provider today, because nothing in-tree establishes them:
//   grounding · reasoning · provenance · safetyMetadata · toolCalling.
// (No transport requests them and no transport parses them — see the transports and
// the core callers. They are left undeclared rather than guessed at.)

const OPENAI_CAPABILITIES = defineProviderCapabilities({
  provider: 'openai',
  capabilities: [
    {
      capability: PROVIDER_CAPABILITIES.TEXT_COMPLETION,
      supported: true,
      evidence: 'aiGatewayCore.callOpenAi — live chat.completions transport.',
    },
    {
      capability: PROVIDER_CAPABILITIES.STREAMING,
      supported: true,
      evidence:
        'aiGatewayCore.callOpenAi streaming path (stream:true + stream_options.include_usage, onChunk deltas, GatewayPartialStreamError salvage).',
    },
    {
      capability: PROVIDER_CAPABILITIES.STRUCTURED_OUTPUT,
      supported: true,
      evidence:
        "aiGatewayCore: GatewayRequest.response_format ({type:'json_object'}) is sent to OpenAI on both the streaming and non-streaming paths; GatewayDispatchParams documents it as OpenAI-only.",
    },
    {
      capability: PROVIDER_CAPABILITIES.SYSTEM_PROMPT,
      supported: true,
      evidence:
        "aiGatewayDispatcher.GATEWAY_PROVIDER_CAPABILITIES.openai.supportsSystemPrompt === true; system-role messages are passed through verbatim.",
    },
    {
      capability: PROVIDER_CAPABILITIES.SEED,
      supported: true,
      evidence:
        'aiGatewayCore.callOpenAi forwards `seed` when non-null (WAVE3 deterministic sampling); GATEWAY_PROVIDER_CAPABILITIES.openai.supportsSeed === true.',
    },
    {
      capability: PROVIDER_CAPABILITIES.IMAGE_GENERATION,
      supported: true,
      evidence:
        'creatorAssetRendererMedia.ts calls client.images.generate (gpt-image-1 / dall-e-3). SURFACE NOTE: the OpenAI image SDK path, NOT the gateway text transport.',
    },
    {
      capability: PROVIDER_CAPABILITIES.CITATIONS,
      supported: false,
      evidence:
        'aiGatewayCore.callOpenAi returns only { content, usage } — no providerMetadata is attached, and no citations descriptor is registered for openai (aiGatewayMetadata).',
    },
    {
      capability: PROVIDER_CAPABILITIES.SEARCH,
      supported: false,
      evidence:
        'No search/tool parameters are sent by callOpenAi; the request body is model/temperature/response_format/messages/max_tokens/seed only.',
    },
  ],
});

const ANTHROPIC_CAPABILITIES = defineProviderCapabilities({
  provider: 'anthropic',
  capabilities: [
    {
      capability: PROVIDER_CAPABILITIES.TEXT_COMPLETION,
      supported: true,
      evidence: 'aiGatewayCore.callAnthropic — live POST https://api.anthropic.com/v1/messages.',
    },
    {
      capability: PROVIDER_CAPABILITIES.STREAMING,
      supported: true,
      evidence:
        'aiGatewayCore.callAnthropicStream — SSE parsing of content_block_delta / message_delta with partial-output salvage.',
    },
    {
      capability: PROVIDER_CAPABILITIES.SYSTEM_PROMPT,
      supported: true,
      evidence:
        "callAnthropic lifts the system message to the top-level `system` field (Messages API); GATEWAY_PROVIDER_CAPABILITIES.anthropic.supportsSystemPrompt === true.",
    },
    {
      capability: PROVIDER_CAPABILITIES.SEED,
      supported: false,
      evidence:
        'callAnthropic accepts `seed` for signature parity but explicitly does NOT send it ("the Anthropic Messages API has no seed field"); GATEWAY_PROVIDER_CAPABILITIES.anthropic.supportsSeed === false.',
    },
    {
      capability: PROVIDER_CAPABILITIES.STRUCTURED_OUTPUT,
      supported: false,
      evidence:
        'callAnthropic takes no response_format parameter and sends no structured-output directive; the platform does not request one for this provider.',
    },
    {
      capability: PROVIDER_CAPABILITIES.CITATIONS,
      supported: false,
      evidence:
        'callAnthropic returns only { content, usage } — no providerMetadata attached, no citations descriptor registered for anthropic.',
    },
  ],
});

const GEMINI_CAPABILITIES = defineProviderCapabilities({
  provider: 'gemini',
  capabilities: [
    {
      capability: PROVIDER_CAPABILITIES.TEXT_COMPLETION,
      supported: true,
      evidence:
        'aiGatewayTransports.callGemini — live generateContent transport; GATEWAY_TRANSPORT_CAPABILITIES.gemini.implemented === true.',
    },
    {
      capability: PROVIDER_CAPABILITIES.SYSTEM_PROMPT,
      supported: true,
      evidence:
        'callGemini maps the system message to `systemInstruction`; GATEWAY_TRANSPORT_CAPABILITIES.gemini.supportsSystemPrompt === true.',
    },
    {
      capability: PROVIDER_CAPABILITIES.STREAMING,
      supported: false,
      evidence:
        'GATEWAY_TRANSPORT_CAPABILITIES.gemini.supportsStreaming === false — the PA-001 seam is non-streaming (stream/onChunk accepted for parity only).',
    },
    {
      capability: PROVIDER_CAPABILITIES.SEED,
      supported: false,
      evidence: 'GATEWAY_TRANSPORT_CAPABILITIES.gemini.supportsSeed === false; callGemini sends no seed.',
    },
    {
      capability: PROVIDER_CAPABILITIES.STRUCTURED_OUTPUT,
      supported: false,
      evidence:
        'callGemini sends only contents / systemInstruction / generationConfig{temperature,maxOutputTokens} — no responseMimeType or responseSchema.',
    },
    {
      capability: PROVIDER_CAPABILITIES.CITATIONS,
      supported: false,
      evidence:
        'callGemini parses only candidates[0].content.parts + usageMetadata; groundingMetadata is neither requested nor read, and no citations descriptor is registered for gemini.',
    },
    {
      capability: PROVIDER_CAPABILITIES.SEARCH,
      supported: false,
      evidence: 'callGemini sends no `tools` / googleSearch retrieval directive in its request body.',
    },
  ],
});

const PERPLEXITY_CAPABILITIES = defineProviderCapabilities({
  provider: 'perplexity',
  capabilities: [
    {
      capability: PROVIDER_CAPABILITIES.TEXT_COMPLETION,
      supported: true,
      evidence:
        'aiGatewayTransports.callPerplexity — live chat/completions transport; GATEWAY_TRANSPORT_CAPABILITIES.perplexity.implemented === true.',
    },
    {
      capability: PROVIDER_CAPABILITIES.CITATIONS,
      supported: true,
      evidence:
        'PB-001: callPerplexity attaches grounded citations[] via PERPLEXITY_CITATIONS_V1; PB-002: perplexityAdapter consumes them. Registered descriptor: aiGatewayMetadata.PERPLEXITY_CITATIONS_V1 (provider perplexity, kind citations, v1).',
    },
    {
      capability: PROVIDER_CAPABILITIES.SYSTEM_PROMPT,
      supported: true,
      evidence:
        'callPerplexity forwards system-role messages unchanged; GATEWAY_TRANSPORT_CAPABILITIES.perplexity.supportsSystemPrompt === true.',
    },
    {
      capability: PROVIDER_CAPABILITIES.STREAMING,
      supported: false,
      evidence: 'GATEWAY_TRANSPORT_CAPABILITIES.perplexity.supportsStreaming === false (non-streaming seam).',
    },
    {
      capability: PROVIDER_CAPABILITIES.SEED,
      supported: false,
      evidence:
        'GATEWAY_TRANSPORT_CAPABILITIES.perplexity.supportsSeed === false; callPerplexity sends no seed.',
    },
    {
      capability: PROVIDER_CAPABILITIES.STRUCTURED_OUTPUT,
      supported: false,
      evidence:
        'callPerplexity sends model / temperature / messages / max_tokens only — no response_format is forwarded to this provider.',
    },
  ],
});

const COPILOT_CAPABILITIES = defineProviderCapabilities({
  provider: 'copilot',
  notes:
    'Transport stub: callCopilot throws GatewayTransportNotImplementedError and GATEWAY_TRANSPORT_CAPABILITIES.copilot.endpoint is null. No capability can be claimed until a real transport lands.',
  capabilities: [
    {
      capability: PROVIDER_CAPABILITIES.TEXT_COMPLETION,
      supported: false,
      evidence:
        'aiGatewayTransports.callCopilot always throws GatewayTransportNotImplementedError; GATEWAY_TRANSPORT_CAPABILITIES.copilot.implemented === false.',
    },
    {
      capability: PROVIDER_CAPABILITIES.STREAMING,
      supported: false,
      evidence: 'GATEWAY_TRANSPORT_CAPABILITIES.copilot.supportsStreaming === false.',
    },
    {
      capability: PROVIDER_CAPABILITIES.SEED,
      supported: false,
      evidence: 'GATEWAY_TRANSPORT_CAPABILITIES.copilot.supportsSeed === false.',
    },
    {
      capability: PROVIDER_CAPABILITIES.SYSTEM_PROMPT,
      supported: false,
      evidence: 'GATEWAY_TRANSPORT_CAPABILITIES.copilot.supportsSystemPrompt === false.',
    },
  ],
});

/**
 * The Platform's built-in profiles, keyed by the CANONICAL provider id. Typed as a
 * total `Record<GatewayProviderId, …>` so adding a provider to the dispatcher
 * without declaring its capabilities here is a COMPILE ERROR, not a silent gap.
 */
export const BUILT_IN_PROVIDER_CAPABILITIES: Readonly<
  Record<GatewayProviderId, ProviderCapabilityProfile>
> = Object.freeze({
  openai: OPENAI_CAPABILITIES,
  anthropic: ANTHROPIC_CAPABILITIES,
  gemini: GEMINI_CAPABILITIES,
  perplexity: PERPLEXITY_CAPABILITIES,
  copilot: COPILOT_CAPABILITIES,
});

/** (Re-)register the Platform's built-in profiles. Called by the registry reset. */
export function registerBuiltInProviderCapabilities(): void {
  for (const profile of Object.values(BUILT_IN_PROVIDER_CAPABILITIES)) {
    REGISTRY.set(profile.provider, profile);
  }
}
