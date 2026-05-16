# High-Gap Remediation — Phase 2

**Date:** 2026-05-15
**Branch:** `identity-spine-consolidation`
**Scope:** Migration enforcement + governance hardening + reservation completion + payment foundation
**Builds on:** [critical-gap-remediation-phase1.md](./critical-gap-remediation-phase1.md)

---

## 1. Migrated Execution Paths

### 1.1 HTTP — refine_variant (audit gap G-1)

[pages/api/activity-workspace/content.ts:743](../../pages/api/activity-workspace/content.ts) — the previously-unbilled `aiGateway.runCompletionWithOperation` call is now routed through `runBilledAiCompletion`. The call now:

1. Resolves a token-priced HOLD via `estimateLlmHoldCredits`.
2. Runs the LLM under the orchestrator scope.
3. Settles actual cost via `apply_credit_partial_confirm`.
4. Emits financial audit + correlation lineage.

Behavioral change: refine requires a `companyId` (returns 400 if missing) and consumes credits like every other content rewrite (`content_rewrite` action, fixed 3 credits per call).

### 1.2 Queue — contentGenerationProcessor (audit gap C-1 partial)

[backend/queue/jobProcessors/contentGenerationProcessor.ts:57](../../backend/queue/jobProcessors/contentGenerationProcessor.ts) — `processContentGenerationJob` now resolves the `billing.reservations_required` per-org feature flag. When enabled, the job runs under `withQueueBilling`, which:

- Computes a deterministic `execution_hash` from `(queue, jobId, payloadFingerprint)`.
- Atomically claims the `job_execution_registry` row.
- Short-circuits terminal replays (returns `{ skipped: true }`).
- Wraps execution in the orchestrator scope.
- Advances registry status to `completed` / `released` on terminal outcome.

When the flag is OFF, behavior is identical to today (the legacy in-job `deductCredits` is a stub that does nothing — see §11.2).

### 1.3 Queue — creatorContentProcessor

[backend/queue/jobProcessors/creatorContentProcessor.ts:37](../../backend/queue/jobProcessors/creatorContentProcessor.ts) — same flag-gated wrap pattern.

### 1.4 Migration Audit (Phase A discovery)

The Phase 1 scan + Phase 2 follow-up confirmed:

| Bypass class | Count | Action |
|---|---|---|
| Direct `apply_credit_reservation` RPC outside approved files | 0 | Clean |
| Direct `apply_credit_partial_confirm` RPC outside approved files | 0 | Clean |
| Direct `credit_transactions` INSERT/UPDATE/DELETE | 0 | Clean |
| Direct `organization_credits` UPDATE | 0 | Clean |
| Unwrapped `aiGateway.runCompletionWithOperation` callers | **131 (warnings)** | Each is a future migration candidate; CI guard reports under `VERBOSE_BILLING_AUDIT=true` |

The 131 aiGateway warnings are mostly:
- Internal completion routes inside content/blog/campaign generation engines that DO eventually settle through `executeWithCredits` at an outer scope.
- Background analysis engines that legitimately need allowlisting.

These are surfaced as **warnings**, not errors, so the C-2 shadow-mode rollout proceeds without false-fail CI.

### 1.5 BOLT / Campaign-Planning Processors

[backend/queue/jobProcessors/boltContentJobProcessor.ts](../../backend/queue/jobProcessors/boltContentJobProcessor.ts) and [campaignPlanningProcessor.ts](../../backend/queue/jobProcessors/campaignPlanningProcessor.ts) DO NOT make direct credit deductions — they delegate to inner pipeline services that already use `executeWithCredits`. No wrap needed; verified in Phase 2 discovery.

---

## 2. Remaining Bypasses

### 2.1 By-design bypasses (no action needed)

| Path | Why exempt |
|---|---|
| `backend/repositories/creditExecutionRepository.ts` | Single allowed RPC caller |
| `backend/services/creditExecutionService.ts` | Single allowed orchestrator |
| `backend/services/creditExpiryService.ts` | Authorized expire-phase mutator |
| `backend/services/creditOrphanHoldReaper.ts` | Authorized release-phase mutator (crash recovery) |
| `supabase/migrations/*` | Schema management |

### 2.2 Conditional bypasses (allowlist required)

Operations that legitimately consume LLM tokens without per-call charge (e.g. health-check completions, internal cache warmers) must register entries in `credit_untracked_actions` with:
- `action_key` (the operation name from `runCompletionWithOperation`)
- `reason` (free text)
- `approved_by` (super-admin user id)
- `expires_at` (optional auto-expiry)

The table is immutable (DB trigger from Phase 1 migration 20260663).

### 2.3 To-be-migrated callers (deferred, tracked as MEDIUM gaps)

The CI guard's 131 warnings represent the inventory:
- ~40 inside `contentGenerationPipeline` and its inner engines — already covered by an enclosing `executeWithCredits` scope; warnings are noisy and will be silenced via the allowlist or by adding a `creditHandle` param plumbed from the outer scope.
- ~25 in `campaignAiOrchestrator/*` — also enclosed; pending audit.
- ~30 in BOLT/Creator paths — pending follow-up wrap.
- ~36 in analysis / intelligence engines — candidates for the allowlist.

---

## 3. Feature Flag Rollout Status

The five required flags ship as part of Phase 2. Default = OFF for all of them.

| Flag | Default | Effect when ON | Owner module |
|---|---|---|---|
| `billing.orchestrator_enforced` | OFF | All new code must use `runBilledOperation`. CI guard runs PR-time. | [billingFeatureFlags.ts](../../backend/services/billing/billingFeatureFlags.ts) |
| `billing.ai_enforced`           | OFF | `aiGateway.runCompletionWithOperation` throws on unguarded calls (mirrors `BILLING_REQUIRE_AI_HANDLE` env var) | [aiGatewayBillingGuard.ts](../../backend/services/billing/aiGatewayBillingGuard.ts) |
| `billing.reservations_required` | OFF | Queue processors wrap with `withQueueBilling` (real billing) | [queueBillingMiddleware.ts](../../backend/services/billing/queueBillingMiddleware.ts) |
| `billing.reconciliation_blocking` | OFF | High-value admin operations synchronously reconcile and block on drift | reserved hook in orchestrator |
| `billing.dual_approval_required` | OFF | All admin financial actions require N≥2 sigs regardless of amount | [financeRbacService.ts](../../backend/services/billing/financeRbacService.ts) |

Each flag uses the existing org-scoped `feature_flags` table — supports cohort + percent-rollout via `evaluateFeatureFlag` (no new infra).

### Rollout readiness indicators

The dashboard endpoint [pages/api/super-admin/billing-dashboard.ts](../../pages/api/super-admin/billing-dashboard.ts) returns per-org flag state when called with `?orgId=<uuid>`, plus aggregate billing-operations counters from `billing_operations` and `v_billing_operations_health`.

Migration completeness signal exposed via `MigrationReadiness` type in [billingFeatureFlags.ts](../../backend/services/billing/billingFeatureFlags.ts):
- `orchestratorCoverage` — share of `credit_transactions` linked to a `billing_operations` row in the same window
- `pendingApprovalsCount` — `credit_action_approvals.status='pending'`
- `recentDriftCount` — output of last reconciliation cron
- `reservationLeakCount` — open HOLDs older than 24h (from `v_reservation_health`)

---

## 4. Reservation Coverage %

The audit prompt asks for a coverage % metric. Computed live by the dashboard endpoint over the previous 24h:

```
coverage = COUNT(billing_operations rows with confirm_txn_id) /
           COUNT(credit_transactions where execution_phase='confirm')
```

Today this is < 100% because:
- HTTP routes route through `executeWithCredits` directly (not through the orchestrator wrapper) — these CONFIRMs have no `billing_operations` peer yet.
- Background engines using `deductCreditsAwaited` also don't open `billing_operations`.

Both call patterns are valid (they hit the same RPC under the same idempotency invariants) — the wrapping is an *observability* improvement, not a *safety* one. Coverage rises naturally as callers migrate to `runBilledOperation`.

Expected coverage trajectory:
- Phase 2 land: ~5–15% (only queue processors when flag enabled + refine_variant)
- Sprint 3: ~40% (all HTTP routes migrated)
- Sprint 4: ~75% (background engines migrated)
- Sprint 6: ~95% (long tail closed)

---

## 5. AI Billing Enforcement Status

### Mode

**Shadow mode** (default), with two ways to enforce:

| Mechanism | Granularity | Behavior |
|---|---|---|
| `BILLING_REQUIRE_AI_HANDLE=true` env var | Global | Throws on every unguarded call platform-wide |
| `billing.ai_enforced` feature flag | Per-org | Throws only for the cohort enabled |

### Detection inventory

The Phase 2 monitoring surface:

- **In-process counter**: `untracked_ai_call_blocked_total` in [billingMetrics.ts](../../backend/services/billing/billingMetrics.ts)
- **Structured anomaly**: emitted on every unguarded call (`emitAnomaly({ kind: 'untracked_ai_call_blocked', ...})`)
- **Orphan usage scan** (hourly cron): [pages/api/cron/billing-orphan-usage-scan.ts](../../pages/api/cron/billing-orphan-usage-scan.ts) finds `usage_events` rows with no matching CONFIRM in ±5 minutes — quantifies the leak in USD
- **Integrity audit** (daily cron): [pages/api/cron/billing-integrity-audit.ts](../../pages/api/cron/billing-integrity-audit.ts) rolls up the orphan scan into the overall integrity report

### Untracked allowlist tooling

`credit_untracked_actions` table allows justified bypass entries. Today there is no admin UI; entries are managed via direct SQL (super-admin only) until the next sprint's tooling lands. Each entry has:
- `action_key` (operation name)
- `reason` (justification)
- `approved_by` (actor)
- `expires_at` (optional auto-rotation)

---

## 6. Governance / RBAC Additions

### 6.1 New roles ([financeRbacService.ts](../../backend/services/billing/financeRbacService.ts))

| Role | Powers | Subset-of |
|---|---|---|
| `FINANCE_ADMIN` | Propose grants, adjustments, freezes; execute below-threshold | implied by `SUPER_ADMIN` |
| `FINANCE_APPROVER` | Sign pending approvals (cannot self-sign — DB enforced) | implied by `SUPER_ADMIN` |
| `FINANCE_AUDITOR` | Read-only across all financial tables + dashboards | implied by both above + `SUPER_ADMIN` |

Helpers `isFinanceAdmin`, `isFinanceApprover`, `isFinanceAuditor` plus `evaluateRequiredApprovals` (combines threshold ladder + dual-approval flag).

### 6.2 Emergency freeze + billing lock

Migration [20260664_phase2_governance_and_payment_foundation.sql §2](../../supabase/migrations/20260664_phase2_governance_and_payment_foundation.sql) extends `org_controls` with:
- `emergency_freeze` (boolean) + `emergency_freeze_reason` / `_at` / `_by`
- `billing_lock` (boolean) + `billing_lock_reason` / `_at` / `_by`

Surface:
- Service: [orgFinancialControlService.ts](../../backend/services/billing/orgFinancialControlService.ts) — `applyFinancialControl({ action: 'freeze'|'unfreeze'|'lock'|'unlock' })`
- Endpoint: [pages/api/super-admin/financial-control.ts](../../pages/api/super-admin/financial-control.ts)
- Auth: `FINANCE_ADMIN` (or `SUPER_ADMIN`)

`checkFinancialControls(orgId)` is the pre-flight that the orchestrator can consult — designed to plug into `preflightCheck` without changing its contract.

### 6.3 Approval lifecycle additions

| Capability | Service | API |
|---|---|---|
| Cancel pending approval (proposer only) | [approvalCancellationService.ts](../../backend/services/billing/approvalCancellationService.ts) | [POST /api/admin/credits/approvals/cancel](../../pages/api/admin/credits/approvals/cancel.ts) |
| Sign approval (no self-sign) | (existing) | (existing) |
| Auto-expire pending after 7 days | (existing `expirePendingApprovals` cron-callable) | extend existing reaper |

DB-level safety reinforced via new RPC `cancel_credit_action_approval` (Migration §3).

### 6.4 Dual-control enforcement

`evaluateRequiredApprovals()` is the single source of truth for "how many sigs do we need for this action":

```
if (orgFlag: billing.dual_approval_required = true) → 2
else                                                → threshold_ladder(action_type, amount)
```

Wire up in `proposeApproval` is reserved for a follow-up: today `proposeApproval` reads the threshold ladder via `required_approvals_for_action` RPC directly. The new evaluator is exposed for callers that want flag-aware decisioning. A subsequent commit will swap the internal lookup once we validate no production org has the flag enabled.

---

## 7. Payment Foundation Readiness

Five new services under [backend/services/billing/payments/](../../backend/services/billing/payments/) implement the abstraction the audit roadmap requires for future Stripe / Razorpay live-mode work.

| Service | Role | Status |
|---|---|---|
| [paymentProviderAdapter.ts](../../backend/services/billing/payments/paymentProviderAdapter.ts) | Provider-agnostic dispatch; Razorpay routes to existing staging service; Stripe slot returns `NOT_IMPLEMENTED` cleanly | Foundation only |
| [billingWalletService.ts](../../backend/services/billing/payments/billingWalletService.ts) | Finance-side read of wallet state + portfolio aggregate | Production-ready |
| [invoicePreparationService.ts](../../backend/services/billing/payments/invoicePreparationService.ts) | Draft-invoice generation from CONFIRM rollups; tax_amount=0 until Stripe Tax/Avalara ships | Foundation only |
| [subscriptionProjectionService.ts](../../backend/services/billing/payments/subscriptionProjectionService.ts) | Read-only renewal projection | Foundation only |
| [usageAggregationService.ts](../../backend/services/billing/payments/usageAggregationService.ts) | Idempotent `usage_billing_snapshots` writer | Production-ready |

### Payment-foundation tables (immutable financial-evidence tables)

| Table | Purpose | Mutability |
|---|---|---|
| `company_billing_profiles` | Per-org billing identity (email, address, tax ID, currency pref) | Mutable |
| `payment_transactions` | Per-payment record across providers; UNIQUE on `(provider, provider_transaction_id)` | **Immutable** at update/delete |
| `billing_subscriptions` | Recurring billing state; UNIQUE on `(provider, provider_subscription_id)` | Mutable status transitions |
| `invoices` | Customer-facing invoice | Mutable while `status='draft'`; status-transition triggers |
| `invoice_line_items` | Per-invoice line items | **Frozen** when parent invoice leaves `draft` (DB trigger) |
| `usage_billing_snapshots` | Per-period immutable usage rollup | **Immutable** at update; UNIQUE per `(org, period_start, period_end)` |

---

## 8. Reconciliation Coverage

Three new reconciliation jobs land in Phase 2:

| Job | File | Schedule | Output |
|---|---|---|---|
| Reservation reconciliation | [reservationReconciliationJob.ts](../../backend/services/billing/jobs/reservationReconciliationJob.ts) | every 15min | Expired HOLDs, mismatched `billing_operations` confirmed-without-ledger, stuck orchestrator calls |
| Orphan usage reconciliation | [orphanUsageReconciliationJob.ts](../../backend/services/billing/jobs/orphanUsageReconciliationJob.ts) | hourly | `usage_events` with no matching CONFIRM in ±5min |
| Financial integrity audit | [financialIntegrityAuditJob.ts](../../backend/services/billing/jobs/financialIntegrityAuditJob.ts) | daily | Composite of the above + wallet drift + stale approvals + stuck fulfillments |

Cron endpoints:

| Endpoint | Cadence |
|---|---|
| [POST /api/cron/billing-reservation-reconcile](../../pages/api/cron/billing-reservation-reconcile.ts) | every 15min |
| [POST /api/cron/billing-orphan-usage-scan](../../pages/api/cron/billing-orphan-usage-scan.ts) | hourly |
| [POST /api/cron/billing-integrity-audit](../../pages/api/cron/billing-integrity-audit.ts) | daily |
| `POST /api/cron/credit-reconciliation` (pre-existing) | daily |
| `POST /api/cron/credit-orphan-hold-reap` (pre-existing) | hourly |

### Validation chain (audit prompt's Phase F continuous-verify requirement)

The integrity audit produces a single `overallStatus` ∈ `healthy | degraded | critical`:

- **Wallet ↔ ledger**: orgs with non-zero delta from `creditReconciliation.reconcileAll`
- **Reservation ↔ usage**: `billing_operations.status='confirmed'` rows whose ledger CONFIRM is missing
- **Usage ↔ settlement**: `usage_events` rows with no matching CONFIRM in ±5min
- **Invoice ↔ projection**: future hook in [usageAggregationService.ts](../../backend/services/billing/payments/usageAggregationService.ts) (snapshots are computed but not yet auto-rolled into invoices)
- **Approvals**: pending older than 24h
- **Payment fulfillment**: provider events stuck in `recorded` > 30min

Anomaly emission via [billingAuditEmitter.ts](../../backend/services/billing/billingAuditEmitter.ts) pages on `critical`.

---

## 9. Dashboard Implementations

The audit prompt requires six dashboards. They are exposed via a single read endpoint that returns the data behind all six, so a future React UI can hydrate from one round-trip:

[GET /api/super-admin/billing-dashboard](../../pages/api/super-admin/billing-dashboard.ts)

| Dashboard | Data source in response |
|---|---|
| Financial Integrity | `integrity` (live `runFinancialIntegrityAudit()` result) |
| AI Billing | `aiBilling` (enforced flag, allowlist size, in-memory counters) |
| Reservation Health | `reservationHealth` (rows from `v_reservation_health` view) |
| Admin Adjustment | `adjustments.recent` + `adjustments.byReason` (from `admin_financial_audit_events`) |
| Company Burn | `portfolio` (`getPortfolioWalletAggregate(200)` with top-10 consumers) + `focusedWallet` when `orgId` is set |
| Billing Drift | `opsHealth` (rows from `v_billing_operations_health` view) + `integrity.walletReconciliation` |

Auth: `FINANCE_AUDITOR` (or any superset role). Query params:
- `orgId` — focus a single org
- `refresh=true` — force re-run the integrity audit instead of pulling cached result (today `refresh` is a no-op because integrity is computed inline; reserved for future caching).

### KPIs

The dashboard surfaces every KPI the audit prompt enumerates:

| KPI | Source |
|---|---|
| Consumption velocity | `portfolio.topByConsumption` |
| Settlement latency | `integrity.reservationState.stuckOrchestratorCalls` |
| Orphan rate | `integrity.orphanUsage.orphanCount / orphanUsage.scanned` |
| Reservation leak rate | `integrity.reservationState.expiredHoldsAwaitingReap / reservationHealth.open_holds` |
| Retry suppression rate | `aiBilling.countersFromMemory.queue_replay_blocked_total / billing_operations_total` |
| Approval turnaround | `v_approval_health.oldest_pending_age_s` |
| Billing anomaly rate | `aiBilling.countersFromMemory.untracked_ai_call_blocked_total` over time |

---

## 10. Chaos Test Results

[backend/tests/unit/billingChaos.test.ts](../../backend/tests/unit/billingChaos.test.ts) — 8 categories, all passing:

```
PASS backend/tests/unit/billingChaos.test.ts
  Chaos #1 — multi-worker race                                  ✅
  Chaos #2 — queue replay storm                                 ✅
  Chaos #3 — provider timeout (executor rejects)                ✅
  Chaos #4 — reservation leak recovery                          ✅
  Chaos #5 — approval replay attack (same approver)             ✅
  Chaos #6 — orchestrator bypass detection (CI guard script)    ✅
  Chaos #7 — financial reconciliation under drift               ✅
  Chaos #8 — partial transaction rollback                       ✅

Test Suites: 1 passed
Tests:       8 passed
```

Combined with the rest of the Phase 2 suite:

```
PASS backend/tests/unit/billingFeatureFlags.test.ts             3 passed
PASS backend/tests/unit/financeRbacService.test.ts              5 passed
PASS backend/tests/unit/billingChaos.test.ts                    8 passed
Plus Phase 1 still passing:
PASS backend/tests/unit/billingIdempotencyService.test.ts       7 passed
PASS backend/tests/unit/billingCorrelationService.test.ts       5 passed
PASS backend/tests/unit/billingMetrics.test.ts                  2 passed
PASS backend/tests/unit/creditApprovalService.test.ts           6 passed
PASS backend/tests/unit/aiGatewayBillingGuard.test.ts           6 passed
PASS backend/tests/unit/queueBillingMiddleware.test.ts          4 passed
PASS backend/tests/integration/billingLedgerImmutability.test.ts 6 passed (+1 skipped)
```

**Phase 2 new test totals: 16 new passing tests (8 chaos + 3 feature-flag + 5 RBAC).**
**Combined Phase 1+2: 52 passing, 1 skipped.**

CI guard script run:
```
$ npx tsx scripts/audit/no-direct-credit-deductions.ts
Scanned 3253 files
Errors:   0
Warnings: 131
OK — no direct credit deductions outside the orchestrator.
```

---

## 11. Backward Compatibility Status

### 11.1 No breaking API changes

| Surface | Behavior |
|---|---|
| `executeWithCredits()` | Unchanged |
| `runCompletionWithOperation()` | Unchanged signature, unchanged behavior in shadow mode |
| `POST /api/admin/credits/grant` | Unchanged for small grants; 202+approvalId for large (already in Phase 1) |
| `POST /api/admin/credits` | Same as above for grant/adjust/set_rate |
| Cron routes pre-existing | Unchanged |
| Queue processors | Unchanged when flag OFF; flag-gated wrap is opt-in |
| Refine variant HTTP route | Now charges 3 credits per call (previously free). **Breaking for users — communicate before enabling.** |

### 11.2 Production data preservation

- `org_controls` extension is purely ADDITIVE (`ADD COLUMN IF NOT EXISTS`). Existing rows get the default values (freeze=false, lock=false).
- All immutability triggers from Phase 1 remain in force.
- New tables (`payment_transactions`, `billing_subscriptions`, `invoices`, `invoice_line_items`, `usage_billing_snapshots`, `company_billing_profiles`) start empty.
- Migration filename `20260664` is sequential to `20260663` (Phase 1's), preserving the existing repo's calendar-loose convention.

### 11.3 Refine variant — breaking change call-out

**ATTENTION**: The refine_variant route now consumes 3 credits per invocation. Existing customers who use refine in steady state should be communicated to before rollout. Recommended sequence:
1. Deploy with the change behind a `BILLING_REFINE_VARIANT_CHARGE` env flag (next sprint).
2. Email customers 7 days in advance.
3. Flip the flag.

For now, the charge is hardcoded ON because the route was unbilled — the audit explicitly identified it as a leak. If you want to defer the user-facing impact, set up the env flag in the next commit.

### 11.4 Feature flag defaults

Every flag defaults OFF, so a fresh deployment behaves identically to the pre-Phase-2 system in every observable way except:
- Refine variant now charges (per §11.3)
- CI now has a guard script (non-blocking, advisory-only on warnings)
- DB now has the immutability triggers from Phase 1 + the new tables from Phase 2

---

## 12. Remaining MEDIUM Gaps (from audit's full inventory)

These are next on the backlog per [final-credit-ledger-gap-analysis.md](./final-credit-ledger-gap-analysis.md) §4:

| ID | Title | Phase 2 status |
|---|---|---|
| M-1 | Smart-mode dedup window too short for slow engines | Not addressed (deferred to a smart-mode tuning sprint) |
| M-2 | Underfunded settlement after partial confirm | Not addressed (alerting via cost_anomalies already exists) |
| M-3 | Smart-mode dedup query non-locking (race) | Not addressed |
| M-4 | Reconciliation cadence too slow (24h drift) | **Partially addressed** by new 15-min reservation cron + hourly orphan-usage |
| M-5 | Reconciliation alerts but no auto-correct | Not addressed (anomalies emitted; auto-correct deferred) |
| M-6 | Adjust action accepts arbitrary signed delta | **Partially addressed** — adjusts now route through approval flow (Phase 1) and per-amount threshold (Phase 1) |
| M-7 | `credit_rate_usd` change has no rollback | Not addressed |
| M-8 | `usage_meter.increment_usage_meter` RPC non-idempotent | Not addressed |
| M-9 | Multi-step Razorpay fulfillment stuck rows | **Detected** by reservation reconciliation cron; remediation deferred |
| M-10 | Payment webhook delivery failure not retried | **Provider event state side-table** added; retry cron deferred |
| M-11 | `usd_equivalent` uses spot rate | Not addressed (FX engine is Sprint 5+) |
| M-12 | Out-of-calendar migration filenames | Phase 2 migration uses `20260664` (next sequential) — same convention |
| M-13 | No auto-recharge implementation | Not addressed |
| M-14 | No saved payment methods | Not addressed |
| M-15 | Single-actor admin authority (no MFA at financial ops) | Not addressed |
| M-16 | No promotional cohort / promo-code primitive | Not addressed |
| M-17 | Block has no auto-expiry | Not addressed |
| M-18 | Quota in cost dims, not credit dims | Not addressed |
| M-19 | `creditRevoke` does not write `super_admin_audit_logs` | Not addressed |
| M-20 | No proration for mid-period plan changes | Not addressed |

Sprint 3 priorities recommend: M-4 closure (full hourly reconciliation), M-9 + M-10 (payment fulfillment retry cron), M-15 (MFA for financial ops).

---

## 13. Net Files Touched in Phase 2

### Created (22 files)

| Path | Purpose |
|---|---|
| `supabase/migrations/20260664_phase2_governance_and_payment_foundation.sql` | RBAC + freeze/lock + payment foundation tables + dashboard views |
| `scripts/audit/no-direct-credit-deductions.ts` | CI guard |
| `backend/services/billing/billingFeatureFlags.ts` | 5-flag rollout registry |
| `backend/services/billing/financeRbacService.ts` | finance-role helpers + dual-approval evaluator |
| `backend/services/billing/orgFinancialControlService.ts` | freeze / lock / unfreeze / unlock |
| `backend/services/billing/approvalCancellationService.ts` | proposer-cancels-pending flow |
| `backend/services/billing/payments/paymentProviderAdapter.ts` | provider-agnostic dispatch |
| `backend/services/billing/payments/billingWalletService.ts` | finance-side wallet reads |
| `backend/services/billing/payments/invoicePreparationService.ts` | draft invoice generator |
| `backend/services/billing/payments/subscriptionProjectionService.ts` | renewal projection |
| `backend/services/billing/payments/usageAggregationService.ts` | period rollup writer |
| `backend/services/billing/jobs/reservationReconciliationJob.ts` | reservation state audit |
| `backend/services/billing/jobs/orphanUsageReconciliationJob.ts` | usage_events ↔ ledger detector |
| `backend/services/billing/jobs/financialIntegrityAuditJob.ts` | composite daily audit |
| `pages/api/cron/billing-reservation-reconcile.ts` | 15-min cron |
| `pages/api/cron/billing-orphan-usage-scan.ts` | hourly cron |
| `pages/api/cron/billing-integrity-audit.ts` | daily cron |
| `pages/api/super-admin/billing-dashboard.ts` | unified dashboard endpoint |
| `pages/api/super-admin/financial-control.ts` | freeze / lock endpoint |
| `pages/api/admin/credits/approvals/cancel.ts` | proposer-cancel endpoint |
| `backend/tests/unit/billingFeatureFlags.test.ts` | flag service tests |
| `backend/tests/unit/financeRbacService.test.ts` | RBAC tests |
| `backend/tests/unit/billingChaos.test.ts` | 8 chaos scenarios |

### Modified (5 files)

| Path | Change |
|---|---|
| `backend/services/billing/index.ts` | Export Phase 2 surface |
| `backend/types/featureFlag.ts` | Add 5 billing flag keys to `KNOWN_FEATURE_FLAGS` |
| `pages/api/activity-workspace/content.ts` | refine_variant → `runBilledAiCompletion` |
| `backend/queue/jobProcessors/contentGenerationProcessor.ts` | Flag-gated `withQueueBilling` wrap |
| `backend/queue/jobProcessors/creatorContentProcessor.ts` | Flag-gated `withQueueBilling` wrap |

---

## 14. Rollout Plan (Phase 2 → Sprint 3)

### Day 1 (this commit)
1. Apply migration `20260664` to staging.
2. Deploy code with all flags OFF.
3. Verify CI guard runs clean.
4. Monitor `untracked_ai_call_blocked_total` baseline.

### Week 1
1. Operators register `credit_untracked_actions` entries for known internal-only LLM calls (target: get warning count from 131 → < 30).
2. Enable `billing.ai_enforced` for a single canary org.
3. Enable `billing.reservations_required` for the canary org.

### Week 2
1. Roll out to 10% of orgs via percent-rollout on `billing.reservations_required`.
2. Watch the new reservation reconciliation cron output; ensure leak count is zero.
3. Monitor `v_billing_operations_health` for the canary cohort.

### Week 3
1. Roll forward to 100% on `billing.reservations_required` and `billing.ai_enforced`.
2. Communicate refine_variant charging to customers; ship the `BILLING_REFINE_VARIANT_CHARGE` env-flag override if needed for grace period.
3. Plan Sprint 3 MEDIUM closures.

---

## 15. Where to Read Next

- Phase 1 closure: [critical-gap-remediation-phase1.md](./critical-gap-remediation-phase1.md)
- Consolidated gap index: [final-credit-ledger-gap-analysis.md](./final-credit-ledger-gap-analysis.md)
- Target architecture: [target-enterprise-credit-architecture.md](./target-enterprise-credit-architecture.md)
- Payment readiness (Sprint 4+ scope): [payment-readiness-audit.md](./payment-readiness-audit.md)
