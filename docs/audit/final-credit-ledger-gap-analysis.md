# Final Credit Ledger Gap Analysis

**Date:** 2026-05-15
**Scope:** Consolidated gap inventory across discovery + consumption matrix + financial risk + payment readiness + governance + target architecture
**Status:** AUDIT ONLY — no fixes applied

This document is the single index of every gap identified across the audit, ranked by enterprise-blocking severity. Each gap is cross-referenced to its source report. Use this as the input to backlog / OKR planning.

---

## 1. Severity Distribution

| Severity | Count |
|---|---|
| **CRITICAL** (financial loss or audit failure possible *now*) | 4 |
| **HIGH** (enterprise sales blocker, compliance gap) | 17 |
| **MEDIUM** (operational risk, scaling concern) | 20 |
| **LOW** (cleanup, observability, polish) | 13 |
| **Total** | **54** |

---

## 2. CRITICAL Gaps (P0 — must close before enterprise GA)

### C-1. Queue processors POST-deduct credits, retries double-charge

- **Source:** [credit-financial-risk-audit.md §B-1](./credit-financial-risk-audit.md#b-1-queue-processor-retries-bull-mq) · [credit-consumption-matrix.md §2.1](./credit-consumption-matrix.md#21-content-generation--publishing)
- **Impacted modules:**
  - [backend/queue/jobProcessors/contentGenerationProcessor.ts:267, 372, 447, 517](../../backend/queue/jobProcessors/contentGenerationProcessor.ts)
  - [backend/queue/jobProcessors/boltContentJobProcessor.ts](../../backend/queue/jobProcessors/boltContentJobProcessor.ts)
  - [backend/queue/jobProcessors/creatorContentProcessor.ts](../../backend/queue/jobProcessors/creatorContentProcessor.ts)
  - [backend/queue/jobProcessors/campaignPlanningProcessor.ts](../../backend/queue/jobProcessors/campaignPlanningProcessor.ts)
- **Exploitability:** Triggered by worker crash, Bull MQ retry policy, or queue re-drain. Not adversarial — operational.
- **Financial risk:** Each retry deducts again *and* re-incurs LLM provider cost. Compounded across 4 high-volume processors.
- **Scaling risk:** Amplifies with traffic; crash loops can produce 3–5× over-charges per work unit.
- **Enterprise impact:** Blocks "exactly-once billing" claims; opens dispute surface.
- **Complexity:** M
- **Remediation:** At job-enqueue, immediately `reserveCreditsForWork(deterministicJobKey)`. Worker uses passed `creditHandle` to CONFIRM on success / RELEASE on failure. Bull MQ `failed` event handler must invoke RELEASE.

### C-2. `aiGateway` callable without credit wrapper (~11 candidate surfaces)

- **Source:** [credit-financial-risk-audit.md §A-1](./credit-financial-risk-audit.md#a-1-aigateway-callable-without-credit-wrapper) · [credit-consumption-matrix.md §4 (G1–G11)](./credit-consumption-matrix.md#4-identified-consumption-gaps-unguarded-cost)
- **Impacted modules:** [pages/api/activity-workspace/content.ts:743-766](../../pages/api/activity-workspace/content.ts) confirmed; plus 10 candidate services in matrix §4 requiring per-branch verification
- **Exploitability:** Currently accidental; potentially adversarial if any path is reachable by free-tier accounts
- **Financial risk:** Real provider cost, zero charge
- **Enterprise impact:** Cost-to-serve undercutting margin targets (cost_anomalies catches *after* the fact)
- **Complexity:** M (binding) + M (per-service audit)
- **Remediation:** Make `aiGateway.runCompletionWithOperation` require a `creditHandle` parameter (returned from `reserveCreditsForWork`). Reject calls without one outside an explicit allowlist persisted in `credit_untracked_actions`. CI grep guard.

### C-3. `credit_transactions` not immutable at DB layer

- **Source:** [credit-financial-risk-audit.md §H-1](./credit-financial-risk-audit.md#h-mutable-ledger-vulnerabilities) · [target-enterprise-credit-architecture.md §9](./target-enterprise-credit-architecture.md#9-required-immutability-triggers)
- **Impacted:** [database/organization_credits.sql](../../database/organization_credits.sql) and all migrations adding columns to `credit_transactions`
- **Exploitability:** Requires service-role DB access; trust boundary breach
- **Financial risk:** Catastrophic if an actor mutates / deletes historical rows
- **Enterprise impact:** Blocks SOC 2 / SOX-style controls; "convention immutability" is insufficient for audit
- **Complexity:** M
- **Remediation:** Add `BEFORE UPDATE OR DELETE` trigger raising EXCEPTION. Move mutable operational metadata to a sibling 1:1 table. Revoke UPDATE/DELETE from all roles except a sealed `ledger_admin` role used only by migrations.

### C-4. No approval chain for admin credit actions

- **Source:** [credit-financial-risk-audit.md §I-1](./credit-financial-risk-audit.md#i-1-no-approval-chain-for-admin-grants) · [super-admin-credit-governance-audit.md §10](./super-admin-credit-governance-audit.md#10-approval-chain--currently-missing)
- **Impacted:** [creditAdminGrantService.ts](../../backend/services/creditAdminGrantService.ts); [pages/api/admin/credits/grant.ts](../../pages/api/admin/credits/grant.ts); [pages/api/admin/credits/index.ts](../../pages/api/admin/credits/index.ts) (adjust + rate-set)
- **Exploitability:** Compromised super-admin account = unlimited credit minting (subject only to 3/24h velocity per org, easily circumvented across orgs)
- **Financial risk:** Single insider can issue arbitrary value
- **Enterprise impact:** Fails dual-control governance; audit committees will reject
- **Complexity:** L
- **Remediation:** Add `credit_action_approvals` schema (see governance §10.3). Require N-of-M for above-threshold actions. Block fulfillment until approval row is signed by required count.

---

## 3. HIGH Gaps (P1 — close in 1–2 sprints)

| ID | Title | Source |
|---|---|---|
| H-1 | Free-tier free report may invoke LLM without charge | [risk §A-2](./credit-financial-risk-audit.md#a-2-free-tier-free-report-branch-may-invoke-llm) |
| H-2 | `deductCreditsAwaited` after work allows retry double-charge | [risk §B-2](./credit-financial-risk-audit.md#b-2-deductcreditsawaited-after-successful-work) |
| H-3 | `usage_events` not linked to `credit_transactions` | [risk §G-1](./credit-financial-risk-audit.md#g-1-aigateway-cost-recorded-in-usage_events-is-not-linked-to-a-credit-transaction) |
| H-4 | No hard cap on admin grant amount | [risk §I-2](./credit-financial-risk-audit.md#i-2-no-hard-cap-on-grant-amount) |
| H-5 | Two grant paths with inconsistent governance | [governance §2.2 + GR-1/GR-2](./super-admin-credit-governance-audit.md#22-legacy-flow-post-apiadmincredits-action--grant) |
| H-6 | Paid refunds require manual ops + direct DB | [governance §3 REV-1](./super-admin-credit-governance-audit.md#31-revokecredit--backendservicescreditrevoketsl72-151) · [payment §10 REF-1](./payment-readiness-audit.md#101-current-state) |
| H-7 | No "reverse transaction X" primitive | [governance §11.2 FRAUD-1](./super-admin-credit-governance-audit.md#112-reverse-transaction-fraud-correction) |
| H-8 | No DB-level immutability on `super_admin_audit_logs` + `credit_admin_grants` | [governance §8 AUD-1, CAG-1](./super-admin-credit-governance-audit.md#81-super_admin_audit_logs) |
| H-9 | Stripe SDK not present | [payment §3 STR-1](./payment-readiness-audit.md#31-current-state) |
| H-10 | No Razorpay live mode | [payment §2.4 RZP-1](./payment-readiness-audit.md#24-findings) |
| H-11 | No subscription lifecycle model | [payment §4.3 SUB-1, SUB-2](./payment-readiness-audit.md#43-findings) |
| H-12 | No invoicing | [payment §5.3 INV-1, INV-2](./payment-readiness-audit.md#53-findings) |
| H-13 | No tax handling | [payment §6.3 TAX-1](./payment-readiness-audit.md#63-findings) |
| H-14 | No enterprise contract primitive | [payment §9.2 ENT-1, ENT-2](./payment-readiness-audit.md#92-findings) · [governance §12 CON-1, CON-2](./super-admin-credit-governance-audit.md#12-contract-based-allocations) |
| H-15 | Multi-currency stored but no FX engine / snapshot | [payment §7.2 FX-3](./payment-readiness-audit.md#72-findings) |
| H-16 | No customer-facing payment UI (super-admin-routed only) | [payment §2.4 RZP-2](./payment-readiness-audit.md#24-findings) |
| H-17 | Legacy `super_admin_session=1` cookie path active | [governance §7.3 RBAC-1, RBAC-3](./super-admin-credit-governance-audit.md#73-findings) |

---

## 4. MEDIUM Gaps (P2 — close in 3–6 sprints)

| ID | Title | Source |
|---|---|---|
| M-1 | Smart-mode dedup window too short for slow engines | [risk §C-1](./credit-financial-risk-audit.md#c-1-smart-mode-dedup-window-too-short-for-slow-engines) |
| M-2 | Underfunded settlement after partial confirm | [risk §D-1](./credit-financial-risk-audit.md#d-1-underfunded-settlement-after-partial-confirm) |
| M-3 | Smart-mode dedup query non-locking (race) | [risk §E-2](./credit-financial-risk-audit.md#e-2-smart-mode-dedup-query-is-non-locking) |
| M-4 | Reconciliation cadence too slow (24h drift window) | [risk §F-1](./credit-financial-risk-audit.md#f-1-reconciliation-runs-once-per-day-drift-window-is-24h) |
| M-5 | Reconciliation alerts but no auto-correct | [risk §F-2](./credit-financial-risk-audit.md#f-2-reconciliation-alerts-on-drift-but-does-not-auto-correct) |
| M-6 | Adjust action accepts arbitrary signed delta | [risk §I-3](./credit-financial-risk-audit.md#i-3-adjust-action-accepts-arbitrary-signed-delta) |
| M-7 | `credit_rate_usd` change has no rollback / time-versioning | [risk §I-4](./credit-financial-risk-audit.md#i-4-credit_rate_usd-per-org-change-has-no-rollback--reasoning) · [governance §2.4 RATE-1](./super-admin-credit-governance-audit.md#24-rate-set-flow-post-apiadmincredits-actionset_rate) |
| M-8 | `usage_meter.increment_usage_meter` RPC non-idempotent | [risk §J-3](./credit-financial-risk-audit.md#j-3-usage_meterincrement_usage_meter-rpc-is-non-idempotent) |
| M-9 | Multi-step Razorpay fulfillment can leave stuck rows | [risk §K-2](./credit-financial-risk-audit.md#k-2-credit_purchases-fulfillment-is-multi-step) · [payment §2.4 RZP-3](./payment-readiness-audit.md#24-findings) |
| M-10 | Payment webhook delivery failure not retried | [risk §M-3](./credit-financial-risk-audit.md#m-3-payment-webhook-delivery-failure) |
| M-11 | `usd_equivalent` uses spot rate (not snapshot) | [risk §N-1](./credit-financial-risk-audit.md#n-1-usd_equivalent-on-ledger-rows-uses-spot-credit_rate_usd) |
| M-12 | Out-of-calendar migration filenames (`06-31`, `06-34`) | [risk §O-2](./credit-financial-risk-audit.md#o-2-out-of-calendar-migration-filenames-20260631-20260634) |
| M-13 | No auto-recharge implementation | [payment §8 AR-1](./payment-readiness-audit.md#82-findings) |
| M-14 | No saved payment methods | [payment §2.4 RZP-4](./payment-readiness-audit.md#24-findings) |
| M-15 | Single-actor admin authority (no MFA at financial ops) | [governance §7.3 RBAC-3](./super-admin-credit-governance-audit.md#73-findings) |
| M-16 | No promotional cohort / promo-code primitive | [governance §9.2 PROMO-1, PROMO-2](./super-admin-credit-governance-audit.md#92-findings) |
| M-17 | Block has no auto-expiry | [governance §5.2 CTRL-2](./super-admin-credit-governance-audit.md#52-enforcement-at-deduction-time) |
| M-18 | Quota in cost dims, not credit dims | [payment §13.1 QE-1](./payment-readiness-audit.md#131-findings) |
| M-19 | `creditRevoke` does not write `super_admin_audit_logs` | [governance §3 REV-2](./super-admin-credit-governance-audit.md#31-revokecredit--backendservicescreditrevoketsl72-151) |
| M-20 | No proration for mid-period plan changes | [payment §4.3 SUB-3](./payment-readiness-audit.md#43-findings) |

---

## 5. LOW Gaps (P3 — close opportunistically)

| ID | Title | Source |
|---|---|---|
| L-1 | Direct-RPC callers leave `performed_by=NULL` | [risk §G-2](./credit-financial-risk-audit.md#g-2-direct-rpc-callers-bypass-recordadminaudit-shim) |
| L-2 | `metadata` JSONB on ledger is freely writable | [risk §H-2](./credit-financial-risk-audit.md#h-2-metadata-jsonb-on-credit_transactions-is-freely-writable) |
| L-3 | Webhook idempotency lacks test coverage | [risk §C-2](./credit-financial-risk-audit.md#c-2-webhook-retries-handled-but-not-asserted) |
| L-4 | `hasEnoughCredits` is a non-locking hint | [risk §E-1](./credit-financial-risk-audit.md#e-1-wallet-for-update-locking-is-correct-application-level-checks-are-not) |
| L-5 | Confirm/usage telemetry are sequential, not transactional | [risk §K-3](./credit-financial-risk-audit.md#k-3-confirmcreditreservation--trackusage--logusageevent-are-sequential-not-transactional) |
| L-6 | Time-sensitive HOLDs stuck up to 1h before reaper releases | [risk §M-2](./credit-financial-risk-audit.md#m-2-network-failure-between-hold-and-executor) |
| L-7 | `cost_anomalies` are alert-only (no auto-disable) | [risk §N-2](./credit-financial-risk-audit.md#n-2-cost_anomalies-flag-drift-but-action-is-alert-only) |
| L-8 | `audit_log.target_id` is stringly-typed | [governance §8 AUD-3](./super-admin-credit-governance-audit.md#81-super_admin_audit_logs) |
| L-9 | `isSuperAdmin` + `isPlatformSuperAdmin` duplicated | [governance §7.3 RBAC-2](./super-admin-credit-governance-audit.md#73-findings) |
| L-10 | No customer notification on block | [governance §5.2 CTRL-3](./super-admin-credit-governance-audit.md#52-enforcement-at-deduction-time) |
| L-11 | No advance notification for free credit expiry | [governance §4 EXP-2](./super-admin-credit-governance-audit.md#42-pass-2--incentive-expiry-config-gated) |
| L-12 | No price-change history / preview | [payment §12 PE-1, PE-2](./payment-readiness-audit.md#121-strengths) |
| L-13 | No alert routing rules / dashboard for `monetization_operational_events` | [payment §11 MOE-1, MOE-2](./payment-readiness-audit.md#112-strengths) |

---

## 6. Cross-Section Themes

### Theme A: Application-edge billing safety

The DB-layer is enterprise-grade. The application edges leak. Closing the queue-processor and untracked-aiGateway gaps (C-1, C-2) is the single highest-leverage hardening.

### Theme B: DB-enforced immutability

The ledger is *conventionally* append-only. Triggers are required to make it *enforced* (C-3 + H-8).

### Theme C: Governance lifts cannot be deferred

Approval chains, amount caps, and reversal primitives (C-4 + H-4 + H-6 + H-7) are structural — they don't scale by patching individual endpoints; they require a new approval-workflow schema.

### Theme D: Payment + billing edge is greenfield

Stripe, subscriptions, invoicing, tax, multi-currency, contracts (H-9–H-15) constitute most of the enterprise readiness work and are sequenced in [target-enterprise-credit-architecture.md §12](./target-enterprise-credit-architecture.md#12-migration-sequencing-plan-suggested).

### Theme E: Pricing engine + reconciliation are strong assets

The `pricingService`, `pricingIntelligenceService`, `costGovernanceService`, `creditReconciliation`, and `creditOrphanHoldReaper` are well-architected and require only cadence/observability lifts.

---

## 7. Recommended Closure Sequence

### Sprint 1 (P0 hardening)
- C-1 (queue processor HOLD migration)
- C-3 (immutability triggers)
- C-2 part 1 (binding aiGateway → creditHandle)

### Sprint 2 (Governance)
- C-4 (approval workflow schema)
- H-4 (hard amount cap)
- H-8 (immutability on audit tables)
- H-5 (consolidate grant paths)

### Sprint 3 (Reversal + audit completeness)
- H-6 / H-7 (refund + reversal RPCs)
- H-3 (`usage_events` ↔ `credit_transactions` FK)
- M-19 (`creditRevoke` audit log alignment)

### Sprint 4 (Stripe foundation)
- H-9 (Stripe adapter)
- Provider-agnostic webhook abstraction
- `company_billing_profiles` + `saved_payment_methods`

### Sprint 5 (Subscriptions + FX)
- H-11 (subscription lifecycle)
- H-15 (FX engine + ledger snapshot)
- M-11 (`usd_equivalent` snapshot)

### Sprint 6 (Invoicing)
- H-12 (invoices + line items + PDF)
- H-13 (tax integration)

### Sprint 7 (Enterprise contracts + auto-recharge)
- H-14 (enterprise contracts)
- M-13 (auto-recharge)
- M-14 (saved payment methods consumer flow)

### Sprint 8 (Polish + observability)
- All LOW items
- Operational dashboards
- Customer self-service portal

---

## 8. Exit Criteria for "Enterprise-Ready"

The credit + billing system is **enterprise-ready** when:

1. ✅ Every CRITICAL gap closed (C-1 through C-4)
2. ✅ All HIGH gaps closed (H-1 through H-17)
3. ✅ Continuous reconciliation runs (max drift window < 1h for top 20% paid orgs)
4. ✅ End-to-end tests prove "exactly once" billing under worker crash + retry
5. ✅ End-to-end tests prove "exactly once" payment fulfillment under webhook re-delivery
6. ✅ Audit committee reviewed approval workflow + amount caps
7. ✅ External finance / tax counsel signed off on invoicing + tax
8. ✅ Stripe + Razorpay both in live mode with valid PCI + KYC
9. ✅ Subscription renewal cron observed producing correct credit grants for 90 days
10. ✅ Customer-facing billing portal in beta with first enterprise customer

Until these are met, the system is **production-capable but enterprise-blocked**.

---

## 9. Files Touched (Audit Index)

This audit produced seven reports:

1. [credit-system-discovery.md](./credit-system-discovery.md) — discovery + schema + service inventory
2. [credit-consumption-matrix.md](./credit-consumption-matrix.md) — every credit-spending callsite classified
3. [credit-financial-risk-audit.md](./credit-financial-risk-audit.md) — risks A–P with severity & remediation
4. [payment-readiness-audit.md](./payment-readiness-audit.md) — Stripe / Razorpay / subscriptions / invoicing / tax / multi-currency
5. [super-admin-credit-governance-audit.md](./super-admin-credit-governance-audit.md) — admin authority, audit trail, approval workflow
6. [target-enterprise-credit-architecture.md](./target-enterprise-credit-architecture.md) — target shape with required data models, RPCs, crons
7. [final-credit-ledger-gap-analysis.md](./final-credit-ledger-gap-analysis.md) — this file (consolidated gap index)

No source code was modified during this audit.
