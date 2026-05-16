# Idempotency Lifecycle Gap Audit

**Date:** 2026-05-16
**Scope:** Stale / stuck idempotency operation paths in the billing infrastructure
**Status:** Audit — gap inventory drives the remediation in `idempotency-recovery-remediation.md`

---

## 1. Why this audit exists

Financial replay protection (UNIQUE on `credit_transactions.idempotency_key` + DB-level immutability + `apply_credit_reservation` RPC) is **correct** and **must not change**. But replay protection without a lifecycle finalizer creates a second problem: if a non-financial-state row (e.g. `billing_operations`, `job_execution_registry`) enters a non-terminal status and the process crashes before finalizing, future retries with the same idempotency key see "an operation is in progress" and refuse to proceed — even though no financial entry exists.

The financial ledger reaper already handles dangling HOLDs (releases them via `apply_credit_reservation(phase='release')`). What's missing is the equivalent lifecycle finalizer for the **operational tracking tables** that surround the ledger.

---

## 2. State surface inventory

Every table where an "in-progress" state can persist:

| Table | Non-terminal states | Terminal states | Existing finalizer? |
|---|---|---|---|
| `credit_transactions` (ledger) | `hold` (until sibling CONFIRM/RELEASE) | `confirm`, `release`, `grant`, `expire`, `expire_incentive` | ✅ Reaper (`credit-orphan-hold-reap` hourly) |
| `billing_operations` | `initiated`, `held`, `executed` | `confirmed`, `released`, `insufficient`, `duplicate`, `error` | ⚠️ Reconciliation cron reports — does NOT auto-transition |
| `job_execution_registry` | `reserved`, `in_progress` | `completed`, `released`, `orphan_reaped`, `duplicate_blocked` | ❌ No finalizer for stuck `in_progress` rows |
| `credit_action_approvals` | `pending` | `approved`, `rejected`, `executed`, `expired`, `cancelled` | ⚠️ `expirePendingApprovals` exists but not run on a cron schedule |
| `payment_provider_event_state` | `recorded`, `requeued` | `processed`, `duplicate`, `failed` | ❌ Reservation reconciliation cron reports — does NOT auto-transition |

---

## 3. Stuck-path inventory

### G-1. `billing_operations` row stuck at `initiated`

**Path:** `enterpriseBillingOrchestrator.runBilledOperation` opens a row with `status='initiated'` at [line 105-121](../../backend/services/billing/enterpriseBillingOrchestrator.ts). Calls `executeWithCredits` inside a `try/catch`. The catch block calls `closeBillingOperation(..., status='error')`.

**Where it can stick:**
1. Process crash between `openBillingOperation` and the `try` (e.g. OOM, container kill) → row stays `initiated` forever
2. `reconcileBillingOperationToResult` itself throws (e.g. DB lost connection right after work succeeded) → row stays `initiated`
3. Caller's `executor` callback hangs (long LLM call, network stall) → row stays `initiated` until killed by orchestration timeout

**Impact:** subsequent retries with the same idempotency key:
- Will hit `billing_operations.idempotency_key UNIQUE` and load the existing row
- BUT the underlying `credit_transactions` row may not exist yet (HOLD not yet placed) — so retry would correctly proceed at the RPC layer
- The orchestrator wrapper UPSERTs `billing_operations` — concurrent retries get the same `operationId` and proceed. So actually this is **less stuck than it looks** at the orchestrator layer.

**Real risk:** monitoring + dashboards report this row as "stuck" forever. Ops noise + false anomaly signal.

### G-2. `job_execution_registry` row stuck at `in_progress`

**Path:** [queueBillingMiddleware.ts:withQueueBillingCore](../../backend/services/billing/queueBillingMiddleware.ts) — `claim_job_execution` returns `status='reserved'`. After the orchestrator delegates, `advanceRegistryRow(executionHash, 'in_progress')`. On orchestrator throw, `advanceRegistryRow(..., 'released')` in the catch.

**Where it can stick:**
1. Process killed between `'in_progress'` advance and orchestrator completion → row stays `in_progress`
2. The `catch`-side `advanceRegistryRow` itself fails (network) → also stays `in_progress`
3. Worker pool restart while many jobs are mid-`in_progress` → mass stuck rows

**Impact:** ALL future retries of the same job hit `claim_job_execution`, find a non-terminal `in_progress` row with `first_seen=false`, and short-circuit as `in_flight_retry` (per [queueBillingMiddleware.ts](../../backend/services/billing/queueBillingMiddleware.ts) line ~140). **This is the highest-leverage stuck path** — a single OOM-killed worker can permanently block all retries of that job.

The ledger-layer reaper does release the HOLD, but the registry row stays. The next retry sees the registry row, not the ledger, and gives up.

### G-3. `credit_action_approvals` stuck at `pending` past `expires_at`

**Path:** [creditApprovalService.ts:proposeApproval](../../backend/services/billing/creditApprovalService.ts) writes `status='pending'` with `expires_at=now()+7d`. An `expirePendingApprovals` function exists but **is not wired to a cron**.

**Where it can stick:**
1. Proposer never signs / forgets
2. Pending approval older than 7 days

**Impact:** approval row remains queryable and visible in the dashboard as `pending` forever. The DB function `sign_credit_action_approval` does auto-expire on sign attempt (sets `status='expired'`), but if nobody attempts to sign, the row sits.

### G-4. `credit_action_approvals` stuck at `approved` (signed but not executed)

**Path:** `signApproval` advances to `status='approved'` when enough sigs arrive. The originating endpoint (e.g. `/api/admin/credits/grant`) is then expected to call `markApprovalExecuted` after the underlying action succeeds. If the originating endpoint's caller (e.g. the operator's browser) never retries — the approval is silently abandoned.

**Where it can stick:**
1. Operator closes browser after seeing "Approved — execution pending"
2. The actual mutation endpoint returns 5xx — operator never retries
3. Network disconnect between `signApproval` response and the second call

**Impact:** approval row sits at `approved` indefinitely. No financial state is wrong; the org just never received the grant. But the approval can never be "re-used" — the next grant attempt would create a fresh approval row.

### G-5. `payment_provider_event_state` stuck at `recorded`

**Path:** Razorpay/Stripe webhook arrives, `advance_payment_provider_event_state(..., 'recorded')` is called, then the fulfillment cycle is supposed to advance to `processed`. If fulfillment errors and never retries, the event sits at `recorded`.

**Where it can stick:**
1. Fulfillment service throws after recording but before advancing
2. No retry cron for stuck events (Phase 3 detection only)

**Impact:** customer paid but no credit granted. **HIGH severity** even though the integrity audit reports it.

### G-6. Approval flow approval-immutable-after-execute bypass

**Path:** `guard_approval_post_execute` trigger prevents UPDATE after `executed_at` is set. But what if `executed_at` is set but the actual financial work never ran (because the endpoint died between `markApprovalExecuted` and the ledger insert)?

**Analysis:** Inspection of [admin/credits/grant.ts](../../pages/api/admin/credits/grant.ts) shows the sequence is:
1. `proposeApproval` → returns 200 OK with approvalId
2. (Auto-approved path) → `grantAdminCreditExtension` → emits ledger row
3. `recordAdminAudit` + `markApprovalExecuted` → marks `executed_at`

So the ledger comes BEFORE `markApprovalExecuted`. If the process dies after the ledger insert but before `markApprovalExecuted`, the approval sits at `approved` (G-4) but the financial state is correct. The next retry sees the existing ledger row (via idempotency_key UNIQUE) and short-circuits. **G-4 covers this.**

---

## 4. Missing finally blocks

### M-1. `runBilledOperation` lacks `finally`

[enterpriseBillingOrchestrator.ts:125-180](../../backend/services/billing/enterpriseBillingOrchestrator.ts) — `try/catch` only. If `reconcileBillingOperationToResult` (called outside the try/catch) throws, the billing_operations row stays at `initiated`.

**Fix:** wrap the entire body in `try/finally` and ensure terminal status is always set.

### M-2. `withQueueBillingCore` post-`in_progress` paths

[queueBillingMiddleware.ts](../../backend/services/billing/queueBillingMiddleware.ts) — after `advanceRegistryRow(executionHash, 'in_progress')`, the `try` wraps the orchestrator call. The `catch` advances to 'released'. But the `'completed'` advance happens AFTER the try/catch in normal flow — if that itself fails, registry stays `in_progress`.

**Fix:** wrap the entire body (including the final advance) in `try/finally` that calls `advanceRegistryRow` to one of the terminal states based on outcome.

### M-3. Admin endpoint approval-execute sequence

[pages/api/admin/credits/grant.ts](../../pages/api/admin/credits/grant.ts) — `markApprovalExecuted` is called after the ledger write but with no retry-on-failure logic. If it fails, the approval row stays at `approved`.

**Fix:** the approval finalizer is a separate concern from the ledger write; either retry (idempotent) or document G-4 as "expected eventual finalization via cron".

---

## 5. Transaction interruption risks

| Path | Interrupted at | Outcome | Severity |
|---|---|---|---|
| HOLD inserted, process killed | After RPC return | Reaper releases after 1h (existing) | LOW |
| HOLD + CONFIRM both inserted, process killed before billing_operations close | Between RPC return and `closeBillingOperation` | Financial state is final; billing_operations stays `initiated` | LOW (cosmetic) |
| `claim_job_execution` returned `reserved`, process killed | Before orchestrator call | Registry has `reserved` row, no HOLD on ledger; next retry sees `reserved` + `first_seen=false` → short-circuits as in-flight | **HIGH** — permanent block |
| `advanceRegistryRow('in_progress')` returned, process killed | Before orchestrator finishes | Registry has `in_progress` row; next retry short-circuits | **HIGH** — permanent block |
| Approval signed (`approved`), process killed | Before `markApprovalExecuted` | Approval row `approved` forever; no ledger entry; no operator notification | MEDIUM |
| Webhook event recorded, fulfillment crashed | Between record + advance | Event stuck at `recorded`; customer paid; no credit granted | **HIGH** |

---

## 6. Rollback-finalization gaps

The Phase 2 rollback service ([billingRollbackService.ts](../../backend/services/billing/rollout/billingRollbackService.ts)) reverts feature flags. It does NOT touch billing_operations / job_execution_registry / approvals rows. So a rollback during active billing leaves operational rows stuck.

**Acceptable** — the rollback is for emergency feature-flag flipping, not for cleaning up in-flight work. In-flight work continues to drain normally under the rolled-back behavior. But this audit notes it as a known gap to address in PR review when adding new rollback variants.

---

## 7. Replay deadlock risks

**G-2 is the deadlock.** A killed worker leaves `job_execution_registry.status='in_progress'`. The middleware logic:

```ts
if (claim.isTerminal) {
  return { kind: 'duplicate_blocked', reason: claim.status, registryId: claim.registryId };
}
if (!claim.firstSeen && !ctx.allowConcurrentReentry) {
  return { kind: 'duplicate_blocked', reason: 'in_flight_retry', registryId: claim.registryId };
}
```

When the registry row exists with `is_terminal=false`, `first_seen=false`, the middleware returns `duplicate_blocked` and the executor never runs. **No mechanism exists today to transition this row out of `in_progress` other than a deploy-time SQL fix.**

This is the gap the remediation must close.

---

## 8. Inventory summary

| Gap ID | Surface | Severity | Auto-finalizable? |
|---|---|---|---|
| G-1 | `billing_operations` stuck `initiated`/`held`/`executed` | LOW (cosmetic; ledger correct) | Yes — close via age-based cron |
| G-2 | `job_execution_registry` stuck `reserved`/`in_progress` | **HIGH** — permanent retry block | Yes — expire to `orphan_reaped` |
| G-3 | `credit_action_approvals` past `expires_at` | MEDIUM | Yes — `expirePendingApprovals` (needs cron wiring) |
| G-4 | `credit_action_approvals` stuck `approved` | MEDIUM | Partial — cron can mark `cancelled` past N days, no auto-execute |
| G-5 | `payment_provider_event_state` stuck `recorded` | **HIGH** — financial impact | Partial — alert + retry cron needed |
| M-1 | `runBilledOperation` no `finally` | LOW | Code fix |
| M-2 | `withQueueBillingCore` no `finally` | **HIGH** | Code fix |
| M-3 | `markApprovalExecuted` no retry-on-fail | MEDIUM | Could add retry; or accept eventual cron finalization |

---

## 9. What replay protection looks like AFTER remediation

The financial replay invariant is preserved by:

1. **Ledger UNIQUE on `idempotency_key`** — unchanged. A retried HOLD finds the existing row.
2. **Apply RPC idempotency** — unchanged. `apply_credit_reservation` returns the existing row on `unique_violation`.

The remediation only changes the **operational tracking tables**:

- `billing_operations`: stuck `initiated` → expire to `error` after 30 min
- `job_execution_registry`: stuck `in_progress` → expire to `orphan_reaped` after 15 min
- `credit_action_approvals`: stuck `pending` past `expires_at` → expire to `expired`
- `credit_action_approvals`: stuck `approved` past 24 hours → can be retried by operator (UI) OR auto-cancelled after 7 days

After remediation, a retry of a previously-stuck operation:
- Sees the **financial state** (ledger) — if HOLD exists, retry confirms it or it's reaped; if no HOLD, retry places one.
- Sees the **operational state** — if expired, the registry row is `orphan_reaped`/`expired` (terminal but inert); the retry creates a fresh registry row with a new attempt count and proceeds.

**Replay protection of the ledger is unaffected.** The financial unique-key constraint stays in force.

---

## 10. Acceptance criteria for the remediation

1. ✅ No `billing_operations` row in non-terminal state for > 30 min (cron + recovery service).
2. ✅ No `job_execution_registry` row in non-terminal state for > 15 min.
3. ✅ Operator-initiated `expire`, `retry`, `cancel`, `inspect` actions for any stuck operation, RBAC-gated and audit-logged.
4. ✅ All recovery actions emit anomaly events for observability.
5. ✅ All recovery actions verify financial state consistency BEFORE expiring (no expire if it would leave drift).
6. ✅ Heartbeat support for long-running work — `last_seen_at` refresh keeps the registry row alive past its default expiry.
7. ✅ No deletion or mutation of `credit_transactions` rows. Ever.
8. ✅ All Phase 1–Activation tests still pass.

The next document, [idempotency-recovery-remediation.md](./idempotency-recovery-remediation.md), implements these.
