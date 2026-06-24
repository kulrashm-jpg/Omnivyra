# CREDIT_POLICY_RELEASE_AUDIT.md

Release-prep audit for the credit-policy work. Audit only. Branch: `feat/activation-outreach-governed`
(HEAD `45a28085`; activation-outreach already committed).

## Findings
1. **Modified (credit-policy):** 16 files (services + UI + webhook + edge + vercel.json).
2. **Created (credit-policy):** 16 files (4 services + 6 tests + banner + 4 crons + 1 migration).
3. **Unrelated files on branch:** Phase-20 customer-ops (5 files) + 21 `*.md` reports.
4. **Conflicts with activation-outreach:** **NONE** — `send-transactional-email`/`emailService`
   `credit_alert` is purely additive on top of the committed `activation_outreach`
   (HEAD: activation_outreach=3, credit_alert=0; working tree: both=3).
5. **Conflicts with billing/ledger/Stripe/subscription:** **NONE breaking** — Stripe webhook
   changes are additive (`applySubscriptionEvent` dep + record_subscription branch, best-effort);
   ledger untouched (no RPC change); 105 credit/subscription + 24 existing webhook tests pass.
6. **Tests from a clean checkout:** **NOT VERIFIED** (cannot clean-checkout without committing /
   losing the working tree). Working-tree suite passes (105+); credit code imports **no** customer-ops
   → committing only the credit files yields a self-consistent, compilable tree (logically sound, not
   physically run).
7. **Migrations applied to prod:** `20260624200000_pricing_plan_provider_price.sql` **APPLIED**
   (`provider_price_id` column present); idempotent (`ADD COLUMN IF NOT EXISTS`). `free_credit_config`
   300/30 is a prod **data update** (no migration file).
8. **Prod contains changes not in git:** Edge Function deployed (`credit_alert`); the
   provider_price_id migration applied; `free_credit_config` 300/30 data update; `billing_subscriptions`
   = 0 rows (no data drift).
9. **Single merge commit:** the branch is MIXED (activation-outreach + creator-render + uncommitted
   credit + uncommitted customer-ops). A **single selective commit of the credit files** is safe;
   merging the whole branch would also carry unrelated work.

---

## A. SAFE_TO_COMMIT = **YES** (as a selective credit-policy commit)

## B. FILES_TO_COMMIT
**Modified:**
```
backend/services/creditAdminGrantService.ts
backend/services/creditAlertService.ts
backend/services/creditExecutionService.ts
backend/services/creditPriorityService.ts
backend/services/earnCreditsService.ts
backend/services/emailService.ts
backend/services/initialFreeCreditService.ts
backend/services/payments/stripeWebhookService.ts
backend/services/subscriptionAllocationService.ts
components/billing/BillingCenter.tsx
components/billing/TopUpPanel.tsx
components/layout/AppLayout.tsx
pages/api/credits/claim-action.ts
pages/api/stripe/webhook.ts
supabase/functions/send-transactional-email/index.ts
vercel.json
```
**Created:**
```
backend/services/billingSubscriptionService.ts
backend/services/subscriptionStateResolver.ts
backend/services/subscriptionCreditExpiryService.ts
backend/services/creditConsumptionWarningService.ts
backend/tests/unit/billingSubscriptionService.test.ts
backend/tests/unit/subscriptionStateResolver.test.ts
backend/tests/unit/subscriptionCreditExpiry.test.ts
backend/tests/unit/subscriptionPlanResolution.test.ts
backend/tests/unit/topupLockEnforcement.test.ts
backend/tests/unit/creditConsumptionWarning.test.ts
components/billing/CreditWarningBanner.tsx
pages/api/cron/credit-expiry.ts
pages/api/cron/subscription-status-expiry.ts
pages/api/cron/subscription-credit-expiry.ts
pages/api/cron/subscription-monthly-allocation.ts
supabase/migrations/20260624200000_pricing_plan_provider_price.sql
```

## C. FILES_TO_EXCLUDE
**Unrelated Phase-20 customer-ops (separate release):**
```
backend/services/customerActivationOperationsService.ts
backend/tests/unit/customerActivationOperations.test.ts
pages/api/super-admin/customer-activation-operations.ts
pages/super-admin/customer-activation-operations.tsx
supabase/migrations/20260624100000_customer_activation_operations.sql
```
**Docs (21 `*.md` reports)** — exclude from the code commit or land as a separate docs commit (no
runtime impact). Not required for release.

## D. PROD_REPO_DRIFT
| Artifact | Prod | Repo (committed) | Reconcile by |
|---|---|---|---|
| Edge Function `credit_alert` | deployed | uncommitted (working tree) | commit `send-transactional-email/index.ts` |
| `pricing_plans.provider_price_id` | applied | migration uncommitted | commit migration (idempotent) |
| `free_credit_config` 300/30 | data-updated | no source artifact | intentional config (document; no file) |
| customer_activation_operations table | applied | migration uncommitted | belongs to customer-ops release (exclude here) |
| `billing_subscriptions` | 0 rows | n/a | none |

## E. RELEASE_SEQUENCE
1. **Commit** the credit-policy files (Section B) as one focused commit; exclude Section C.
2. **Merge** to `main` (merge/cherry-pick the credit commit; do not bulk-merge the mixed branch).
3. **Deploy** Vercel from `main` → activates services, crons, notification trigger, banner.
4. **Verify crons** — 4 paths registered + firing (check executions / logs).
5. **Verify edge function** — `credit_alert` send (already deployed + 200-validated).
6. **Verify subscription webhooks** — confirm real `customer.subscription.*` events populate
   `billing_subscriptions` (gates are behavior-neutral until then).

## F. FINAL VERDICT
**READY_FOR_RELEASE = YES** — for a **selective** credit-policy commit (Section B), excluding the
unrelated customer-ops files (Section C). Caveats: (i) clean-checkout test run NOT physically
verified; (ii) prod/repo drift is reconciled **by** this commit; (iii) real-data verification of
lock/expiry awaits subscription webhooks (0 rows today).

Stop after report.
