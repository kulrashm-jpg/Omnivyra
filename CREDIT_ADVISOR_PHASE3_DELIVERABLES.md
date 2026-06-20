# CREDIT ADVISOR — PHASE 3: PROACTIVE RUNWAY INTELLIGENCE & EXECUTIVE POPUP — DELIVERABLES

**Turns the Credit Advisor from a passive dashboard into a proactive executive guidance system (Phases 23–36).**
Built 2026-06-17. 100% READ-ONLY w.r.t. billing — recommends and simulates only. The sole persistence is a UI dismissal preference in `localStorage` (no backend writes, no billing impact).

---

## SECTION A — ARCHITECTURE
```
 components/DashboardPage.tsx  (/dashboard = command-center landing)
   ├─ CreditAdvisorExecutivePopup ─ useExecutiveIntelligence ─┐   (popup: show-decision + dismissal in localStorage)
   └─ CreditAdvisorBanner ─────────(own lightweight fetch)────┤
                                                              ▼  GET /api/credits/executive (withOrgAccess)
                                        executiveIntelligenceService.ts  (Phase 3 facade)
                                                              │ loads rows+wallet ONCE, composes ↓ (READ-ONLY)
   Phase-1 blocks (metrics, forecast, health, attribution) + Phase-2 blocks (aggregates, automations,
   opportunities, drivers, runwayOptimizer, upgradeAdvisor) ──► executive summary · automation runway (P26)
                                                                · frequency optimizations (P27/29) · top-3 (P30)
                                                                · display signals (P31) · banner (P32)
   deep links ──► /command-center/credit-advisor#{overview|runway|opportunities|automation|simulator}
```
The facade reads `credit_usage_log` + `organization_credits` once (SELECT-only) and derives everything. The popup and banner each call the cached endpoint; only the popup runs the show-decision + persistence.

---

## SECTION B — FILES CREATED (5)
| File | Phase | Role |
|---|---|---|
| `backend/services/creditAdvisor/executiveIntelligenceService.ts` | 23–32 | Facade: summary, automation-runway, frequency-opt, top-3, banner, display signals |
| `pages/api/credits/executive.ts` | — | Read-only executive endpoint (`withOrgAccess`) |
| `hooks/useExecutiveIntelligence.ts` | 24/31 | Fetch + smart-display decision + dismissal persistence (localStorage) |
| `components/credit-advisor/CreditAdvisorExecutivePopup.tsx` | 23/25/30/34 | Executive popup |
| `components/credit-advisor/CreditAdvisorBanner.tsx` | 32 | Command-center banner |

## SECTION C — FILES MODIFIED (5)
| File | Change |
|---|---|
| `backend/services/creditAdvisor/optimizationKnowledgeBase.ts` | `AutomationDef` + 6 registry entries gain frequency-optimization metadata |
| `backend/services/creditAdvisor/creditForecastService.ts` | Added `runwayDays` + `runwayGainFromMonthlySavings` helpers |
| `backend/services/creditAdvisor/creditAdvisorTypes.ts` | Added Phase-3 types |
| `components/DashboardPage.tsx` | Mounts popup + banner (read-only) |
| `components/credit-advisor/OptimizationPanel.tsx` + `pages/command-center/credit-advisor.tsx` | Deep-link anchor ids (`overview/runway/opportunities/automation/simulator`) |

**Zero** changes to any billing/ledger/subscription/pricing/wallet/automation file.

---

## SECTION D — POPUP LOGIC (Phase 23/25)
`CreditAdvisorExecutivePopup` shows a runway headline, health badge, remaining credits, projected exhaustion, largest driver, optimization potential (credits + runway gain), the **top-3 actions**, and the optimization-before-upgrade verdict. It renders only when `useExecutiveIntelligence` decides `visible` (Phase 31). Executive tone: runway/savings/impact framing, no credit-accounting jargon, no walls of text.

## SECTION E — DISMISSAL LOGIC (Phase 24)
Four controls — **Dismiss**, **Dismiss for today**, **Don’t show again**, **Remind me later** (+4h) — persisted per org in `localStorage` (`omnivyra.creditAdvisor.exec.<orgId>`): `{ dismissedForever, dismissUntil, remindAt, lastShownDate, lastSignature }`. No backend write, no billing impact.

## SECTION F — RUNWAY INTELLIGENCE (Phase 26)
`automation_runway[]`: per active automation → monthly credits, % of consumption, and **runway days lost** = `runwayGainFromMonthlySavings(remaining, dailyBurn, automationMonthly)` (the days you’d reclaim by removing it). Classified Low/Medium/High/Very-High.

## SECTION G — FREQUENCY OPTIMIZATION (Phase 27)
`frequency_optimizations[]`: automations with a safe lower-frequency alternative (Lead Discovery twice-daily→daily, Market Pulse daily→weekly, Triage 3min→15min, Polling 10min→30min, Reports daily→weekly, Active Leads continuous→core). Each → current/recommended frequency, current/optimized monthly credits, potential savings, runway gain, and plain-language tradeoff.

## SECTION H — AUTOMATION IMPACT SIMULATOR (Phase 29)
Realized as the frequency-optimization rows: each carries Current state → Optimized state → Credits saved → Runway gained → Tradeoff, all deterministic. Surfaced in the popup’s top-3 and on the Credit Advisor automation section (deep-linked).

## SECTION I — BANNER (Phase 32)
`CreditAdvisorBanner` — always-on single strip on `/dashboard`, colored by risk: consumption health, runway, largest driver, top recommendation (savings + runway gain), and a **View details** deep link.

## SECTION J — DEEP LINKING (Phase 33)
Every popup action and the banner deep-link into `/command-center/credit-advisor#<section>`; the page + optimization panel expose anchor ids `overview`, `runway`, `opportunities`, `automation`, `simulator` (with `scroll-mt` offsets). Top actions route to `opportunities` (savings levers) or `automation` (frequency levers).

## SECTION K — DISPLAY RULES (Phase 31)
Server computes `display`: `risk`, `runway_days`, `exhaustion_within_30d`, `opportunity_pct`, `consumption_spike` (recent 7d burn > 1.25× 30d), `healthy_and_low_opportunity`, `base_should_show`, and a compact `signature`.
- **Suppressed** when Healthy **and** optimization opportunity < 10% (`base_should_show=false`).
- **Shown** when risk ≠ Healthy, exhaustion < 30 days, opportunity ≥ 10%, or a consumption spike.
- Client adds: not if dismissed-forever / dismissed-today / within remind window; not if already shown today **unless the signature changed** (covers risk escalation / new opportunity).

## SECTION L — VALIDATION RESULTS
- **TypeScript**: `tsc --noEmit -p tsconfig.json` ran to completion (exit 0); filtered to all Phase-3 files (service, API, hook, popup, banner, dashboard mount, panel/page anchors) → **0 errors**.
- **Read-only invariant (Phase 35)**: grep of `backend/services/creditAdvisor/` for write primitives → **zero matches** (SELECT-only). The only writes in the phase are client `localStorage` (UI prefs), never billing/credits/plans/automations.
- **Optimization-before-upgrade (Phase 28)**: enforced by `upgradeAdvisorService` — `Upgrade Recommended` only when optimization can’t restore a healthy runway; the popup leads with savings/actions.
- **Auth**: `/api/credits/executive` wrapped in `withOrgAccess`.

## SECTION M — SCREENSHOTS
**Not captured** — requires `npm run dev:full` against an org with `credit_usage_log` data. Code-delivery task; no app launched. To view: open `/dashboard` (banner + popup) and `/command-center/credit-advisor` (deep-link targets). Drivable via the `verify`/`run` skill on request.

## SECTION N — KNOWN LIMITATIONS
1. **Dismissal is per-browser** (localStorage), not cross-device. This is the deliberate safe choice to keep the backend 100% read-only; cross-device sync would require a user-preferences write path (intentionally avoided).
2. **Popup mounts on `/dashboard`** (the command-center landing + default post-login route), so "first login of day" ≈ "first dashboard visit of day." App-wide triggering would mount it in `AppLayout` (not done to avoid touching the global shell).
3. **Banner + popup each fetch** `/api/credits/executive` (cached 60s) — two GETs. Could be deduped by lifting the report to a shared provider.
4. **Frequency savings ratios + automation attribution** inherit the Phase-2 heuristics (module-weighted, fixed ratios) — deterministic and anchored to real spend, but not per-automation-metered. See Phase-2 deliverables §N.
5. **Consumption-spike** uses recent-7d vs 30d burn from the same window; a dedicated longer baseline would sharpen it.
6. **No screenshots / live validation** (Section M).

---

## SUCCESS CRITERIA
| # | Criterion | Status |
|---|---|---|
| 1 | Sees consumption intelligence proactively | ✅ Popup + banner |
| 2 | Understands runway instantly | ✅ Headline + banner |
| 3 | Understands what consumes credits | ✅ Largest driver + automation runway |
| 4 | Understands how to save | ✅ Top-3 actions + frequency opts |
| 5 | Optimization before upgrade | ✅ Phase 28 enforced |
| 6 | Popup can be dismissed | ✅ 4 controls |
| 7 | Popup can be permanently hidden | ✅ Don’t show again |
| 8 | Banner provides ongoing visibility | ✅ Always-on strip |
| 9 | 100% read-only | ✅ Section L grep |
| 10 | No billing functionality modified | ✅ Section C |
