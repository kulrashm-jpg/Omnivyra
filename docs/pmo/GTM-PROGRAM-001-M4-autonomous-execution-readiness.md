# GTM-PROGRAM-001 — Milestone M4
## Autonomous Execution Readiness Certification

**Type:** Read-only audit + certification. **No implementation, no schema, no prod writes.**
**Question:** Is the platform safe to move from **recommend → simulate → execute** (authorize W5)?
**Method:** Evidence-based audit of the existing execution, safety, governance, connector, observability and security surface. Every finding cites concrete files.

---

## 0. Certification

# ✅ W5 AUTHORIZED — with mandatory pre-execution conditions

**The platform's execution-safety *foundation* is mature and reuse-ready**: a deterministic human-approval gate, an autonomous agent whose `approval_required` defaults to **true**, an execution-guardrail service, idempotent sends, dead-letter queues, deterministic retry, publish reconciliation, capability-based RBAC, tenant isolation, encrypted secrets, and the HARDEN-001 observability spine. W5 does **not** need to build a parallel execution or orchestration engine — it must **extend** these.

**W5 is authorized to BEGIN — but authorization to build the guarded execution layer is NOT authorization for live autonomous sends.** Execution must ship **default-OFF, dry-run/approval-first**, and the following are **hard conditions** (W5's first, gated deliverables) before any live autonomous send:

| # | Condition (blocking for live send) | Why |
|---|---|---|
| **C1** | **Suppression / consent / unsubscribe / DSAR** enforcement on every outbound path | **No suppression layer exists** (LC-001 G10). Sending without it is a legal (CAN-SPAM/GDPR) + reputational failure. Irreversible. |
| **C2** | **Execution bridge** (campaign → approval-gated → idempotent queue → connector), reusing `agentApproval` + `executionGuardrailService` + queue hardening | The W4 GTM layer (`gtm_campaigns`/`gtm_messages`) is **not wired to dispatch**. Build the bridge, don't fork the engine. |
| **C3** | **Connector capability parity** proven per channel (dry-run/preview/rollback/retry/observability) before enabling that channel | Only **email** is clearly send-ready (idempotent, live edge fn). LinkedIn/WhatsApp/SMS/Slack are unproven/absent. |
| **C4** | **Distributed** rate-limits + **per-tenant send quotas** | Several limiters are per-instance in-memory (LC-001 G1). Sends need distributed enforcement (Upstash available). |
| **C5** | **Kill-switch + human override**, execution flag default-OFF | Autonomous sending must be reversible-to-stop instantly and off until conditions clear. |

If W5 ships execution behind those gates (default-off, approval-gated, suppression-enforced, per-connector-proven), it is safe. **BLOCKED would be wrong** — the architecture is ready and every gap is implementable *within* W5's gated scope, not an architectural dead-end.

---

## 1. Architecture Review

| Check | Finding |
|---|---|
| No duplicate execution engines | ✅ reuse `executionGuardrailService`, BullMQ (`publishProcessor`, `jobQueue`), `providerRetryPolicy` |
| No duplicate orchestration | ✅ reuse `agentApproval` (one approval model "for every agent gate") + `autonomousCampaignAgent` |
| Reusable connectors | ◐ `emailService` (live, idempotent), `linkedinEngagementWorkspaceService`, `platformConnectorService`, `marketplaceConnectorService`, `connectors/` (listening) — parity varies (C3) |
| Reusable Operational Platform | ✅ W2 core (`entity_type='gtm_campaign'`, tasks/timeline/owner) is the execution work surface |
| Reusable Audience Platform | ✅ W3 (targets via `audience_id`, no member copy) |
| Reusable Campaign Platform | ✅ W4 (`gtm_campaigns`, strategy, simulation) |

**Verdict:** extend, don't duplicate. Architecture is W5-ready.

---

## 2. Safety Review

| Capability | Present? | Evidence |
|---|---|---|
| Approval workflow | ✅ | `agentApproval.decideApprovalGate` (approved/rejected/timeout/resubmit, deterministic); `autonomousCampaignAgent` `approval_required` **default true**; `creditApprovalService` (propose/sign/execute/expire) |
| Execution permissions | ✅ | `rbacService` + `rbacPrimitives` + capability RBAC (`rbac/communityAiCapabilities`); HARDEN-007 tenant guard |
| Dry-run support | ◐ | W4 `simulateCampaign` (`executed:false`) is a campaign-level pre-flight; per-connector dry-run must be matrixed (C3) |
| Rollback support | ◐ | `publishReconciliationService` + publish snapshots; **irreversible sends need cancel-before-dispatch + suppression** (see §6) |
| Cancellation support | ✅ | `approvalCancellationService.cancelApproval`; queue cancel/DLQ |
| Guardrails | ✅ | `executionGuardrailService`, `aiRequestGuard` (fail-open), `ai/safety/*` (promptSafety, moderation) |

---

## 3. AI Governance — Approval Ladder

```
Human ──▶ Suggested ──▶ Approved ──▶ Executed ──▶ Audited ──▶ Reversible(-to-stop)
  │           │             │            │             │              │
  │   autonomousCampaignAgent  agentApproval    queue/connector   trackEvent +   cancelApproval +
  │   .generateNextCampaign    .decideApprovalGate  dispatch      lead_intel_events   DLQ + suppression
  │   (approval_required        (approved→proceed                 + audit_events      (C1/C5)
  │    DEFAULT true)             rejected→reject
  │                             timeout/resubmit)
  └── default-off flag; kill-switch (C5)
```
**Finding:** the ladder EXISTS end-to-end for campaign generation with a **safe default** (`approval_required=true`). W5 must extend the *Executed* step to real sends **behind the same gate** (never bypass it), and make *Reversible* mean cancel-before-dispatch + suppression (post-send is irreversible).

---

## 4. Connector Capability Matrix

| Connector | Send-capable | Idempotent | Dry-run/preview | Rollback | Retry | Observability | W5 status |
|---|---|---|---|---|---|---|---|
| **Email** (`emailService` → `send-transactional-email` edge fn) | ✅ live | ✅ (`idempotencyKey`) | ◐ (campaign sim; no per-send preview) | ❌ (cancel-before-send only) | ◐ (edge throws; `providerRetryPolicy` reusable) | ✅ (throws + telemetry) | **First channel to enable (after C1)** |
| **LinkedIn** (`linkedinEngagementWorkspaceService`) | ◐ workspace/assisted | ? | ? | ❌ | ? | ◐ | audit before enabling (C3) |
| **CRM / connectors** (`platformConnectorService`, `marketplaceConnectorService`) | ◐ | ? | `connectorSandboxService` exists | ? | ? | ◐ | sandbox-first |
| **Webhook** (`communityAiWebhookService`, internal handoff HMAC) | ✅ | ◐ | ◐ | n/a | ◐ | ✅ | ok w/ HMAC + safeFetch |
| **Slack / WhatsApp / SMS** | ❌ not evident | — | — | — | — | — | **not present — do not enable** |

**Finding:** capability is **email-first**; most channels are unproven or absent. Enable channels **one at a time**, each proven against this matrix. `connectorSandboxService` supports safe connector testing.

---

## 5. Execution Safety Matrix (Operational)

| Control | Present? | Evidence / gap |
|---|---|---|
| Rate limits | ◐ | `checkInMemoryRateLimit` (per-instance), Redis daily cap — **distributed send limits needed (C4)** |
| Quotas | ◐ | credit system (`deductCreditsIfValueAwaited`, `credit_action_approval_thresholds`) gates cost; **per-tenant send quota needed (C4)** |
| Provider failures | ✅ | edge fn throws; `providerRetryPolicy` (WAVE-1D deterministic backoff, transient env-gated) |
| Duplicate sends | ✅ | email `idempotencyKey`; `publishing_jobs.idempotency_key` UNIQUE; `buildLeadJobIdempotencyKey` |
| Retries | ✅ | `providerRetryPolicy`; BullMQ attempt/backoff; `publishing_jobs.attempt_count/max_attempts` |
| Timeouts | ✅ | `aiGateway` operation-keyed timeouts; statement_timeout |
| Dead-letter queues | ✅ | `getLeadDeadLetterQueue`, `leadQueueHardening`, `buildLeadJobFailureMetadata` |
| Reconciliation | ✅ | `publishReconciliationService` (enqueue + worker) |

**Finding:** strong except **distributed rate-limit + per-tenant send quota (C4)**.

---

## 6. Rollback Strategy (irreversible-send-aware)

A sent message cannot be un-sent. "Rollback" for execution = a layered stop:
1. **Cancel-before-dispatch** — `cancelApproval` + queue job cancel/remove while pending (the widest, cleanest reversal window).
2. **In-flight halt** — kill-switch (C5) pauses the executor; DLQ captures partials.
3. **Post-send mitigation** — **suppression list + unsubscribe (C1)** to stop *future* touches; log to audit. There is **no post-send undo**.
4. **State reconciliation** — `publishReconciliationService` reconciles dispatched vs recorded.

**Requirement:** W5 must implement C1 (suppression/consent) and C5 (kill-switch) so "reversible" is real *up to dispatch*, and honest that dispatch is terminal.

---

## 7. Failure Recovery Plan

Retry (`providerRetryPolicy`) → DLQ (`getLeadDeadLetterQueue`) → reconciliation (`publishReconciliationService`) → idempotent replay (idempotency keys prevent double-send on replay). Provider failure is fail-safe (throws, caller decides; best-effort side-effects never block). **Gap (LC-001 G9):** failure *telemetry* on fire-and-forget side-effects — must be closed for execution (silent send-failures are unacceptable).

---

## 8. Execution Observability Plan

Reuse: `trackEvent` (execution/approval/AI events), `lead_intelligence_events` + `audit_events` + `super_admin_audit_logs` (audit trail), `leadQueueObservability` + `queueInstrumentation` (queue/provider telemetry), HARDEN-001 `observability_slow_*` (latency), correlation IDs (route factory). **Add:** per-send provider telemetry + approval telemetry + failure counters (closing G9) — extensions, not new systems.

---

## 9. Security Assessment

| Area | Finding |
|---|---|
| RBAC | ✅ `rbacService`/`rbacPrimitives` + capability RBAC — extend with an explicit **execution capability** (e.g. `campaign.execute`) gating dispatch |
| Execution permissions | ◐ present via RBAC; add the execute-capability + approver-role separation |
| Tenant isolation | ✅ HARDEN-007 `withTenantGuard` + `check-tenant-authz` CI gate; every table `company_id`+RLS |
| Secrets | ✅ `integration_credentials` encrypted; `ENCRYPTION_KEY`; no plaintext creds |
| Connector authorization | ✅ OAuth (`emailAuthService`, `oauthLifecycleScheduler`), signed webhooks (HMAC), `safeFetch` (SSRF, HARDEN-005) |

**Finding:** security foundation is strong; add an explicit execution capability + approver/executor role separation.

---

## 10. W5 Authorization Report

| Readiness dimension | Verdict |
|---|---|
| Reusable architecture (no parallel engines needed) | ✅ ready |
| Approval ladder (human→approved→executed, safe default) | ✅ ready |
| Idempotency / DLQ / retry / reconciliation | ✅ ready |
| Observability + audit spine | ✅ ready (extend telemetry) |
| Security / RBAC / tenant isolation / secrets | ✅ ready (add execute capability) |
| Suppression / consent / DSAR | ❌ **must build (C1)** |
| Campaign→execution bridge | ❌ **must build (C2)** |
| Connector parity | ◐ **email-first; prove per channel (C3)** |
| Distributed send rate-limits + quotas | ◐ **must build (C4)** |
| Kill-switch + default-off | ◐ **must wire (C5)** |

---

## 11. Certification Statement

The platform is **architecturally ready** to move toward execution: the human-approval ladder, autonomous-agent gating (safe default), execution guardrails, idempotency, dead-letter queues, deterministic retry, reconciliation, capability RBAC, tenant isolation, encrypted secrets, and the observability/audit spine already exist and are **reusable** — W5 must extend, never duplicate them. However, **live autonomous sending is not yet safe**: there is no suppression/consent layer, no campaign→dispatch bridge, unproven connector parity beyond email, and per-instance rate-limits.

**Decision: ✅ W5 AUTHORIZED** to build the **guarded execution layer**, on the mandatory conditions C1–C5. Execution must ship **default-off, dry-run + approval first, suppression-enforced, one connector at a time (email first), with a kill-switch** — and **no live autonomous send** until C1–C5 are certified. This authorizes the *engineering*, not the *firing of live campaigns*.

*Read-only audit — production and code untouched. Findings anchor to existing services; W5 implementation is a separate, gated wave.*
