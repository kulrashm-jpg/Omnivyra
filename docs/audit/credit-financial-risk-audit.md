# Credit Financial Risk Audit

**Date:** 2026-05-15
**Scope:** Detected risks A–P from the audit prompt, classified for enterprise impact
**Status:** AUDIT ONLY — no remediation applied

---

## Format

Every finding includes:

- **Severity** — CRITICAL / HIGH / MEDIUM / LOW
- **Impacted modules** — file:line references
- **Exploitability** — accidental, retry-induced, or adversarial
- **Financial risk** — direct $ exposure / unmetered cost / audit failure
- **Scaling risk** — what breaks at 10×/100× load
- **Enterprise impact** — what blocks enterprise sales
- **Implementation complexity** — S / M / L / XL
- **Recommended remediation** (advisory only — not implemented)

---

## A. Missing Deductions

### A-1. `aiGateway` callable without credit wrapper

- **Severity:** CRITICAL
- **Impacted:** [pages/api/activity-workspace/content.ts:743-766](../../pages/api/activity-workspace/content.ts) (Refine Variant); all "GAP G1–G11" services listed in [credit-consumption-matrix.md §4](./credit-consumption-matrix.md#4-identified-consumption-gaps-unguarded-cost)
- **Exploitability:** Accidental (no code-level binding between `aiGateway.runCompletionWithOperation` and `executeWithCredits`). An adversary with a free-tier account could trigger high-frequency unmetered LLM calls if any such path is reachable through public UI.
- **Financial risk:** Real OpenAI/Anthropic spend with no credit deduction. Compounded across 11 candidate gap surfaces.
- **Scaling risk:** Cost scales with usage; margin guardrails (`cost_anomalies`) detect the leak *after the fact*, not pre-flight.
- **Enterprise impact:** Customers can dispute that "AI costs" billed do not match invoiced usage; ledger drift between `usage_events` and `credit_transactions` invalidates the audit trail.
- **Complexity:** M
- **Remediation:** Make `aiGateway` accept a required `creditHandle` parameter (output of a `reserveCreditsForWork` call). Reject calls without one outside an explicit allowlist persisted in DB (`credit_untracked_actions`). Add a CI check that grep-fails new `runCompletionWithOperation` callers lacking an `executeWithCredits` enclosure.

### A-2. Free-tier "free report" branch may invoke LLM

- **Severity:** HIGH
- **Impacted:** [pages/api/reports/generate.ts:263-268](../../pages/api/reports/generate.ts), [backend/services/growthReportService.ts](../../backend/services/growthReportService.ts)
- **Exploitability:** Accidental
- **Financial risk:** Free reports may delegate to LLM-backed render paths with no charge
- **Complexity:** S
- **Remediation:** Either gate free reports to a non-LLM template, or attach a free-credit drain via `category='free'` HOLD.

---

## B. Double-Deduction Risks

### B-1. Queue processor retries (Bull MQ)

- **Severity:** CRITICAL
- **Impacted:** [backend/queue/jobProcessors/contentGenerationProcessor.ts:267, 372, 447, 517](../../backend/queue/jobProcessors/contentGenerationProcessor.ts); [boltContentJobProcessor.ts](../../backend/queue/jobProcessors/boltContentJobProcessor.ts); [creatorContentProcessor.ts](../../backend/queue/jobProcessors/creatorContentProcessor.ts); [campaignPlanningProcessor.ts](../../backend/queue/jobProcessors/campaignPlanningProcessor.ts)
- **Exploitability:** Triggered by infra: worker crash after work done + before deduct, or Bull MQ re-enqueue policy
- **Financial risk:** Each retry deducts again. With aggressive retry policies (3 attempts), a single piece of work could deduct 3× the credits, and 3× tokens at the LLM provider too.
- **Scaling risk:** Crash-loop on hot worker amplifies; tail risk is bounded by `lifetime_consumed` ceilings but not by per-job invariants.
- **Enterprise impact:** Customer dispute on duplicate charges; impossible to prove "exactly once" billing without HOLD-first model.
- **Complexity:** M
- **Remediation:** Convert all queue processors to PRE-HOLD: at job enqueue, immediately `reserveCreditsForWork(jobId)`; in worker, only EXECUTE + CONFIRM; on job `failed` event, RELEASE. Use deterministic `idempotencyKey = sha256(jobId)`.

### B-2. `deductCreditsAwaited` after successful work

- **Severity:** HIGH
- **Impacted:** [campaignPredictionEngine.ts:254](../../backend/services/campaignPredictionEngine.ts), [portfolioDecisionEngine.ts:190](../../backend/services/portfolioDecisionEngine.ts), [replyGenerationService.ts:152](../../backend/services/replyGenerationService.ts)
- **Exploitability:** Retry after deduct-failure but post-work
- **Financial risk:** Bounded by smart-mode window if configured; otherwise per-run cost duplication
- **Complexity:** S
- **Remediation:** Same as B-1, but in-process: HOLD before the engine runs.

---

## C. Retry Duplication Risks

### C-1. Smart-mode dedup window too short for slow engines

- **Severity:** MEDIUM
- **Impacted:** [creditDeductionService.ts:150-166](../../backend/services/creditDeductionService.ts) (`wasRecentlyRun`); engine callers using `deductCreditsIfValueAwaited`
- **Exploitability:** Re-run within window N is suppressed; outside it, re-detection of the same signal re-charges.
- **Financial risk:** Background engines (competitor intel, pattern detection) running e.g. every 30m with 5m smart window will charge twice for the same persistent signal.
- **Complexity:** S
- **Remediation:** Anchor dedup not on time-window alone but on a **signal fingerprint** (e.g. `sha256(orgId, action, signal_payload)`) stored on the CONFIRM row; suppress re-charge if fingerprint repeats inside a longer "stable signal" window (e.g. 24h).

### C-2. Webhook retries handled but not asserted

- **Severity:** LOW
- **Impacted:** [pages/api/webhooks/razorpay-staging.ts](../../pages/api/webhooks/razorpay-staging.ts); `payment_provider_events(provider, provider_event_id) UNIQUE`
- **Exploitability:** Razorpay re-fires webhook
- **Financial risk:** Mitigated by unique index; HIGH only if signature verification regresses
- **Complexity:** S
- **Remediation:** Add an integration test that re-posts the same provider event and asserts only one CONFIRM row appears.

---

## D. Negative Balance Risks

### D-1. Underfunded settlement after partial confirm

- **Severity:** MEDIUM
- **Impacted:** [creditExecutionService.ts:967-1000](../../backend/services/creditExecutionService.ts) (`autoBlockLlm`); `apply_credit_partial_confirm` `is_underfunded` flag
- **Exploitability:** Actual LLM token cost exceeds held ceiling due to provider tokenizer drift or model swap
- **Financial risk:** Credits already consumed; the system auto-blocks the org but the over-spend is real (provider cost > customer charge)
- **Scaling risk:** Provider price changes propagate slowly to `llm_model_pricing` — risk grows when prices increase
- **Complexity:** M
- **Remediation:** Add a margin buffer to `estimateLlmHoldCredits` (e.g. ×1.15 ceiling); alert when underfunded count > 1% per week; freeze partial confirm above a configurable runaway threshold.

### D-2. CHECK constraints prevent negative balance at DB

- **Severity:** LOW — but a "trip-wire" only, not a financial fix
- **Note:** `CHECK (free_balance >= 0)` and friends in `organization_credits` prevent negative balances. RPC `apply_credit_reservation` raises EXCEPTION on insufficient balance during HOLD. This is **good**, but it means *the work fails loudly*, not silently — which is the right trade. No remediation needed.

---

## E. Race Conditions

### E-1. Wallet `FOR UPDATE` locking is correct, application-level checks are not

- **Severity:** LOW (DB layer is safe)
- **Impacted:** `apply_credit_reservation` RPC (lines 154 of [20260625_monetization_invariant_hardening.sql](../../supabase/migrations/20260625_monetization_invariant_hardening.sql))
- **Risk:** Pre-flight `hasEnoughCredits()` ([creditDeductionService.ts:175-183](../../backend/services/creditDeductionService.ts)) is non-locking. Concurrent requests can both see "enough" then one will fail HOLD with `insufficient_credits`. The HOLD failure is correct; the UX (failure response after work setup) is not.
- **Complexity:** S
- **Remediation:** Treat `hasEnoughCredits` as a hint, never a gate. Always rely on HOLD result.

### E-2. Smart-mode dedup query is non-locking

- **Severity:** MEDIUM
- **Impacted:** [creditDeductionService.ts:150-166](../../backend/services/creditDeductionService.ts)
- **Risk:** Two concurrent callers both pass `wasRecentlyRun=false`, both deduct.
- **Complexity:** S
- **Remediation:** Move dedup decisioning *inside* the HOLD RPC; check for a sibling CONFIRM with matching fingerprint within window before allowing HOLD.

---

## F. Ledger Inconsistencies

### F-1. Reconciliation runs once per day; drift window is 24h

- **Severity:** MEDIUM
- **Impacted:** [pages/api/cron/credit-reconciliation.ts](../../pages/api/cron/credit-reconciliation.ts); [creditReconciliation.ts:210-254](../../backend/services/creditReconciliation.ts)
- **Risk:** A drift introduced shortly after a reconciliation run can persist 24 hours before detection.
- **Financial risk:** Bounded by drift magnitude; high-frequency-traffic orgs have higher exposure
- **Complexity:** S
- **Remediation:** Move reconciliation to hourly for `paid_balance > X` or `lifetime_consumed_30d > Y` orgs; daily otherwise.

### F-2. Reconciliation alerts on drift but does not auto-correct

- **Severity:** MEDIUM
- **Impacted:** [creditReconciliation.ts:190-198](../../backend/services/creditReconciliation.ts)
- **Risk:** Drift requires manual triage; in a fast-growing customer, a stuck drift becomes a billing dispute
- **Complexity:** M
- **Remediation:** Add an "auto-correct from ledger" mode behind a feature flag: rebuild wallet from ledger sum and emit an adjustment ledger row attributed to `system:reconciliation_autoheal`.

---

## G. Missing Audit Trails

### G-1. `aiGateway` cost recorded in `usage_events` is not linked to a credit transaction

- **Severity:** HIGH
- **Impacted:** [aiGateway.ts](../../backend/services/aiGateway.ts); `usage_events` table
- **Risk:** When a cost dispute happens, you cannot prove that a given `usage_events` row was billed against the customer
- **Complexity:** M
- **Remediation:** Add `credit_transaction_id` foreign key on `usage_events`; populate at CONFIRM; alert on orphans.

### G-2. Direct-RPC callers bypass `recordAdminAudit` shim

- **Severity:** LOW
- **Impacted:** [creditExecutionRepository.ts](../../backend/repositories/creditExecutionRepository.ts) — invoked outside admin flows
- **Risk:** Internal service-to-service mutations create `credit_transactions` rows with `performed_by=NULL`. The ledger is honest, but downstream tooling needs to handle "system actor" attribution.
- **Complexity:** S
- **Remediation:** Standardize on a sentinel `system_actor_id` (e.g. UUID '00000000-…-0001') and reserve NULL for legacy rows only.

---

## H. Mutable Ledger Vulnerabilities

### H-1. No row-level immutability enforcement on `credit_transactions`

- **Severity:** HIGH (enterprise compliance)
- **Impacted:** [database/organization_credits.sql](../../database/organization_credits.sql); all migrations adding columns to `credit_transactions`
- **Risk:** A privileged SQL session (Supabase service role, DB admin) can UPDATE or DELETE ledger rows. Audit trail is convention-only.
- **Financial risk:** Catastrophic if an actor modifies historical balances or deletes evidence of an over-charge.
- **Enterprise impact:** Blocks SOC 2 / SOX-style controls
- **Complexity:** M
- **Remediation:**
  1. Add a `BEFORE UPDATE OR DELETE` trigger on `credit_transactions` that raises EXCEPTION (`'ledger rows are immutable'`).
  2. Move the `metadata` JSONB to a separate `credit_transaction_metadata` side-table if mutability is needed for operational metadata only.
  3. Revoke UPDATE/DELETE on the table from all roles except a sealed `ledger_admin` role.

### H-2. `metadata` JSONB on `credit_transactions` is freely writable

- **Severity:** LOW
- **Impacted:** [20260625_monetization_invariant_hardening.sql](../../supabase/migrations/20260625_monetization_invariant_hardening.sql) (`metadata jsonb NOT NULL DEFAULT '{}'`)
- **Risk:** Operational metadata mixing with financial fields invites accidental mutation
- **Complexity:** S
- **Remediation:** Split as in H-1 step 2.

---

## I. Admin Abuse Vectors

### I-1. No approval chain for admin grants

- **Severity:** HIGH
- **Impacted:** [creditAdminGrantService.ts:78-168](../../backend/services/creditAdminGrantService.ts); [pages/api/admin/credits/grant.ts](../../pages/api/admin/credits/grant.ts)
- **Risk:** A single compromised super-admin account can mint unlimited free credits (subject only to 3-per-24h-per-org rate limit, easily bypassed across orgs)
- **Enterprise impact:** Fails dual-control financial governance requirement
- **Complexity:** L
- **Remediation:** Add `credit_grant_approvals` table; require N-of-M approvers above grant threshold (e.g. > 5000 credits or > $100 USD-equivalent). Block fulfillment until approval row is signed.

### I-2. No hard cap on grant amount

- **Severity:** MEDIUM
- **Impacted:** [creditAdminGrantService.ts](../../backend/services/creditAdminGrantService.ts) (validates `credits > 0`, no upper bound)
- **Risk:** Operator typo grants 10,000,000 credits
- **Complexity:** S
- **Remediation:** Add `ADMIN_GRANT_HARD_CAP` (e.g. 100,000) at service layer; require escalation flag to exceed; log all overages via `super_admin_audit_logs`.

### I-3. Adjust action accepts arbitrary signed delta

- **Severity:** MEDIUM
- **Impacted:** [pages/api/admin/credits/index.ts:92-107](../../pages/api/admin/credits/index.ts) (`action='adjust'`)
- **Risk:** No cap, no reason-type taxonomy (only free-text `note`); deduct via adjust bypasses the structured grant taxonomy
- **Complexity:** S
- **Remediation:** Mirror grant flow: require `adjustment_type` enum (`correction`, `refund`, `clawback`, `migration`), require approval above threshold.

### I-4. `credit_rate_usd` per-org change has no rollback / reasoning

- **Severity:** MEDIUM
- **Impacted:** [pages/api/admin/credits/index.ts:109-125](../../pages/api/admin/credits/index.ts) (`action='set_rate'`)
- **Risk:** Changing the USD valuation of an org's credits retroactively shifts all USD-equivalent reporting; no historical preservation
- **Complexity:** M
- **Remediation:** Make `credit_rate_usd` a time-versioned table (`organization_credit_rates(org_id, rate_usd, valid_from, valid_to)`); compute historical USD from the time-versioned rate.

---

## J. Missing Idempotency

### J-1. `executeWithCredits` requires idempotency key — good

- **Severity:** OK
- **Impacted:** [creditExecutionService.ts:541-547](../../backend/services/creditExecutionService.ts)
- Behavior is correct: throws if missing.

### J-2. Queue processors use job-id-only idempotency

- **Severity:** HIGH (covered in B-1)
- See B-1.

### J-3. `usage_meter.increment_usage_meter` RPC is non-idempotent

- **Severity:** MEDIUM
- **Impacted:** [database/usage_meter.sql](../../database/usage_meter.sql); callers
- **Risk:** Retried writes inflate monthly usage counters
- **Financial risk:** Marketing/finance reporting is overstated
- **Complexity:** S
- **Remediation:** Add `event_id` UNIQUE on a join table; or move usage_meter rollup to a materialized view over `credit_transactions`.

---

## K. Missing Transaction Boundaries

### K-1. Wallet update + ledger insert are atomic at RPC layer ✅

- **Status:** Correctly enforced inside `apply_credit_reservation` PL/pgSQL.

### K-2. `credit_purchases` fulfillment is multi-step

- **Severity:** MEDIUM
- **Impacted:** [backend/services/payments/razorpayStagingService.ts](../../backend/services/payments/razorpayStagingService.ts) (webhook → mark event → `completePurchase` → `createCredit`)
- **Risk:** Step between "event recorded" and "credit granted" is a window where a process crash leaves the purchase in `fulfillment_status='event_recorded'` permanently
- **Complexity:** M
- **Remediation:** Add a fulfillment retrier cron; idempotency at `createCredit` layer already handles re-attempts safely.

### K-3. `confirmCreditReservation` + `trackUsage` + `logUsageEvent` are sequential, not transactional

- **Severity:** LOW
- **Impacted:** [creditExecutionService.ts:459-494](../../backend/services/creditExecutionService.ts)
- **Risk:** CONFIRM succeeds, usage telemetry inserts may fail. Money is fine; telemetry has gaps.
- **Complexity:** S
- **Remediation:** Move telemetry inserts into the RPC return path or accept eventual-consistency for telemetry.

---

## L. Orphan Usage Records

### L-1. `usage_events` rows without a paired CONFIRM

- **Severity:** HIGH (per G-1)
- See G-1.

### L-2. `credit_usage_log` is 1:1 with CONFIRM — good

- **Status:** OK — UNIQUE on `confirm_transaction_id`.

---

## M. Missing Rollback Handling

### M-1. Executor failure path calls RELEASE — good

- **Status:** OK — [creditExecutionService.ts:783-800](../../backend/services/creditExecutionService.ts)

### M-2. Network failure between HOLD and executor

- **Severity:** LOW (mitigated by reaper)
- **Impacted:** Orphan reaper releases after 1h–24h
- **Risk:** Customer sees credits "stuck" for up to 1 hour
- **Complexity:** S
- **Remediation:** Tighten the lower bound for time-sensitive actions to 5m via cron parameter, or expose a "release my stuck reservation" endpoint scoped to the owning user.

### M-3. Payment webhook delivery failure

- **Severity:** MEDIUM
- **Impacted:** Razorpay webhook absence
- **Risk:** Customer paid, no credit granted, no retry mechanism beyond manual super-admin verify
- **Complexity:** M
- **Remediation:** Add a poll-fallback cron that scans `credit_purchases.status='pending'` older than N minutes and queries Razorpay API for status.

---

## N. Billing Inconsistency Risks

### N-1. `usd_equivalent` on ledger rows uses spot `credit_rate_usd`

- **Severity:** MEDIUM
- **Impacted:** [creditExecutionService.ts](../../backend/services/creditExecutionService.ts); `credit_transactions.usd_equivalent`
- **Risk:** Per-org rate changes (I-4) retroactively affect historical USD reporting unless time-versioned
- **Complexity:** M
- **Remediation:** Snapshot `usd_equivalent` at CONFIRM using the rate-at-time; do not recompute.

### N-2. `cost_anomalies` flag drift but action is "alert only"

- **Severity:** LOW
- **Impacted:** [pricingService.ts:517](../../backend/services/pricingService.ts) (`recordCostAnomaly`)
- **Risk:** Without auto-block, margins erode
- **Complexity:** S
- **Remediation:** Wire `cost_credit_mismatch` severity=critical to auto-disable the affected action via `credit_cost_config.is_disabled`.

---

## O. Currency Conversion Limitations

### O-1. Currency stored but no FX engine

- **Severity:** MEDIUM
- **Impacted:** [database/pricing_plans.sql](../../database/pricing_plans.sql) (`currency text DEFAULT 'USD'`); [razorpayStagingService.ts:94, 195](../../backend/services/payments/razorpayStagingService.ts) (INR + JPY subunit logic)
- **Risk:** Multi-currency purchases convert ad-hoc; no historical FX rates stored
- **Enterprise impact:** Blocks enterprise multi-currency contracts; finance reporting cannot reconcile across currencies
- **Complexity:** L
- **Remediation:** Add `currency_exchange_rates(base_currency, quote_currency, rate, valid_from)`; snapshot the rate used into `credit_purchases.fx_rate_used` and `credit_transactions.fx_snapshot`. Source: ECB/openexchangerates API with a daily cron.

### O-2. Out-of-calendar migration filenames (`20260631`, `20260634`)

- **Severity:** LOW
- **Impacted:** [supabase/migrations/20260631_restore_canonical_credit_wallet.sql](../../supabase/migrations/20260631_restore_canonical_credit_wallet.sql), [supabase/migrations/20260634_rebuild_canonical_credit_wallet_projection.sql](../../supabase/migrations/20260634_rebuild_canonical_credit_wallet_projection.sql)
- **Risk:** Migration ordering ambiguity (June has 30 days)
- **Complexity:** S
- **Remediation:** Rename in next migration window; document in CHANGELOG.

---

## P. Future Payment Integration Blockers

### P-1. No Stripe primitives

- **Severity:** HIGH (enterprise blocker)
- **Impacted:** Whole codebase — zero Stripe SDK imports
- **Risk:** Cannot accept US/EU enterprise payments through preferred gateway
- **Complexity:** L (greenfield)
- **Remediation:** Mirror Razorpay staging service structure; add `payment_providers` table + provider-agnostic webhook handler; add `stripeCustomerId` to `company_billing_profiles` (target table per [target-enterprise-credit-architecture.md](./target-enterprise-credit-architecture.md)).

### P-2. No `subscriptions` / recurring billing primitives

- **Severity:** HIGH (enterprise blocker)
- **Impacted:** `organization_plan_assignments` is permanent-until-changed; no `current_period_start/end`, no renewal job
- **Complexity:** L
- **Remediation:** Add `subscriptions` table with provider-linked `subscription_id`, period bounds, status, auto-renew flag. Add renewal cron that auto-grants the plan's credit allotment at period start.

### P-3. No invoicing table

- **Severity:** HIGH (enterprise blocker — required for B2B AR)
- **Impacted:** No `invoices`, `invoice_line_items`
- **Complexity:** L
- **Remediation:** Add invoice schema + PDF generation (e.g. via headless renderer); attach to monthly usage rollup.

### P-4. No tax handling

- **Severity:** HIGH (compliance — required for VAT/GST/sales tax)
- **Impacted:** Zero
- **Complexity:** XL (jurisdictional rules)
- **Remediation:** Integrate Avalara, Stripe Tax, or TaxJar; store `tax_calculation` per invoice row.

### P-5. No auto-recharge logic

- **Severity:** MEDIUM
- **Impacted:** [creditAlertService.ts](../../backend/services/creditAlertService.ts) — `auto_topup` enum is placeholder only
- **Complexity:** M
- **Remediation:** Tie threshold trigger → saved payment method → automatic `credit_purchases` row.

### P-6. No enterprise-contract primitive

- **Severity:** HIGH (enterprise blocker)
- **Impacted:** No `enterprise_contracts` table; no purchase orders; no NET30/NET60 terms
- **Complexity:** L
- **Remediation:** Add `enterprise_contracts` table with `payment_terms`, `total_value_usd`, `credit_allotment`, `start_date`, `end_date`, `signed_contract_url`.

---

## Cross-Cutting Findings

### X-1. No "billing event" abstraction

- The system mixes wallet mechanics (`credit_transactions`) with monetary events (purchases, refunds, adjustments). For enterprise audit, these need a higher-level `financial_events` view.

### X-2. RLS posture on financial tables not audited here

- **TODO:** Separate report should validate that:
  - `credit_transactions`, `organization_credits`, `credit_admin_grants` are **service-role only**
  - No client SELECT/INSERT/UPDATE policies exist
  - Service role keys are rotated and tied to a single signed deploy

### X-3. No reservation-expiry-after-success contract for HOLDs older than partial-confirm window

- HOLDs are time-bounded by the reaper (1h–24h) but `expires_at` column on `credit_transactions` is set but not enforced as a hard auto-release.
- Remediation: enforce via cron + `expires_at IS NOT NULL AND expires_at < now() AND phase='hold'`.

---

## Summary Risk Matrix

| Section | CRITICAL | HIGH | MEDIUM | LOW |
|---|---|---|---|---|
| A. Missing deductions | 1 | 1 | 0 | 0 |
| B. Double deductions | 1 | 1 | 0 | 0 |
| C. Retry duplication | 0 | 0 | 1 | 1 |
| D. Negative balance | 0 | 0 | 1 | 1 |
| E. Races | 0 | 0 | 1 | 1 |
| F. Ledger drift | 0 | 0 | 2 | 0 |
| G. Audit trail | 0 | 1 | 0 | 1 |
| H. Mutability | 0 | 1 | 0 | 1 |
| I. Admin abuse | 0 | 1 | 3 | 0 |
| J. Idempotency | 0 | 1 | 1 | 0 |
| K. Transactions | 0 | 0 | 2 | 1 |
| L. Orphans | 0 | 1 | 0 | 0 |
| M. Rollback | 0 | 0 | 1 | 1 |
| N. Billing | 0 | 0 | 1 | 1 |
| O. Currency | 0 | 0 | 1 | 1 |
| P. Payments | 0 | 4 | 1 | 0 |
| **Totals** | **2** | **11** | **15** | **9** |

**Top 5 must-fix-before-enterprise:**

1. B-1 — Queue processors PRE-HOLD
2. A-1 — `aiGateway` cannot be invoked without credit wrapper
3. H-1 — Immutability trigger on `credit_transactions`
4. I-1 / I-2 — Admin grant approval chain + amount cap
5. P-1 / P-2 / P-3 / P-4 — Stripe, subscriptions, invoicing, tax
