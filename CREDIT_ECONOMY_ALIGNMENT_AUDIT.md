# OMNIVYRA — CREDIT ECONOMY ALIGNMENT AUDIT

**Can the *current* implementation support the proposed commercial model without major architectural change?**
Audit only — no code/migration/pricing changed. Evidence = actual tables, services, RPC, ledger behavior (file:line) + prior live census.

> ## VERDICT (one line)
> **YES — substantially.** The proposed model is **activity-based** (credits not tied to tokens), and that is exactly the system's strongest, already-built capability: a **bank-grade dual/triple-bucket wallet** (free/incentive/paid with per-bucket expiry and a DB guard that **paid never expires**), an **immutable idempotent ledger** with HOLD/CONFIRM/RELEASE, a **fixed-cost catalog** (`credit_cost_config` + `getCreditCost`), and a **free→incentive→paid consumption order** that already matches "subscription before purchased." The gaps are **wiring + additions** (recurring monthly allocation, metering coverage, founding-member fields, capacity tuning) — **not architecture**.

---

## SECTION A — CREDIT SYSTEM INVENTORY
| Component | Purpose | Status |
|---|---|---|
| `organization_credits` (table) | Wallet: free/paid/incentive balances + reserved_* per bucket; `credit_rate_usd`, lifetime_* | ✅ Live (27 wallets) |
| `credit_transactions` (table) | Immutable append-only ledger; `execution_phase` (grant/hold/confirm/release/expire/expire_incentive), `category`, `expires_at`, idempotency_key | ✅ Live (333 txns) |
| `credit_cost_config` (table) | Fixed per-activity credit cost | ✅ Exists (25 actions seeded) |
| `action_pricing_config`, `llm_model_pricing` | Token/metered pricing (not needed for activity model) | ✅ Exists (cost dark) |
| `apply_credit_reservation` (RPC) | Atomic wallet UPDATE + ledger INSERT under row lock; all phases | ✅ Live |
| `creditExecutionService` | HOLD→CONFIRM/RELEASE orchestrator (`executeWithCredits`, reserve/confirm/release) | ✅ |
| `creditPriorityService` | Wallet snapshot + split: **free→incentive→paid** (`computeSplit`) | ✅ |
| `creditDeductionService` | `getCreditCost` (fixed), `hasEnoughCredits`, read utilities | ✅ |
| `creditReadService` / `billingWalletService` | User + finance wallet read projections | ✅ |
| `initialFreeCreditService` | One-time onboarding free grant (idempotent `createCredit`) | ✅ |
| `creditExpiryService` | Free-credit + incentive expiry; **paid never touched** (`:206,248-251`) | ✅ (cadence-gated) |
| `pricingService` | `resolveLlmCost`, `assertModelPricingExists` | ✅ |
| Billing Phase-E (`billingWalletService`, `checkout-session.ts`, hidden billing catalog `20260717`, payment providers `20260714/16` Cashfree/PhonePe) | Purchase / top-up → credit grant | ⚠ Scaffolded |
| Monthly allocation per plan | grant `monthly_credits` on renewal | ❌ **Not wired** |
| Founding-member fields/logic | preferential pricing / discounts / badge | ❌ **Absent** |
| Activity deduction coverage | actual `executeWithCredits` calls on chargeable routes | ⚠ **~3 routes / 79 rows** (dark) |

---

## SECTION B — CREDIT WALLET MODEL → **READY**
| Question | Answer | Evidence |
|---|---|---|
| Can two credit buckets exist today? | **YES** (three exist: free/incentive/paid) | `organization_credits` per-bucket balance + reserved columns |
| Can balances be separated? | **YES** | per-bucket columns; ledger `category` + `*_delta` columns |
| Can balances be reported separately? | **YES** | `getWalletSnapshot`, `getBillingWalletSnapshot:33` return all buckets |
| Can balances be consumed separately? | **YES** | `computeSplit` consumes per-bucket in priority order |

**Mapping to the proposal:** Wallet A (monthly subscription, expires monthly) → **free bucket** (has `free_credit_expiry` path, `creditExpiryService.ts:195`). Wallet B (purchased, never expires) → **paid bucket** (DB-guarded: expiry phases force `p_paid_amount:0`, `:251`). Incentive is a bonus third bucket. The hard part — separable, separately-expiring buckets with a paid-never-expire guarantee — **already exists**. Gap is only semantic labeling ("subscription" vs "free").

---

## SECTION C — CREDIT CONSUMPTION ORDER → **READY**
| Question | Answer | Evidence |
|---|---|---|
| Order configurable? | **No (hardcoded)** | `creditPriorityService.computeSplit` fixed free→incentive→paid |
| Order hardcoded? | **Yes — and it MATCHES the proposal** | subscription(free) → incentive → purchased(paid) = "Priority 1 subscription, Priority 2 purchased" |
| Dual-wallet consumption without schema changes? | **YES** | already implemented; no schema change needed |

The proposed "monthly first, purchased second" is **already the live behavior** (free consumed before paid). No change required.

---

## SECTION D — CREDIT ALLOCATION MODEL → **PARTIAL**
| Question | Answer | Evidence |
|---|---|---|
| One-time allocation (Free 300)? | **READY** | `initialFreeCreditService` grants once, idempotent (`createCredit`, grant phase). *(Current default amount differs from 300 — config value.)* |
| Recurring allocation (Starter 300 / Growth 700 / Business 1500 monthly)? | **NOT READY** | No scheduler grants `monthly_credits` per plan; `monthly_credits` is a **catalog value only** (`plan_limits`, read in `super-admin/plans/analytics.ts`); confirmed no monthly grant job |
| Tied to subscription plans? | **PARTIAL** | plans exist (`organization_plan_assignments`, `plan_limits`); billing layer mentions "subscription renewal" (`billingWalletService.ts:6`) but the grant-on-renewal credit allocation is not wired |

**This is the #1 functional gap.** Everything to grant credits exists (`createCredit`/`apply_credit_reservation`, idempotency); what's missing is a **renewal job** that calls it monthly per plan.

---

## SECTION E — TOP-UP MODEL → **READY (structurally)**
| Question | Answer | Evidence |
|---|---|---|
| Stored separately? | **YES** | paid bucket / `category='paid'` |
| Avoid expiration? | **YES** | expiry phases DB-guarded to never touch paid (`creditExpiryService.ts:206,251`) |
| Survive plan changes? | **YES** | paid bucket independent of plan; plan change doesn't touch it |
| Survive renewals? | **YES** | renewal grants to free bucket; paid untouched |

Purchase path: `checkout-session.ts` + hidden billing catalog (`20260717`) + payment providers (`20260714/16`) + `billingWalletService` → grant to paid via `apply_credit_reservation`. The proposed top-ups (250 / 750 / 1500, lifetime) map directly to paid grants with `expires_at = null`. ⚠ Verify the checkout→grant wiring is live end-to-end (scaffolding present).

---

## SECTION F — FOUNDING MEMBER MODEL → **NOT READY**
| Question | Answer | Evidence |
|---|---|---|
| Existing support? | **No** | grep `founding_member` / `founding_enrolled` / `founding_price` → **0 real hits** (only unrelated "founding-date" usages) |
| Partial support? | Only generic carriers | wallet/ledger have `metadata` jsonb; org tables could hold flags, but no founding semantics, discount logic, or badge exist |
| Required additions? | fields (`founding_member`, `founding_enrolled_at`, `founding_price_expiry`) + discount application + badge | net-new, but **additive and low-risk** (no ledger change) |

---

## SECTION G — CREDIT DEDUCTION MODEL (current vs proposed catalog)
| Activity | Current Status | Gap |
|---|---|---|
| Reply / Inbox / Triage | catalog action exists (`ai_reply`/`reply_generation`); **not wired to deduct** | wire deduction |
| Post / Thread / Story | content actions partially catalogued; **mostly unmetered** | wire + price |
| Blog / Article | `content_generation`/`content_basic` catalogued; **gateway logs usage but deduction dark** | wire deduction at route |
| Image / Banner / Carousel / Infographic | creator actions exist; **image cost capture org-gated & not deducting** | wire + correct no-image pricing |
| Market Pulse / Snapshot / Growth | report actions exist (`website_audit`,`deep_analysis`,`full_strategy`); **some of the ~3 enforced routes** | wire remaining + reprice |
| BOLT / Creator / Mix / Strategic campaigns | `campaign_generation`/`campaign_optimization` exist; **fan-out items not individually metered** | wire per-item deduction |
| Active Leads Discovery | `lead_detection` exists; **per-scan deduction not wired** | wire per-scan |
| Voice | provider cost captured (flat $/min, org-gated); **no credit deduction** | wire per-minute |

**Summary:** every proposed activity has a **catalog home** (or near-match) in `credit_cost_config`/`featureRegistry`, but **only ~3 routes + 2 processors actually deduct** (`CREDIT_COVERAGE_AUDIT.md` Appendix G; live: 79/67,485 unified rows carry a charge). Current seeded credit *values* differ from the proposed catalog → **re-pricing config + deduction wiring** is the work. Classification: **support exists, charging is dark, pricing differs.**

---

## SECTION H — PLAN SIMULATION (current implementation rules)
**With CURRENT rules (metering dark):** almost no activity deducts, so 300/700/1500 are effectively **unlimited today** — the plans are not enforced. This is the core misalignment: *capacities are meaningless until metering is wired.*

**With the proposed catalog wired** (from `OMNIVYRA_ACTIVITY_CREDIT_CALIBRATION_AUDIT.md` §K, evidence-derived):
| Plan | Credits | Typical monthly | Result | Disproportionate consumers |
|---|---|---|---|---|
| Free | 300 | trial bundle (2 campaigns+2 blogs+10 assets+pulse+engagement) = **244** | ✅ fits (81%) | assets (10×) dominate |
| Starter | 300 | light ~253 ✅ / active ~416 ❌ | ⚠ caps active users | campaigns + assets |
| Growth | 700 | ~641 ✅ (92%) | ✅ tight | campaigns, leads |
| Business | 1500 | agency ~1,470 ✅ (98%) | ⚠ overflow for heavy agencies | assets, campaigns, leads |

**Breaks assumptions:** creator assets (10–40/mo) and campaign per-item fan-out consume disproportionately; lead discovery is COGS-sensitive at high post volume (needs a fair-use cap).

---

## SECTION I — COMMERCIAL ALIGNMENT SCORES (0–100)
| Area | Score | Justification |
|---|---|---|
| **Wallet Architecture** | **85** | Triple bucket + reserved + per-bucket expiry + **paid-never-expire DB guard** all live; only semantic labeling missing |
| **Credit Allocation** | **50** | One-time grant ready/idempotent; **recurring monthly-per-plan grant not wired**; renewal scaffolding partial |
| **Deduction Engine** | **85** | Bank-grade: `apply_credit_reservation` HOLD/CONFIRM/RELEASE, immutable+idempotent ledger, `getCreditCost`; live (333 txns) |
| **Activity Metering** | **30** | Catalog exists but **enforcement dark** (~3 routes / 79 rows); most activities don't deduct |
| **Top-Up Readiness** | **70** | Paid bucket + never-expire guard + checkout/catalog/providers; purchase→grant wiring needs live verification |
| **Founding Program** | **15** | No fields, discount logic, or badge; additive |
| **Subscription Readiness** | **45** | Plans + `plan_limits` exist; monthly credit grant per plan not wired; renewal partial |

---

## SECTION J — REQUIRED CHANGES
**CRITICAL (must exist before launch):**
| Change | Impact | Effort | Risk |
|---|---|---|---|
| Recurring monthly credit allocation per plan (grant-on-renewal job) | High — without it, subscriptions grant nothing | Medium (call existing `createCredit` on a cadence) | Medium — must be idempotent (ledger already supports it) |
| Wire activity metering (deduction on all chargeable routes) + reprice `credit_cost_config` to the catalog | High — without it, plans aren't enforced | High (many routes) | Medium — choose fail-closed vs fail-open per route |
| Confirm top-up checkout→paid-credit grant is live end-to-end | High — top-up revenue path | Low–Med (scaffolding exists) | Low |

**IMPORTANT (should exist before launch):**
| Change | Impact | Effort | Risk |
|---|---|---|---|
| Founding-member fields + discount application + badge | Medium (proposal requires it) | Medium | Low (additive, no ledger change) |
| Monthly-expiry cadence for the subscription (free) bucket — activate/confirm | Medium | Low (machinery exists) | Low |
| Capacity tuning (Starter 300→~600, Business 1500→~2,000–2,500) | Medium (UX/limits) | Low (config) | Low |
| Bucket semantic relabel (free→"subscription") | Low | Low | Low |

**NICE-TO-HAVE (later):**
| Change | Impact | Effort | Risk |
|---|---|---|---|
| Per-call USD cost telemetry (`total_cost_usd`) | Low for activity model (not token-priced) | Medium | Low |
| Founding badge UI polish, top-up discount tiers | Low | Low | Low |
| Single source-of-truth reconciliation across `usage_events`/`credit_usage_log`/`unified_transactions` | Low–Med | Medium | Low |

---

## SECTION K — FINAL VERDICT
1. **Can the current implementation support the proposed model?** **YES, substantially — without architectural change.** The model is activity-based, and the system's strongest built components (dual/triple-bucket wallet, immutable ledger, fixed-cost catalog, free→paid consumption order, paid-never-expire guard) are precisely what activity-based charging needs. The remaining work is **wiring + additive features**, not redesign.

2. **% already implemented:** **~65%** — wallet architecture (85), deduction engine (85), top-up readiness (70), consumption order (100) are done; allocation automation, metering coverage, founding, and subscription-grant wiring are the gap.

3. **% remaining:** **~35%** — concentrated in: recurring allocation job, activity-metering coverage, founding-member fields, capacity tuning.

4. **Are 300/700/1500 realistic?** **Mostly.** Free 300 ✅ and Growth 700 ✅ fit typical usage; **Starter 300 caps active users** and **Business 1500 is tight for agencies** (from the evidence-derived simulation). Recommend Starter **~600**, Business **~2,000–2,500**.

5. **Would pricing need to increase if the recommended catalog is adopted?** **No.** COGS is cents (LLM gpt-4o-mini), so even small plans run **~70%+ gross margin** — profitability does not force a price rise. The lever is **capacity**, not price.

6. **If yes, by how much?** Not a price increase — a **capacity** increase: Starter **+~300 credits**, Business **+~500–1,000 credits**. Pricing can stay as proposed.

7. **Recommended launch-ready commercial model:**
   - **Keep the architecture** — activity-based charging on the existing dual-wallet ledger (free=monthly-expiring subscription, paid=never-expiring top-up, incentive=bonus).
   - **Wire two things:** (a) a monthly grant-on-renewal job per plan, (b) activity-metering deduction across chargeable routes with the §J/§G catalog values.
   - **Capacities:** Free 300, Starter ~600, Growth 700–1,000, Business 2,000–2,500.
   - **Top-ups:** 250 / 750 / 1,500, never-expire (already supported) — verify checkout wiring.
   - **Founding member:** add the 3 fields + discount + badge (additive).
   - **Launch as activity-based now; token/cost telemetry is optional** (the cost-dark gap from the telemetry audit does NOT block this model).

> **Bottom line:** this is a **wiring + tuning launch, not a rebuild.** The expensive, hard-to-get-right parts (immutable atomic ledger, dual-wallet with paid-never-expire, holds/refunds, fixed-cost catalog, correct consumption order) are **already production-grade and live**. Ship activity-based credits by (1) automating monthly allocation, (2) wiring deduction coverage, (3) adding founding fields, and (4) nudging Starter/Business capacities up.

*(Audit only. No code, schema, migration, credit rule, or price created or modified. All checks read-only.)*
