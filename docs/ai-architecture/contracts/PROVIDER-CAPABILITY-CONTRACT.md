# Canonical Provider Capability Contract (PB-004)

**Status:** Engineering complete. **Authority:** PMO-002. **Program:** B (Egress Product Adoption). **Zone:** P (Platform gateway). **Kind:** additive-only Platform enhancement, **descriptive only** — no routing, no dispatcher, no provider-behavior change; no flags, no schema, no dependencies. **Date:** 2026-07-21.

Module: `backend/services/aiGatewayCapabilities.ts` · Tests: `backend/tests/unit/gatewayProviderCapabilities.test.ts`

Governs alongside [PLATFORM-CONTRACTS.md](./PLATFORM-CONTRACTS.md) §V1 (Versioning) and §Z1 (Extension), and complements [PROVIDER-METADATA-CONTRACT.md](./PROVIDER-METADATA-CONTRACT.md) (PB-001/PB-003R). Metadata says *what a provider returned*; capabilities say *what a provider can do*.

---

## 1. Problem

Program A unified transport (`aiGatewayDispatcher`); PB-001→PB-003R unified provider metadata. What remained un-modelled is **capability knowledge**. A consumer that needs to know "does this provider return citations?" or "can I ask this provider for JSON?" answers it today from *implementation knowledge* — by remembering that `callPerplexity` attaches an envelope, or that `response_format` is only sent to OpenAI. That knowledge is:

- **un-queryable** — you must read the transport source;
- **duplicated** — each consumer re-derives it;
- **un-versioned** — it silently rots when a transport changes;
- **product-owned** — each adapter decides for itself what a provider "can do".

PB-004 makes capabilities **Platform metadata, not adapter knowledge**.

## 2. What this contract is NOT

| Not | Because |
|---|---|
| a router | it never selects a provider; `resolveTransport` remains the ONLY routing decision (`aiGatewayDispatcher`) |
| a feature gate | it has no flags and no config reads; it cannot enable or disable anything |
| a probe | registration is declarative literals evaluated at module load — no network, no I/O, no live-config inspection, no conditional discovery |
| a duplicate of `GatewayProviderCapabilities` | that dispatcher type is the **transport descriptor** (endpoint / implemented / supportsSeed …). This registry is the **capability vocabulary** (citations, grounding, structured output …), evidenced and queryable. Different contracts, deliberately different names |
| consumed | nothing reads it yet. Adoption is a separate, independently-gated package |

Loading this module cannot change what any provider does. It has exactly one dependency on the rest of the gateway — a **type-only** import of the canonical provider-id union — so it carries no runtime coupling to routing.

## 3. Capability model

### 3.1 Vocabulary (Platform-owned)

```ts
PROVIDER_CAPABILITIES = {
  TEXT_COMPLETION, STREAMING, STRUCTURED_OUTPUT, SYSTEM_PROMPT, SEED,
  CITATIONS, GROUNDING, REASONING, PROVENANCE, SAFETY_METADATA,
  TOOL_CALLING, SEARCH, IMAGE_GENERATION,
}
```

Capabilities are **never product-owned**. Products consume these names; they do not define, rename or re-scope them. A capability answers *"can this provider do X, as reachable from THIS platform"*.

### 3.2 Declaration

```ts
type ProviderCapabilityDeclaration = {
  readonly capability: ProviderCapability;
  readonly supported: boolean;
  readonly evidence: string;   // REQUIRED — where this was established in-tree
};

type ProviderCapabilityProfile = {
  readonly provider: string;
  readonly capabilities: Readonly<Record<string, ProviderCapabilityDeclaration>>;
  readonly notes?: string;
};
```

**`evidence` is mandatory and carried at runtime**, so a claim is auditable from a REPL, a log line or a test — not just from a comment. An unevidenced claim is a guess, and this registry does not make guesses.

### 3.3 Three-valued semantics — the core honesty rule

| State | Query result | Meaning |
|---|---|---|
| declared `supported: true` | `getProviderCapability(...)!.supported === true`, `supportsCapability(...) === true` | positively evidenced |
| declared `supported: false` | declaration present, `supportsCapability(...) === false` | positively evidenced **negative** |
| **not declared** | `getProviderCapability(...) === undefined`, `supportsCapability(...) === false` | **the Platform makes NO claim** |

The third state is what keeps the registry honest: anything not evidenced in-tree is left undeclared rather than assumed false-because-convenient or true-because-plausible. `supportsCapability` collapses "unknown" to `false` so consumers are safe by default (never enable an unverified capability), while `getProviderCapability` preserves the distinction for anyone who needs it.

## 4. Registration mechanism

```ts
defineProviderCapabilities({
  provider: 'perplexity',
  capabilities: [ { capability, supported, evidence }, … ],
  notes?: '…',
});   // → deep-frozen ProviderCapabilityProfile, registered under the provider id
```

- **Declarative only.** The input is plain data. No callbacks, no probing, no I/O.
- **Idempotent per provider** — re-registering *replaces* (last-wins), so a future provider package can own its declaration without depending on module load order.
- **Detached** — the spec array is copied; mutating it afterwards cannot alter the registered profile.
- **Prototype-safe** — the capability map has a null prototype and lookups are own-property only, so `toString`/`constructor`/`__proto__` can never masquerade as a declaration.
- **Exhaustive by type.** `BUILT_IN_PROVIDER_CAPABILITIES` is typed `Record<GatewayProviderId, ProviderCapabilityProfile>`, so adding a provider to the dispatcher without declaring capabilities here is a **compile error**, not a silent gap.

## 5. Discovery API (read-only)

| Function | Returns | Unknown provider | Unknown capability |
|---|---|---|---|
| `getProviderCapabilityProfile(provider)` | frozen profile | `undefined` | — |
| `getProviderCapabilities(provider)` | frozen `{ capability → declaration }` | frozen `{}` | — |
| `getProviderCapability(provider, cap)` | frozen declaration | `undefined` | `undefined` |
| `supportsCapability(provider, cap)` | `boolean` | `false` | `false` |
| `listProviderCapabilities(provider)` | frozen declaration array | `[]` | — |
| `listSupportedCapabilities(provider)` | frozen name array (positives only) | `[]` | — |
| `listCapabilityProviders()` / `listProviderCapabilityProfiles()` | frozen arrays | — | — |
| `findProvidersWithCapability(cap)` | frozen provider-id array | — | `[]` |
| `serializeProviderCapabilities()` | frozen `{ provider → { capability → boolean } }` | — | — |
| `isKnownCapability(name)` | `boolean` | — | `false` |

**Every function is a pure lookup over frozen data. None mutates. None throws — for any input, including `''`, wrong case, or a capability invented after this Platform version shipped.** Provider ids are matched exactly: no case folding, no trimming, no fuzzy resolution (a guess is worse than a miss).

## 6. Immutability

- Profiles, their capability maps and every declaration are **deep-frozen** at registration (cycle-safe recursive freeze).
- Every returned collection is frozen and **detached from registry internals** — mutating a returned declaration, map, list or snapshot cannot change a subsequent answer.
- `PROVIDER_CAPABILITY_NAMES` and `BUILT_IN_PROVIDER_CAPABILITIES` are frozen.
- `resetProviderCapabilityRegistry()` restores the built-in baseline exactly (test isolation, mirroring `resetProviderMetadataRegistry`).

## 7. Declared capabilities and their evidence

`✓` = declared supported · `✗` = declared **unsupported** (an evidenced negative) · `–` = **not declared** (no in-tree evidence; the Platform makes no claim).

| Capability | openai | anthropic | gemini | perplexity | copilot |
|---|:--:|:--:|:--:|:--:|:--:|
| textCompletion | ✓ | ✓ | ✓ | ✓ | ✗ |
| streaming | ✓ | ✓ | ✗ | ✗ | ✗ |
| systemPrompt | ✓ | ✓ | ✓ | ✓ | ✗ |
| structuredOutput | ✓ | ✗ | ✗ | ✗ | – |
| seed | ✓ | ✗ | ✗ | ✗ | ✗ |
| citations | ✗ | ✗ | ✗ | **✓** | – |
| search | ✗ | – | ✗ | – | – |
| imageGeneration | ✓ | – | – | – | – |
| grounding · reasoning · provenance · safetyMetadata · toolCalling | – | – | – | – | – |

Evidence (each `✓`/`✗` carries the same string at runtime in `declaration.evidence`):

- **openai** — streaming: `callOpenAi` stream path (`stream: true`, `stream_options.include_usage`, `onChunk`, `GatewayPartialStreamError` salvage). structuredOutput: `GatewayRequest.response_format` (`{type:'json_object'}`) is sent to OpenAI on both paths and documented as OpenAI-only on `GatewayDispatchParams`. seed: `callOpenAi` forwards `seed` when non-null. imageGeneration: `creatorAssetRendererMedia.ts` → `client.images.generate` (gpt-image-1 / dall-e-3) — **surface note: the OpenAI image SDK path, NOT the gateway text transport**.
- **anthropic** — streaming: `callAnthropicStream` SSE (`content_block_delta` / `message_delta`) with partial salvage. systemPrompt: system message lifted to the top-level `system` field. seed `✗`: `callAnthropic` accepts `seed` for signature parity and explicitly does **not** send it. structuredOutput `✗`: no `response_format` parameter exists on `callAnthropic`.
- **gemini** — systemPrompt: `callGemini` maps the system message to `systemInstruction`. streaming/seed `✗`: `GATEWAY_TRANSPORT_CAPABILITIES.gemini`. structuredOutput `✗`: the body carries only `contents` / `systemInstruction` / `generationConfig{temperature,maxOutputTokens}`. citations/search `✗`: no `tools`/googleSearch directive is sent and `groundingMetadata` is never read.
- **perplexity** — **citations ✓**: PB-001 `callPerplexity` attaches grounded `citations[]` via `PERPLEXITY_CITATIONS_V1`; PB-002 `perplexityAdapter` consumes them; descriptor registered in `aiGatewayMetadata`. This is the anchor fact of the registry. `search` is **not declared** — Perplexity's citations strongly *imply* server-side search, but nothing in-tree requests or observes a search capability directly, so the Platform under-claims rather than infers.
- **copilot** — everything `✗`: `callCopilot` always throws `GatewayTransportNotImplementedError`; `GATEWAY_TRANSPORT_CAPABILITIES.copilot.implemented === false`, `endpoint === null`.

**Deliberately NOT declared for any provider:** `grounding`, `reasoning`, `provenance`, `safetyMetadata`, `toolCalling`. No transport requests them and no transport parses them, so there is nothing to evidence. They exist in the vocabulary so a future package can declare them *with* evidence — not so the registry can look complete.

> **Scope caveat, stated plainly.** These declarations describe the **platform's reachable surface**, not the providers' full published product capabilities. Several providers offer tool calling, structured output or search that this platform does not currently request. `✗` therefore means "not available through this platform today", and `–` means "unknown to this platform". Neither is a statement about the vendor's API.

## 8. Lifecycle · ownership · extension rules

**Ownership.** The Platform owns the capability vocabulary and every declaration. Products consume; products never declare. A product that believes a capability is missing raises it as a Platform change with evidence.

**Lifecycle of a capability name:** proposed → added to `PROVIDER_CAPABILITIES` (vocabulary only, no provider claims it) → declared per provider *with evidence* as transports gain it → (never renamed; a changed meaning is a NEW name) → deprecated only by documentation, since removing a name is a breaking change.

**Adding a capability to an existing provider (recipe):**
1. Land the transport/adapter change that actually creates the capability (a separate package — PB-004 declares, it never implements).
2. Add the name to `PROVIDER_CAPABILITIES` if it is new.
3. Add a declaration to that provider's built-in profile with an `evidence` string naming the file/symbol that establishes it.
4. Extend the tests: the positive claim, and the `findProvidersWithCapability` exclusivity assertion if it should be provider-unique.

**Adding a provider:**
1. Add the id to the dispatcher (Program A territory).
2. `BUILT_IN_PROVIDER_CAPABILITIES` immediately fails to type-check until a profile exists — declare one, `supported: false` where the transport is a stub, undeclared where nothing is known.

**Registration guidelines (binding):**
- Declarative literals only — no probing, no I/O, no env/config/flag reads, no live inspection.
- Every declaration carries non-empty `evidence`.
- Under-claim rather than over-claim: if you cannot cite it in-tree, leave it undeclared.
- Never declare a capability to *influence* behavior; this registry is descriptive. Routing lives in the dispatcher.

## 9. Compatibility guarantees

- **Additive only.** New module, new test, new doc. No existing export removed, renamed, or re-signed; no existing file's behavior altered.
- **Unknown degrades, never throws.** Unknown providers → `undefined`/`{}`/`[]`; unknown capabilities → `undefined`/`false`/`[]`. A consumer built against a newer Platform runs against an older one without crashing; it simply gets "no claim".
- **Additive evolution is answer-stable.** Registering a new provider or a new capability leaves every existing answer byte-identical (asserted in the tests via full-snapshot comparison).
- **Versioned from day one.** `PROVIDER_CAPABILITY_REGISTRY_VERSION` tracks the *mechanism* shape. Adding capabilities or providers is additive and does **not** bump it; only a breaking change to the registry shape/semantics does (MINOR/MAJOR per §V1).
- **Serializable.** `serializeProviderCapabilities()` and full profiles JSON round-trip structurally.
- **Runtime-neutral.** No flags, no schema, no migrations, no new dependencies, no observability emission, no network. Provider behavior — OpenAI, Anthropic, Gemini, Perplexity, Copilot — is unchanged, because no provider file was touched.
