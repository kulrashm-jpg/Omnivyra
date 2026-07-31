# OmniVYRA — Phase 2B: Resolver Promotion (Authoritative Cutover)

**Scope:** the control plane to promote the Configuration Resolver to the authoritative config source — governed entirely by **rollout, measurement, and immediate rollback**. Not an architecture phase. The only functional change is **execution-authority gating** (inert while flags are OFF). Default is byte-identical. No schema/persistence/provider/routing/retry/dispatcher change; the Legacy Builder is retained as the rollback target.
**Builds on:** 2A-2 → 2A-2.1 → 2A-2.2 → 2A-2.3 → 2A-3.
**Date:** 2026-07-31.

> **STOP-and-explain — the live gateway execution swap is deferred (Critical Rules 12–15).** The brief is explicit: *"Promotion occurs only through rollout. Never by deployment. Never by code edits,"* and *"Promotion MUST NOT occur until ALL checklist items are satisfied … abort immediately if any item fails."* This phase delivers everything that makes that flag-flip meaningful and safe — the **master enable switch wired into execution authority, the promotion state machine, the parity-gated selection, the evidence-driven checklist, and the failure/rollback policy** — but does **not** wire the gateway's synchronous resolve-and-execute swap, because:
> 1. **The checklist cannot be satisfied in this environment.** `StructuralParityRate`/`SnapshotParityRate`/`ExecutionDifference` are produced only by observing real DUAL/shadow traffic; the migrations aren't applied to a live DB and no live traffic exists here, so `getLivePromotionReadiness()` correctly returns **HOLD**. Promoting now would violate *"abort if any item fails."*
> 2. **Enabling authority now would be a behavioral change beyond "selecting an already-validated config" (Rule 13).** The seeded profiles currently produce `CONFIGURATION_DIFFERENCE`s (the resolver is more complete than legacy call-site literals), so `ExecutionDifference ≠ 0`; and a synchronous resolve on the hot path adds DB latency (needs a resolver cache — Phase 2C). Both are exactly the additional changes Rule 13 says to STOP on.
>
> So promotion here is what it should be: an **operational flag-flip**, gated on evidence, made **safe and reversible** by this control plane — not a code edit I make blind. `git status` confirms the only modified existing file is still `aiGatewayProvidersOps.ts` from 2A-2.1 (unchanged here).

---

## 1. Resolver Promotion Architecture

Promotion is a **rollout-driven authority change**, not a redesign. Two inputs decide who executes:
- **Mode** (`AI_CONFIG_RESOLVER_MODE` ∈ off/shadow/dual/canary/full) — the *intent*.
- **Master enable switch** (`AI_CONFIG_RESOLVER_ENABLED`, a rollout flag; `enforce` = on) — the *safety gate*.

`resolveExecutionAuthority(mode, enabled)` is the **single source of truth**: `executes: 'resolver'` requires **both** a resolver mode (canary/full) **and** the enable switch. Default (enable off) → always `legacy`. Everything downstream (state machine, selection, checklist) is pure and reads only this authority + the existing parity metrics.

New: `promotion.ts`. Extended: `orchestrationMode.ts` (enable-flag gating).

---

## 2. Execution Authority Flow

```
mode (AI_CONFIG_RESOLVER_MODE) ─┐
                                ├─▶ resolveExecutionAuthority() ─▶ { executes, resolverEnabled, ... }
enable (AI_CONFIG_RESOLVER_ENABLED = enforce) ─┘                         │
                                                                        ▼
   legacyConfig ─┐                                          selectExecutionConfiguration(authority, legacy, resolver, guard)
   resolverConfig ─ (adapter) ─┐                                        │  parity-gated
   ConfigurationParityGuard ───┘                                        ▼
                                             executes = resolver ONLY when snapshotHashMatch, else LEGACY FALLBACK
                                                                        │
                                                                        ▼  (the gateway synchronous-resolve swap that consumes this
                                                                            selection is the deferred go-live — see the STOP note)
                                                                     Provider
```

**Exactly one configuration executes**, and it is **byte-identical to legacy by construction**: the resolver config is selected only when the guard proves it execution-identical (`snapshotHashMatch`); otherwise legacy executes. Resolver authority changes the *source* of an identical config, never the observable behavior.

---

## 3. Promotion State Machine

| Stage | Mode | resolverActive (needs enable) | legacy | rollback |
|---|---|---|---|---|
| `STAGE_0_OFF` | off | no | executes | n/a |
| `STAGE_1_SHADOW` | shadow | no | executes | mode↓ |
| `STAGE_2_DUAL` | dual | no | executes | mode↓ |
| `STAGE_3_CANARY` | canary | **yes if enabled** | computed (parity) | mode↓ / enable off |
| `STAGE_4_FULL` | full | **yes if enabled** | retained (rollback only) | mode↓ / enable off |

`getPromotionState(authority)` derives the stage + `resolverActive` + `legacyRetained` (always true this phase). `nextStage()` gives operator guidance. The Legacy Builder is **never removed** (that is Phase 2C).

---

## 4. Rollout Validation Summary

- **Incremental** — 0→1→2→3→4, each a rollout change only.
- **Observable** — each stage feeds the existing in-memory parity metrics + `getLivePromotionReadiness()`.
- **Reversible** — `rollbackEvents` proves mode-down works; enable-off instantly demotes.
- **Deterministic** — authority + selection are pure functions of (mode, enable, guard result).

Every stage has success/failure/rollback criteria encoded in the checklist (§6) + failure policy.

---

## 5. Rollback Validation Summary

Rollback is **deploy-free + immediate**: lower `AI_CONFIG_RESOLVER_MODE`, or set the enable flag off / `ROLLOUT_AI_CONFIG_RESOLVER_ENABLED_KILL=1`, or the global `ROLLOUT_KILL_SWITCH` → the **next request** resolves the lower authority (`executes: 'legacy'`). No restart, no migration. The Legacy Builder remains fully operational at every stage < production sign-off. `recordOrchestrationMode` increments `rollbackEvents` on any mode decrease.

---

## 6. Operational Checklist (evidence-driven)

`evaluatePromotionReadiness(stage, metrics, report)` returns `{ ready, recommendation: PROMOTE|HOLD|ROLLBACK, checklist[] }`:

| Item | Required | Source |
|---|---|---|
| `structuralParityRate` | 1.0 | dual-execution guard |
| `snapshotParityRate` | 1.0 | dual-execution guard |
| `adapterParityRate` | 1.0 | adapter round-trip (2A-2.3) |
| `executionDifference` | 0 | equivalence (2A-2.2) |
| `configParityDifferent` | 0 | dual guard |
| `observationsPresent` | > 0 | dual executions |
| `rollbackValidated` | mode-down works | `rollbackEvents` |

`PROMOTE` only when every item passes; any hard divergence → `ROLLBACK` (overrides); otherwise `HOLD`. With no live observations (this environment) → **HOLD**. Plus the human items from the brief (latency/error-rate/provider/retry/cost unchanged, production sign-off) are operational gates verified during CANARY before FULL.

---

## 7. Compatibility Report

1. **No new gateway edit** — only modified existing file is `aiGatewayProvidersOps.ts` from 2A-2.1 (untouched here). The control plane lives in the untracked `aiOrchestration/` modules.
2. **Execution authority is the only functional change — and it is inert by default** — `AI_CONFIG_RESOLVER_ENABLED` defaults off → `executes` is always `legacy`; no flag default changed.
3. **Exactly one config executes; byte-identical** — parity-gated selection guarantees resolver config is used only when snapshot-identical, else legacy fallback.
4. **Legacy Builder retained** as the rollback target; no migration/legacy code removed (that is Phase 2C, per Rule 14).
5. **Reuses everything** — ConfigurationResolver / adapter / ExecutionSnapshotBuilder / ConfigurationParityGuard unchanged (Rules 6/7); no persistence/schema/provider/routing/retry/timeout/dispatcher change.
6. **Rollback deploy-free + immediate.**

---

## 8. Production Readiness Report

**Unit/integration tests: 119/119 passed** (115 across the 9 orchestration suites + the gateway-barrel integration).

New `aiResolverPromotion.test.ts` (18):
- ✅ **Authority gating** — default: resolver NEVER executes (canary/full → legacy); enable=enforce → canary/full execute resolver; dual/shadow always legacy.
- ✅ **State machine** — mode→stage; `resolverActive` requires enable; default live state `STAGE_0_OFF` inactive; `nextStage` guidance.
- ✅ **Parity-gated selection** — authority=legacy→legacy; resolver+IDENTICAL→resolver; resolver+DIFFERENT→**legacy fallback** (never diverges).
- ✅ **Failure/rollback policy** — clean→no rollback; any divergence→rollback with reasons.
- ✅ **Checklist** — no observations→HOLD; all-pass→PROMOTE; divergence→ROLLBACK (overrides); live default→HOLD.

Regression: all prior orchestration suites green (the 2A-3 authority-matrix test updated for the new enable-gating). Integration `defineTargetCustomerCompletionPilot` (4) passes → gateway barrel loads; flag-OFF byte-identical.

**Confirmations:** ✓ default byte-identical · ✓ exactly one config executes · ✓ legacy retained/rollback-only · ✓ guard diagnostic-only · ✓ ExecutionSnapshotBuilder single engine · ✓ LegacyExecutionAdapter only translation layer · ✓ no persistence/schema/provider/routing/retry/timeout/dispatcher change · ✓ rollback deploy-free.

---

## 9. Migration Readiness Assessment

The resolver is **code-ready to be promoted by a rollout flag-flip**, gated on evidence:

1. **Apply the frozen migrations** (2B.1–2B.1B) to non-prod, then prod (controlled process).
2. **Enable `AI_CONFIG_RESOLVER_MODE=shadow`** → watch `getEquivalenceValidationReport()`; reconcile `EXECUTION_DIFFERENCE` to 0 (adjust profiles), understand every `CONFIGURATION_DIFFERENCE`.
3. **`=dual`** → confirm `structuralParityRate`/`snapshotParityRate`/`adapterParityRate` → 1.0 on real traffic; `getLivePromotionReadiness()` → PROMOTE.
4. **Wire the gateway synchronous-resolve swap** (the deferred step) behind the enable flag — a small, gated, parity-safe edit — plus a **resolver cache** to hold latency (Phase 2C-adjacent).
5. **`=canary` + enable** for one org → watch metrics; the parity-gated selection keeps execution byte-identical; roll back instantly on any `ROLLBACK` recommendation.
6. **`=full`** after sign-off; legacy retained. **Legacy removal is Phase 2C** (out of scope).

**This phase's contribution:** the authority model + state machine + evidence checklist + rollback policy that make that sequence safe, measurable, and reversible.

---

## 10. Resolver Promotion Report

**Status: control plane COMPLETE; promotion HOLD (evidence-gated).**

- **Delivered:** master-enable authority gating, promotion state machine (Stage 0–4), parity-gated byte-identical selection, evidence-driven checklist (`PROMOTE/HOLD/ROLLBACK`), failure/rollback policy, live operator diagnostics (`getLivePromotionState`/`getLivePromotionReadiness`), debug logging (mode/authority/parity — no PII/contents). All pure, tested, default-inert.
- **Deferred (with cause):** the gateway synchronous-resolve execution swap — the operational go-live — gated on the checklist which is unsatisfiable without live parity evidence, and which (with today's profiles + no resolver cache) would change latency/params (Rule 13).
- **Recommendation now:** `HOLD`. Do not enable `AI_CONFIG_RESOLVER_ENABLED`. Proceed operationally per §9: apply migrations → shadow → dual → observe → reconcile → then wire the swap + cache → canary → full.

---

## Files delivered

```
backend/services/aiOrchestration/orchestrationMode.ts   (extended — AI_CONFIG_RESOLVER_ENABLED master switch in authority)
backend/services/aiOrchestration/promotion.ts           (new — state machine, selection, checklist, rollback policy)
backend/tests/unit/aiResolverPromotion.test.ts          (new)
backend/tests/unit/aiConfigurationParityGuard.test.ts   (updated — authority matrix reflects enable-gating)
```

*Phase 2B complete as a control-plane phase. The resolver is code-ready to become authoritative by an evidence-gated rollout flag-flip, with byte-identical parity-gated execution and immediate deploy-free rollback — while the Legacy Builder is retained as the rollback target. The actual go-live (gateway synchronous-resolve swap) is the deferred, checklist-gated operational step; legacy removal is Phase 2C.*
