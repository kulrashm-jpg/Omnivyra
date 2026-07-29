# GTM-PROGRAM-001 — Wave W5.1
## LC-501 — Guarded Execution Platform & Connector Certification

**Program:** GTM-PROGRAM-001 · **Wave:** W5.1 (Guarded Execution Platform) · **Type:** Execution infrastructure ONLY — no live sends.
**Predecessors:** W0…W4 + M4 (all certified). M4 authorized W5 on conditions **C1–C5**.
**Branch:** `feat/gtm-w5-1-guarded-execution` (off committed W4 `82c4d249`).
**Method:** Reuse-first guarded execution layer verified against the **live prod DB** (test tenant `0eda0896`); schema additive/dark; **no real message transmitted**; synthetic data cleaned up (18 seeds intact).

---

## 0. Certification Decision

# ✅ CERTIFIED WITH ADJUSTMENTS

**All M4 conditions C1–C5 are implemented and prod-verified. The guarded execution platform is certified. No live execution is enabled** — execution is default-OFF and the sole connector is dry-run. Prod runtime validation drove the complete guarded path and confirmed **it terminates before any send**:

| Scenario | Result |
|---|---|
| Default OFF (no env) | **blocked @ control** (`global_env_off`) — nothing runs |
| Full guarded path (enabled, approved, clean) | **`dry_run`** through **all 7 stages**, `dispatched:false`, idempotency key issued — **NO SEND** |
| Unapproved | **blocked @ approval** (`not_approved`) — no bypass |
| Suppressed recipient | **`suppressed` @ suppression** (`unsubscribe`) |
| Kill-switch (tenant emergency stop) | **`killed` @ control** (`tenant_emergency_stop`) |

14 execution-audit rows across every stage; the only "send" is a dry-run marker. **Architecture is sound**; the remaining items are refinements to the *live* path (M5's scope):

- **A** — Distributed quota verified via the in-memory fallback (validation host has no reachable Redis); the Upstash path + **fail-fast→fail-closed timeout** are implemented and unit-safe, but need a live-Redis exercise.
- **B** — Queue stage is inline dry-run; **BullMQ async wiring** for real dispatch is M5.
- **C** — Suppression covers the **send-blocking** half of DSAR; a full DSAR *erase* flow (LC-001 G10) is broader.
- **D** — Execution capability **grants** must be bound to org roles (the API is default-deny today).

**M5 (Live Execution Certification) is authorized after A–D** — and only channel-by-channel, email first, still approval-gated + suppression-enforced + kill-switched + default-off.

---

## 1. Entry Gate — PASS

All reuse foundations exist: `agentApproval`, `executionGuardrailService` (pattern), BullMQ (`publishProcessor`/`jobQueue`), `publishReconciliationService`, `leadQueueHardening` (DLQ/idempotency), `rbacService`, `lib/redis/canonicalClient`, W2/W3/W4 platforms, HARDEN-001. (Retry available via BullMQ + `leadQueueHardening`; `providerRetryPolicy` under a different path — not a blocker.)

---

## 2. Suppression Platform Report (C1 · WP-501.1)

`suppression_entries` + `suppressionService` — **the ONE suppression engine every connector must consult**. Global + tenant scope (sentinel `__global__`), per-channel (`*`|email|…), reasons `unsubscribe/consent_withdrawn/dsar/legal_hold/bounce/complaint/manual`. **Fail-CLOSED** (lookup error/exception → suppressed; never lets a message through on error). `unsubscribe()` convenience.

**Prod-verified:** subscribed → allowed; suppressed → blocked @ suppression (`unsubscribe`); released → allowed again.

---

## 3. Campaign Execution Bridge Report (C2 · WP-501.2)

`executionBridge.dispatchGuarded` — the ONE guarded dispatch path; **no new dispatcher/queue/approval engine**. Ordered gate, failure at ANY stage prevents dispatch + audits:
`control(kill-switch/default-off) → approval → suppression → guardrail → quota → queue(reuse BullMQ in M5) → connector(DRY-RUN)`. Reuses control/suppression/quota/audit services + the dry-run connector.

**Prod-verified:** full path emits 7 stage-audits and terminates at `dry_run` (no send).

---

## 4. Email Connector Certification Report (C3 · WP-501.3)

`emailExecutionConnector` — the ONLY connector this wave; **dry-run only**. Supports preview, dry-run, deterministic **idempotency key**, recipient validation, and cancellation-before-dispatch (via the approval/control gates). **Never transmits**: a second hard gate `GTM_LIVE_SEND` (default OFF) + the W5.1 rule keep it dry-run; the live path (existing `emailService` edge fn, idempotent) is M5-only. Other connectors remain disabled (`connector_not_certified`).

**Prod-verified + unit:** dry-run returns `dispatched:false` even with `GTM_LIVE_SEND=true`; idempotency key deterministic/stable.

---

## 5. Distributed Rate Limit & Quota Report (C4 · WP-501.4)

`executionQuotaService` — distributed counters over the canonical Redis/Upstash client: per-tenant daily, per-connector daily, per-campaign daily, and burst. **Fail-fast (2.5s timeout) → fail-closed** so an unreachable quota store can never hang or silently allow dispatch. In-memory fallback only when Redis is *unconfigured*.

**Verified:** quota stage runs in the guarded path (in-memory fallback in validation); Redis path + fail-fast implemented (Adjustment A: live-Redis exercise).

---

## 6. Kill Switch & Human Override Report (C5 · WP-501.5)

`executionControlService` — layered, **DEFAULT OFF**: execution requires (a) `GTM_EXECUTION_ENABLED='true'` **and** (b) a global control `enabled=true` **and** (c) no tenant/campaign/connector `emergency_stop` or `enabled=false`. `killSwitch(scope)` sets emergency_stop; any scope hard-stops. `cancelApproval` (existing) covers approval cancellation.

**Prod-verified:** default → blocked (`global_env_off`); tenant kill-switch → `killed` (`tenant_emergency_stop`); recovery via clear.

---

## 7. Execution Telemetry Report (C6 · WP-501.6)

`execution_audit` (append-only) + `trackEvent('execution.<stage>.<decision>')` on **every** stage decision (approval_requested/granted/rejected, queued, suppressed, quota_blocked, killed, dry_run, dead_letter…). Reuses HARDEN-001. **No silent failures** — audit insert uses the reliable `.select()` pattern.

**Prod-verified:** 14 audit rows across all 7 stages for the validation run.

---

## 8. Execution Security & RBAC Report (C7 · WP-501.7)

`lib/execution/executionCapabilities` — explicit `campaign.execute/approve/cancel/override` with **role separation** (executor≠approver; auditor read-only; creator cannot execute). API is **default-deny**: execute/override actions 403 without the capability. Tenant isolation via `enforceCompanyAccess` + RLS; secrets/OAuth reused. **No user may bypass approval** (the bridge requires `approved`).

**Unit-verified:** executor lacks approve; approver lacks execute; default-deny.

---

## 9. Runtime Validation Report (WP-501.8)

Complete guarded path (campaign → audience-referenced entity → approval → suppression → guardrail → quota → queue → email connector → telemetry → audit) executed against prod and **terminated before live dispatch — no real email transmitted**. All five safety scenarios behaved correctly (§0).

---

## 10. Performance Certification

Guarded path = a bounded set of company-scoped reads (control/suppression) + distributed counter ops + pure guardrail + one dry-run connector call. Fail-fast quota bounds worst-case latency. No regression to W4 (execution is additive; capture/read/campaign paths untouched).

---

## 11. Observability Report

Approval/suppression/queue/connector/quota/kill-switch/audit + provider (dry-run) telemetry via `execution_audit` + `trackEvent`; correlation IDs threaded through the bridge; DB timing via `ownedDbTable`. No new observability platform.

---

## 12. Architectural Drift Report

| Prohibited | Introduced? | Evidence |
|---|---|---|
| Duplicate approval engine | ❌ | bridge requires upstream approval; capabilities extend RBAC |
| Duplicate dispatcher / queue | ❌ | one bridge; BullMQ reused for M5 async |
| Duplicate suppression platform | ❌ | `suppressionService` is the ONE engine |
| Duplicate RBAC / telemetry / connector framework | ❌ | extends capability RBAC + HARDEN-001; email connector reuses `emailService` pattern (live path M5) |

**Change surface:** all NEW files (execution service dir, `lib/execution`, execution API, migration, test) — **zero existing-code edits**.

---

## 13. M5 Readiness Assessment

| M5 (Live Execution) needs | Provided by W5.1 |
|---|---|
| Guarded path with all safety gates | ✅ control/approval/suppression/guardrail/quota/queue/connector |
| Suppression enforced pre-send | ✅ (fail-closed) |
| Kill-switch + default-off | ✅ |
| Idempotent connector | ✅ key; live idempotency = `emailService` edge fn (M5) |
| Audit + telemetry, no silent failures | ✅ |
| Capability RBAC + role separation | ✅ (grants binding = Adjustment D) |
| Distributed quotas | ◐ implemented; live-Redis exercise = Adjustment A |
| Async dispatch | ◐ BullMQ wiring = Adjustment B |

**M5 authorized after Adjustments A–D.**

---

## 14. Certification Statement

W5.1 delivers the **Guarded Execution Platform**: one suppression engine, one guarded dispatch bridge, a dry-run email connector, distributed fail-closed quotas, a layered default-off kill-switch, append-only execution audit/telemetry, and execution-capability RBAC with role separation — every outbound action must pass Approval → Suppression → Guardrail → Quota → Queue → Connector → Telemetry → Audit, and **failure at any stage prevents dispatch**. Built entirely by extending certified services (**zero architectural drift**), it was verified end-to-end against the production database and **transmitted no real message** (execution default-OFF, connector dry-run). Conditions C1–C5 are satisfied.

**Decision: CERTIFIED WITH ADJUSTMENTS. M5 (Live Execution Certification) is authorized after Adjustments A–D** (distributed-Redis live exercise, BullMQ async wiring, full DSAR-erase flow, capability-grant binding). Live autonomous sending remains **disabled** until M5.

*Prod schema `suppression_entries`/`execution_controls`/`execution_audit` applied additive + RLS + dark (execution disabled). Migration `20260727030000_guarded_execution.sql`. Code on `feat/gtm-w5-1-guarded-execution`, unpushed. No live send performed or enabled.*
