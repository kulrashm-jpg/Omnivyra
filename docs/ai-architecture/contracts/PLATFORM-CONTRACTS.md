# Platform & Cross-Cutting Contracts (AI-CONTRACT-000)

Observability, Billing, and the three cross-cutting contracts (Error, Versioning, Extension) that bind every subsystem. Built on [COMMON-SUBSTRATE.md](COMMON-SUBSTRATE.md).

---

## X1. Observability Contract

- **Purpose:** one telemetry model for every AI call — metrics, traces, cost, quality, grounding, originality, hallucination — correlated end-to-end.
- **Owner:** Platform Reliability. **Canonical modules:** `usage_events` + `observability/*` + OTLP spans.
- **Entry point:** every subsystem emits `UsageRecord` + lifecycle terminal; no silent path.
```
UsageRecord {
  correlationId; traceId; reasoningId          // reasoningId PERSISTED with the artifact (not throwaway)
  operation; provider?; model?
  tokens: { input; output; total }
  costUsd: number | null                        // system/UNKNOWN_ORG spend is costed (not null-by-skip)
  latencyMs; attempts; finalAttempt; cacheHit
  featureArea; referenceType?; referenceId?
  outcome: 'success'|'failure'|'blocked'|'bypassed'
}
QualitySignals {                                 // emitted where applicable
  groundedRate?; hallucinationScore?; originalityHitRate?; semanticTierCovered?
}
```
- **Trace/reasoning/correlation IDs:** one `correlationId` spans the whole lifecycle; `traceId`/`reasoningId` persist with produced artifacts (artifact↔call correlation).
- **Metrics / latency / cost / provider events:** recorded on every outcome (success/failure/cache/block/retry attempt).
- **Grounding / originality / hallucination / quality metrics:** first-class signals (new per AI-ARCH §11), not just structural validation.
- **Invariant:** observability is fail-safe (a telemetry error never affects the decision) and mandatory (every layer emits).

---

## X2. Billing Contract

- **Purpose:** explicit cost enforcement + attribution per operation.
- **Owner:** Platform Reliability. **Canonical module:** `billing/runBilledAiCompletion` (HOLD→EXECUTE→CONFIRM).
- **Entry point:** every AI operation declares `BillingIntent`.
```
BillingIntent = { mode: 'billed'; creditHandle } | { mode: 'exempt'; reason: string }
BillingRecord { correlationId; orgId; operation; creditsReserved; creditsConsumed; costUsd; providerAccount; cacheHit; refunded?: boolean }
```
- **Usage recording / credit consumption:** billed ops reserve→consume via the enterprise orchestrator; every op is billed **or** explicitly exempt with a recorded reason (no accidental unbilled paths).
- **Provider accounting / cost attribution:** cost attributed per org/feature/activity; **system/`UNKNOWN_ORG` spend is costed**, not silently null.
- **Retries / cache accounting:** each attempt costed; cache hits recorded as zero-provider-cost; no double-charge across retries.
- **Refund behavior:** failed/blocked generation after reservation → reservation released/refunded.
- **Auditability:** every billing decision is reconstructable from `usage_events` + `BillingRecord`, keyed by `correlationId`.

---

## E1. Unified Error Contract

The single AI error model (`AiError`, Substrate §S7). No subsystem defines a parallel error type; all failures are typed values in `Result<T>`.

| Facet | Rule |
|---|---|
| **Error codes** | stable, namespaced per category (e.g. `GATEWAY_TIMEOUT`, `GATEWAY_NO_FALLBACK`, `GROUNDING_MISSING_PROFILE`, `GROUNDING_STALE`, `ORIGINALITY_BLOCKED`, `SAFETY_INJECTION_BLOCKED`, `SAFETY_MODERATION_BLOCKED`, `VALIDATION_BAD_OUTPUT`, `VALIDATION_REJECTED`, `BILLING_INSUFFICIENT`, `TENANT_REQUIRED`, `CONTRACT_INCOMPATIBLE`, `PROVIDER_ERROR`, `INTERNAL`) |
| **Severity** | `info` / `warn` / `error` / `critical` |
| **Retryability** | `retryable` boolean; transport/timeout/429/529 retryable; validation/safety/tenant not |
| **User-facing errors** | `userMessage` — safe, no internals/PII |
| **Developer diagnostics** | `devDetail` — never surfaced to end users |
| **Provider failures** | `category:'transport'`, mapped from provider status; **fail-closed** (no fabricated completion) |
| **Grounding failures** | `category:'grounding'`; floor/staleness are typed, not silent |
| **Validation failures** | `category:'validation'`; malformed output → `VALIDATION_BAD_OUTPUT` (never unhandled throw) |
| **Timeout behavior** | `GATEWAY_TIMEOUT`, retryable, per-attempt cap; partial-stream salvage where available |
| **Moderation failures** | `category:'safety'`, fail-closed (`SAFETY_MODERATION_BLOCKED`) |

**Invariant:** one error shape, one code namespace, consistent `correlationId` — every layer speaks the same error language.

---

## V1. Versioning Contract

| Facet | Rule |
|---|---|
| **Semantic versioning** | every contract is `MAJOR.MINOR.PATCH`, versioned from day one (Substrate §S8) |
| **Backward compatibility** | additive change (new optional field, new provider, new content-type profile) = MINOR/PATCH; consumers unaffected |
| **Forward compatibility** | unknown optional fields are ignored, never rejected |
| **Breaking change policy** | changing a request/response shape, removing a field, or changing error semantics = MAJOR; requires a CDR |
| **Deprecation lifecycle** | `active → deprecated (documented, still served) → removed (after ≥1 MAJOR + parity)` |
| **Migration rules** | MAJOR cutovers are flag-gated, fall-back-safe, parity-verified (AI-ARCH ADR-014); a rejected incompatible MAJOR returns `CONTRACT_INCOMPATIBLE` |

---

## Z1. Extension Contract

How future AI capabilities extend the platform **without** forking a contract.

| Extension point | Rule |
|---|---|
| **Plugin points** | new capability = new consumer of existing contracts (gateway/runtime/grounding), never a new pipeline |
| **Optional capabilities** | opt-in via feature flags (off/shadow/enforce), default OFF |
| **Provider additions** | new provider = new adapter behind the Provider Gateway (C1); router + capability map updated |
| **New products** | declare a canonical execution path that composes existing contracts (AI-ARCH §3) |
| **New AI models** | registered in the router + pricing + capability map; no new call site |
| **Experimental features** | flag-gated, observable, fail-safe; never on a default path until certified |
| **Feature flags** | one rollout kit (off/shadow/enforce + kill switch); flag state travels in `RequestEnvelope.flags` |
| **Compatibility guarantees** | an extension may add, never break; a breaking extension requires a MAJOR + CDR |

**Invariant:** extension is composition over existing contracts. No extension introduces a second interface for an existing responsibility (No Duplicate Interfaces).
