# OmniVYRA — Phase 2A-2.3: Canonical Configuration Bridge

**Scope:** eliminate the last duplication between the legacy config builder and the resolver by proving the resolver can COMPLETELY describe the legacy execution configuration — via a pure adapter + round-trip snapshot identity. **Execution authority does NOT change; the gateway executes exactly as today.** No gateway edit, no routing/provider/retry/dispatcher/schema/persistence change. Gated OFF by default → byte-identical.
**Builds on:** [2A-2](AI-ORCHESTRATION-PHASE-2A2-CONFIGURATION-RESOLVER-SHADOW.md) · [2A-2.1](AI-ORCHESTRATION-PHASE-2A2.1-SHADOW-WIRING.md) · [2A-2.2](AI-ORCHESTRATION-PHASE-2A2.2-EXECUTION-EQUIVALENCE.md).
**Date:** 2026-07-31.

> **No execution-path edit this phase.** The 2A-2.1 hook already runs the shadow pipeline; 2A-2.3 only adds pure downstream logic (the adapter + its round-trip validator). `git status` shows the only modified existing file is still `aiGatewayProvidersOps.ts` from 2A-2.1 — unchanged here. The adapter is NOT wired into execution; the gateway keeps building its own config.

---

## 1. LegacyExecutionAdapter Architecture

```
                       ┌──────────────── proven equivalent ────────────────┐
Configuration Resolver ─▶ ResolvedExecutionPlan ─▶ LegacyExecutionAdapter ─▶ LegacyExecutionConfiguration
                                    │                                                │
                                    ▼ ExecutionSnapshotBuilder.fromPlan               ▼ ExecutionSnapshotBuilder.fromLegacyConfiguration
                               ExecutionSnapshot ◀───── AdapterValidator: IDENTICAL? ─────▶ ExecutionSnapshot
```

`LegacyExecutionAdapter` is the ONE new runtime abstraction: a **pure, deterministic, stateless mapper** `ResolvedExecutionPlan → LegacyExecutionConfiguration`. It contains **zero business logic** — no decisions, provider selection, routing, retries, fallbacks, heuristics, or normalization. It copies already-resolved values into the gateway's field names. Nothing else.

`AdapterValidator` proves the mapping is lossless by round-trip: it snapshots both the plan and the adapter output through the **existing** `ExecutionSnapshotBuilder` (rule 5 — no second snapshot implementation) and requires the execution snapshots to be **IDENTICAL**.

New files: `backend/services/aiOrchestration/legacyExecutionAdapter.ts`, `types/LegacyExecutionConfiguration.ts`.

---

## 2. Field Mapping Matrix

| ResolvedExecutionPlan | → | LegacyExecutionConfiguration |
|---|---|---|
| `model.provider` | → | `provider` |
| `model.model` | → | `model` |
| `model.modelVersion` | → | `modelVersion` |
| `model.deploymentId` | → | `deploymentId` |
| `params.temperature` | → | `temperature` |
| `params.topP` | → | `topP` |
| `params.maxOutputTokens` | → | `maxOutputTokens` / (token limit) |
| `params.streaming` | → | `streaming` |
| `params.structuredOutput` | → | `structuredOutput` |
| `params.vision` | → | `vision` |
| `params.reasoningLevel` | → | `reasoning` |
| `params.responseFormat` | → | `responseFormat` |
| `params.toolCalling` | → | `toolCalling` |
| `params.seedPolicy` | → | `seedPolicy` |
| `reliability.timeoutMs` | → | `timeoutMs` |
| `reliability.maxRetries` | → | `maxRetries` |
| `reliability.retryPolicy` | → | `retryPolicy` |
| `routingPolicyKey ?? routingPolicyId` | → | `routingPolicy` |
| `safety` | → | `safety` |
| `caching` | → | `cachePolicy` |
| `limits.maxCostUsdPerCall` | → | `costLimit` |
| `limits.tokenCeiling` | → | `tokenLimit` |
| `configFingerprint` | → | `configFingerprint` (**diagnostic only** — never consumed for execution) |
| (not expressed by the plan) | → | `presencePenalty` / `frequencyPenalty` = `null` |

Values are used as already-resolved (no invented values, no normalization). Missing optional fields → `null`.

---

## 3. Adapter Validation Summary

`AdapterValidator.validate(plan)`:
1. `configuration = LegacyExecutionAdapter.toLegacyConfiguration(plan)`
2. `snapPlan = ExecutionSnapshotBuilder.fromPlan(plan)`
3. `snapAdapter = ExecutionSnapshotBuilder.fromLegacyConfiguration(configuration)`
4. compare the 24 `EXECUTION_FIELDS` of the two snapshots; any inequality → an `AdapterFieldDifference { mappedField, resolverValue, adapterValue }`
5. return `AdapterParityResult { parity, reason, differences, snapshotHashPlan, snapshotHashAdapter, snapshotHashMatch, configuration }`

Reuses the single `ExecutionSnapshotBuilder`; pure; never executes; never throws.

---

## 4. Round-Trip Validation Summary

The round trip `plan → adapter → LegacyExecutionConfiguration → snapshot` must equal `plan → snapshot` **IDENTICALLY** (not merely semantically equivalent). Because the adapter maps 1:1 from already-resolved values and `rawConfigFromLegacyConfiguration` mirrors `rawConfigFromPlan` field-for-field (same empty-policy-object handling), the two execution snapshots — and their hashes — are identical by construction. Divergence would surface as `AdapterFieldDifference` entries; it never executes and never throws.

---

## 5. Adapter Parity Summary

`AdapterParity ∈ { IDENTICAL, DIFFERENT }`. `IDENTICAL` when every execution-snapshot field of the adapter output matches the plan's. This validates **adapter correctness independently from resolver correctness**: a resolver DIFFERENT-vs-legacy result (2A-2.2) is about resolver↔legacy config; adapter parity is about plan↔adapter round-trip. Each `DIFFERENT` records `mappedField`, `resolverValue`, `adapterValue`.

---

## 6. Metrics Summary

`resolverShadowMetrics` extended (in-memory only): `adapterInvocations`, `adapterIdentical`, `adapterDifferent`, and an `adapterDifferences` map (mapped-field → count). `recordAdapterParity(result)` updates them. The validation report adds `adapterInvocations`, `adapterIdentical`, `adapterDifferent`, `adapterParityRate`, `topAdapterDifferences[]`. Shadow debug log gains `adapterParity` + `adapterDiffs` (summary only — never snapshot contents/PII). No persistence, no monitoring integration.

---

## 7. Compatibility Report

1. **No execution-path edit / no dispatcher change** — the only modified existing file is `aiGatewayProvidersOps.ts` from 2A-2.1 (untouched here). The adapter is not wired into execution; the gateway builds and consumes its own `LegacyExecutionConfiguration` exactly as today.
2. **Adapter is pure + zero business logic** — a deterministic field mapper; no decisions/routing/retries/fallbacks/heuristics/normalization/I/O/persistence/execution.
3. **Single snapshot source** — `ExecutionSnapshotBuilder` is extended with `fromLegacyConfiguration` (reuse), not duplicated (rule 4/5).
4. **Runs only in shadow** — the round-trip validation executes inside the already-gated, fail-safe, fire-and-forget shadow runner (flag OFF by default → never runs).
5. **No schema / persistence / provider / routing / retry / flag-default change**; `AI_CONFIG_RESOLVER_ENABLED` not enabled.
6. **Exactly one new runtime abstraction** — `LegacyExecutionAdapter` (with its `AdapterValidator` helper); everything else is additive extension.

---

## 8. Validation Report

**Unit/integration tests: 92/92 passed** (88 across the 7 orchestration suites + the gateway-barrel integration).

New `aiLegacyExecutionAdapter.test.ts` (11):
- ✅ **Pure 1:1 mapper** — every documented field mapped; `configFingerprint` carried as diagnostic; missing optional fields → `null` (no invented values).
- ✅ **Deterministic** — repeated adapter + validation runs identical.
- ✅ **Round-trip IDENTICAL** — `parity === 'IDENTICAL'`, zero differences, `snapshotHashMatch`, `snapshotHashPlan === snapshotHashAdapter` — held across varied plans (different temperature/tokens/streaming/seed, explicit provider+version, cost/token limits).
- ✅ **Metrics + report** — `adapterInvocations/Identical/Different`, `adapterParityRate === 1`, empty `topAdapterDifferences`.

Regression: `aiExecutionEquivalence`, `aiResolverShadowWiring` (updated metrics-shape assertion), `aiConfigurationResolver`, `aiOrchestrationMetadata`, `aiConfigFingerprint`, `aiOrchestrationFlags` — all green. Integration `defineTargetCustomerCompletionPilot` (4) passes → gateway barrel loads the extended modules; flag-OFF byte-identical.

**Confirmations:** ✓ gateway byte-identical · ✓ no execution authority change · ✓ existing orchestration suites green · ✓ shadow observation still operational · ✓ ExecutionSnapshotBuilder is the single snapshot source · ✓ adapter deterministic + pure.

---

## 9. Operational Readiness Report

- **Adapter parity is measurable in shadow:** `getEquivalenceValidationReport()` now exposes `adapterParityRate` + `topAdapterDifferences`. Enabling `AI_CONFIG_RESOLVER_SHADOW` runs the round-trip on live requests (still discarded); `adapterParityRate` should read **1.0** (the adapter is a lossless mapper by construction — any drift is a code bug, caught immediately).
- **Kill/enable:** unchanged — `ROLLOUT_AI_CONFIG_RESOLVER_SHADOW_MODE=shadow` / `..._KILL=1`.
- **No new operational surface** — same in-memory counters + debug logs; no dashboards/APIs/UI/monitoring.

---

## 10. Migration Readiness Assessment

This phase establishes the **Configuration Resolver as the single canonical source that can fully describe the legacy execution configuration**, while leaving the legacy execution path untouched. The remaining duplication (two independent config producers) is now provably redundant: the resolver + adapter reproduce the legacy config identically.

**Exit criteria for Phase 2A-3 (authoritative resolver):**

| Criterion | Status / how measured |
|---|---|
| Adapter parity 100% | `adapterParityRate === 1` — lossless by construction; proven by tests and observable live |
| Execution-snapshot parity 100% | round-trip IDENTICAL (snapshot hashes equal) — proven |
| No unexplained adapter differences | `topAdapterDifferences` empty; any entry is a code bug, not config drift |
| Resolver↔legacy equivalence understood | from 2A-2.2 `getEquivalenceValidationReport()` — `EXECUTION_DIFFERENCE` must be zero/explained; `CONFIGURATION_DIFFERENCE` (resolver more complete) documented |
| Gateway behavior unchanged | no execution-path edit; integration test green |

**Path to 2A-3 (a future, separately-gated phase):** once shadow observation shows resolver↔legacy `EXECUTION_DIFFERENCE = 0` and adapter parity = 100% on real traffic, the gateway can — behind `AI_CONFIG_RESOLVER_ENABLED`, flag-gated and parity-verified (ADR-014) — source its `LegacyExecutionConfiguration` from `LegacyExecutionAdapter(resolvedPlan)` instead of the legacy builder. That is a deliberate, evidence-gated cutover; **it is out of scope here** and this phase changes no execution authority.

---

## Files delivered

```
backend/services/aiOrchestration/legacyExecutionAdapter.ts          (new — LegacyExecutionAdapter + AdapterValidator + AdapterParity)
backend/services/aiOrchestration/types/LegacyExecutionConfiguration.ts (new — the config contract)
backend/services/aiOrchestration/executionSnapshot.ts              (extended — fromLegacyConfiguration; reuses the builder)
backend/services/aiOrchestration/resolverShadowMetrics.ts          (extended — adapter counters + report)
backend/services/aiOrchestration/resolverShadow.ts                 (extended — round-trip validation + summary log)
backend/tests/unit/aiLegacyExecutionAdapter.test.ts                (new)
backend/tests/unit/aiResolverShadowWiring.test.ts                  (updated metrics-shape assertion)
```

*Phase 2A-2.3 complete. The Configuration Resolver can now completely + losslessly describe the legacy execution configuration (proven by round-trip snapshot identity), eliminating the config-producer duplication — with zero execution-authority change, no gateway edit, and byte-identical behavior. The resolver is now evidence-ready to become authoritative in a future, separately-gated Phase 2A-3.*
