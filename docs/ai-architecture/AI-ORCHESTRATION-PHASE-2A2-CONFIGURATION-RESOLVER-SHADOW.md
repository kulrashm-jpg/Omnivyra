# OmniVYRA — Phase 2A-2: Configuration Resolver (SHADOW MODE)

**Scope:** the Configuration Resolver — one new, read-only, deterministic runtime component. It runs in **shadow only**: its output is computed then **discarded**; legacy execution stays authoritative. **No execution change, no gateway change, no routing, no persistence, no schema change, no flag default changed.** With `AI_CONFIG_RESOLVER_SHADOW` OFF (default), behavior is byte-identical to today.
**Builds on:** the FROZEN persistence layer ([2B.1](AI-ORCHESTRATION-PHASE-2B1-FOUNDATION.md) / [2B.1A](AI-ORCHESTRATION-PHASE-2B1A-FOUNDATION-IMPROVEMENTS.md) / [2B.1B](AI-ORCHESTRATION-PHASE-2B1B-EXECUTION-METADATA.md)).
**Date:** 2026-07-31.

> **Deviation flagged up front (Critical Rule #13).** The brief asks the resolver to "run alongside legacy execution when the flag is ON," but it **also** forbids modifying `executeGatewayCompletion` / `resolveLlmConfig` / "the existing execution path" — the only natural shadow hook points. These are mutually exclusive. To honor the hard prohibition, this phase delivers the **complete, tested, production-ready shadow runner** (`runConfigResolverShadow`) but does **not** wire it into the execution path. The single fail-safe, fire-and-forget hook is the explicit next micro-step. The runner is exercised with the flag ON via its unit tests. Nothing on the execution path imports any 2A-2 code, so runtime is provably unchanged.

---

## 1. Resolver Architecture

One new component, three allowed abstractions, one shadow harness:

```
runConfigResolverShadow(input, deps, legacy)      ← shadow harness (flag-gated, fail-safe, DISCARDS)
        │  (only when AI_CONFIG_RESOLVER_SHADOW ≠ off)
        ▼
ConfigurationResolver.resolveExecutionPlan(input, deps)   ← the ONE new component (pure, deterministic)
        │  reads the frozen schema via injected loaders (deps)
        ▼
{ ResolvedExecutionPlan, ExecutionMetadata, ResolutionTrace }
        │
        ▼
ResolverComparator.compareToLegacy(legacy, plan) → ParityResult (MATCH | MISMATCH + diffs)
        │
        ▼
log (debug only) → DISCARD          legacy execution continues, authoritative
```

Files (all new, under `backend/services/aiOrchestration/`):
- `configurationResolver.ts` — the resolver (`resolveExecutionPlan`).
- `resolverComparator.ts` — the comparator (`compareToLegacy`, `ParityResult`).
- `resolverShadow.ts` — the shadow harness (`runConfigResolverShadow`).
- `types/ResolvedExecutionPlan.ts` — the internal plan type.

**Dependency injection.** All data access is via a `ResolverDeps` loader set (`mapOperationToCapability`, `loadBinding`, `loadPlatformDefaultBinding`, `loadActiveProfileVersion`). This keeps the resolver pure + unit-testable with fixtures and free of hard DB coupling. A supabase-backed deps factory reading the frozen tables is the trivial adapter the future wiring supplies.

---

## 2. Resolution Algorithm

```
resolveExecutionPlan(input, deps):
  1. capabilityId = input.capabilityId ?? mapOperationToCapability(operation) ?? GENERIC_COMPLETION   [trace]
  2. precedence walk (most specific first, FIRST MATCH WINS):
       if orgId: loadBinding(orgId, capabilityId)   → capability_override
                 loadBinding(orgId, null)           → org_default
                 loadBinding(null, capabilityId)    → capability_default
                 loadPlatformDefaultBinding()       → platform_default
       none matched → LEGACY plan (source=legacy_hardcoded, fingerprint=null)   [fail-safe]
  3. loadActiveProfileVersion(binding.profileId); deep-merge binding.override_patch onto the config bundles   [trace: select profile]
  4. resolve provider/model/version/deployment:
       explicit mode → profile's pinned provider/model/version/deployment
       tier mode     → adopt input.legacyProvider/legacyModel (heuristic-free; explicit model-selection is a later phase)
  5. resolve params/modality/reliability/limits/caching/safety from the (patched) version; emit modality/reasoning decision steps
  6. configFingerprint = computeConfigFingerprint(profile execution-semantics)   [reuses the 2B.1A single-source util]
  7. finish → { plan, metadata, trace }
```

**No heuristics, no randomness, no ambiguity.** Every branch is a deterministic lookup or a fixed rule.

---

## 3. Precedence Rules

| Priority | Binding coordinate | `source` | Decision code | Reason code |
|---|---|---|---|---|
| 1 (most specific) | org = X, capability = C | `capability_override` | `USE_OVERRIDE` | `CAP_OVERRIDE_APPLIED` |
| 2 | org = X, capability = NULL | `org_default` | `USE_ORG_DEFAULT` | `ORG_DEFAULT_APPLIED` |
| 3 | org = NULL, capability = C | `capability_default` | `USE_CAPABILITY_DEFAULT` | `CAP_DEFAULT_APPLIED` |
| 4 | platform default | `platform_default` | `USE_PLATFORM_DEFAULT` | `PLATFORM_DEFAULT_APPLIED` |
| 5 (fallback) | none matched / version missing | `legacy_hardcoded` | `LEGACY_SELECTION` | `LEGACY_RESOLVER_UNAVAILABLE` |

First match wins; the walk short-circuits. Org-scoped lookups are skipped entirely when `orgId` is absent. (Matches the approved design §6.1 and the 2B.1 binding scopes.)

---

## 4. ResolvedExecutionPlan Summary

Internal, discarded in shadow. Fields: `capabilityId`, `operation`, `orgId`; `profileId`/`profileKey`/`profileVersion`; `model{ provider, model, modelVersion, deploymentId }`; `params{ temperature, topP, maxOutputTokens, reasoningLevel, seedPolicy, streaming, structuredOutput, responseFormat, vision, toolCalling }`; `reliability{ timeoutMs, maxRetries, retryPolicy, partialAllowed }`; `limits{ maxCostUsdPerCall, tokenCeiling }`; `caching{ cacheable, ttlSeconds }`; `routingPolicyId`/`routingPolicyKey`; `safety`; `configFingerprint`; `source`. Never persisted, never executed.

---

## 5. ExecutionMetadata Summary

Populated using the **2B.1B contract**. Carries: profile id/key + version; `configFingerprint` + the separated `executionSchemaVersion` / `canonicalizationVersion` / `fingerprintAlgorithm` (from the util constants) + `fingerprintAlgoLegacy` (`sha256:v1`); `resolutionSource`; `resolutionDecisionCode`; `resolutionReasonCode`; and the `resolutionTrace`. Deterministic — no timestamps or durations are set in shadow (they would break reproducibility; `executionTimestamp` is left for the future authoritative phase).

---

## 6. ResolutionTrace Summary

Populated using the **2B.1B contract**. Every decision emits one ordered step (`sequence` 0..n): map-operation → the precedence lookups (each records `hit`) → select-profile → resolve-provider → resolve-model → resolve-model-version → (select-routing-policy) → modality/reasoning decisions → compute-fingerprint → **finish**. Each step carries the relevant `decisionCode` (→ `ai_resolution_decision_codes`) and/or `reasonCode` (→ `ai_resolution_reason_codes`) and `source`. Descriptive only; discarded in shadow.

---

## 7. Comparator Summary

`compareToLegacy(legacy, plan)` compares the config the **legacy path actually used** against the resolved plan, field by field, with `null`/`undefined` normalized to "unset". Compared fields: `provider`, `model`, `modelVersion`, `temperature`, `maxOutputTokens`, `streaming`, `structuredOutput`, `vision`, `timeoutMs`, `maxRetries`. Any inequality — including one side setting a value the other leaves unset — is a diff. Pure, read-only, never throws for a normal mismatch, never modifies execution.

---

## 8. Parity Report Format

```
ParityResult {
  status: 'MATCH' | 'MISMATCH',
  diffs: [ { field, legacy, resolved }, ... ],   // empty on MATCH
  comparedFields: [ 'provider', 'model', ... ]    // coverage of the comparison
}
```
Shadow log line (debug only, emitted ONLY when the flag is ON; no persistence):
```
[ai-config-resolver][shadow] {
  capability, operation, orgId,
  parity: 'MATCH'|'MISMATCH', diffs: [...],
  source, reason, decision, fingerprint, traceSteps,
  legacy: {...}, resolved: { provider, model }
}
```

---

## 9. Compatibility Report — why runtime is identical

1. **Nothing on the execution path imports 2A-2 code.** `executeGatewayCompletion`, `resolveLlmConfig`, `resolveEffectiveModel`, `resolveTransport`, `aiCapabilityRuntime`, the gateway, and every provider adapter are untouched (git: only new files under `aiOrchestration/`). Since no existing module imports the resolver, existing behavior and existing tests are structurally unaffected.
2. **Shadow harness not wired in** (see the deviation note) — even the harness is called by nothing on the execution path this phase.
3. **Gated + fail-safe by construction.** When `AI_CONFIG_RESOLVER_SHADOW` is `off` (default), `runConfigResolverShadow` returns immediately without touching the deps or resolver. When ON, any error is swallowed — it can never propagate to a caller.
4. **Read-only + discard.** The resolver performs only reads (via loaders); it persists nothing, executes nothing; the plan/metadata/trace/parity are logged and thrown away. The function returns a boolean *diagnostic* (ran/gated) that callers must not branch execution on.
5. **No schema/persistence/flag-default change.** No migration in this phase; all 5 flags remain OFF.
6. **Reuses, does not replace.** No parallel gateway, no second dispatcher, no new execution engine — only `ConfigurationResolver` + `ResolvedExecutionPlan` + `ResolverComparator` (rule 14), plus the flag-gated shadow invoker.

---

## 10. Validation Report

**Unit tests: 50/50 passed** across the 4 AI-orchestration suites (new `aiConfigurationResolver.test.ts` = 15; plus 2B.1B metadata = 7, fingerprint = 18, flags = 12 — all still green).

New-suite coverage (`aiConfigurationResolver.test.ts`):
- ✅ **Determinism** — same inputs → identical `plan`/`metadata`/`trace`/`fingerprint` (deep-equal across two runs).
- ✅ **Fingerprint reproducibility** — a tier-mode BALANCED profile recomputes the exact 2B.1A seed fingerprint `sha256:v1:9dbba7cc…c92910`, with `executionSchemaVersion=1`/`canonicalizationVersion=1`/`fingerprintAlgorithm='sha256'`.
- ✅ **Precedence** — capability_override > org_default > capability_default > platform_default > legacy_hardcoded; unmapped operation → `GENERIC_COMPLETION` with `LEGACY_UNMAPPED_OPERATION`.
- ✅ **Trace** — sequential steps, `SELECT_PROFILE` present, terminal `finish`.
- ✅ **Override patch** — deep-merges params AND changes the fingerprint.
- ✅ **Comparator** — MATCH on full agreement (null==undefined); MISMATCH surfaces field-level diffs with legacy/resolved values.
- ✅ **Shadow OFF (default)** — resolver NEVER runs; sink never called; **deps never touched** (returns `false`).
- ✅ **Shadow ON** — resolver runs, emits exactly one observation, discards (returns `true`); parity MATCH against a faithful legacy config.
- ✅ **Shadow ON + deps throw** — fail-safe: never throws, still returns `true` (legacy execution can never be perturbed).

**Confirmations:**
- ✓ Existing Gateway unchanged · ✓ Existing Resolver chokepoints unchanged · ✓ Existing Runtime unchanged · ✓ Existing UI unchanged.
- ✓ Resolver is read-only; never executes; output discarded; legacy authoritative.
- ✓ No schema / persistence / flag-default change.
- ✓ Only new runtime component is `ConfigurationResolver` (+ `ResolvedExecutionPlan`, `ResolverComparator`, and the flag-gated shadow invoker).
- ✓ Byte-identical behavior (flag OFF, unread; nothing on the execution path imports 2A-2 code).

**Full-suite note:** the entire repo test suite was not run here (it includes secret-gated/env-gated suites unrelated to this change). Because no existing module imports the new code, existing tests cannot be affected by it; the 4 orchestration suites that exercise the new code all pass.

---

## Files delivered

```
backend/services/aiOrchestration/configurationResolver.ts
backend/services/aiOrchestration/resolverComparator.ts
backend/services/aiOrchestration/resolverShadow.ts
backend/services/aiOrchestration/types/ResolvedExecutionPlan.ts
backend/tests/unit/aiConfigurationResolver.test.ts
```

*Phase 2A-2 complete. The Configuration Resolver exists, is deterministic and fully tested in shadow, and changes no runtime behavior. Next micro-step: wire `runConfigResolverShadow` into the gateway as a single fail-safe, flag-gated, fire-and-forget call (the one deliberately-deferred edit), then observe live parity before Phase 2A-3 makes the resolver authoritative.*
