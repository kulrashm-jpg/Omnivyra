# OmniVYRA — Phase 2A-3: Dual Execution Validation

**Scope:** validate that the configuration the gateway ACTUALLY executes is structurally + semantically identical to the resolver's configuration, across rollout modes — **without making the resolver authoritative**. Execution authority is controlled by rollout; default (`off`) is byte-identical to today. No schema/persistence/provider/routing/retry/dispatcher change; no new gateway edit.
**Builds on:** 2A-2 → 2A-2.1 → 2A-2.2 → 2A-2.3.
**Date:** 2026-07-31.

> **STOP-and-explain — the live CANARY execution swap is deferred (Critical Rules 14 & 15).** DUAL is fully implemented (legacy executes; parity validated). CANARY *infrastructure* (mode, authority, guard, metrics) is implemented, but the **live execution swap** — making the gateway actually execute the resolver's config — is **not wired this phase**, because it (a) requires making resolution **synchronous on the request path** (the current hook is fire-and-forget) and (b) **intentionally changes provider params** on requests where the profile differs from the legacy call-site literals (the documented `CONFIGURATION_DIFFERENCE` from 2A-2.2). Per Rule 14 (STOP if CANARY requires modifying provider behavior rather than selecting an already-identical config) and Rule 15 (prove safety *before* authoritative), the swap must not go live until DUAL/shadow shows `EXECUTION_DIFFERENCE = 0` on real traffic — not observable in this environment. So this phase delivers the validation machinery + the CANARY authority model; the gateway continues to execute the legacy configuration. `git status` confirms the only modified existing file is still `aiGatewayProvidersOps.ts` from 2A-2.1 (unchanged here).

---

## 1. ConfigurationParityGuard Architecture

`ConfigurationParityGuard.compare(executed, resolver)` — the ONE new runtime abstraction: a **pure, side-effect-free** comparator of two `LegacyExecutionConfiguration`s (the one the gateway executed vs the one the resolver produced via `LegacyExecutionAdapter`). It never modifies either config, never retries, persists, throws, or influences execution. It reuses the single `ExecutionSnapshotBuilder` (no second snapshot impl).

New files: `configurationParityGuard.ts`, `orchestrationMode.ts`.

---

## 2. Dual Execution Flow

```
Legacy Builder ─▶ LegacyExecutionConfiguration (EXECUTED) ──┐
                                                            ▼
                                              ConfigurationParityGuard ─▶ ParityResult (validation only)
                                                            ▲
Resolver ─▶ ResolvedExecutionPlan ─▶ LegacyExecutionAdapter ─▶ LegacyExecutionConfiguration (resolver)
```
The gateway executes **exactly one** configuration (the legacy one, in every mode this phase ships). The second exists only for validation, computed fire-and-forget in the existing 2A-2.1 hook (now mode-aware) — so DUAL adds no request latency and no new gateway edit.

---

## 3. Execution Authority Matrix

| Mode | executes | buildResolver | validateParity | canary | live this phase |
|---|---|---|---|---|---|
| `off` (default) | legacy | no | no | no | ✅ (byte-identical) |
| `shadow` | legacy | yes | no (equivalence only) | no | ✅ (2A-2.1/2/3) |
| `dual` | legacy | yes | **yes (guard)** | no | ✅ |
| `canary` | **resolver** | yes | yes | yes | ⏸ infra only — live swap **deferred** |
| `full` | resolver | yes | yes | — | ❌ out of scope |

`resolveExecutionAuthority(mode)` is the single pure source of truth for "who executes". For `canary`/`full` it reports `executes: 'resolver'`, but the gateway execution swap is not wired (see the STOP note); the executor remains legacy.

---

## 4. Rollout Strategy Summary

Modes are controlled by `AI_CONFIG_RESOLVER_MODE` ∈ `off|shadow|dual|canary|full` (default **off** → byte-identical). When unset, it falls back to the existing `AI_CONFIG_RESOLVER_SHADOW` rollout flag (off→off, else→shadow) — **no flag default changed**. Resolution is pure and fail-safe (→`off` on error).

**Rollback is immediate + deploy-free:** change `AI_CONFIG_RESOLVER_MODE` (or the rollout override / `..._KILL`) → the next request resolves the lower mode. The metrics track `rollbackEvents` (mode decreasing). No restart, no migration.

---

## 5. Parity Validation Summary

The guard performs, per execution field: structural comparison, `ExecutionSnapshot` comparison, snapshot-**hash** comparison, configuration-**fingerprint** comparison, field-coverage, and returns a 3-level verdict:

| `ConfigurationParity` | Meaning |
|---|---|
| `IDENTICAL` | raw + normalized identical on every execution field |
| `SEMANTICALLY_EQUIVALENT` | normalized identical (hashes match), some raw representations differ |
| `DIFFERENT` | a normalized execution field differs |

Each difference carries `mappedField`, `executedValue`, `resolverValue`, `category` (`EXECUTION_/CONFIGURATION_/NORMALIZATION_DIFFERENCE`), and `reason`. Plus `structuralMatch`, `snapshotHashMatch`, `fingerprintMatch`, `fieldCoverage`. Never modifies either configuration.

---

## 6. Fingerprint Validation Summary

The guard compares `configFingerprint` between the executed and resolver configurations and reports `fingerprintMatch` — **diagnostic only**. The legacy executed config carries no fingerprint (the gateway does not compute one today), so `fingerprintMatch` is expected `false` until the resolver is the config source; this is surfaced as a diagnostic and **never produces an execution failure** (Rule: differences → diagnostics, never failures).

---

## 7. Metrics Summary

`resolverShadowMetrics` extended (in-memory only): `dualExecutions`, `legacyExecutions`, `resolverExecutions`, `canaryExecutions`, `structuralParity`, `snapshotParity`, `fingerprintParity`, `configParityDifferent`, `rollbackEvents`, plus the difference-category map. `recordDualExecution(result, executes, canary)` + `recordOrchestrationMode(mode)` (rollback detection). The validation report adds `dualExecutions`, `legacy/resolver/canaryExecutions`, `structural/snapshot/fingerprintParityRate`, `rollbackEvents`. Debug log gains `mode`, `authority`, `configParity` (summary only — never prompts/outputs/PII/snapshot contents). No persistence, no monitoring integration.

---

## 8. Compatibility Report

1. **No new gateway edit** — the only modified existing file is `aiGatewayProvidersOps.ts` from 2A-2.1 (untouched here). DUAL validation runs through that existing fire-and-forget hook, now mode-aware in the (untracked) shadow module.
2. **Exactly one new runtime abstraction** — `ConfigurationParityGuard` (pure). The mode/authority resolvers are pure helpers; the adapter/resolver/snapshot builder are reused unchanged.
3. **Gateway executes exactly one config** — the legacy one, every mode this phase ships. The resolver config is validation-only.
4. **Default byte-identical** — `AI_CONFIG_RESOLVER_MODE` defaults `off`; no flag default changed; DUAL adds no latency (fire-and-forget) and no new DB calls on the OFF path.
5. **Immediate deploy-free rollback** — mode change takes effect next request.
6. **No schema / persistence / provider / routing / retry / dispatcher change**; `AI_CONFIG_RESOLVER_ENABLED` not enabled; FULL out of scope.

---

## 9. Validation Report

**Unit/integration tests: 105/105 passed** (101 across the 8 orchestration suites + the gateway-barrel integration).

New `aiConfigurationParityGuard.test.ts` (14):
- ✅ **Guard 3-level** — IDENTICAL; provider-alias → SEMANTICALLY_EQUIVALENT; temperature → DIFFERENT (EXECUTION); one-side-unset → DIFFERENT + `structuralMatch=false` (CONFIGURATION); fingerprint match diagnostic; deterministic.
- ✅ **Mode + authority** — default `off`; env selects mode; authority matrix (dual=legacy/validate, canary=resolver/canary, full=resolver); fallback to the shadow flag.
- ✅ **Dual metrics + rollback** — `recordDualExecution` counts parity + execution source; `snapshotParityRate`; rollback increments when the mode decreases.
- ✅ **DUAL hook flow** — `AI_CONFIG_RESOLVER_MODE=dual`: hook builds both, **legacy remains the executor** (`legacyExecutions=1`, `resolverExecutions=0`), guard validates (`dualExecutions=1`).

Regression: `aiLegacyExecutionAdapter`, `aiExecutionEquivalence`, `aiResolverShadowWiring` (updated metrics-shape assertion), `aiConfigurationResolver`, `aiOrchestrationMetadata`, `aiConfigFingerprint`, `aiOrchestrationFlags` — all green. Integration `defineTargetCustomerCompletionPilot` (4) passes → gateway barrel loads the extended modules; flag-OFF byte-identical.

**Confirmations:** ✓ gateway byte-identical (default) · ✓ exactly one config executed · ✓ second config validation-only · ✓ authority controlled by rollout · ✓ rollback immediate/deploy-free · ✓ ExecutionSnapshotBuilder single source · ✓ no schema/persistence/provider/routing/retry change · ✓ guard pure/side-effect-free.

---

## 10. Production Rollout Readiness Assessment

**Exit criteria before FULL (a future, separately-gated phase) — measured, not assumed:**

| Criterion | How measured |
|---|---|
| Structural parity 100% | `getEquivalenceValidationReport().structuralParityRate === 1` under DUAL on real traffic |
| Snapshot parity 100% | `snapshotParityRate === 1` (executed vs resolver execution snapshots) |
| Fingerprint parity | `fingerprintParityRate` — diagnostic; becomes 1 once the resolver is the config source |
| No unexplained DIFFERENT | `configParityDifferent` with the difference-category map — every `EXECUTION_DIFFERENCE` explained; `CONFIGURATION_DIFFERENCE` (resolver more complete) documented |
| Successful CANARY observation | requires the live CANARY swap (deferred here) once DUAL parity is clean |
| Rollback validated | `rollbackEvents` proves mode-down is immediate |
| Gateway behavior stable | no execution-path edit; integration test green |

**Recommended rollout (operational, once live):**
1. Enable `AI_CONFIG_RESOLVER_MODE=dual` in non-prod → confirm `structuralParityRate`/`snapshotParityRate` → 1 and the only `DIFFERENT`s are understood `CONFIGURATION_DIFFERENCE`s.
2. Reconcile any `EXECUTION_DIFFERENCE` (adjust profile params to match legacy where intended) until zero.
3. **Then** — in a separately-gated change — wire the CANARY execution swap (synchronous resolution + select the resolver config) behind `canary`, canary a single org, watch metrics, roll back instantly if needed.
4. FULL (resolver authoritative, legacy retained for rollback) is the final, separate phase.

**This phase's contribution:** the evidence instrument + the authority/rollback model that make that cutover safe and measurable. It changes no execution authority.

---

## Files delivered

```
backend/services/aiOrchestration/configurationParityGuard.ts        (new — ConfigurationParityGuard)
backend/services/aiOrchestration/orchestrationMode.ts               (new — modes + execution authority)
backend/services/aiOrchestration/resolverShadowMetrics.ts           (extended — dual/canary/rollback counters + report)
backend/services/aiOrchestration/resolverShadow.ts                  (extended — mode-aware; DUAL guard validation)
backend/tests/unit/aiConfigurationParityGuard.test.ts               (new)
backend/tests/unit/aiResolverShadowWiring.test.ts                   (updated metrics-shape assertion)
```

*Phase 2A-3 complete. Dual execution validation is live in DUAL mode (legacy executes; the ConfigurationParityGuard validates the executed config against the resolver's), with a pure rollout-mode authority model and immediate deploy-free rollback — and zero execution-authority change. The live CANARY execution swap is deliberately deferred (STOP-and-explain) until DUAL parity is proven on real traffic. The resolver is now one measured, reversible step from authoritative promotion (FULL).*
