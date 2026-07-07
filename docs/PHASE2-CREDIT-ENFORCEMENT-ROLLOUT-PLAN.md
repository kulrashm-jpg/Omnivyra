# Phase-2 Credit Enforcement — Rollout Plan for AI Generation

_Status: PLAN ONLY. No prod flags flipped, no DDL run. Verified read-only against
prod on this date._

## TL;DR

AI generation (creator images/carousels/infographics, text content) currently
deducts **zero credits** because every switch that would activate charging is
**off by default** — this is the intended "Phase-2 built but DARK" state, not a
leak. **The database and cost catalog are already in place** (verified live), so
turning charging on is now a **configuration-only** rollout: no migrations, no
new pricing work.

## Verified current state (read-only prod probe)

**Migrations — ALL APPLIED** (the migration ledger is desynced and under-reports;
`to_regclass` confirms the objects exist):

- `20260664` governance/payment foundation — `company_billing_profiles`,
  `billing_subscriptions`, `invoices`, `invoice_line_items`, `payment_transactions`,
  `usage_billing_snapshots`, `v_reservation_health`, `v_billing_operations_health` ✅
- `20260665` credit catalog — `credit_cost_config` table + 45 seed rows ✅
- `20260666` `credit_hold_policy_snapshots` ✅
- `20260667` `usage_events.ledger_hold_transaction_id` +
  `unified_transactions.ledger_hold_transaction_id` ✅

**Cost catalog — ALREADY DEFINED** (`credit_cost_config`, live values):

| action_type | credits |
|---|---|
| blog_generation | 60 |
| campaign_generation | 50 |
| insight_generation | 8 |
| content_basic / content_repurpose / **creator_content** | 5 |
| content_rewrite / content_suggestions | 3 |
| reply_generation | 2 |

Every creator image/carousel/infographic charges through **`creator_content` = 5
credits**.

## Why nothing charges today (switch resolution order)

| Layer | Switch | Default |
|---|---|---|
| Global kill | `PHASE2_BILLING_KILL_SWITCH` | off (forces off when on) |
| Global force enforce | `PHASE2_BILLING_FORCE_ENFORCE` | off |
| Global shadow | `PHASE2_BILLING_SHADOW` | off |
| Entry-consumption master | `PHASE2_ENTRY_CONSUMPTION` | **off → every path resolves `off`** |
| Per-org canary | flag `billing.reservations_required` | off |
| Economy shadow telemetry | `PHASE2_CREDIT_ECONOMY_SHADOW` | off |

- Inline creator path (`generate.ts → wirePhase2Route`): `off` = pure passthrough.
- Worker path (`creatorContentProcessor`): only charges when
  `getCreditEconomyExecutionMode === 'enforce'`; legacy in-job `deductCredits()` is
  an empty stub.

## Recommended decisions (picked as best defaults)

1. **Cost per image = 5 credits** — use the existing `creator_content` catalog
   value. It's the configured source of truth; don't invent new numbers.
2. **Charge each explicit regenerate** — a fresh generate = new logical request =
   new 5-credit charge. Idempotent retries of the *same* request reuse the HOLD and
   do not double-charge.
3. **Hold → confirm/release (atomic), effectively flat 5** — charge succeeds only on
   a produced asset; failed/abandoned generation releases the hold (no phantom
   charge). For the flat low-cost creator action this behaves like a flat 5-credit
   charge with automatic refund-on-failure.

## Rollout (configuration-only — no DDL)

**Phase A — Confirm mapping (read-only, DONE here).** Migrations present ✅, cost
catalog present ✅, `creator_content = 5` ✅.

**Phase B — Shadow soak (zero deductions).**
- Set `PHASE2_CREDIT_ECONOMY_SHADOW=true` (and optionally `PHASE2_BILLING_SHADOW=true`)
  on **Vercel (prod)** and the **Railway worker**; redeploy/restart.
- Generate across all three surfaces; watch `credit_economy_shadow_evaluation`
  events + `would_allow` / `would_block` counters (`billingMetrics`,
  `creditEconomyObservability`).
- **Gate:** would-charge amounts == 5/asset as expected; would-block rate on funded
  orgs ≈ 0. Soak a few days.

**Phase C — Enforce canary (one test org).**
- Turn on master `PHASE2_ENTRY_CONSUMPTION=true`, and set flag
  `billing.reservations_required` for a **single test org** (e.g. `0eda0896`;
  **never** the real `73e5fa6f` "Embrosales").
- Smoke: one generation → exactly one 5-credit debit in the ledger; insufficient
  balance → clean **402 PaymentRequired** (no free output — `generate.ts` already
  surfaces this). Retried request → no double-charge; fresh regenerate → charges.

**Phase D — Broaden.**
- Expand the canary flag org-by-org (or globally via master + per-org gate).
- Confirm hold → confirm/release: abandoned/failed generations release the hold.

**Rollback (instant, no deploy) at any phase:** `PHASE2_BILLING_KILL_SWITCH=true`
forces `off` everywhere immediately. Migrations are additive; nothing to revert.

## Open items before Phase C (real charges)

- Confirm the creator activity resolves to `creator_content` (5) and not the
  in-code `SHORT_GENERATION` economics via `activityEconomyCatalog` — reconcile the
  two so the charged amount is unambiguous.
- Decide funded-balance messaging / top-up prompts for the 402 path (UI).
