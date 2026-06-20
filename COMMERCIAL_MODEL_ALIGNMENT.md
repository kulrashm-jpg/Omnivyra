# OMNIVYRA — COMMERCIAL MODEL ALIGNMENT (top-ups + subscriptions)

Reconciled every surface to **one** commercial model: dual-currency (USD/INR), canonical top-up SKUs **250 / 500 / 1000**. Frontend + config + prepared seed only — no payment/ledger/financial-core change. **TypeScript: 0 errors.**

## Single source of truth
`lib/billing/commercialPlans.ts` now holds the entire model with **both currencies**:
| Plan | Founder (USD / INR) | Regular (USD / INR) | Credits | Users |
|---|---|---|---|---|
| Free | $0 | — | 300 (one-time) | 1 |
| Starter | $39 / ₹3,299 | $100 / ₹8,499 | 300/mo | 2 |
| Growth | $79 / ₹6,599 | $200 / ₹16,999 | 700/mo | 5 |
| Business | $159 / ₹13,299 | $400 / ₹33,999 | 1,400/mo | 10 |

**Top-ups (canonical):** 250 → $30 / ₹2,499 · 500 → $55 / ₹4,599 · 1000 → $100 / ₹8,299 (never expire).

## What changed (4 files, all consistent)
| File | Change |
|---|---|
| `lib/billing/commercialPlans.ts` | Dual-currency `Money` model; `priceFounder`/`priceRegular` (USD+INR); top-ups 250/500/1000 with stable SKU ids; `formatMoney()`; matrix + FAQs (single source) |
| `pages/pricing.tsx` | **USD/INR toggle** (tabs) — switches all displayed prices; renders entirely from config |
| `lib/billing/topupCatalog.ts` (checkout) | Aligned to 250/500/1000; INR charge amounts (₹2,499/₹4,599/₹8,299); **ids match** commercialPlans + seed |
| `supabase/migrations/20260721_seed_topup_credit_packages.sql` | Aligned to 250/500/1000; INR `price`; **same UUIDs** — page, checkout, and DB are one model |

**Consistency:** the top-up SKU ids (`0a0a0a25…/0a0a0500…/0a0a1000…`) are **identical** across the pricing page, the checkout catalog, and the seed, so display ↔ checkout ↔ DB resolve to the same packs.

## Currency model
- **Display:** page toggles USD or INR (per your request).
- **Charge:** **INR via Razorpay** (India-native; the order path charges `credit_packages.price` as INR). USD is display/reference.
- The page footnote + FAQ state "Payments are processed in INR via Razorpay" so the USD tab isn't misleading.

## Remaining (your call / follow-up)
1. **Confirm the INR amounts** — they're ~₹84/USD conversions rounded to clean retail; set your exact ₹ values in `commercialPlans.ts` + `topupCatalog.ts` + the seed (one place each, kept in sync).
2. **Charge in the *selected* currency** (USD charge when USD is shown) would need order-path USD support (Razorpay international) — a deliberate financial-core change, deferred. Today: display both, charge INR.
3. **Subscriptions** use these same plan definitions (the single source) once the subscription checkout/allocation is built — no separate price list to drift.

*(Frontend + config + prepared seed only. No payment/ledger/financial-core change. Typecheck clean.)*
