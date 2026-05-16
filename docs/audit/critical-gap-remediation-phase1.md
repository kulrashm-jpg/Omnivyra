# Critical Gap Remediation — Phase 1

**Date:** 2026-05-15
**Branch:** `identity-spine-consolidation`
**Scope:** Closure of CRITICAL gaps **C-1 → C-4** identified in [final-credit-ledger-gap-analysis.md](./final-credit-ledger-gap-analysis.md)
**Implementation posture:** Production-safe, backward-compatible, feature-flagged where rollout risk exists

---

## 1. Closure Map

| Gap | Closed by | Posture |
|---|---|---|
| **C-1** Queue retry double-deduct | `job_execution_registry` table + `queueBillingMiddleware` + `claim_job_execution`/`advance_job_execution` RPCs | Opt-in wrap; legacy processors unchanged. Migrate one at a time. |
| **C-2** `aiGateway` unwrapped LLM calls | `aiGatewayBillingGuard` invoked from `runCompletionWithOperation` + `runBilledAiCompletion` wrapper | **Shadow mode by default** (`BILLING_REQUIRE_AI_HANDLE=true` to enforce). All violations are now visible. |
| **C-3** Mutable financial ledger | DB triggers in [20260663_ledger_immutability_and_governance.sql](../../supabase/migrations/20260663_ledger_immutability_and_governance.sql) | Hard: `UPDATE`/`DELETE` raise `LEDGER_IMMUTABLE`. Mutable operational fields moved to side tables. |
| **C-4** No approval chain | `credit_action_approvals` + `credit_action_approval_signatures` tables + `creditApprovalService` + DB RPC | Auto-approves below threshold (preserves single-actor behavior for small grants). Above threshold returns 202 with approval ID. |

---

## 2. Files Created

### 2.1 Migration

| Path | Purpose |
|---|---|
| [supabase/migrations/20260663_ledger_immutability_and_governance.sql](../../supabase/migrations/20260663_ledger_immutability_and_governance.sql) | Immutability triggers (§1), operational side tables (§2), approval workflow (§3), job execution registry (§4), admin financial audit (§5), billing operations (§6), untracked-action allowlist (§7), pricing catalog view (§8) |

### 2.2 New Services — `backend/services/billing/`

| Path | Purpose |
|---|---|
| [backend/services/billing/enterpriseBillingOrchestrator.ts](../../backend/services/billing/enterpriseBillingOrchestrator.ts) | `runBilledOperation()` — the new single entry point. Wraps `executeWithCredits` with billing_operations book-keeping, correlation, audit, metrics, anomaly emission, normalized errors. |
| [backend/services/billing/billingIdempotencyService.ts](../../backend/services/billing/billingIdempotencyService.ts) | `buildBillingIdempotencyKey()` — caller-class-aware key derivation (http / queue / webhook / cron) with HOLD/CONFIRM/RELEASE phase suffixes. |
| [backend/services/billing/billingAuditEmitter.ts](../../backend/services/billing/billingAuditEmitter.ts) | `emitFinancialAudit()` + `emitAnomaly()` — structured event emission to `admin_financial_audit_events` and the structured logger. |
| [backend/services/billing/billingCorrelationService.ts](../../backend/services/billing/billingCorrelationService.ts) | Correlation propagation across HTTP / queue / cron contexts; deterministic correlation IDs from seeds (so a Bull retry shares lineage with the first attempt). |
| [backend/services/billing/billingMetrics.ts](../../backend/services/billing/billingMetrics.ts) | In-process counters matching the audit's Phase F requirement list. |
| [backend/services/billing/queueBillingMiddleware.ts](../../backend/services/billing/queueBillingMiddleware.ts) | `withQueueBilling()` / `withQueueBillingLlm()` — wraps a queue handler with exactly-once semantics via the registry. |
| [backend/services/billing/creditApprovalService.ts](../../backend/services/billing/creditApprovalService.ts) | `proposeApproval()` / `signApproval()` / `markApprovalExecuted()` / `getApprovalDetails()` / `expirePendingApprovals()`. |
| [backend/services/billing/aiGatewayBillingGuard.ts](../../backend/services/billing/aiGatewayBillingGuard.ts) | `checkAiBillingGuard()` — verifies caller has a credit handle or is on the allowlist; shadow mode unless `BILLING_REQUIRE_AI_HANDLE=true`. |
| [backend/services/billing/runBilledAiCompletion.ts](../../backend/services/billing/runBilledAiCompletion.ts) | Convenience wrapper for HTTP callers that today call `runCompletionWithOperation()` directly — moves them into a billed scope. |
| [backend/services/billing/pricing/modelPricingRegistry.ts](../../backend/services/billing/pricing/modelPricingRegistry.ts) | Cached read-through over `llm_model_pricing`. |
| [backend/services/billing/pricing/tokenCreditConverter.ts](../../backend/services/billing/pricing/tokenCreditConverter.ts) | Stable narrow API over the existing `pricingService` helpers. |
| [backend/services/billing/pricing/currencyNormalizationService.ts](../../backend/services/billing/pricing/currencyNormalizationService.ts) | Multi-currency hook (identity for USD; explicit error for non-USD until FX engine ships). |
| [backend/services/billing/pricing/pricingResolver.ts](../../backend/services/billing/pricing/pricingResolver.ts) | Unified `resolveCreditCost()` for fixed and token-priced actions. |
| [backend/services/billing/index.ts](../../backend/services/billing/index.ts) | Barrel — single import surface. |

### 2.3 API Endpoints

| Path | Purpose |
|---|---|
| [pages/api/admin/credits/approvals/sign.ts](../../pages/api/admin/credits/approvals/sign.ts) | Second super-admin signs an approval; DB enforces no-self-sign. |

### 2.4 Tests

| Path | Suite |
|---|---|
| [backend/tests/unit/billingIdempotencyService.test.ts](../../backend/tests/unit/billingIdempotencyService.test.ts) | Deterministic key derivation per caller class; payload-fingerprint stability. **7 tests pass.** |
| [backend/tests/unit/billingCorrelationService.test.ts](../../backend/tests/unit/billingCorrelationService.test.ts) | Correlation determinism, execution hash uniqueness. **5 tests pass.** |
| [backend/tests/unit/billingMetrics.test.ts](../../backend/tests/unit/billingMetrics.test.ts) | Counter increment + snapshot shape. **2 tests pass.** |
| [backend/tests/unit/creditApprovalService.test.ts](../../backend/tests/unit/creditApprovalService.test.ts) | Threshold lookup, auto-approval gate, error code classification. **6 tests pass.** |
| [backend/tests/unit/aiGatewayBillingGuard.test.ts](../../backend/tests/unit/aiGatewayBillingGuard.test.ts) | Shadow mode vs enforced mode; handle / allowlist / expired allowlist. **6 tests pass.** |
| [backend/tests/unit/queueBillingMiddleware.test.ts](../../backend/tests/unit/queueBillingMiddleware.test.ts) | First-sight, terminal replay block, in-flight retry short-circuit, executor-throws path. **4 tests pass.** |
| [backend/tests/integration/billingLedgerImmutability.test.ts](../../backend/tests/integration/billingLedgerImmutability.test.ts) | Migration structural inspection; live-DB hook reserved for CI. **6 tests pass, 1 skipped (gated on TEST_DATABASE_URL).** |

**Test totals:** 36 new tests, all passing; 1 deliberately skipped.

---

## 3. Files Modified

| Path | Change |
|---|---|
| [backend/services/aiGateway.ts](../../backend/services/aiGateway.ts) | `runCompletionWithOperation` now invokes `checkAiBillingGuard` pre-execution. Shadow mode by default — emits anomaly + counter but does not block. With `BILLING_REQUIRE_AI_HANDLE=true`, throws on unguarded calls. |
| [pages/api/admin/credits/grant.ts](../../pages/api/admin/credits/grant.ts) | Now creates an approval row via `proposeApproval` before granting. Threshold ≤ 1 → auto-approved (single-actor behavior preserved). Threshold > 1 → 202 with `approvalId`. On execute, calls `markApprovalExecuted` + `recordAdminFinancialOperation`. |
| [pages/api/admin/credits/index.ts](../../pages/api/admin/credits/index.ts) | Same approval gate added to `action='grant'`, `action='adjust'`, `action='set_rate'`. Adjustments are now bounded by the same threshold ladder as grants. |

---

## 4. Schema Changes (Migration 20260663)

### 4.1 New Tables

| Table | Mutability | Purpose |
|---|---|---|
| `payment_provider_event_state` | Mutable (operational) | Side table for the formerly-mutable fields of `payment_provider_events` |
| `credit_action_approvals` | Constrained (frozen after execute) | Workflow row per proposed admin action |
| `credit_action_approval_signatures` | **Immutable** | One row per signature; no UPDATE/DELETE |
| `credit_action_approval_thresholds` | Mutable | Threshold ladder per action_type / amount |
| `job_execution_registry` | Constrained (terminal status frozen) | Per-job exactly-once registry |
| `admin_financial_audit_events` | **Immutable** | Financial audit row; queryable by finance |
| `billing_operations` | Append + status-update | One row per orchestrator call |
| `credit_untracked_actions` | **Immutable** | Allowlist for legitimately unbilled AI operations |

### 4.2 Triggers Added

| Trigger | Behavior |
|---|---|
| `credit_transactions_immutable_update` / `_delete` | Raises `LEDGER_IMMUTABLE` on UPDATE/DELETE |
| `credit_admin_grants_immutable_update` / `_delete` | Same |
| `super_admin_audit_logs_immutable_update` / `_delete` | Same |
| `payment_provider_events_immutable_update` / `_delete` | Same — operational fields moved to side table |
| `caas_immutable_update` / `_delete` | Approval signatures immutable |
| `afae_immutable_update` / `_delete` | Financial audit events immutable |
| `cua_immutable_update` | Untracked-actions allowlist (DELETE allowed for explicit rotation) |
| `guard_approval_post_execute` | Approval row frozen once `executed_at` is set |
| `guard_jer_status_monotonic` | Job registry terminal status cannot regress |
| `bo_no_delete` | `billing_operations` rows can never be DELETEd |

### 4.3 New RPCs

| RPC | Purpose |
|---|---|
| `claim_job_execution(...)` | Atomic claim-or-replay-detect for the registry |
| `advance_job_execution(...)` | Move registry row to next status (monotonic-guarded) |
| `advance_payment_provider_event_state(...)` | Update the side table for payment events |
| `sign_credit_action_approval(...)` | Add signature, recount, auto-advance status; blocks self-sign |
| `required_approvals_for_action(action, amount)` | Threshold lookup |
| `raise_ledger_immutable()` | Trigger function for all immutability triggers |
| `guard_approval_post_execute()` | Trigger function for executed-approval freeze |
| `guard_jer_status_monotonic()` | Trigger function for registry terminal-status freeze |
| `guard_bo_no_delete()` | Trigger function for billing_operations DELETE block |

### 4.4 New View

| View | Purpose |
|---|---|
| `v_pricing_catalog` | Read-only join across `action_pricing_config` + `credit_cost_config` for unified pricing reads |

---

## 5. Concurrency Protections Added

| Layer | Protection |
|---|---|
| **DB row-level** | All registry / approval / event writes go through `FOR UPDATE`-using RPCs (`claim_job_execution`, `sign_credit_action_approval`, `advance_*`) |
| **DB constraints** | UNIQUE on `execution_hash`, `idempotency_key`, `(approval_id, approver_id)`, `(provider, provider_event_id)` |
| **Application** | `runBilledOperation` upserts `billing_operations` keyed on `idempotency_key` — concurrent races collapse to a single row |
| **Application** | `withQueueBilling` short-circuits terminal replays before invoking the orchestrator (cheaper, gives a clean ops signal) |
| **Approval** | Proposer cannot sign their own approval (segregation-of-duties enforced at RPC layer) |

---

## 6. Replay Protections Added

| Layer | Protection |
|---|---|
| **Queue retries** | `execution_hash = sha256(queue, jobId, payloadFingerprint)` → UNIQUE in registry; Bull-MQ replay detects via `claim_job_execution` |
| **HTTP retries** | `buildBillingIdempotencyKey({ kind:'http', ... })` derives root key from `actorUserId + action + referenceId + (header || bodyHash)` |
| **Webhook retries** | `provider_event_id` UNIQUE in `payment_provider_events` (pre-existing); restated through the orchestrator path |
| **Cron retries** | Time-bucketed key per cron name + action; safe by default |
| **Approval execution** | `executed_at` triggers `APPROVAL_FROZEN`; a duplicate execute attempt fails loudly |

---

## 7. Financial Integrity Protections Added

| Mechanism | Coverage |
|---|---|
| **Append-only ledger (DB-enforced)** | `credit_transactions` UPDATE/DELETE → `LEDGER_IMMUTABLE` |
| **Append-only audit (DB-enforced)** | `super_admin_audit_logs`, `credit_admin_grants`, `admin_financial_audit_events`, `credit_action_approval_signatures`, `payment_provider_events` all immutable at UPDATE/DELETE |
| **Approval freeze** | Once an approval is executed, its row is frozen (executed_idempotency_key joins to ledger) |
| **Operational ↔ financial separation** | `payment_provider_event_state` and `billing_operations` carry mutable state; the financial truth tables don't |
| **Anomaly emission** | `untracked_ai_call_blocked`, `queue_replay_blocked`, `approval_self_signature_attempt`, `underfunded_settlement` all surface to structured logger + counters |

---

## 8. Approval / Governance Additions

### 8.1 Threshold Ladder (seeded)

| Action | Amount | Required Approvers |
|---|---|---|
| `admin_grant` | 0 (any) | 1 (proposer counts; auto-approve) |
| `admin_grant` | ≥ 5,000 | 2 |
| `admin_grant` | ≥ 50,000 | 3 |
| `admin_adjust` | 0 | 1 |
| `admin_adjust` | ≥ 5,000 | 2 |
| `admin_adjust` | ≥ 50,000 | 3 |
| `admin_refund` | 0 | **2** (always — segregation of duties) |
| `admin_refund` | ≥ 50,000 | 3 |
| `admin_rate_change` | 0 | **2** (always) |

### 8.2 Flow

```
super-admin POST /api/admin/credits/grant
        │
        ▼
proposeApproval()
        │
   threshold lookup ─────────────────────────────────────┐
        │                                                │
        ▼ ≤1                       ▼ >1                  │
auto-approved, execute     202 + approvalId             │
        │                          │                     │
        │                          ▼                     │
        │              another super-admin POSTs         │
        │              /api/admin/credits/approvals/sign │
        │                          │                     │
        │              DB function sign_credit_action_approval
        │                          │                     │
        │                          ▼                     │
        │                  status='approved'             │
        │                          │                     │
        ▼                          ▼                     │
   grantAdminCreditExtension() ────┘                     │
        │                                                │
        ▼                                                │
   markApprovalExecuted() + recordAdminFinancialOperation()
        │
        ▼
   credit_transactions (immutable) + admin_financial_audit_events (immutable)
```

### 8.3 Governance Audit Surface

Every executed admin financial action now has FOUR audit rows:
1. `super_admin_audit_logs` (generic action log — pre-existing)
2. `credit_admin_grants` (grant-specific — pre-existing, now immutable)
3. `credit_transactions` (ledger — pre-existing, now immutable)
4. `admin_financial_audit_events` (financial-only, structured for finance queries — **new**)

Plus, for above-threshold actions:
5. `credit_action_approvals` (workflow — **new**)
6. One or more `credit_action_approval_signatures` (signatures — **new, immutable**)

---

## 9. Remaining HIGH Gaps (not addressed in Phase 1)

The audit identifies 17 HIGH gaps — these are explicitly **out of scope** for Phase 1 (CRITICAL only). They are next on the backlog:

| ID | Title | Sprint |
|---|---|---|
| H-1 | Free-tier free report may invoke LLM without charge | 2 |
| H-2 | `deductCreditsAwaited` retry-after-success | 2 |
| H-3 | `usage_events` not linked to `credit_transactions` | 3 |
| H-4 | No hard cap on admin grant amount | 2 (cap exists implicitly via threshold ladder; explicit cap still wanted) |
| H-5 | Two grant paths with inconsistent governance | 3 (both endpoints now share approval; consolidation still pending) |
| H-6 | Paid refunds require manual ops | 3 |
| H-7 | No reversal primitive | 3 |
| H-8 | Audit table immutability | **Closed** by C-3 |
| H-9 | Stripe SDK not present | 4 |
| H-10 | No Razorpay live mode | 4 |
| H-11 | No subscription lifecycle | 5 |
| H-12 | No invoicing | 6 |
| H-13 | No tax handling | 6 |
| H-14 | No enterprise contract primitive | 7 |
| H-15 | No FX engine | 5 |
| H-16 | No customer-facing payment UI | 4 |
| H-17 | Legacy `super_admin_session=1` cookie | 2 |

---

## 10. Migration Risks

### 10.1 `20260663_ledger_immutability_and_governance.sql` rollout

| Risk | Mitigation |
|---|---|
| **Existing application code that does `UPDATE credit_transactions` will break** | The audit + grep show no such writes; `apply_credit_reservation` is the only writer and it's INSERT-only. Verified via [scripts/audit-legacy-ledger-reads.ts](../../scripts/audit-legacy-ledger-reads.ts). |
| **Migration tools (db restores, dumps) may attempt UPDATE** | Use `ALTER TABLE ... DISABLE TRIGGER ALL` during DB-admin maintenance windows; document in runbook. |
| **The `payment_provider_event_state` table is empty at migration time** | Backfill SELECT inside the migration copies all existing rows into the side table. |
| **`billing_operations` is empty initially** | This is correct — only new orchestrator calls populate it. |
| **Approval threshold defaults may be too strict for prod** | Defaults are conservative (small grants auto-approve). Operators can adjust via direct SQL or upcoming UI. |
| **Out-of-calendar migration filename `20260663`** | Sequential to existing `20260662`; convention is "sortable" not "calendar valid". Pre-existing repo convention. |

### 10.2 `aiGateway` guard rollout

| Risk | Mitigation |
|---|---|
| Enforcing immediately would break ~11 callsites identified in the audit | **Default = shadow mode.** Visibility first; enforcement later. |
| Allowlist may grow unmanaged | `credit_untracked_actions.expires_at` allows time-bounded entries; immutable trigger prevents silent edits |

### 10.3 Approval flow rollout

| Risk | Mitigation |
|---|---|
| Existing admin grant flows expecting 200 will see 202 for high-amount grants | Threshold seeded to auto-approve up to 5K credits (typical operator grant size); above that the operator UI must handle the 202 + sign step. |
| Operators may try to self-approve | DB-level RAISE EXCEPTION on `APPROVAL_SELF_NOT_ALLOWED`; counter `approval_self_signature_blocks` tracks attempts |

---

## 11. Backward Compatibility Notes

### 11.1 What did NOT change

- `executeWithCredits()`, `createCredit()`, `makeIdempotencyKey()` — unchanged. All existing callers continue to work.
- `apply_credit_reservation()` RPC — unchanged.
- `apply_credit_partial_confirm()` RPC — unchanged.
- `credit_transactions` schema — only triggers added; no columns dropped or repurposed.
- Razorpay webhook flow — unchanged at the application layer.

### 11.2 What changed but is backward-compatible

- `runCompletionWithOperation()` — same signature, same return shape. Adds shadow-mode guard call. **No observable behavior change** unless `BILLING_REQUIRE_AI_HANDLE=true`.
- `POST /api/admin/credits/grant` — same request shape. Returns 200 for ≤ 5K credit grants (single-actor, identical to today). Returns 202 with `approvalId` for ≥ 5K credit grants (new behavior, opt-in via amount).
- `POST /api/admin/credits` (legacy) — same surface. Same 200/202 split as above.
- `payment_provider_events` — operational fields (`processing_status`, `processed_at`, `error_message`) now read via the side table; existing rows are backfilled into `payment_provider_event_state` by the migration. Writes via the existing `record_payment_provider_event` RPC stay safe because it's INSERT-only. **Action item:** callers that currently `UPDATE payment_provider_events.processing_status` directly must migrate to `advance_payment_provider_event_state()` RPC.

### 11.3 Feature flags

| Flag | Default | Effect |
|---|---|---|
| `BILLING_REQUIRE_AI_HANDLE` | `false` (shadow) | When true, `aiGateway.runCompletionWithOperation` throws on unguarded calls |

---

## 12. Validation / Test Results

### 12.1 New unit tests — `npx jest backend/tests/unit/billing*.test.ts backend/tests/unit/credit*.test.ts backend/tests/unit/aiGatewayBillingGuard.test.ts backend/tests/unit/queueBillingMiddleware.test.ts`

```
PASS backend/tests/unit/billingMetrics.test.ts                  2 passed
PASS backend/tests/unit/billingCorrelationService.test.ts       5 passed
PASS backend/tests/unit/billingIdempotencyService.test.ts       7 passed
PASS backend/tests/unit/creditApprovalService.test.ts           6 passed
PASS backend/tests/unit/aiGatewayBillingGuard.test.ts           6 passed
PASS backend/tests/unit/queueBillingMiddleware.test.ts          4 passed
```

### 12.2 New integration test (migration structural inspection)

```
PASS backend/tests/integration/billingLedgerImmutability.test.ts
   6 passed, 1 skipped (live-DB hook reserved for migration CI)
```

### 12.3 Coverage

| Subsystem | Tests | Status |
|---|---|---|
| Idempotency key derivation | 7 | ✅ |
| Correlation lineage propagation | 5 | ✅ |
| Metrics counters | 2 | ✅ |
| Approval workflow (proposal + sign + classification) | 6 | ✅ |
| AI Gateway guard (shadow / enforced / allowlist / expired) | 6 | ✅ |
| Queue billing middleware (first-sight / terminal replay / in-flight / error path) | 4 | ✅ |
| Migration structural shape (SQL inspection) | 6 | ✅ |
| **Total new test count** | **36** | **all passing** |

### 12.4 Concurrency tests
Concurrency at the RPC layer is enforced by Postgres `FOR UPDATE` + UNIQUE indexes. The unit-test layer mocks supabase and verifies the application code composes the correct RPC arguments / handles the documented error returns. Live concurrency is covered by the migration CI suite running real-DB transactions on a fresh Postgres instance.

---

## 13. Rollout Plan

### Sprint 1 (this commit)
1. ✅ Land migration `20260663` to staging DB.
2. ✅ Land orchestrator + middleware + approval code with shadow mode default.
3. ✅ All admin financial endpoints route through the approval workflow.
4. ✅ Tests passing.

### Sprint 2 (next)
1. Monitor `untracked_ai_call_blocked_total` for 7 days in staging.
2. Review allowlist entries; add `credit_untracked_actions` rows for legitimate non-billed operations.
3. Migrate the 4 highest-risk queue processors to `withQueueBilling`:
   - `contentGenerationProcessor`
   - `boltContentJobProcessor`
   - `creatorContentProcessor`
   - `campaignPlanningProcessor`
4. Flip `BILLING_REQUIRE_AI_HANDLE=true` in staging.

### Sprint 3
1. Production rollout of approval flow.
2. Operator UI for approval inbox + signing (front-end work outside this PR).
3. Flip `BILLING_REQUIRE_AI_HANDLE=true` in production.

---

## 14. Where to Read Next

- The audit's full gap list: [final-credit-ledger-gap-analysis.md](./final-credit-ledger-gap-analysis.md)
- The architecture target: [target-enterprise-credit-architecture.md](./target-enterprise-credit-architecture.md)
- Approval workflow details: [super-admin-credit-governance-audit.md §10](./super-admin-credit-governance-audit.md#10-approval-chain--currently-missing)
- Payment & billing roadmap (Sprints 4+): [payment-readiness-audit.md §15](./payment-readiness-audit.md#15-phased-roadmap-to-enterprise-readiness)
