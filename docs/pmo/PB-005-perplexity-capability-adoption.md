# PB-005 — Provider Capability Adoption (Perplexity)

**Status:** Engineering complete. **Authority:** PMO-002. **Program:** B (Egress Product Adoption). **Agent:** 2 (Product Adoption). **Zone:** A2 — **product only; no Platform file modified.** **Date:** 2026-07-21.

Product: `backend/services/intelligence/adapters/perplexityAdapter.ts`
Tests: `backend/tests/unit/perplexityAdapterCapabilityAdoption.test.ts` (new, 34) · `backend/tests/unit/perplexityAdapterGatewayAdoption.test.ts` (PB-002, 16, unchanged)
Consumes: `backend/services/aiGatewayCapabilities.ts` (PB-004, read-only, **not modified**)

---

## 1. Audit finding (Phase 0) — no capability assumption existed

The adapter was read in full before any code was written. **It contains no provider-specific capability *branch* that the registry could replace.**

| Candidate | Verdict |
|---|---|
| `extractPerplexityCitations` (`:59-64`) | Reads the PB-001 envelope, version-checks, filters non-strings, returns `[]` when absent. **Data-driven, not capability-driven.** |
| `reshapeCompletionToPerplexityResponse` (`:79-98`) | Adds the `citations` key only when the array is non-empty. Opportunistic. |
| `extractAnswer` (`:130-138`) | Appends `Sources: …` only when `citations.length > 0`. Opportunistic. |
| `PERPLEXITY_URL`, `DEFAULT_MODEL`, `temperature: 0`, no `max_tokens` | Endpoint / request-shape parity — **transport configuration, not capability**. |

There is no `if (provider supports X)` anywhere in the file. The adapter is **already capability-agnostic and fail-safe by construction**: absent metadata degrades to the citation-free legacy shape rather than to an error. Manufacturing a `supportsCapability('perplexity','citations')` gate whose answer is statically known would have been ceremony, and — worse — would have made a hand-maintained registry load-bearing for a working feature.

**Two adjacent findings raised, not acted on** (both outside PB-005's permitted edit set):

1. **A genuine provider-specific branch exists in `backend/services/intelligence/queryOrchestrator.ts:175` — `if (provider === 'perplexity') return { system: null, user: query }`.** This looks like a capability assumption but is **not** one: the registry declares `perplexity → systemPrompt: true`. Replacing that branch with a registry lookup would *start sending a system prompt to Perplexity* — a behavior change, forbidden by requirement 3, and a probe-semantics change besides. It is a deliberate product choice (bare user query for grounded search), and it should stay a product choice. **No edit made.**
2. **Provider-id namespace mismatch.** `AIProviderId` (product) = `chatgpt | gemini | claude | perplexity | copilot`; `GatewayProviderId` (Platform) = `openai | anthropic | gemini | perplexity | copilot`. `'chatgpt' ≠ 'openai'`, `'claude' ≠ 'anthropic'`. A naive adoption that passed `this.id` into `supportsCapability` would silently read `false` ("no claim") for **two of five providers**. This adapter therefore passes the gateway literal `'perplexity'` — the same literal already handed to `dispatchTransport` and `getProviderMetadata` — never `this.id`. Asserted in tests.

## 2. Adoption shape — reconciliation + diagnostics, never a gate

PB-004's mandate is *descriptive only*. Making product behavior depend on it converts a hand-maintained table with **no automated registry↔transport agreement test** into a runtime dependency. PB-005 therefore adopts the registry in the one shape that adds value without adding risk.

**Added to the adapter (all additive):**

| Symbol | Kind | Role |
|---|---|---|
| `PERPLEXITY_ADAPTER_CONSUMED_CAPABILITY` | const | Names the *Platform* capability this adapter consumes (`PROVIDER_CAPABILITIES.CITATIONS`). A product **expectation**, not a declaration — the vocabulary and the claims stay Platform-owned. |
| `reconcileCitationCapability(observedCitations, provider?)` | pure fn | Reconciles the expectation against `getProviderCapability(...)`. Returns `{ provider, capability, declared, observed, agreement, evidence, drift, citationsApplied: true }`. Total; never throws (the lookup is additionally `try/catch`ed). |
| `shouldReportCapabilityReconciliation(r)` | pure predicate | `true` only for **proven drift** or an unreadable registry. The healthy case is silent → zero log volume in normal operation. |
| `reportCapabilityReconciliation(n)` | private, fire-and-forget | Emits one `logProviderCall` line, `operation: 'visibility.probe.perplexity.capability_reconcile'`. Wholly `try/catch`ed; returns `void` so no caller can branch on it. |

**Agreement states:** `agreed` (declared supported) · `registry_contradicts` (evidenced negative) · `registry_silent` (undeclared **or** unknown provider) · `registry_unavailable` (lookup could not be performed).

**Call site — one line, at the end of the gateway path only:**

```ts
const response = reshapeCompletionToPerplexityResponse(completion, model);
reportCapabilityReconciliation(response.citations?.length ?? 0);   // AFTER citations are applied
return response;
```

The reconciliation runs **after** the response is fully built. The citations are already in the object; the outcome is observed, logged, and discarded. The legacy (flag-OFF, default) path is not touched at all.

### Why this cannot regress citations

- **No branch consumes the registry answer.** Nothing in the citation path reads `declared`, `agreement` or `drift`. Grep-checkable: the only registry import is `getProviderCapability`, used in exactly one pure function whose result flows only into a log line.
- **`citationsApplied` is a literal `true`**, so the fail-open direction is machine-checked in every state, not merely commented.
- **Ordering** places the lookup downstream of the response construction, so even a pathological registry cannot be upstream of the data.
- **Two layers of swallowing**: the lookup is `try/catch`ed inside the pure function, and the whole diagnostic is `try/catch`ed at the call site (asserted with a throwing logger).
- **Tested exhaustively**: supported · unsupported · undeclared · unknown provider · registry throws — all five produce the identical `Sources: …` answer on **both** transports.

### What this buys

PB-004's own documented risk is undetectable drift in a hand-maintained table. PB-005 closes it from the product side, from the one consumer that actually depends on the capability, in two directions:

- **Runtime:** if the registry ever stops claiming `perplexity → citations` while the Platform keeps delivering them, a diagnostic fires — instead of the drift being invisible (or, under a gated design, silently deleting the feature).
- **Test-layer:** the suite asserts registry↔product agreement statically (`supportsCapability('perplexity','citations') === true`, evidence string mentions PB-001), so a registry regression breaks a build rather than production.

**Honest caveat:** in the healthy world this adoption is behaviorally inert by design — that is the point, and it is stated rather than disguised. The genuine value is the drift alarm and the static agreement check, not a runtime decision.

## 3. Compatibility

| Path | Result |
|---|---|
| Legacy transport (flag OFF, default) | **Byte-identical.** No code added to `super.fetchCompletionJson`; no diagnostic emitted (asserted). |
| Gateway transport (flag ON) | Same response object; one extra out-of-band log line only on drift/unreadable registry. |
| Citations present | `Sources: …` rendered — verified on both transports in **all four** registry states. |
| Citations absent | `citations` key still **omitted** (no fabrication) in all four registry states. |
| Registry unavailable / unknown provider | `declared: null`, `agreement: registry_unavailable`/`registry_silent`, behavior unchanged. |
| `PERPLEXITY_ADAPTER_GATEWAY_TRANSPORT` | Untouched — still a transport-only choice. No new flag. |
| Exports / signatures | All existing exports unchanged; additions only. |

## 4. Tests — `perplexityAdapterCapabilityAdoption.test.ts` (34)

The registry module is mocked with a switchable mode (`real` / `unsupported` / `undeclared` / `throws`) so every state is driven against the real adapter on both transports.

- **Adoption surface (2)** — consumes the Platform capability name; real registry agrees with the product expectation (evidence cites PB-001).
- **Capability available (1)** — `agreed`, evidence carried, no drift, nothing reported.
- **Capability unavailable (6)** — unsupported ⇒ `registry_contradicts` + drift; undeclared ⇒ `registry_silent`; lookup throws ⇒ `registry_unavailable`; no observation ⇒ no drift claimed; `citationsApplied === true` in every state; never throws for `''` / `'__proto__'` / negative counts.
- **Unknown provider (2)** — degrades to `registry_silent`; the `chatgpt`/`claude` namespace hazard is asserted.
- **The certification invariant (17)** — parameterized over all four registry states: gateway renders `Sources: …`; legacy renders `Sources: …`; reshape restores citations identically; gateway answer `===` legacy answer; metadata-absent stays citation-free.
- **Diagnostics (6)** — agreed ⇒ silent; drift ⇒ exactly one line containing `citations_applied=true`; unreadable registry ⇒ reported; no observation ⇒ silent; legacy path ⇒ never emits; a throwing logger cannot break the probe.

## 5. Verification

| Gate | Result |
|---|---|
| `npx tsc -p tsconfig.backend.json --noEmit` | **0 errors in touched files.** One pre-existing, unrelated failure in `pages/api/company-profile/index.ts:267` (untouched by PB-005). |
| `perplexityAdapterCapabilityAdoption.test.ts` (PB-005, new) | **34/34** |
| `perplexityAdapterGatewayAdoption.test.ts` (PB-002) | **16/16** — unmodified file |
| `gatewayProviderMetadata.test.ts` (PB-001) | **11/11** |
| `gatewayMetadataFramework.test.ts` (PB-003R) | **29/29** |
| `gatewayProviderCapabilities.test.ts` (PB-004) | **43/43** |
| Combined | **133/133** |

## 6. Risks

1. **Log-volume:** bounded by construction — emission requires drift or an unreadable registry; the healthy path is silent (asserted).
2. **`logProviderCall` status vocabulary:** the diagnostic squats on `status: 'ok'` with a distinct `operation`, since the union is `'ok' | 'unavailable' | 'cache_hit'`. Widening it is a Platform-adjacent change and was not made. Consumers filter on `operation`.
3. **Drift is detected, not prevented.** A registry mis-declaration still needs a human. PB-005 makes it *visible*; it deliberately does not make it *actionable in-band*.
4. **The queryOrchestrator branch (finding 1) remains unadopted** — correctly, since adopting it would change probe behavior. If PMO wants it reconciled it must be a separate, explicitly behavior-reviewed package.
5. **Not extended to other providers.** Only Perplexity consumes a capability today; nothing was changed in any other adapter.

## 7. Repository validation

- **Platform untouched** — `aiGatewayCapabilities.ts`, `aiGatewayCore.ts`, `aiGatewayMetadata.ts`, `aiGatewayTransports.ts`, `aiGatewayDispatcher.ts`, `aiGatewayProviders*.ts` all unmodified.
- No other provider adapter, no UI, no analytics, no MarketPulse, no Engagement, no schema/migration, no contract change, **no new feature flag**, no new dependency.
- Files changed: the adapter, one **new** test file, this doc.
- No git operations performed — changes left in the working tree.
