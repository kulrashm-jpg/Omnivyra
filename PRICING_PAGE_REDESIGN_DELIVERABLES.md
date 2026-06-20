# OMNIVYRA — PRICING PAGE REDESIGN — DELIVERABLES

**Refactored the existing `/pricing` page** (not a new page) to the approved commercial model + target structure, driven by a **single source of truth**, with all duplication removed. Frontend only — no payments, no DB, no financial-core.

---

## BEFORE / AFTER STRUCTURE
| | Before | After |
|---|---|---|
| Hero | ✅ (with redundant sub-CTAs) | ✅ concise value prop |
| Founding messaging | ❌ repeated (hero pill + explanation block + per-card badges) | ✅ **once** — single banner |
| Plan cards | Starter/Growth/Scale/Enterprise (credits only, repeated notes) | **Free/Starter/Growth/Business** — founder price + struck-through regular price, credits, seats, one CTA; **no feature lists** |
| Feature/capability info | scattered across cards + 3 "reserve" blocks | ✅ **one** unified comparison matrix |
| Top-up pricing | shown twice (hero note + reserve packs) | ✅ **once** — single Top-Up section |
| FAQ | none | ✅ added (6 Q&As, incl. credits + founding + expiry) |
| Source of truth | hardcoded `TIERS`/`RESERVE_PACKS` in the page | ✅ `lib/billing/commercialPlans.ts` (plans + matrix + top-ups + FAQs) |

**Final order:** Hero → Founding Member Banner → Pricing Cards → Unified Feature Matrix → Top-Up Section → FAQ.

---

## FILES CHANGED
| File | Change |
|---|---|
| `pages/pricing.tsx` | **Refactored** to the target structure; renders entirely from the config; zero duplicated info |
| `lib/billing/commercialPlans.ts` | Added `regularPriceLabel` (Starter $100 / Growth $200 / Business $400); **`FEATURE_MATRIX`** (single capability source of truth); **`FAQS`**; updated **`TOPUPS`** to the approved display pricing (250/$30, 500/$55, 1000/$100) |
**Not changed:** no payment/checkout/DB/ledger code.

---

## IMPLEMENTED VALUES (from the single source of truth)
| Plan | Founder | Regular | Credits | Users |
|---|---|---|---|---|
| Free | $0 | — | 300 (one-time) | 1 |
| Starter | **$39** | ~~$100~~ | 300 / mo | 2 |
| Growth | **$79** | ~~$200~~ | 700 / mo | 5 |
| Business | **$159** | ~~$400~~ | 1,400 / mo | 10 |
| Top-ups | 250 → **$30** · 500 → **$55** · 1000 → **$100** (never expire) |

**Rules satisfied:** Founding messaging once (banner) · top-up pricing once (section) · capability comparison once (matrix) · single feature matrix as source of truth · no info duplicated across cards.

---

## SCREENS UPDATED
- `/pricing` — the public marketing pricing page (the only screen touched). Cards link to `/get-free-credits` (Free) and `/create-account?plan=<id>` (paid) — signup-first, since live checkout is the separate staging flow.

---

## MOBILE VALIDATION
Responsive by construction (Tailwind):
- Cards: `grid-cols-1 → sm:grid-cols-2 → lg:grid-cols-4`.
- Founding banner: `flex-col → sm:flex-row` (stacks on mobile).
- **Feature matrix:** wrapped in `overflow-x-auto` with `min-w-[640px]` → horizontal scroll on small screens (no clipping).
- Top-ups: `grid-cols-1 → sm:grid-cols-3`. FAQ: single column, stacks.
- All padding uses `px-6 lg:px-8`. (Static validation; render-screenshot pass would confirm visually.)

## ACCESSIBILITY VALIDATION
- Semantic headings (`h1` hero, `h2` per section); `<section aria-label>` on each block.
- Comparison table uses `<th scope="col">` (plan headers) + `<th scope="row">` (capability labels); ✓/— cells carry `aria-label="Included"/"Not included"`.
- FAQ uses `<dl>/<dt>/<dd>`.
- Regular price `line-through` carries `aria-label="Regular price"` so it isn't read as the active price.
- Links are real `<a>` (keyboard/focusable); color contrast uses the existing dark-on-light palette.

## CONVERSION-FLOW ASSESSMENT
Clean, single-path funnel: **Hero** (value: full access, pay-by-usage) → **Founding banner** (incentive, no fake urgency/countdown per policy) → **Cards** (one clear price + one CTA each; founder vs regular anchors value) → **Matrix** (justifies the choice without per-card clutter) → **Top-ups** (expansion) → **FAQ** (objection handling: credits, expiry, plan changes). One decision per card; comparison is consult-on-demand below. No competing CTAs, no repeated messaging diluting the ask.

---

## REMAINING COMMERCIALIZATION WORK
1. **Reconcile top-up pricing across surfaces** — the page shows **USD 250/$30, 500/$55, 1000/$100**, but the checkout catalog (`lib/billing/topupCatalog.ts` / seed `20260721`) is **INR 250/750/1500**. The SKUs *and* currency must be reconciled into one source before checkout goes live. *Important.*
2. **Wire CTAs to real checkout** — paid CTAs currently go to signup; connect to the staging top-up flow (Phase A.2) / subscription checkout once live. *High.*
3. **Regular-price enforcement** — charging the regular price after the Founding window (March 2028) needs the subscription + founding-enrollment logic (not built). *High (later).*
4. **Nav/visual QA** — a browser render pass for visual + true mobile/contrast confirmation. *Low.*

> **Bottom line:** the pricing page is **refactored to the approved model and target structure**, de-duplicated, fully config-driven (single source of truth), mobile-responsive, and accessibility-sound — **TypeScript 0 errors**. The remaining items are downstream commercialization (reconcile the two top-up catalogs, wire real checkout, enforce regular pricing post-Founding), not page work.

*(Frontend only. No payment/checkout/DB/ledger change. `pricing.tsx` refactored in place; config extended. Typecheck clean.)*
