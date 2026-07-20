# Canonical Provider Metadata Contract (PB-001)

**Status:** Engineering complete. **Authority:** PMO-002. **Program:** B (Egress Product Adoption). **Zone:** P (Platform gateway). **Kind:** additive-only Platform enhancement, runtime-neutral, no flags, no schema. **Date:** 2026-07-21.

Extends the canonical AI Gateway completion contract so provider-native metadata SURVIVES normalization, without weakening the provider-agnostic core. Resolves the Program A limitation (PA-006): `NormalizedCompletion` could not carry Perplexity's grounded `citations[]`, forcing lossy normalization.

Governs alongside [PLATFORM-CONTRACTS.md](./PLATFORM-CONTRACTS.md) §V1 (Versioning) and §Z1 (Extension). This is a MINOR, additive change (new optional field) per §V1: consumers are unaffected, unknown fields are ignored.

---

## 1. Canonical completion contract

`NormalizedCompletion` (`backend/services/aiGatewayCore.ts`) is the single canonical return of every gateway transport (`callOpenAi`, `callAnthropic`, and the seam transports `callGemini`/`callPerplexity`/`callCopilot`). It is deliberately **provider-agnostic**:

```ts
type NormalizedCompletion = {
  content: string;
  usage: { prompt_tokens; completion_tokens; total_tokens } | null;
  readonly providerMetadata?: ProviderMetadataMap;   // ← PB-001, OPTIONAL
};
```

`content` + `usage` are the fields every consumer relies on and are unchanged. `providerMetadata` is a new **optional** field — absent on every legacy path, so any consumer reading only `content`/`usage` compiles and behaves identically.

## 2. Extension philosophy

Provider-specific fields (e.g. `citations`) must **never** sit directly on the core completion object — that would re-fork the contract per provider (violating "No Duplicate Interfaces", §Z1). Instead every provider's native extras live inside a **provider-scoped, version-tagged, immutable envelope**:

```ts
type ProviderMetadataEnvelope<P extends string = string, D = Readonly<Record<string, unknown>>> = {
  readonly provider: P;      // which provider produced this
  readonly version: number;  // schema version of THIS provider's data shape
  readonly data: Readonly<D>; // provider-native payload (deep-frozen)
};

type ProviderMetadataMap = Readonly<Record<string, ProviderMetadataEnvelope>>; // keyed by provider id
```

The container satisfies five properties by construction:

| Property | How |
|---|---|
| **Optional** | `providerMetadata?` — absent by default; no caller changed. |
| **Immutable** | `freezeProviderMetadata` deep-freezes the envelope + nested `data` (readonly types + `Object.freeze`). |
| **Version-safe** | each envelope tags its own `version`; consumers branch on it. A container-mechanism version (`PROVIDER_METADATA_CONTRACT_VERSION`) tracks the shape of the mechanism itself. |
| **Provider-scoped** | the map is keyed by provider id — reading `map['a']` can never surface provider `b`'s data (isolation). |
| **Forward-compatible** | `data` is an open readonly record. New kinds — citations, grounding refs, search provenance, safety annotations, reasoning metadata — need NO contract change, only a new envelope shape + version. |

## 3. Helper API (pure, immutable)

All in `backend/services/aiGatewayCore.ts`:

- `freezeProviderMetadata(provider, version, data)` → a deep-frozen `ProviderMetadataEnvelope`.
- `attachProviderMetadata(completion, ...envelopes)` → a **new** completion with the envelopes merged into its provider-scoped map. Pure (input never mutated); provider-scoped merge (an envelope replaces only its own slot); no-op returning the input when no envelopes are supplied (preserves byte-identical behavior for providers with no native metadata).
- `getProviderMetadata(completion, provider)` → that provider's envelope, or `undefined`.

## 4. Lifecycle — how metadata flows

```
provider HTTP response
  → transport seam (callPerplexity) normalizes content/usage AND, if native extras
    are present, wraps them via freezeProviderMetadata + attachProviderMetadata
  → NormalizedCompletion { content, usage, providerMetadata? }
  → dispatchTransport(providerId, …) returns it unchanged (pure routing, pass-through)
  → callProviderWithRetry spreads it through (…result) — metadata survives retry/fallback
  → consumer reads content/usage as before; MAY additionally read providerMetadata
```

The retry/fallback layer (`aiGatewayProvidersRetry.ts`) and the dispatcher (`aiGatewayDispatcher.ts`) required **no change** — both already carry a `NormalizedCompletion` through by value/spread, so the new optional field flows automatically.

## 5. Perplexity (first adopter of the survival guarantee)

`callPerplexity` (`aiGatewayTransports.ts`) now reads the provider's grounded `citations[]` (string URLs) and, when present, attaches a `perplexity` envelope:

```ts
{ provider: 'perplexity', version: 1, data: { citations: readonly string[] } }
```

- Typed as `PerplexityCompletionMetadataV1`; version `PERPLEXITY_METADATA_VERSION`.
- **Non-consuming:** PB-001 only guarantees the citations SURVIVE normalization. No product path consumes them yet, and no output changes. When Perplexity returns no citations, the completion is byte-identical to the legacy `{ content, usage }` shape (no `providerMetadata` key).
- The intelligence adapter (`intelligence/adapters/perplexityAdapter.ts`) is out of Zone P and unchanged — enabling product consumption of citations is a separate, future package.

## 6. Compatibility & guarantees

- Additive only (new optional field, new helpers). No removed/renamed fields, no changed signatures. MINOR per §V1.
- No feature flags, no DB/schema changes, no migrations, no runtime regression, no behavior change for any existing provider (OpenAI, Anthropic, Gemini, Copilot completions are unchanged; Perplexity output is unchanged — only additive metadata when the provider supplies it).
- Serializes cleanly (plain data — JSON round-trips structurally); deep-frozen for immutability across cloning.

## 7. Adding a new provider's metadata (recipe)

1. Define a typed payload + version (e.g. `type GeminiGroundingMetadataV1 = { readonly groundingChunks: readonly … }`).
2. In that provider's transport seam, build the envelope with `freezeProviderMetadata('<provider>', <version>, data)` and return `attachProviderMetadata(base, env)` — only when the provider actually returns the extra (so the no-metadata path stays byte-identical).
3. Consumers opt in via `getProviderMetadata(completion, '<provider>')` and branch on `version`.

No core contract edit is required — that is the forward-compatibility guarantee.
