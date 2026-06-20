# OMNIVYRA — COMMERCIALIZATION PHASE B — DELIVERABLES

Your currency decision reshaped Phase B into a **multi-currency commercial architecture** (canonical USD → USD/INR/EUR display via Super-Admin-managed FX → charge in the selected currency → internal gateway routing). I built the **safe foundation** and **designed** the financial-core pieces rather than blind-building money paths. **TypeScript: 0 errors.**

## DECISION RECORDED
> Canonical catalog in **USD**. Display in **USD / INR / EUR**. Super-Admin manages FX rates, market overrides, founder + regular pricing. Pricing page updates by selected currency. **Checkout charges in the selected currency.** **Gateway selection is internal** (by currency / method support), not customer-chosen.

This supersedes the fixed-INR top-up seed — so **Section A (apply INR seed) is intentionally NOT done**; the catalog is now canonical-USD with currency resolved at display/charge time.

## BUILT NOW (safe foundation — display/config only, charges nothing)
| File | Change |
|---|---|
| `lib/billing/currency.ts` (new) | `Currency` = USD/INR/EUR; canonical-USD **FX model** (`FxConfig` rates + per-SKU market overrides); `resolvePrice` / `formatPrice` (override → FX → USD); `gatewayForCurrency` (INR→Razorpay, USD/EUR→Stripe) |
| `lib/billing/commercialPlans.ts` | Catalog re-priced to **canonical USD** (`priceFounderUsd` / `priceRegularUsd` / `priceUsd`); display derives via FX |
| `pages/pricing.tsx` | Currency toggle now **USD / INR / EUR**; prices via `formatPrice` |
| `components/billing/BillingCenter.tsx` | Uses `formatPrice` (canonical USD) |
| `components/layout/navigationConfig.tsx` | **Section B done** — "Billing & Subscription" (+ Buy Credits) exposed under a "Credits & Billing" Command-Center group |

**Foundation validation (pure-function, no writes):**
```
USD  Starter $39 · Growth $79 · Business $159   | topups 250:$30 · 500:$55 · 1000:$100
INR  Starter ₹3,276 · Growth ₹6,636 · ₹13,356   | topups ₹2,520 · ₹4,620 · ₹8,400
EUR  Starter €35.88 · Growth €72.68 · €146.28    | topups €27.6 · €50.6 · €92
```
(FX-derived from canonical USD; Super-Admin overrides will set exact retail values.)

## PHASE-B SECTION STATUS
| § | Item | Status |
|---|---|---|
| A | credit_packages seed | **Superseded** — fixed-INR seed dropped; needs the multi-currency catalog (below) |
| B | Nav: Billing & Subscription | ✅ **Done** |
| C | Create Order / Verify / History | Built in Phase A.2 (INR/Razorpay); **needs multi-currency + gateway-routing rework** for the new model |
| D | Razorpay test mode | ✅ confirmed (`PROVIDER_MODE='test'`, `rzp_live_` + `order_live` rejected, staging-gated) |
| E | Allocation → top-up balance | Path wired (`verify → completePurchase → createCredit('paid')`, razorpayStagingService.ts:561/761); **not executable** without test keys |
| F | Billing Center refresh | Wired (purchase → `paid` pool → Top-Up balance + Available + Billing History); not executable without keys |
| G | Validation matrix (success/fail/dup/webhook/retry) | **Cannot run** — no Razorpay test keys, no staging env |

## DESIGNED (financial-core — next controlled phases, NOT built)
1. **Super-Admin FX & pricing management** — tables `fx_rates(currency, rate, updated_by, updated_at)`, `price_overrides(sku, currency, amount)`, plus founder/regular price management; admin endpoints + UI. `currency.ts` already consumes an injected `FxConfig`, so wiring a store is additive.
2. **Multi-currency checkout** — order path must carry `currency` (today hardcoded INR) + a per-currency amount from `resolvePrice`; `credit_packages` needs a canonical-USD price + computed/override amounts.
3. **Internal gateway routing** — `gatewayForCurrency` exists; INR→Razorpay is wired, **USD/EUR→Stripe is not integrated** (no Stripe gateway yet). Routing must check provider-enabled + fall back.

## READY FOR LIVE PAYMENTS?
### **NOT READY FOR LIVE PAYMENTS.**
The revenue *code* for INR/Razorpay exists, but the approved model now requires multi-currency charging + internal gateway routing that isn't built, and live execution is blocked externally. Exact blockers:
1. **Multi-currency checkout + gateway routing** not implemented (financial-core) — USD/EUR need a Stripe integration that doesn't exist. *Critical.*
2. **Super-Admin FX/override store** not built — rates/overrides are config defaults, not operator-managed. *High.*
3. **No Razorpay test keys + no staging env** — Sections E/F/G can't be executed/validated. *Critical (external).*
4. **credit_packages not seeded** in the new canonical-USD shape. *High.*

**Foundation is in place and validated.** The next build is the financial-core trio (§"Designed"): Super-Admin FX store → multi-currency checkout → gateway routing — then run Section G in staging with test keys.

*(Foundation: display/config only, no charge, no gateway selected at runtime. Financial-core designed, not built. Nav shipped. Typecheck clean.)*
