# OmniVYRA — Phase 3A: Operational Validation & Go-Live (Production Rollout Runbook)

**Type:** OPERATIONAL RUNBOOK — not a software implementation. No code, architecture, resolver, gateway, provider, schema, or persistence change (Critical Rules 1, 7, 15). This document governs the evidence-driven rollout of the (feature-complete) AI Orchestration platform.
**Grounded in:** the artifacts built across 2B.1 → 2C. **Date:** 2026-07-31.

> **Two honesty notes, up front.**
> 1. **The live-observation reports are templates, not results.** Deliverables 3–6, 8, 9 depend on real production/non-prod traffic. This environment has no reachable non-prod DB and no running app, and the frozen migrations are not applied here. So every "observed metric" field below is marked **`TBD — populate from live observation`**; the reports ship as *executable procedures* (exact flags + getters + exit criteria), never as fabricated numbers.
> 2. **One engineering prerequisite precedes Phase 3D (CANARY execution).** The gateway *synchronous-resolve execution swap* — the code that makes the gateway actually consume `ResolverCache.get(...) → LegacyExecutionAdapter` when authority is `resolver` — was deliberately deferred (2B §9 step 4 / 2C §10), because enabling it is a behavioral change that must not go live without parity evidence. **It is a small, gated, parity-safe engineering task that must be completed + reviewed before CANARY can execute the resolver config.** SHADOW (3B) and DUAL (3C) need no such change — they run through the existing 2A-2.1 fire-and-forget hook. This runbook flags that prerequisite at the 3C→3D boundary rather than treating CANARY as purely operational.

---

## Control surface (the exact levers)

| Lever | Value / command | Effect |
|---|---|---|
| Mode | `AI_CONFIG_RESOLVER_MODE` = `off`\|`shadow`\|`dual`\|`canary`\|`full` | Sets orchestration stage. Default (unset) → `off`. |
| Master enable | `ROLLOUT_AI_CONFIG_RESOLVER_ENABLED_MODE=enforce` (rollout flag `ai-config-resolver-enabled`) | The safety switch; resolver executes ONLY when mode∈{canary,full} AND this is on. |
| Per-flag kill | `ROLLOUT_AI_CONFIG_RESOLVER_ENABLED_KILL=1` | Forces enable OFF instantly. |
| Global kill | `ROLLOUT_KILL_SWITCH=1` | Forces every rollout flag OFF. |
| Rollback | lower `AI_CONFIG_RESOLVER_MODE`, or enable OFF/kill | Next request → `executes: 'legacy'`. Deploy-free. |

| Live diagnostic (in-memory getters) | Source |
|---|---|
| `getLivePromotionState()` → stage, resolverActive | `promotion.ts` |
| `getLivePromotionReadiness()` → `{ ready, recommendation: PROMOTE\|HOLD\|ROLLBACK, checklist[] }` | `promotion.ts` |
| `getResolverShadowMetrics()` → parity/dual/rollback counters | `resolverShadowMetrics.ts` |
| `getEquivalenceValidationReport()` → parity rates + top diffs | `resolverShadowMetrics.ts` |
| `resolverCache.getMetrics()` → hit/miss/latency/fallback | `resolverCache.ts` |

*All getters are in-memory, per-process, debug-surface only (no persistence). Aggregate across replicas at the ops layer.*

---

## Deliverable 1 — Production Readiness Checklist

### Infrastructure
- ☐ Database migrations applied (2B.1 `…foundation/extensions/seed`, 2B.1A `…resolution_reason/config_fingerprint`, 2B.1B `…version_separation/decision_catalog`) — controlled process, non-prod first.
- ☐ Config tables populated: `llm_providers`/`llm_models`(+family/versions), `ai_execution_profiles`(+versions, fingerprints), `ai_capability_profile_bindings`, `ai_routing_policies`, `ai_operation_capability_map`, `ai_config_versions`.
- ☐ Active execution profiles exist (10 seeded; `active_version_id` set; fingerprints backfilled).
- ☐ Provider/model bindings complete; routing policies active (if any).
- ☐ `RESOLVER_VERSION` / `RESOLUTION_TRACE_VERSION` synchronized across replicas.
- ☐ Configuration generation (`ai_config_versions.version`) correct + readable.

### Cache
- ☐ `ResolverCache` initialized; ☐ warm-up successful (non-blocking); ☐ `getMetrics()` operational; ☐ manual + generation invalidation verified in staging.

### Rollout flags
- ☐ `AI_CONFIG_RESOLVER_MODE` recognizes off/shadow/dual/canary/full; ☐ `AI_CONFIG_RESOLVER_ENABLED` present; ☐ kill switches verified; ☐ mode-down rollback verified.

### Monitoring
- ☐ All of: StructuralParityRate, SnapshotParityRate, AdapterParityRate, ExecutionDifference, ConfigurationDifference, CacheHitRate, ResolverLatency, FallbackCount, RollbackEvents, ExecutionAuthority, PromotionState — surfaced from the getters above and aggregated cross-replica.

**Gate:** every box checked before ANY rollout flag is enabled.

---

## Deliverable 2 — Environment Validation Report (template)

| Check | Command / getter | Expected | Result |
|---|---|---|---|
| Migrations applied | migration tool status | all 2B.1x present | `TBD` |
| Profiles active | `SELECT count(*) FROM ai_execution_profiles WHERE active_version_id IS NOT NULL` | ≥ 10 | `TBD` |
| Fingerprints backfilled | `SELECT count(*) FROM ai_execution_profile_versions WHERE config_fingerprint IS NOT NULL` | 10 | `TBD` |
| Bindings present | `SELECT count(*) FROM ai_capability_profile_bindings WHERE is_active` | ≥ 17 | `TBD` |
| Op map present | `SELECT count(*) FROM ai_operation_capability_map` | ≥ 54 | `TBD` |
| Config generation readable | `SELECT max(version) FROM ai_config_versions` | ≥ 1 | `TBD` |
| Cache warm-up | `resolverCache.getMetrics()` after `warm()` | size > 0, warmups > 0 | `TBD` |
| Flags default OFF | `getLivePromotionState()` | STAGE_0_OFF, resolverActive=false | `TBD` |

Sign: Engineering ▢  Operations ▢.

---

## Deliverable 3 — Shadow Observation Report (Phase 3B; template)

**Enable:** `AI_CONFIG_RESOLVER_MODE=shadow`. Resolver non-authoritative; **no production behavior changes** (fire-and-forget hook). Observe ≥ the operational minimum window.

| Metric | Getter | Result |
|---|---|---|
| ExecutionDifference | `getResolverShadowMetrics().executionDifferences` | `TBD` |
| Top difference categories | `getEquivalenceValidationReport().topDifferenceCategories` | `TBD` |
| Resolver latency (shadow) | ops timing | `TBD` |
| Cache hit rate | `resolverCache.getMetrics().hitRate` | `TBD` |
| Resolver failures | `getResolverShadowMetrics().failure` | `TBD` |

**Exit criteria (Rule 3 — all required):** ☐ `ExecutionDifference == 0` · ☐ every `ConfigurationDifference` documented (resolver-more-complete cases expected) · ☐ resolver deterministic · ☐ no unexpected failures · ☐ rollback verified (mode→off). **Do not advance until met.**

---

## Deliverable 4 — Dual Validation Report (Phase 3C; template)

**Enable:** `AI_CONFIG_RESOLVER_MODE=dual`. Legacy executes; `ConfigurationParityGuard` validates executed-vs-resolver.

| Metric | Getter | Result |
|---|---|---|
| StructuralParityRate | `getEquivalenceValidationReport().structuralParityRate` | `TBD` |
| SnapshotParityRate | `.snapshotParityRate` | `TBD` |
| AdapterParityRate | `.adapterParityRate` | `TBD` |
| ExecutionDifference | `getResolverShadowMetrics().executionDifferences` | `TBD` |
| CacheHitRate / FallbackRate / RefreshFailures | `resolverCache.getMetrics()` | `TBD` |
| RollbackEvents | `getResolverShadowMetrics().rollbackEvents` | `TBD` |
| PromotionReadiness | `getLivePromotionReadiness().recommendation` | `TBD` |

**Exit criteria (all required):** ☐ Structural/Snapshot/Adapter ParityRate `== 1.0` · ☐ `ExecutionDifference == 0` · ☐ no unexplained `ConfigurationDifference` · ☐ rollback tested · ☐ cache stable · ☐ resolver stable · ☐ operator approval · ☐ `getLivePromotionReadiness() == PROMOTE`.

> **3C→3D engineering gate:** complete + review the deferred gateway synchronous-resolve swap (consume `ResolverCache.get → LegacyExecutionAdapter`, behind the enable flag, parity-gated fallback per `selectExecutionConfiguration`). CANARY cannot execute the resolver config without it.

---

## Deliverable 5 — Canary Validation Report (Phase 3D; template)

**Enable:** `AI_CONFIG_RESOLVER_MODE=canary` **and** `AI_CONFIG_RESOLVER_ENABLED=enforce` — but only after `PromotionReadiness == PROMOTE`. Authority changes ONLY through `resolveExecutionAuthority()`. Execution stays byte-identical (parity-gated selection → legacy fallback on any divergence).

**Rollout ladder (advance only when every metric holds; Rule 12 — no skips):**
internal tenant → single prod tenant → small traffic % → expanded tenant set → full population.

| Continuously monitor | Getter | Result |
|---|---|---|
| Resolver / legacy / canary executions | `getResolverShadowMetrics()` | `TBD` |
| Legacy fallback count | `resolverCache.getMetrics().fallbacks` + parity fallbacks | `TBD` |
| Latency / provider / retry / timeout | gateway `usage_events` + APM | `TBD` (must be unchanged) |
| Cache hit rate / refresh | `resolverCache.getMetrics()` | `TBD` |
| Rollback events / error rate | metrics + gateway | `TBD` |

**Rollback immediately (Rule 4/14) if:** `PromotionReadiness == ROLLBACK` · any `ExecutionDifference` · unexpected provider/routing/retry/timeout/latency/cache failure · operator call. Action: mode↓ or enable OFF (`…_ENABLED_KILL=1`) — no deploy/restart.

---

## Deliverable 6 — Production Promotion Report (Phase 3E; template)

**Enable:** `AI_CONFIG_RESOLVER_MODE=full` + enable on. Resolver authoritative; **Legacy Builder retained for rollback** (Rule 10). Continue monitoring all production + cache + resolver metrics + rollback readiness.

| Post-promotion (steady state) | Target | Result |
|---|---|---|
| Resolver executes all traffic | 100% (minus parity-fallbacks, which should be ~0) | `TBD` |
| Parity rates | 1.0 | `TBD` |
| Cache hit rate | > 95% | `TBD` |
| Latency vs baseline | unchanged | `TBD` |
| Rollback available | mode↓/enable-off verified | `TBD` |

---

## Deliverable 7 — Operational Dashboard Specification

One dashboard, read continuously; each tile maps to a getter (aggregate cross-replica):

| Tile | Source field |
|---|---|
| Execution Authority | `getLivePromotionState().resolverActive` / authority.executes |
| Promotion State | `getLivePromotionState().stage` |
| Promotion Recommendation | `getLivePromotionReadiness().recommendation` |
| Resolver / Legacy Executions | `getResolverShadowMetrics().resolverExecutions` / `.legacyExecutions` |
| Cache Hit Rate | `resolverCache.getMetrics().hitRate` |
| Resolver Latency | ops timing / `avgResolutionMs` |
| Fallback Count | `resolverCache.getMetrics().fallbacks` |
| Refresh Failures | `resolverCache.getMetrics().refreshFailures` |
| Parity Rates | `getEquivalenceValidationReport().{structural,snapshot,adapter}ParityRate` |
| Rollback Events | `getResolverShadowMetrics().rollbackEvents` |

**Alert thresholds:** any ParityRate < 1.0 during dual/canary; `ExecutionDifference > 0`; `PromotionReadiness == ROLLBACK`; cache hit-rate < 90%; sustained fallbacks/refreshFailures; latency regression. **Never render/log prompts, responses, PII, or configuration contents** — summaries only.

---

## Deliverable 8 — Rollback Verification Report (template)

Verify BEFORE canary, and re-verify at each stage:

| Scenario | Action | Expected | Result |
|---|---|---|---|
| Mode-down | `AI_CONFIG_RESOLVER_MODE` canary→dual | next request `executes: legacy`; `rollbackEvents++` | `TBD` |
| Enable off | `…_ENABLED_KILL=1` | resolver authority off immediately | `TBD` |
| Global kill | `ROLLOUT_KILL_SWITCH=1` | all flags off | `TBD` |
| No deploy/restart needed | — | takes effect next request | `TBD` |
| Legacy path intact | run legacy | byte-identical output | `TBD` |

---

## Deliverable 9 — Production Sign-off Document (template)

Promotion to FULL requires ALL (no bypass, Rule 13; no single approver overrides the checklist):

- ☐ Engineering approval (parity 1.0, no regressions)
- ☐ Operations approval (dashboard stable, rollback verified)
- ☐ Performance approval (latency/cost unchanged; cache > 95%)
- ☐ Rollback verification (Deliverable 8 passed)
- ☐ Business approval
- ☐ All prior stages (3A–3D) exit criteria met + documented (Rule 11)

Approvers / dates: `TBD`.

---

## Deliverable 10 — Legacy Retirement Authorization (authorizes, does not implement)

Legacy retirement is a **separate implementation phase**; this only authorizes it. Confirm during a defined observation period after FULL:
- ☐ Resolver stable · ☐ Cache stable · ☐ Rollback UNUSED during observation · ☐ No parity regressions · ☐ No operational incidents · ☐ No execution differences.

**Only after all confirmed + formal approval may Legacy Retirement implementation begin.** Until then, the Legacy Builder + migration components remain (Rules 10, 14).

Authorization: `TBD`.

---

## Incident Response & Stage Gates

- **Sev 1** → immediate rollback (mode↓/enable-off). **Sev 2** → pause rollout, investigate. **Sev 3** → continue observation. **No advancement while any incident is open.**
- **Stage gates:** no stage may be skipped (Rule 12); each stage's exit criteria must be met + documented before advancing (Rule 3/11); any unexplained execution difference blocks promotion (Rule 8); operational evidence beats assumptions (Rule 9).
- **Regression policy (Rule 14):** if any production metric regresses unexpectedly — STOP, document, restore the previous stable stage, resolve, then re-attempt.

---

## Success Criteria & Program Transition

Operational rollout is complete when: the resolver executes all production traffic, all parity metrics remain perfect, cache performance stays within targets, rollback remains immediately available, and stability holds through the observation period.

**Program transition (Rule 15):** completing this runbook transitions AI Orchestration from an engineering project to a **production operational capability**. Any future architectural enhancement must begin as a new, separately-approved engineering initiative — not an extension of this migration program.

---

## Status of this deliverable

- ✅ **Runbook + all 10 deliverable templates authored**, wired to the real control levers + getters, with exact exit criteria, rollback procedures, dashboard spec, sign-off, and retirement authorization structure.
- ⏳ **Live-observation fields (`TBD`) are intentionally unfilled** — they require real traffic against applied migrations in a running environment, which is not available here. Fabricating them would violate the evidence-first mandate (Rules 2, 9).
- 🔧 **One engineering prerequisite** (the gated gateway synchronous-resolve swap consuming `ResolverCache`) must be completed + reviewed before Phase 3D can execute the resolver config; SHADOW (3B) and DUAL (3C) require no code change.

*Phase 3A complete as an operational runbook. Execute it against a prepared non-prod environment first, populate each report from live observation, advance only on evidence, and keep rollback one flag away at every stage.*
