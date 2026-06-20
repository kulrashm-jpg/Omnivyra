# CREDIT ADVISOR & CONSUMPTION INTELLIGENCE — DELIVERABLES

**Read-only intelligence layer on top of the existing (bank-grade) credit system.**
Built 2026-06-17. No billing logic, ledger, catalog, subscription, or top-up code was modified.

---

## SECTION A — ARCHITECTURE

```
                         pages/command-center/credit-advisor.tsx   (Phase 6 page)
                                   │  useCompanyContext().selectedCompanyId
                                   ▼
                hooks/useCreditAdvisor.ts ──GET──► /api/credits/advisor?org_id&days   (withOrgAccess)
                                   │                         │
   components/credit-advisor/CreditAdvisorDashboard.tsx      ▼
                                            backend/services/creditAdvisor/creditAdvisorService.ts (facade)
                                                              │  composes ↓ (all READ-ONLY)
   ┌──────────────────────────────┬──────────────────────────┬───────────────────────┬─────────────────────┐
   ▼                              ▼                          ▼                       ▼                     ▼
consumptionMetricsService   creditForecastService   consumptionAttributionService  creditOptimizationEngine  creditHealthScoreService
 (Phase 2 burn/metrics)      (Phase 3 runway)         (Phase 4 module/activity/user) (Phase 5 rules A–E)       (Phase 8 score)
   │                                                          │
   ▼ SELECT                                                   ▼ featureRegistry (action_key→module)
 credit_usage_log · organization_credits          (no DB writes anywhere)

  preExecutionImpactService (Phase 7) ──► /api/credits/advisor-impact  (reuses getCreditCost catalog resolver)
```

**Design principles:** (1) compose, don't duplicate — reuse `creditPriorityService.computeAvailable`, `featureRegistry`, `getCreditCost`, `credit_usage_log`; (2) single read per source per request (rows + wallet fetched once, shared downstream); (3) every module is a pure function or a `SELECT`-only reader.

---

## SECTION B — FILES CREATED (13)

**Backend services** (`backend/services/creditAdvisor/`):
| File | Phase | Responsibility |
|---|---|---|
| `creditAdvisorTypes.ts` | — | Shared types + safety doc |
| `creditAdvisorTaxonomy.ts` | 4 | action_key → module/activity, deep-variant detection (reuses featureRegistry) |
| `consumptionMetricsService.ts` | 2 | daily/weekly/monthly consumption, burn rates, wallet overview reader |
| `creditForecastService.ts` | 3 | days_remaining, month-end projection, exhaustion risk |
| `consumptionAttributionService.ts` | 4 | by module/activity/variant/user + % + trend |
| `creditOptimizationEngine.ts` | 5 | deterministic rules A–E (no AI) |
| `creditHealthScoreService.ts` | 8 | 0–100 health score + band |
| `preExecutionImpactService.ts` | 7 | estimated cost + % of remaining |
| `creditAdvisorService.ts` | — | facade composing the full report |

**APIs** (`pages/api/credits/`): `advisor.ts`, `advisor-impact.ts`
**UI**: `hooks/useCreditAdvisor.ts`, `components/credit-advisor/CreditAdvisorDashboard.tsx`, `pages/command-center/credit-advisor.tsx`

---

## SECTION C — FILES MODIFIED (1)
| File | Change |
|---|---|
| `components/layout/navigationConfig.tsx` | Added `Wallet` icon import + one top-level "Credit Advisor" nav item → `/command-center/credit-advisor`. (Command-palette entry auto-derives.) |

No other files touched. **Zero** changes to any credit/ledger/billing/subscription file.

---

## SECTION D — DATABASE CHANGES
**NONE.** No migrations, no new tables, views, or columns. The system reads only existing objects:
- `credit_usage_log` (action, credits_used, user_id, created_at) — daily-grain consumption
- `organization_credits` (balances + reserved + lifetime_purchased/consumed) — wallet
- `credit_cost_config` (indirectly, via `getCreditCost`) — fixed per-action cost

This keeps the layer 100% read-only and avoids any prod-ledger migration risk.

---

## SECTION E — SERVICES ADDED
9 services (see Section B). All exports are pure or `SELECT`-only. None import the credit write/deduction/execution path.

---

## SECTION F — APIs ADDED
| Method · Route | Auth | Returns |
|---|---|---|
| `GET /api/credits/advisor?org_id&days` | `withOrgAccess` | Full `CreditAdvisorReport` (overview, metrics, forecast, attribution, recommendations, health) |
| `GET /api/credits/advisor-impact?org_id&action&multiplier&variant` | `withOrgAccess` | `PreExecutionImpact` (estimated_credits, pct_of_remaining) |

Both 405 on non-GET, 400 on missing params, set `Cache-Control: private`, and log failures via the shared `logger`.

---

## SECTION G — UI COMPONENTS ADDED
- **Page**: `pages/command-center/credit-advisor.tsx` (lean; AppLayout/nav injected by AuthGate).
- **Dashboard**: `components/credit-advisor/CreditAdvisorDashboard.tsx` — 7 widgets: (1) Credit Overview (allocated/consumed/remaining), (2) Burn Rate (daily/weekly/monthly), (3) Days Remaining + projected exhaustion, (4) Top drivers by module, (5) Top activities, (6) Optimization recommendations, (7) Subscription health (score + factor breakdown + month-end projection). Uses `components/ui/{card,badge}` + recharts LineChart.
- **Hook**: `hooks/useCreditAdvisor.ts` — explicit `loading|ready|error|unavailable` status discriminator (mirrors `useCredits`; never treats a fetch failure as a real zero).

---

## SECTION H — FORECAST LOGIC (Phase 3)
- `daily_burn_rate = credits_used_30d / 30`; weekly/monthly = ×7 / ×30.
- `days_remaining = credits_remaining / daily_burn_rate` (null when burn ≈ 0 → no runway pressure).
- `projected_exhaustion_date = now + days_remaining`.
- `projected_month_end_consumption = consumed_this_month + daily_burn × days_left_in_month`.
- `projected_month_end_balance = remaining − daily_burn × days_left_in_month`.
- **Risk levels** (by days_remaining): `Critical < 7`, `At Risk < 15`, `Monitor < 30`, `Healthy ≥ 30` (or null burn).
- `credits_remaining` = wallet available = (free+paid+incentive) − reserved (via `creditPriorityService.computeAvailable`).

---

## SECTION I — RECOMMENDATION RULES (Phase 5 — deterministic, no AI)
| Rule | Trigger | Output |
|---|---|---|
| **A** High Consumption Activity | top activity > 40% of spend | Highlight activity, %, credits |
| **B** Credit Exhaustion Risk | days_remaining < 15 | Warn (critical < 7); show projected exhaustion date |
| **C** Under Utilization | remaining > 50% of period budget AND month > 75% complete | Encourage usage |
| **D** Deep Variant Overuse | deep/long variants > 50% of spend | Suggest lighter variants |
| **E** Campaign Heavy Usage | Campaigns module > 35% of spend | Identify campaign impact |

Sorted by severity (critical → warn → info). "Deep" detection = action keys in {deep_analysis, full_strategy, market_positioning} or containing `deep`/`_long`/`pillar`.

---

## SECTION J — SCREENSHOTS
**Not captured.** Producing live screenshots requires running the app against a real org with credit-usage data (`npm run dev:full`, per project constraints — the workers + Supabase prod connection). This was a code-delivery task; no app instance was launched. To capture: start `dev:full`, sign in, open `/command-center/credit-advisor` for an org with `credit_usage_log` rows. (I can drive this via the `verify`/`run` skill on request.)

---

## SECTION K — VALIDATION RESULTS
- **TypeScript**: `tsc --noEmit -p tsconfig.json` ran to completion (exit 0); filtered to the new files (services, APIs, hook, dashboard, page) → **0 errors**.
- **Read-only invariant (Phase 9)**: verified by construction — grep of `backend/services/creditAdvisor/` for write primitives (`insert(`, `update(`, `upsert(`, `delete(`, `executeWithCredits`, `createCredit`, `reserveCredits`, `apply_credit`, `.rpc(`) returns **zero** matches. The only DB calls are `.from(...).select(...)`. The facade header documents the contract.
- **Auth**: both routes wrapped in `withOrgAccess` (caller must be a member of the requested org).
- **Reuse**: no duplication of balance math (uses `computeAvailable`), module mapping (uses `featureRegistry`), or cost catalog (uses `getCreditCost`).

---

## SECTION L — KNOWN LIMITATIONS
1. **"Allocated" semantics.** There is **no monthly auto-allocation** in this system — `plan_limits.monthly_credits` is a catalog/display figure, not auto-granted (credits enter only via explicit grants/purchases). So the overview's "Allocated" uses `lifetime_purchased`, and forecast/utilization use the live wallet balance, not a monthly entitlement. If a true monthly allotment is introduced later, swap that source in `getWalletOverview` + rule C's `periodBudget`.
2. **Burn source = `credit_usage_log`.** Mirrors the existing `/api/credits/usage` endpoint. Because credit *enforcement* is still largely dark in prod (per `CREDIT_COVERAGE_AUDIT.md`), this log may under-represent true economic cost for actions that don't yet charge credits. Burn reflects **credits actually consumed**, which is the correct basis for runway, but will rise as enforcement coverage expands.
3. **User attribution** labels users by truncated `user_id` (`User a1b2c3d4`) + "System / automated" for null. Email resolution was intentionally omitted to avoid extra queries/permission surface; can be added via the same path `consumptionAnalyticsService` uses for super-admin.
4. **Pre-execution impact** resolves only **fixed-cost** actions (`credit_cost_config`). Token-priced actions return `resolvable:false` with a note, since their cost depends on runtime token usage. Campaign whole-plan estimates can be layered in via the existing `campaignCostEstimator`.
5. **Trend** is a recent-half vs prior-half split of the window (±15% band), not a regression — adequate for direction, not magnitude.
6. **No screenshots / live validation** (see Section J).
7. **No persistence/alerting**: this is pure read-time computation. A projected-depletion alert could be added by extending the existing `creditAlertService` + `credit_alert_log` (dedup infra already exists) rather than building new.

---

## SUCCESS CRITERIA
| # | Criterion | Status |
|---|---|---|
| 1 | See burn rate, remaining credits, projected exhaustion | ✅ Widgets 1–3 + forecast |
| 2 | Identify top consuming activities + modules | ✅ Widgets 4–5 (attribution) |
| 3 | Receive optimization recommendations | ✅ Widget 6 (rules A–E) |
| 4 | Understand whether credits will last | ✅ Days-remaining + risk + health score |
| 5 | No existing billing functionality changed | ✅ Section D (no DB) + K (read-only grep) |
