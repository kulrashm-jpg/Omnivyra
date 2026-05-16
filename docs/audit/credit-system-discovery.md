# Credit System Discovery Report

**Date:** 2026-05-15
**Scope:** Enterprise architecture & financial governance audit of Credit Ledger, Balance, and Usage Metering subsystems
**Status:** AUDIT ONLY — no fixes applied

---

## 1. Executive Summary

Virality operates a **three-tier credit architecture**:

1. **Wallet projection** (`organization_credits`) — per-org balance with category splits (`free` / `paid` / `incentive`) and live reservation counters.
2. **Append-only ledger** (`credit_transactions`) — immutable transaction log keyed by `idempotency_key`, with phases `hold | confirm | release | grant | expire | expire_incentive`.
3. **Atomic execution layer** — Postgres RPC functions `apply_credit_reservation` and `apply_credit_partial_confirm` are the **only** legal mutators. All credit-changing application code must go through them.

The system is **strong on atomicity and idempotency** at the database layer, but **weak at the consumption edges** (queue processors, post-execution deductions, untracked LLM paths) and **immature on the monetization edges** (Stripe missing, Razorpay staging-only, no invoicing/tax).

| Layer | Readiness | Critical Gaps |
|---|---|---|
| Storage schema | **Enterprise-ready** | None at schema level |
| RPC mutation engine | **Enterprise-ready** | None |
| Wallet reconciliation | **Enterprise-ready** | Manual triage on drift |
| Consumption discipline | **Partially-ready** | Queue retries can double-deduct |
| Admin governance | **Partially-ready** | No approval chain, no amount cap |
| Payment gateways | **Prototype-level** | Razorpay test-mode only, no Stripe |
| Billing/invoicing/tax | **Missing** | No invoice, GST/VAT, auto-recharge |
| Multi-currency | **Prototype-level** | Currency stored but no FX engine |

---

## 2. Storage Schema Inventory

### 2.1 Wallet Projection — `organization_credits`

[database/organization_credits.sql](../../database/organization_credits.sql) + [supabase/migrations/20260322_wallet_reservation.sql](../../supabase/migrations/20260322_wallet_reservation.sql) + [supabase/migrations/20260631_restore_canonical_credit_wallet.sql](../../supabase/migrations/20260631_restore_canonical_credit_wallet.sql)

```sql
CREATE TABLE organization_credits (
  organization_id     uuid PRIMARY KEY,
  free_balance        int NOT NULL DEFAULT 0 CHECK (free_balance >= 0),
  paid_balance        int NOT NULL DEFAULT 0 CHECK (paid_balance >= 0),
  incentive_balance   int NOT NULL DEFAULT 0 CHECK (incentive_balance >= 0),
  reserved_free       int NOT NULL DEFAULT 0 CHECK (reserved_free >= 0),
  reserved_paid       int NOT NULL DEFAULT 0 CHECK (reserved_paid >= 0),
  reserved_incentive  int NOT NULL DEFAULT 0 CHECK (reserved_incentive >= 0),
  lifetime_purchased  int NOT NULL DEFAULT 0,
  lifetime_consumed   int NOT NULL DEFAULT 0,
  credit_rate_usd     numeric(10,6) NOT NULL DEFAULT 0.01,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);
```

**Key properties:**
- Legacy single `balance_credits` column was **dropped** in [20260323_remove_balance_credits.sql](../../supabase/migrations/20260323_remove_balance_credits.sql). Source of truth is now the category split.
- `reserved_*` columns model in-flight HOLDs (FOR UPDATE locking).
- `credit_rate_usd` allows per-org USD valuation override (operator-controlled).

### 2.2 Append-Only Ledger — `credit_transactions`

Final shape after [20260321_credit_ledger_hardening.sql](../../supabase/migrations/20260321_credit_ledger_hardening.sql), [20260322_wallet_reservation.sql](../../supabase/migrations/20260322_wallet_reservation.sql), [20260625_monetization_invariant_hardening.sql](../../supabase/migrations/20260625_monetization_invariant_hardening.sql):

```sql
CREATE TABLE credit_transactions (
  id                    uuid PRIMARY KEY,
  organization_id       uuid NOT NULL,
  transaction_type      text CHECK (transaction_type IN ('purchase','deduction','adjustment','refund')),
  credits_delta         numeric(18,6) NOT NULL,
  balance_after         numeric(18,6) NOT NULL,
  usd_equivalent        numeric(14,6),
  reference_type        text,
  reference_id          text,           -- widened from uuid in 20260625
  note                  text,
  performed_by          uuid,
  idempotency_key       text,           -- UNIQUE where NOT NULL
  execution_phase       text,           -- hold|confirm|release|grant|expire|expire_incentive
  parent_transaction_id uuid,           -- confirm/release point at hold
  expires_at            timestamptz,
  category              text,           -- free|paid|incentive
  free_delta            int NOT NULL DEFAULT 0,
  paid_delta            int NOT NULL DEFAULT 0,
  incentive_delta       int NOT NULL DEFAULT 0,
  metadata              jsonb NOT NULL DEFAULT '{}',
  created_at            timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX idx_credit_txn_idempotency
  ON credit_transactions(idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX idx_credit_tx_parent_phase  ON credit_transactions(parent_transaction_id, execution_phase);
CREATE INDEX idx_credit_tx_org_phase_key ON credit_transactions(organization_id, execution_phase, idempotency_key);
```

**Immutability:** No UPDATE statements on `credit_transactions` exist in the application code path — all mutations are pure INSERTs from `apply_credit_reservation`. No trigger enforces this at DB level (see [Risk-H](./credit-financial-risk-audit.md#h-mutable-ledger-vulnerabilities)).

### 2.3 Atomic Mutation RPCs

Defined in [supabase/migrations/20260625_monetization_invariant_hardening.sql](../../supabase/migrations/20260625_monetization_invariant_hardening.sql).

`apply_credit_reservation(org, phase, free, incentive, paid, idem_key, ref_type, ref_id, note, actor, parent, category) -> jsonb`

| Phase | Behavior |
|---|---|
| `hold` | `FOR UPDATE` lock; validate `balance ≥ requested`; deduct balance, add to reserved; insert negative-delta ledger row |
| `confirm` | Deduct from reserved (no balance change — already moved at HOLD); increment `lifetime_consumed`; insert negative-delta ledger row with `parent_transaction_id` |
| `release` | Restore reserved → balance; insert positive-delta ledger row |
| `grant`  | Add to category balance; increment `lifetime_purchased`; insert positive-delta ledger row |
| `expire` / `expire_incentive` | Guarded (paid can never expire); deduct from category balance |

**Idempotency:** Uniqueness on `idempotency_key`; on `unique_violation` the RPC catches and returns the existing row (lines 363-373 of the migration).

`apply_credit_partial_confirm(org, hold_id, actual_free, actual_incentive, actual_paid, idem_key, ...) -> jsonb`
— Used for token-priced LLM work: settles actual cost < held cost by emitting one CONFIRM (negative actual) + one RELEASE (positive overage) atomically, marks `is_underfunded` when actual > held.

### 2.4 Supporting Tables

| Table | Migration | Purpose |
|---|---|---|
| `credit_usage_log` | [20260322_wallet_reservation.sql](../../supabase/migrations/20260322_wallet_reservation.sql) | 1:1 with CONFIRM rows; per-action usage telemetry |
| `credit_alert_log` | [creditAlertService.ts:58](../../backend/services/creditAlertService.ts#L58) | 24h-dedup balance threshold alerts |
| `credit_admin_grants` | [20260513_simplify_free_credit_model.sql](../../supabase/migrations/20260513_simplify_free_credit_model.sql) | Super-admin grant audit row |
| `free_credit_config` | [20260322_domain_credit_hardening.sql](../../supabase/migrations/20260322_domain_credit_hardening.sql) | Configurable free/incentive credit policy |
| `free_credit_claims` | [20260322_domain_level_credit_enforcement.sql](../../supabase/migrations/20260322_domain_level_credit_enforcement.sql) | Per-domain uniqueness for initial signup credits |
| `free_credit_profiles` | [database/free-credits-schema.sql](../../database/free-credits-schema.sql) | Onboarding bonus state + expiry |
| `credit_purchases` | [20260322_monetization_foundation.sql](../../supabase/migrations/20260322_monetization_foundation.sql) | Payment-gateway-originated purchases |
| `payment_provider_events` | [20260625_monetization_invariant_hardening.sql](../../supabase/migrations/20260625_monetization_invariant_hardening.sql) | Webhook dedup + processing audit |
| `credit_expiry_log` | [creditExpiryService.ts:189](../../backend/services/creditExpiryService.ts#L189) | Per-expiry audit |
| `super_admin_audit_logs` | [20260420_hardening_auth_email_invites.sql](../../supabase/migrations/20260420_hardening_auth_email_invites.sql) | Cross-cutting admin action audit |
| `cost_budgets` / `cost_events` | [costGovernanceService.ts](../../backend/services/costGovernanceService.ts) | Soft/hard ceiling enforcement |
| `cost_anomalies` | [20260515_pricing_engine.sql](../../supabase/migrations/20260515_pricing_engine.sql) | Pricing guardrail violations |
| `usage_meter_monthly` | [database/usage_meter.sql](../../database/usage_meter.sql) | Tokens / API calls / cost rollup per org/month |
| `org_weekly_metrics` | [20260515_pricing_engine.sql](../../supabase/migrations/20260515_pricing_engine.sql) | Margin computation per week |
| `monetization_operational_events` | [20260627_monetization_operational_observability.sql](../../supabase/migrations/20260627_monetization_operational_observability.sql) | Payment-flow telemetry |

---

## 3. Service Layer Inventory

| Service | File | Role |
|---|---|---|
| **creditExecutionService** | [backend/services/creditExecutionService.ts](../../backend/services/creditExecutionService.ts) | Single mutation authority — HOLD/EXECUTE/CONFIRM/RELEASE orchestrator. `executeWithCredits<T>`, `reserveCreditsForWork`, `confirmCreditReservation`, `releaseCreditReservation`, `deductCreditsAwaited`, `deductCreditsIfValueAwaited`, `createCredit`, `makeIdempotencyKey` |
| **creditExecutionRepository** | [backend/repositories/creditExecutionRepository.ts](../../backend/repositories/creditExecutionRepository.ts) | Thin wrapper over RPC calls (`callCreditReservation`, `callCreditPartialConfirm`, `findCreditTransaction`, `loadCreditHoldSplit`) |
| **creditDeductionService** | [backend/services/creditDeductionService.ts](../../backend/services/creditDeductionService.ts) | Read-only cost lookups (`getCreditCost`, `hasEnoughCredits`, `wasRecentlyRun`, `hasFreeCreditAccess`) |
| **creditPriorityService** | [backend/services/creditPriorityService.ts](../../backend/services/creditPriorityService.ts) | Wallet snapshot reads + category split decisioning (`getWalletSnapshot`, `computeAvailable`, `computeSplit`, `resolveDeduction`) |
| **creditPriorityEngine** | [backend/services/creditPriorityEngine.ts](../../backend/services/creditPriorityEngine.ts) | Category drain priority (free → incentive → paid) |
| **creditReadService** | [backend/services/creditReadService.ts](../../backend/services/creditReadService.ts) | User-facing summary reads (`getOrgCreditSummary`) |
| **creditReconciliation** | [backend/services/creditReconciliation.ts](../../backend/services/creditReconciliation.ts) | Wallet-vs-ledger drift verification (`reconcileOrg`, `reconcileAll`) |
| **creditOrphanHoldReaper** | [backend/services/creditOrphanHoldReaper.ts](../../backend/services/creditOrphanHoldReaper.ts) | Hourly cron — releases crashed HOLDs |
| **creditExpiryService** | [backend/services/creditExpiryService.ts](../../backend/services/creditExpiryService.ts) | Daily cron — expires free/incentive credits |
| **creditAdminGrantService** | [backend/services/creditAdminGrantService.ts](../../backend/services/creditAdminGrantService.ts) | Super-admin grant flow with rate limit + audit |
| **creditAdminGrantContract** | [backend/services/creditAdminGrantContract.ts](../../backend/services/creditAdminGrantContract.ts) | Type/enum contract for admin grants |
| **creditRevoke** | [backend/services/creditRevoke.ts](../../backend/services/creditRevoke.ts) | Operator clawback (free/incentive only) |
| **creditAlertService** | [backend/services/creditAlertService.ts](../../backend/services/creditAlertService.ts) | Balance threshold notifications |
| **creditEstimationService** | [backend/services/creditEstimationService.ts](../../backend/services/creditEstimationService.ts) | Pre-flight cost preview |
| **creditEfficiencyEngine** | [backend/services/creditEfficiencyEngine.ts](../../backend/services/creditEfficiencyEngine.ts) | Smart-mode dedup logic |
| **creditGuardService** | [backend/services/creditGuardService.ts](../../backend/services/creditGuardService.ts) | Org control preflight (block/risk/daily limit) |
| **creditEnforcer (shield)** | [lib/shield/creditEnforcer.ts](../../lib/shield/creditEnforcer.ts) | Edge/middleware enforcement |
| **pricingService** | [backend/services/pricingService.ts](../../backend/services/pricingService.ts) | LLM cost engine: `resolveLlmCost`, `estimateLlmHoldCredits`, `validateModelLimits`, `recordCostAnomaly` |
| **pricingIntelligenceService** | [backend/services/pricingIntelligenceService.ts](../../backend/services/pricingIntelligenceService.ts) | Margin optimization (20%–60% target) |
| **costGovernanceService** | [backend/services/costGovernanceService.ts](../../backend/services/costGovernanceService.ts) | Budget enforcement (`allowed`/`warned`/`denied`/`overage_approved`) |
| **razorpayStagingService** | [backend/services/payments/razorpayStagingService.ts](../../backend/services/payments/razorpayStagingService.ts) | Razorpay test-mode order + webhook handler |

---

## 4. API Surface

### 4.1 Mutation Endpoints

| Route | Auth | Action |
|---|---|---|
| `POST /api/admin/credits/grant` | super-admin | Free credit grant (reason+reasonType required) |
| `POST /api/admin/credits` (action=`grant`/`adjust`/`set_rate`) | super-admin | Legacy paid grant / signed adjust / USD rate set |
| `POST /api/admin/org/[id]/control` | super-admin | Block, daily limit, high-risk flag |
| `POST /api/super-admin/credit-reconciliation` | super-admin | Manual reconcile trigger |
| `POST /api/super-admin/razorpay/create-staging-order` | super-admin (gated) | Initiate Razorpay test order |
| `POST /api/super-admin/razorpay/verify-staging-payment` | super-admin | Manual verify/fulfill |
| `POST /api/webhooks/razorpay-staging` | HMAC signature | Process Razorpay webhook |
| `POST /api/cron/credit-reconciliation` | CRON_SECRET / super-admin | Scheduled drift scan |
| `POST /api/cron/credit-orphan-hold-reap` | CRON_SECRET / super-admin | Scheduled HOLD cleanup |
| `POST /api/cron/credit-expiry` | CRON_SECRET / super-admin | Scheduled free/incentive expiry |

### 4.2 Cron Cadence

| Cron | Recommended | File |
|---|---|---|
| Orphan HOLD reaper | hourly | [pages/api/cron/credit-orphan-hold-reap.ts](../../pages/api/cron/credit-orphan-hold-reap.ts) |
| Reconciliation | daily | [pages/api/cron/credit-reconciliation.ts](../../pages/api/cron/credit-reconciliation.ts) |
| Expiry | daily | [pages/api/cron/credit-expiry.ts](../../pages/api/cron/credit-expiry.ts) (referenced by [creditExpiryService.ts](../../backend/services/creditExpiryService.ts)) |

---

## 5. Migration Timeline (chronological)

| Date | Migration | Step |
|---|---|---|
| 2026-03-22 | `20260322_monetization_foundation.sql` | `pricing_plans`, `credit_packages`, `credit_purchases` |
| 2026-03-22 | `20260322_wallet_reservation.sql` | Category split + reserved counters + `apply_credit_reservation` |
| 2026-03-22 | `20260322_domain_credit_hardening.sql` | Domain-level free credit uniqueness |
| 2026-03-22 | `20260322_expiry_category_guard.sql` | Paid-non-expire invariant at RPC layer |
| 2026-03-23 | `20260323_remove_balance_credits.sql` | Drop legacy single-balance column |
| 2026-05-13 | `20260513_simplify_free_credit_model.sql` | `credit_admin_grants` table + reason taxonomy |
| 2026-05-15 | `20260515_pricing_engine.sql` | `llm_model_pricing`, `action_pricing_config`, `cost_anomalies`, `org_weekly_metrics` |
| 2026-05-17 | `20260517_pricing_intelligence.sql` | Margin recommendation queue |
| 2026-06-25 | `20260625_monetization_invariant_hardening.sql` | Terminal phase validation, `apply_credit_partial_confirm`, provider event dedup |
| 2026-06-27 | `20260627_monetization_operational_observability.sql` | Payment flow event stream |
| 2026-06-31 | `20260631_restore_canonical_credit_wallet.sql` | Wallet table idempotent recovery |
| 2026-06-34 | `20260634_rebuild_canonical_credit_wallet_projection.sql` | Wallet rebuild from ledger |

> Migration date filenames `06-31` and `06-34` are out-of-calendar (likely placeholder sequencing). Recommend renumbering during the next finance-touching migration window — see [Risk-O](./credit-financial-risk-audit.md#o-currency-conversion-limitations).

---

## 6. Existing Architecture Documents

| Doc | Path |
|---|---|
| Credit reliability hardening | [architecture-migration/reports/credit-reliability-hardening/credit-reliability-hardening.md](../../architecture-migration/reports/credit-reliability-hardening/credit-reliability-hardening.md) |
| AI cost visibility | [docs/AI-COST-VISIBILITY-STAGE-1-2-REPORT.md](../AI-COST-VISIBILITY-STAGE-1-2-REPORT.md) |
| AI usage audit (campaign pipeline) | [docs/AI-USAGE-AUDIT-CAMPAIGN-PIPELINE.md](../AI-USAGE-AUDIT-CAMPAIGN-PIPELINE.md) |
| Audit script for legacy reads | [scripts/audit-legacy-ledger-reads.ts](../../scripts/audit-legacy-ledger-reads.ts) |
| Governance ledger | [database/governance_event_ledger.sql](../../database/governance_event_ledger.sql) |

---

## 7. Discovery Findings Summary

- **DB safety strong:** Atomic RPCs, FOR UPDATE locking, unique idempotency keys, reaper + reconciliation cron. The financial integrity floor is enterprise-grade *as long as application code uses the RPCs*.
- **App safety mixed:** Some consumption paths still POST-deduct (queue processors, autonomous engines) instead of using the HOLD/CONFIRM flow — see [credit-consumption-matrix.md](./credit-consumption-matrix.md).
- **Monetization edge immature:** Razorpay is test-mode-only; no Stripe; no invoicing/tax/auto-recharge; multi-currency stored but not converted. See [payment-readiness-audit.md](./payment-readiness-audit.md).
- **Governance has structural gaps:** No approval chain, no amount cap, no per-org grant allowlist. See [super-admin-credit-governance-audit.md](./super-admin-credit-governance-audit.md).
- **Target enterprise architecture:** Required additions documented in [target-enterprise-credit-architecture.md](./target-enterprise-credit-architecture.md).
- **Consolidated gap list:** See [final-credit-ledger-gap-analysis.md](./final-credit-ledger-gap-analysis.md).
