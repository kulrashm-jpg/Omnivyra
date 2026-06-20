# OMNIVYRA — BILLING & SUBSCRIPTION SYSTEM AUDIT

**Audit only — no code changed.** Evidence = actual code, tables, APIs, payment integrations (file:line) via two parallel deep investigations.

> ## HEADLINE: there are TWO disconnected billing systems, and NO live money path
> - **System 1 — Razorpay-staging + Stripe-webhook (WIRED end-to-end, but sandbox-only, super-admin-only):** real Razorpay API calls + idempotent credit grant (`razorpayStagingService.ts` → `purchaseService.ts` → `createCredit`). Rejects live keys; no customer UI.
> - **System 2 — "Hidden billing" orchestrator (SCAFFOLD):** `checkout-session` / `settlement-webhook` / `payment-providers`. **Pricing-blind (amount=0), no wallet funding, no credit grant — by design** (`checkoutSessionOrchestrator.ts:17-24`). The two systems are wired with **mismatched contracts** (a latent bug).
> - **No payment SDK is installed** (no `stripe`/`razorpay`/`cashfree`/`phonepe` in package.json) — all hand-rolled `fetch` + HMAC.
> - **Founding-member: categorically ABSENT** (config, lifecycle, records, UI).
> - **Biggest unknown:** billing migrations `20260714–20260719` are header-marked "NOT applied — controlled process only"; code has compiled fallbacks for unapplied tables. Per the known prod ledger desync, **several "EXISTS" schemas may not be live in production** (not verified — prod write was out of scope).

---

## SECTION A — PRICING PAGE STATUS
| Item | Status | Evidence |
|---|---|---|
| Public pricing page | **EXISTS** (user-facing) | `pages/pricing.tsx` — 4 tiers: Starter 1k / Growth 5k / Scale 20k credits / Enterprise |
| Dollar prices shown | **ABSENT by design** | shows credit counts + cadence only; prices server-side |
| Top-up / reserve packs | **EXISTS (display only)** | `pricing.tsx:53-57` (500/2k/10k) |
| "Buy Now" CTA → checkout | **SCAFFOLD / dead-end** | `:15,22,30` → `/login?plan=…`; `?plan` **never consumed** by `login.tsx`; no checkout follows |
| Top-up CTA | **SCAFFOLD** | redirects to `/get-free-credits`, not a purchase |
| Checkout integration on page | **ABSENT** | no `pages/checkout*`; `/billing` shell is provider-discovery only, env-gated (`BILLING_SHELL_ENABLED`), `noindex` |

---

## SECTION B — PLAN CONFIGURATION
| Item | Status | Evidence |
|---|---|---|
| `pricing_plans` table + super-admin CRUD | **EXISTS, configurable** | `pages/api/super-admin/plans/create.ts:72-90` (gated `BILLING_PLAN_MANAGE`) |
| `plan_limits` incl `monthly_credits` | **EXISTS, configurable** | `create.ts:92-108`; read in `planResolutionService.ts`, `analytics.ts:114` |
| Credits configurable | **YES** | `PlansPricingPanel.tsx:99-130` (but `TIER_SEEDS`/`CREDIT_COSTS` `:26-43` are **hardcoded fallbacks**) |
| User limits configurable | **YES** | `plan_limits` resource keys |
| `organization_plan_assignments` / `_overrides` | **EXISTS** | `plans/assign.ts`, `plans/override.ts`; override>default in `planResolutionService.ts:77-88` |
| Hidden `billing_catalog` (INR) | **EXISTS** (separate system) | mig `20260717`; `super-admin/billing-catalog/index.ts`; `billingAmountResolver.ts` |
| Regular pricing | **EXISTS (server-side)** | catalog defaults ₹499/₹1999 + top-ups |
| **Founding-member pricing** | **❌ ABSENT** | grep `founding_member` = 0 code hits |

⚠ **Two parallel plan systems** coexist and are unreconciled: USD `pricing_plans`/`plan_limits` (super-admin) vs INR `hidden_billing_catalog` (drives the inert checkout).

---

## SECTION C — PAYMENT PROVIDER MATRIX
| Provider | SDK | Integration called? | Configured? | Sandbox? | Prod? | Webhook? |
|---|---|---|---|---|---|---|
| **Razorpay** | none (raw fetch) | **✅ WIRED** — real order + payment fetch + HMAC verify (`razorpayStagingService.ts:125-171`) | env `RAZORPAY_TEST_KEY_*` + governance row | **✅ test-only** (live key **rejected** `:76,153`; gated `RAZORPAY_STAGING_ENABLED`) | **❌** (blocked unless `RAZORPAY_ALLOW_PRODUCTION_STAGING`) | **✅ + grants credits** (`webhooks/razorpay-staging.ts`) |
| **Stripe** | none (HMAC) | **Webhook-only**; checkout adapter = stub `NOT_IMPLEMENTED` (`paymentProviderAdapter.ts:135-143`) | env `STRIPE_WEBHOOK_SECRET` | adapter `mode:'unknown'` | **❌** (no checkout creates Stripe sessions) | **✅ wired** (`stripe/webhook.ts`) — grants **only if** matching `credit_purchases` row (dormant) |
| **Cashfree** | none | **SCAFFOLD** — deterministic local session, no network (`adapter.ts:205-234`) | governance mig `20260716` | local ref only | **❌** | **INERT** (`handleWebhook`→ignored) |
| **PhonePe** | none | **SCAFFOLD** — same stub | governance mig `20260716` | local ref only | **❌** | **INERT** |

---

## SECTION D — CHECKOUT FLOW MATRIX
| Stage | Subscription | Top-up | Failure | Webhook |
|---|---|---|---|---|
| Pricing → checkout | **ABSENT** (no UI calls checkout) | **ABSENT** | — | — |
| checkout-session creates real provider session | **SCAFFOLD** — `checkout-session.ts:88`→orchestrator; **amount resolves but Stripe=stub, Cashfree/PhonePe=local, Razorpay adapter has a contract bug**; `expires_at` always null | same (`intent_type='topup'`) | 400/502 on provider error | — |
| payment → success | **No live settlement** (`orchestrator:17-24`: "NO wallet funding, NO ledger mutation") | same | — | `settlement-webhook/[provider].ts` accepts **sandbox `mode:'test'` only**; reaches `succeeded` state but **grants nothing** |
| success → credit allocation | **ABSENT** (System 2) | **ABSENT** (System 2) | — | **ABSENT** (System 2) |
| **Working alt (System 1, super-admin only)** | n/a | **✅** `create-staging-order` → Razorpay → webhook/`verify-staging-payment` → `completePurchase` → credits | dedupe via `payment_provider_events` | **✅ Razorpay** auto-grant on `payment.captured` |

---

## SECTION E — CREDIT ALLOCATION MATRIX
| Question | Answer | Evidence |
|---|---|---|
| Subscription allocates credits? | **❌ NO** — no subscription→credit path anywhere | `orchestrator:18-21`; no monthly-grant job (matches the Phase-2 alignment audit) |
| Top-up allocates credits? | **✅ YES — but only via System 1** (Razorpay staging) | `purchaseService.ts:162` `createCredit({category:'paid', referenceType:'credit_purchase'})` |
| Automatic on payment? | **Partial** — Razorpay webhook auto-grants; Stripe grant dormant (no row creator); hidden settlement never | `razorpayStagingService.ts:561` |
| Idempotent? | **✅ YES** | idempotency_key `makeIdempotencyKey(org,'credit_purchase',id)`; UNIQUE `payment_provider_events`; UNIQUE `reference_id` |

---

## SECTION F — SUBSCRIPTION LIFECYCLE MATRIX
| Item | Status | Evidence |
|---|---|---|
| `billing_subscriptions` table | **EXISTS (schema)** | mig `20260664:164-189` (status, period, cancel_at_period_end, auto_renew) |
| Subscription **write** path | **❌ ABSENT** | only READS (`subscriptionProjectionService.ts`, `stripeReconciler.ts:122`); header defers writes to "future `subscriptionRenewalJob.ts` (Phase 6)" |
| Active plan tracking | **✅ EXISTS** | `organization_plan_assignments` (`planResolutionService.ts:41-45`) |
| Renewal dates | **SCAFFOLD (read-only)** | `listRenewalsDue()`/`projectOrgSubscriptions()` forecast, no cron writes |
| Upgrade | **PARTIAL (super-admin only)** | `plans/assign.ts` + idempotent credit grant; no user-facing upgrade |
| Downgrade / Cancellation | **❌ ABSENT** | schema columns exist, no code |
| Founding-member status | **❌ ABSENT** | no field in any subscription/assignment table |

---

## SECTION G — BILLING DATA MATRIX
| Table / Service | Status | Writers? | Evidence |
|---|---|---|---|
| `payment_transactions` | EXISTS, immutable | ✅ | mig `20260664:125`; `stripeWebhookService.ts:311` |
| `credit_purchases` | EXISTS | ✅ | mig `20260322`; `purchaseService.ts:91-200` |
| `payment_provider_events` | EXISTS | ✅ | mig `20260625`; dedupe |
| `invoices` / line items | EXISTS, **DRAFT-only** | ✅ (draft) | mig `20260664:191`; `invoicePreparationService.ts` ("tax integration Sprint 6+") |
| `usage_billing_snapshots` | EXISTS, immutable | ✅ | mig `20260664:265`; idempotent |
| `billing_audit` / `billing_checkout_sessions` / `billing_settlement_events` | EXISTS | ✅ (sandbox) | migs `20260718/19` |
| Payment history / transaction history / purchase history | **EXISTS** | ✅ | as above |
| Invoice generation | **PARTIAL (draft only)** | ✅ | no finalize/tax/PDF |
| Renewal history | **❌ ABSENT** | — | no subscription writes |

---

## SECTION H — BILLING UI MATRIX (user-facing vs admin)
| Item | Status | Audience |
|---|---|---|
| Company billing portal `pages/company/billing/index.tsx` | **WIRED** | **Admin/Finance roles only** (gate `:95`); standard users blocked |
| Current plan · credits remaining · usage · ledger history | **WIRED** | admin/finance |
| Invoices (projected USD) · renewal date | **WIRED** | admin/finance |
| Payment methods | **❌ ABSENT** | — |
| **Founding-member status** | **❌ ABSENT** | — |
| `CreditMeter` (all users) · "Buy more credits" | **WIRED**, but CTA → `/pricing` (dead-end) | all authed |
| In-app buy / embedded checkout | **❌ ABSENT** | — |

---

## SECTION I — FOUNDING MEMBER READINESS → **❌ NOT READY (entirely absent)**
| Requirement | Status |
|---|---|
| Fixed discounted subscription | ❌ no founding price field/logic |
| Expires March 2028 | ❌ no `founding_price_expiry` |
| Preserved through renewals | ❌ no founding flag + no renewal write path |
| Visible badge | ❌ no UI |
| Pricing explanation | ❌ none |
**All net-new.** Low architectural risk (additive fields + discount application + badge), but **0% exists** — only referenced as a gap in a prior audit `.md`.

---

## SECTION J — IMPLEMENTATION ROADMAP
| Phase | Scope | Effort | Dependencies | Risk |
|---|---|---|---|---|
| **1 — Pricing page** | Wire CTAs to a real checkout; reconcile the two catalogs (USD `pricing_plans` vs INR `hidden_billing_catalog`); surface prices | **Low–Med** | catalog decision | Low |
| **2 — Checkout** | Customer checkout UI → call a **productionized** order endpoint (extend System 1's `create-staging-order`); un-gate from `staging` | **Med** | Phase 3 | Med (money path) |
| **3 — Payment provider** | Productionize **Razorpay** (enable live keys, remove staging guards, fix the `paymentProviderAdapter` contract bug); add webhook signature for live | **Med** | env/keys | **High** (live payments) |
| **4 — Credit allocation** | Top-up: already idempotent (System 1) — just connect. **Subscription→credit: build the monthly grant-on-renewal job** (`subscriptionRenewalJob.ts`) + the subscription **write** path | **Med–High** | Phase 3 + ledger | Med (idempotency critical; ledger supports it) |
| **5 — Billing center** | Open the admin billing portal to end-users (or a user-safe view); add payment-methods + top-up history | **Med** | Phase 4 | Low |
| **6 — Invoices** | Finalize draft invoices (tax, numbering, PDF) | **Med** | Phase 4 | Med (tax/GST compliance) |
| **7 — Founding member** | `founding_member` / `founding_enrolled_at` / `founding_price_expiry` fields + discount application + badge | **Med** | Phase 3/4 | Low (additive) |

---

## SECTION K — FINAL VERDICT
**1. What already exists?**
- A **bank-grade credit wallet + ledger** (free/paid/incentive, holds, idempotent grants).
- **Plan config** (`pricing_plans`/`plan_limits`/assignments/overrides) + super-admin UIs.
- **Billing-record schemas** (payment_transactions, credit_purchases, invoices-draft, snapshots, checkout/settlement sessions).
- **One WIRED credit-purchase path** (Razorpay-staging + Stripe-webhook → idempotent `createCredit`) — but **sandbox-only, super-admin-only, no customer UI**.
- A **public pricing page** (no real checkout) and an **admin/finance billing portal**.

**2. What is missing?**
- **Any live production payment path** (everything is test/sandbox; live keys rejected; settlement webhook accepts `test` only).
- **Customer-facing checkout** (pricing CTAs are dead-ends; no embedded buy).
- **Subscription write/renewal/cancel/downgrade** + **subscription→credit allocation** (no monthly grant job; `billing_subscriptions` has zero writers).
- **Founding member** (entirely).
- **Reconciliation of the two catalog/plan systems**; **payment-methods UI**; **finalized invoices** (draft only).
- **Confirmation that the billing migrations are applied in prod** (likely partially unapplied).

**3. Fastest path to launch:** productionize **System 1** (it already grants credits idempotently): un-gate `create-staging-order`/`verify`, enable live Razorpay, **fix the adapter contract bug**, and wire the pricing-page CTA → checkout → Razorpay → webhook → `createCredit`. That ships **top-up/credit purchase** quickly. Subscriptions need the additional renewal-write + monthly-allocation job (the Phase-2 alignment gap). Abandon/quarantine **System 2** (the pricing-blind hidden orchestrator) or finish it later — it currently funds nothing.

**4. Recommended provider for India-first launch: Razorpay.** It's the **only** provider actually wired end-to-end with real API calls + an idempotent credit grant; it's India-native (UPI/cards/netbanking); Cashfree/PhonePe are inert local scaffolds and Stripe is webhook-only/dormant.

**5. Recommended rollout order:** (1) **Razorpay top-ups** (productionize System 1 + customer checkout UI) → (2) **subscription write path + monthly credit allocation** → (3) **user billing center** (open portal + payment methods + top-up history) → (4) **founding member** (additive) → (5) **finalize invoices** + **reconcile the two catalogs** → later, **Cashfree/PhonePe** if multi-PSP is needed.

> **Bottom line:** the **credit/ledger foundation is production-grade**, and **one real (sandbox) credit-purchase path exists** — but **no money flows today**: it's super-admin-only, test-key-only, with no customer checkout, no subscription billing, and no founding-member support. Launch is a **"productionize the wired Razorpay path + add the subscription/allocation job + build customer UI"** effort, not a from-scratch build — and step one is **verifying which billing migrations are actually applied in prod.**

*(Audit only. No code, schema, migration, or pricing changed. Evidence is file:line; prod migration-applied status was not write-verified.)*
