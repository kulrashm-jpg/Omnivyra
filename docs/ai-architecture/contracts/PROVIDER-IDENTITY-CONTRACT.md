# Canonical Provider Identity Contract (PB-006)

**Status:** Engineering complete. **Authority:** PMO-002. **Program:** B (Egress Product Adoption). **Zone:** P (Platform). **Kind:** additive-only Platform enhancement, **data + pure functions only** — no routing, no dispatcher, no registry, no provider-behavior change; no flags, no schema, no dependencies. **Date:** 2026-07-21.

Module: `backend/services/aiGatewayProviderIdentity.ts` · Tests: `backend/tests/unit/gatewayProviderIdentity.test.ts`

Governs alongside [PLATFORM-CONTRACTS.md](./PLATFORM-CONTRACTS.md) §V1 (Versioning) and §Z1 (Extension). Complements [PROVIDER-CAPABILITY-CONTRACT.md](./PROVIDER-CAPABILITY-CONTRACT.md) (PB-004) — capabilities say *what a provider can do*; identity says *which provider you are actually naming*.

---

## 1. Problem

The repository speaks **two provider vocabularies**, and they are not the same:

| Vocabulary | Type | Owner | Ids |
|---|---|---|---|
| **Product** | `AIProviderId` | `backend/services/intelligence/providerInterfaces.ts:18` | `chatgpt` · `gemini` · `claude` · `perplexity` · `copilot` |
| **Platform** | `GatewayProviderId` | `backend/services/aiGatewayDispatcher.ts:42` | `openai` · `anthropic` · `gemini` · `perplexity` · `copilot` |

Three of five ids **coincide** (`gemini`, `perplexity`, `copilot`); two **do not** (`chatgpt` ≠ `openai`, `claude` ≠ `anthropic`).

That partial overlap is the entire hazard. Code written and verified against a coinciding provider looks correct and then **fails silently** on the two that differ. PB-005 surfaced exactly this: a Product adapter calling `supportsCapability(this.id, …)` with its own `AIProviderId` answers `false` for **two of five providers** — features disabled, no error, no log, no exception. *A wrong answer that never raises is the worst available failure mode.*

PB-006 does not patch a call site. It makes the whole class of mistake **impossible to make silently**.

## 2. What this contract is NOT

| Not | Because |
|---|---|
| a third provider union | both id sets are imported **type-only** from their existing owners. `ProductProviderId` / `PlatformProviderId` are *aliases of the same types*, not new vocabularies |
| a router or a gate | it never selects, enables or disables anything. `resolveTransport` (`aiGatewayDispatcher`) remains the ONLY routing decision |
| a normalizer | there is no `.trim()`, no `.toLowerCase()`, no alias table, no nearest-match. An id that is not byte-identical to a canonical id is **unknown** |
| a default-provider mechanism | there is deliberately **no** API that returns a plausible-but-wrong id or a fallback |
| a change to PB-004 | the capability registry is untouched — see §5 |
| consumed | **nothing reads it yet.** Product adoption is a separate, independently-gated package |

Loading this module cannot change what any provider does: no network, no I/O, no config, no env, no flags, no schema, no side effects.

## 3. The canonical mapping

```ts
PRODUCT_TO_PLATFORM_PROVIDER = {   PLATFORM_TO_PRODUCT_PROVIDER = {
  chatgpt:    'openai',              openai:     'chatgpt',
  gemini:     'gemini',              anthropic:  'claude',
  claude:     'anthropic',           gemini:     'gemini',
  perplexity: 'perplexity',          perplexity: 'perplexity',
  copilot:    'copilot',             copilot:    'copilot',
}                                  }
```

Frozen, **null-prototype**, data-only, and a **total bijection**.

### 3.1 Compile-time totality (the structural guarantee)

Both literals are declared `as const satisfies Record<ProductProviderId, PlatformProviderId>` (and the inverse). Mirroring PB-004's `Record<GatewayProviderId, …>` technique, this makes each of the following a **compile error, not a silent gap** — each verified empirically against `tsc` 5.9:

| Defect | Diagnostic |
|---|---|
| provider added to either union, left unmapped | `TS1360` — does not satisfy the expected type |
| key that is not in the union | `TS2353` — object literal may only specify known properties |
| value outside the target union | `TS2322` — not assignable |
| maps bijective but **not inverse** | `TS2344` — round-trip proof `Type 'false' does not satisfy the constraint 'true'` |

The last one comes from exported type-level proofs that assert key exactness, value surjectivity and **round-trip identity in both directions**:

```ts
type _ProviderIdentityProductRoundTrip = AssertTrue<Equals<
  { [K in ProductProviderId]: PLATFORM_TO_PRODUCT[PRODUCT_TO_PLATFORM[K]] },
  { [K in ProductProviderId]: K }
>>;
```

They emit no runtime code and are exported only so they can never be pruned as unused.

## 4. API surface — strict by default, non-throwing by explicit choice

| API | Behavior on a bad id | Use when |
|---|---|---|
| `toPlatformProviderId(id)` | **throws** `ProviderIdentityError` | **default.** An unmappable id is a programming/config error |
| `toProductProviderId(id)` | **throws** `ProviderIdentityError` | **default**, reverse direction |
| `tryToPlatformProviderId(v)` / `tryToProductProviderId(v)` | returns `undefined` | the caller genuinely must not throw and only needs "did it resolve?" |
| `resolvePlatformProviderId(v)` / `resolveProductProviderId(v)` | `{ ok: false, reason, direction, received }` | the caller must report or branch on **why** it failed |
| `isProductProviderId(v)` / `isPlatformProviderId(v)` | `false` | narrowing an untrusted value |

The strict resolvers are **overloaded** so a statically-known argument yields a statically-known result — `toPlatformProviderId('chatgpt')` is typed `'openai'` — catching mismatches at compile time as well as runtime.

**There is no third variant.** Nothing in this module ever substitutes, defaults or guesses; a test enumerates the exported surface and fails on any export matching `/fallback|default|coerce|normalize|guess|fuzzy|lenient|orElse/i`.

### 4.1 Rejection is total and exact

`ProviderIdentityFailureReason` is `not_a_string` | `empty` | `unknown_provider`. Everything below is rejected — never coerced:

- the **other vocabulary** (`'openai'` as a product id, `'chatgpt'` as a platform id);
- **wrong case** (`'ChatGPT'`, `'OPENAI'`, `'Gemini'`) — no case-folding;
- **whitespace** (`' chatgpt'`, `'chatgpt '`, `'\tchatgpt\n'`, `'chat gpt'`, `'   '`) — no trimming;
- the **empty string**;
- **prototype keys** (`'__proto__'`, `'constructor'`, `'toString'`, `'valueOf'`, `'hasOwnProperty'`, `'prototype'`) — the lookup tables carry a **null prototype** and reads are own-property only, so an inherited member is structurally incapable of resolving, even for a caller that indexes the exported map directly;
- **non-strings** (`null`, `undefined`, numbers, booleans, objects, arrays, functions, `new String(...)`). The error message renders the input **without invoking** its `toString`.

`ProviderIdentityError` carries `reason`, `direction`, `received` and the frozen `expected` vocabulary, so callers act on structure rather than parsing a message.

## 5. The PB-004 boundary — a strict gate in front of a graceful registry

PB-004 is **mandated never to throw**: `aiGatewayCapabilities.ts:217` states that unknown providers and capabilities "degrade to undefined / false / [] — never an exception." **That mandate is correct and PB-006 does not change it. Not one line of the registry was edited.**

The two are complementary layers, not competing policies:

```
untrusted id ──▶ [ PB-006 identity layer:  STRICT   — rejects loudly ]
                            │ validated GatewayProviderId
                            ▼
                  [ PB-004 capability registry: GRACEFUL — never throws ]
```

- **Validation belongs at the boundary** where an identifier *enters* the Platform. That is the only place with enough context to know the id was supposed to be valid.
- **The registry is a pure lookup** over already-validated ids. It must stay total and non-throwing so a newer consumer querying an older Platform degrades instead of crashing.
- Callers that must not throw use `tryTo…` / `resolve…` and handle the failure **explicitly**. They never receive a silent substitution.

The tests pin this boundary from both sides: the registry still answers `false` (silently) for a raw product id — the unchanged legacy behavior, and precisely the defect — while translating first makes the *same* query correct:

```ts
supportsCapability('chatgpt', TEXT_COMPLETION)                      // false  (unchanged)
supportsCapability(toPlatformProviderId('chatgpt'), TEXT_COMPLETION) // true
```

## 6. Runtime isolation

The only dependencies are **two type-only imports**, erased at compile time:

- `AIProviderId` from `intelligence/providerInterfaces` — so the Platform carries **zero runtime dependency on Product code**; importing this module loads nothing from `intelligence/**`;
- `GatewayProviderId` from `aiGatewayDispatcher` — so `tsc` enforces agreement with the dispatcher while the module stays free of the transports, the OpenAI SDK, supabase and config.

Consequently `PRODUCT_PROVIDER_IDS` / `PLATFORM_PROVIDER_IDS` are derived from this module's own maps rather than imported from `AI_PROVIDERS` / `GATEWAY_PROVIDER_IDS`, which would reintroduce runtime coupling. Agreement is guaranteed at compile time by the totality proofs and asserted at runtime by the tests.

## 7. Versioning & extension

`PROVIDER_IDENTITY_CONTRACT_VERSION = 1` versions the **mechanism**, not any provider. Adding a provider is additive and does **not** bump it — but it *does* require an entry in **both** maps, or the build fails (§3.1). A changed meaning for an existing id is a breaking change and bumps the version.

## 8. Adoption (NOT in this package)

Nothing consumes this module. The intended adoption shape, for a later gated package, is: a Product adapter holding an `AIProviderId` calls `toPlatformProviderId(this.id)` **once**, at the Platform boundary, and passes the validated `GatewayProviderId` to Platform APIs (capabilities, metadata, dispatch). No Product code was modified by PB-006.
