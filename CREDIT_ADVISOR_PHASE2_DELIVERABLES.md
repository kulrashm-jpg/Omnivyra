# CREDIT ADVISOR — PHASE 2: CONSUMPTION OPTIMIZATION INTELLIGENCE — DELIVERABLES

**Extends the Phase-1 Credit Advisor into a full Consumption Optimization Intelligence system (Phases 11–22).**
Built 2026-06-17. 100% READ-ONLY. No billing, ledger, subscription, pricing, deduction, wallet, allocation, or top-up logic modified. Deterministic — NO LLM / AI anywhere.

---

## SECTION A — ARCHITECTURE

```
 pages/command-center/credit-advisor.tsx
   ├─ CreditAdvisorDashboard  (Phase 1, widgets 1–7)
   └─ OptimizationPanel       (Phase 2, widgets 8–12 + Upgrade Advisor)
            │ useCreditOptimization ──GET──► /api/credits/optimization   (withOrgAccess)
            ▼
   consumptionOptimizationAdvisorService.ts   (Phase 11 facade)
            │  loads rows + wallet ONCE, composes ↓ (all deterministic, READ-ONLY)
   ┌────────────────────┬─────────────────────┬───────────────────┬──────────────────┬─────────────────┐
   ▼                    ▼                     ▼                   ▼                  ▼                 ▼
 optimizationAggregates  automationConsumption  optimizationOpportunity  consumptionDriver  consumptionScenario  runwayOptimization
 (module monthly+deep)   (Phase 12)             Engine (Phase 13)        Analysis (P15)     Simulator (P16)      Optimizer (P17)
            │                    │                     │                                                          │
            │              optimizationKnowledgeBase.ts  ◄── single deterministic source (registry, levers,      │
            │              consumptionSavingsEstimator.ts     savings ratios, scenarios, alternatives)            │
            ▼                                                                                          upgradeAdvisorService (P19)
   credit_usage_log · organization_credits (SELECT only)

 preExecutionImpactService.estimateEnhancedImpact (Phase 20) ──► /api/credits/advisor-impact
```

**Principle:** every Phase-2 module is a pure function over already-read data; the facade reads each source once. The only DB reads are `credit_usage_log` and `organization_credits` (`SELECT`), plus the existing `getCreditCost` resolver and `resolveOrganizationPlanLimits` (read) for the plan name.

---

## SECTION B — FILES CREATED (16)
**Backend (`backend/services/creditAdvisor/`):**
| File | Phase | Role |
|---|---|---|
| `optimizationKnowledgeBase.ts` | 11–20 | Deterministic constants: automation registry, optimization levers + savings ratios, scenarios, alternatives, classification/priority thresholds |
| `optimizationAggregates.ts` | — | Per-module window/monthly credits + deep-variant share from raw rows |
| `automationConsumptionService.ts` | 12 | AutomationConsumptionReport (status, monthly credits/cost, classification) |
| `consumptionSavingsEstimator.ts` | 14 | Pure savings math (current/optimized/%/monthly/annual) |
| `optimizationOpportunityEngine.ts` | 13 | Rules A–E → opportunities + savings (deterministic) |
| `consumptionDriverAnalysisService.ts` | 15 | Top drivers with %/trend/projected impact |
| `consumptionScenarioService.ts` | 16 | What-if simulator (saved/runway/month-end per scenario) |
| `runwayOptimizationService.ts` | 17 | Current vs optimized runway, days gained |
| `upgradeAdvisorService.ts` | 19 | Deterministic upgrade category + reasoning (no sales language) |
| `consumptionOptimizationAdvisorService.ts` | 11 | Facade composing the full report |

**APIs:** `pages/api/credits/optimization.ts`
**UI:** `hooks/useCreditOptimization.ts`, `components/credit-advisor/OptimizationPanel.tsx`
**Docs:** `CREDIT_ADVISOR_PHASE2_DELIVERABLES.md` (this file)
*(Phase-1 created 13 files; this phase adds 16.)*

---

## SECTION C — FILES MODIFIED (4)
| File | Change |
|---|---|
| `backend/services/creditAdvisor/creditAdvisorTypes.ts` | Added Phase-2 types + `credit_rate_usd` to `WalletOverview` |
| `backend/services/creditAdvisor/consumptionMetricsService.ts` | `getWalletOverview` now also selects `credit_rate_usd` |
| `backend/services/creditAdvisor/preExecutionImpactService.ts` | Added `estimateEnhancedImpact` (Phase 20: runway impact, % of allocation, alternatives) |
| `pages/api/credits/advisor-impact.ts` | Switched to `estimateEnhancedImpact` |
| `pages/command-center/credit-advisor.tsx` | Renders `OptimizationPanel` below the Phase-1 dashboard |

**Zero** changes to any billing/ledger/subscription/pricing/wallet file.

---

## SECTION D — SERVICES ADDED
10 deterministic services (Section B). All are pure functions or `SELECT`-only readers. None import the credit write/deduction/execution path.

---

## SECTION E — DASHBOARD ENHANCEMENTS
`OptimizationPanel.tsx` adds (rendered under the Phase-1 widgets):
- **Upgrade Advisor** (Phase 19): category badge + plan + factual reasoning.
- **Widget 11 — Runway Optimizer**: current vs optimized runway + days gained + monthly credits saved.
- **Widget 9 — Optimization Opportunities**: opportunity · monthly savings · annual savings · priority (table).
- **Widget 8 — Automation Consumption**: automation · status · monthly credits · impact level (table).
- **Widget 10 — Consumption Drivers**: top modules · % · trend · projected monthly.
- **Widget 12 — What-If Simulator**: interactive scenario chips → projected credits saved / runway gained / month-end balance (client-side over the report's `scenarios[]`; no extra calls, no mutations).

---

## SECTION F — AUTOMATION DISCOVERY (Phase 12)
13 recurring automations registered (cadence from `backend/scheduler/cron.ts` + `vercel.json`): Conversation Triage (3 min), Conversation Memory (5 min), Engagement Monitoring/Social Polling (10 min), Inbox Analysis (per comment), Scheduled Lead Discovery (07:00 & 18:00), Active Leads Monitoring, Market Pulse Automation (daily), Intelligence Polling (2h), Signal Processing (30 min), Analytics Ingestion (daily), Scheduled Reports, Publish Reconciliation (10 min, **disabled by default**).
- **Estimated monthly credits** = the automation's module's observed monthly credits × its registry weight (anchored to real consumption — never fabricated).
- **Status** = `active` (observed spend) / `idle` (none) / `disabled_by_default`.
- **Classification** = Low <50 · Medium <200 · High <500 · Very High ≥500 credits/mo.

---

## SECTION G — OPTIMIZATION RULES (Phase 13 — deterministic, no AI)
| Rule | Module | Detect | Recommend | Savings ratio |
|---|---|---|---|---|
| A Campaign | Campaigns | spend ≥ 50/mo | shorter durations, fewer platforms, smaller campaigns | 30% |
| B Market Pulse | Intelligence | deep/multi-region detected, ≥ 30/mo | standard scans, lower frequency | 65% of deep portion |
| C Active Leads | Intelligence | spend ≥ 50/mo | narrow regions/platforms, lighter schedule | 45% |
| D Creator | Creator | spend ≥ 30/mo | less image regeneration, non-image formats | 30% |
| E Content | Content | deep/long detected, ≥ 30/mo | standard variants for routine content | 50% of deep portion |

Ratios are fixed, documented heuristics (basis: `OMNIVYRA_COST_ECONOMICS_MODEL.md`) applied to **actual observed module spend**, so no opportunity is surfaced for a module the org doesn't actually use.

---

## SECTION H — SAVINGS LOGIC (Phase 14)
`estimateSavings(currentMonthly, ratio)` → `{ current, optimized, savings, savings_pct, monthly_savings, annual_savings }`. Pure arithmetic, no estimation via AI. Module monthly = window credits × (30 / window_days). Deep-gated rules apply the ratio only to the deep-variant portion of the module.

---

## SECTION I — SCENARIO ENGINE (Phase 16)
6 scenarios (disable Market Pulse, reduce campaign duration/platforms, reduce lead coverage, reduce creator usage, standard content variants). Each removes a fixed fraction of its module's observed monthly spend, then recomputes: `projected_credits_saved_monthly`, `projected_runway_days`, `runway_increase_days`, `projected_month_end_balance`. Read-only; the UI selects scenarios client-side.

---

## SECTION J — RUNWAY OPTIMIZATION (Phase 17)
Sums applicable opportunity savings (capped per module at that module's spend, and total capped at current burn — can't save more than is spent), derives optimized daily burn, and recomputes runway. Returns current/optimized runway + additional days gained + monthly credits saved + which opportunities were applied.

---

## SECTION K — UPGRADE ADVISOR (Phase 19)
Deterministic, no sales language. Inputs: days_remaining, optimized runway, optimization potential, plan name.
- **No Upgrade Needed** — runway ≥ 30d (or negligible burn).
- **Optimization Recommended** — 15–30d, OR <15d where optimization alone restores ≥30d.
- **Upgrade Recommended** — 7–15d where optimization can't reach 30d.
- **Immediate Upgrade Recommended** — <7d where optimization can't restore a healthy runway.
Each returns a factual `reasoning` string with the numbers.

---

## SECTION L — VALIDATION RESULTS
- **TypeScript**: `tsc --noEmit -p tsconfig.json` ran to completion (exit 0); filtered to all Phase-2 files (10 services, API, hook, panel, page) → **0 errors**.
- **Read-only invariant (Phase 21)**: grep of `backend/services/creditAdvisor/` (entire tree, Phase 1 + 2) for write primitives (`insert(`, `update(`, `upsert(`, `delete(`, `.rpc(`, `executeWithCredits`, `createCredit`, `reserveCredits`, `confirmCreditReservation`, `releaseCreditReservation`, `apply_credit`, `deductCredits`) → **zero matches**. SELECT-only.
- **No AI**: no module imports `aiGateway`/`runCompletion`; all logic is fixed-rule arithmetic over the knowledge base.
- **Auth**: `/api/credits/optimization` + `/api/credits/advisor-impact` both wrapped in `withOrgAccess`.

---

## SECTION M — SCREENSHOTS
**Not captured** — requires `npm run dev:full` against an org with `credit_usage_log` data (workers + prod Supabase). Code-delivery task; no app instance launched. To view: open `/command-center/credit-advisor` → "Consumption Optimization" section. Can be driven via the `verify`/`run` skill on request.

---

## SECTION N — KNOWN LIMITATIONS
1. **Savings ratios are fixed heuristics**, not per-org measured elasticity. They’re deterministic and documented; they apply to real observed spend so they don’t invent savings, but actual realized savings depend on user behavior. Tunable in `optimizationKnowledgeBase.ts`.
2. **Automation attribution is module-weighted**, not per-automation-metered. `credit_usage_log` doesn’t cleanly separate, e.g., triage vs reply within Engagement, so each automation’s estimate = module spend × registry weight. Direct per-action metering would require an action_key on every automation’s usage rows.
3. **Automation enablement** is inferred (`active` if observed spend, else `idle`); only globally-off processes are marked `disabled_by_default`. True per-org toggle state would require reading each subsystem’s config tables (intentionally not done, to avoid coupling/guessing).
4. **Deep-variant detection** is by action-key heuristic (`deep`/`_long`/`pillar` + a fixed set), since the log doesn’t carry an explicit variant-depth field.
5. **"Allocated"** still uses `lifetime_purchased` (no monthly auto-allocation exists in this system — see Phase-1 deliverables §L1). Upgrade/utilization logic uses live wallet + burn.
6. **Enhanced pre-exec impact** loads 30d of rows per call for the runway-impact figure; it’s cached 30s. If called very frequently, cache the burn rate separately.
7. **No screenshots / live validation** (Section M). No persistence — pure read-time computation.

---

## SUCCESS CRITERIA
| # | Criterion | Status |
|---|---|---|
| 1 | Understand where credits are consumed | ✅ Drivers (W10) + automations (W8) |
| 2 | Understand why | ✅ Opportunities detail + driver trends |
| 3 | Understand which automations drive consumption | ✅ Automation Consumption (W8) |
| 4 | Estimate savings | ✅ Savings estimator + opportunities (W9) |
| 5 | Simulate alternatives | ✅ What-If Simulator (W12) |
| 6 | Extend credit runway | ✅ Runway Optimizer (W11) |
| 7 | Actionable optimization recommendations | ✅ Opportunity engine (rules A–E) |
| 8 | 100% read-only | ✅ Section L grep |
| 9 | No billing logic modified | ✅ Section C |
| 10 | Becomes a complete Consumption Optimization Intelligence system | ✅ Phases 11–22 delivered |
