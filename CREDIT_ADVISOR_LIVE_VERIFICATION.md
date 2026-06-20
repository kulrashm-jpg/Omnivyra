# CREDIT ADVISOR — LIVE VERIFICATION & PRODUCTION-READINESS AUDIT

**Runtime validation of Phases 1–3 against REAL production data, read-only.** 2026-06-17.
Two defects were found *and fixed* during the audit and re-verified on the same live data.

> ### Scope & honesty boundary (read first)
> The literal request — boot `npm run dev:full`, click through the UI, capture screenshots — was **partially blocked**, and I will not fake what I couldn't observe:
> - **`dev:full` not run.** `.env.local` resolves to **production Supabase** (`klkiseupptzbecbxwrky`) with `NODE_ENV=production`. Booting the full stack locally against prod is unsafe and pointless for a read-only audit. (Note: `REDIS_URL` is `redis://127.0.0.1:6379` — *localhost*, not prod Upstash — so workers would target a local Redis, not prod queues. The blocker is the prod DB + `NODE_ENV`, not Redis.)
> - **No browser screenshots / click-through.** The dashboard is behind `AuthGate` and the APIs behind `withOrgAccess`; no test credentials or test-org id were provided, so I cannot establish an authenticated session to render/scrshot the UI.
> - **What I DID do instead — and it's stronger than clicking:** ran the **actual service code at runtime** (`getCreditAdvisorReport`, `getConsumptionOptimizationReport`, `getExecutiveIntelligence`) against a real prod org with usage history, plus edge cases and timing — read-only, zero writes, no workers, no HTTP. This validates execution, calculations, display logic, and edge handling on real data. The UI *rendering* layer remains unverified (needs an authenticated browser pass).

---

## SECTION A — ENVIRONMENT
| Item | Result |
|---|---|
| Method | Read-only `tsx` harness importing the real services; `dotenv` → `.env.local` |
| Config boot | ✅ `[config] Startup configuration validated` (NODE_ENV=production, supabase klkiseupptzbecbxwrky) |
| Writes performed | **0** (SELECT-only; harness imports proven read-only services) |
| Workers started | **0** |
| Service execution | ✅ all 3 facades executed without runtime errors |

## SECTION B — ORGANIZATION USED
| Item | Value |
|---|---|
| `credit_usage_log` total rows (whole prod DB) | **138** |
| `organization_credits` wallets | **27** |
| Orgs with usage (last 60d) | **2** |
| Target org | `4bdbec26-4f7e-4e77-a965-d499e1472f5c` (137 events, 1048 credits, 7 action types) |
| Wallet | free 3252, paid 0, incentive 0, **lifetime_purchased 4300, lifetime_consumed 1048**, rate $0.01 |

> **Environment finding (not a bug):** `credit_usage_log` holds only **138 rows DB-wide** — credit enforcement is still largely dark in prod (consistent with `CREDIT_COVERAGE_AUDIT.md`). Most orgs will show light/empty Advisor data until charging coverage expands. Sets expectations for rollout.

## SECTION C — DASHBOARD VERIFICATION (Phase-1 widgets, runtime)
`getCreditAdvisorReport` — **175–214 ms**. All values computed correctly:
| Widget | Output | Check |
|---|---|---|
| 1 Credit Overview | remaining 3252, allocated 4300, consumed 1048 | ✅ matches wallet |
| 2 Burn Rate | today 0, 7d 806, 30d 868, daily 28.93 | ✅ 868/30 = 28.93 |
| 3 Days Remaining | **112.4 days**, risk Healthy, exhaust 2026-10-07 | ✅ 3252/28.93 = 112.4 |
| 4 Drivers / 5 Activities | (after fix) Other 61.3%, Creator 28.3%, Content 10.4% | ⚠ see Issue 1 |
| 6 Recommendations | none (healthy, well-distributed) | ✅ correct for state |
| 7 Health | 83/100 (Healthy) | ✅ |

## SECTION D — OPTIMIZATION VERIFICATION (Phase-2 widgets, runtime)
`getConsumptionOptimizationReport` — **183–192 ms**.
- **Opportunities** (after fix): `Creator Optimization — save 74/mo`. ✅ (Creator monthly ≈ 247 × 0.30 = 74).
- **Runway optimizer**: current 112.4 → optimized 122.9 (**+10.5 days**, save 74/mo). ✅ 3252/(28.93−74/30)=122.9.
- **Automations**: 0/13 active — correct: this org's spend is creator/content/blog, none of which maps to automation-bearing modules (Engagement/Intelligence) in the 30d window.
- **Upgrade**: "No Upgrade Needed — ~112 days, healthy." ✅

## SECTION E — POPUP VERIFICATION (logic, runtime)
`getExecutiveIntelligence` — **143–156 ms**.
- Executive summary, largest driver, optimization potential, top-3 actions, upgrade verdict all computed.
- **Top action**: "Creator Optimization — save 74 (+10.5 days)" → deep-link `#opportunities`. ✅
- **Display signals**: after fix `base_should_show=true` (spike-driven), `opportunity_pct=8.5`, `signature=Healthy|1|ok`. ✅
- Dismissal logic (localStorage state machine) is deterministic and unit-traceable; **persistence across refresh/login was NOT browser-verified** (no auth session).

## SECTION F — BANNER VERIFICATION (payload, runtime)
Banner payload correct: risk Healthy, runway 112.4, largest driver, **top recommendation "Creator Optimization."** Visual states (Healthy/Monitor/At Risk/Critical styling) **not browser-verified**.

## SECTION G — DEEP LINKING
Anchors present in source (`overview/runway/opportunities/automation/simulator`), top-actions carry correct `deep_link` targets. **Click-navigation not browser-verified** (no UI session).

## SECTION H — SCENARIO VERIFICATION (Phase 8, runtime — real data)
| Scenario | Expected (deterministic) | Actual | ✓ |
|---|---|---|---|
| Standard content variants (Content×0.40) | ~36/mo, runway +~5d | save 36, 112.4→117.3 (+4.9) | ✅ |
| Reduce creator image/regen (Creator×0.30) | ~74/mo, runway +~10d | save 74, 112.4→122.9 (+10.5) | ✅ |
| Disable Market Pulse / Reduce campaign / leads | 0 (no such spend this org) | save 0, +0 | ✅ correct (no fabricated savings) |

Month-end projections internally consistent (remaining − newDaily × daysLeft). ✅

## SECTION I — UPGRADE ADVISOR VERIFICATION (Phase 9)
- Healthy 112-day runway → **"No Upgrade Needed."** ✅
- **Optimization-before-upgrade rule**: verified by construction + runtime — `upgradeAdvisorService` only emits `Upgrade Recommended`/`Immediate` when optimized runway **cannot** reach 30 days; otherwise `Optimization Recommended`. The healthy case never suggested upgrade. ✅

## SECTION J — PERFORMANCE (against prod Supabase, cold)
| Operation | Time |
|---|---|
| `getCreditAdvisorReport` | 175–214 ms |
| `getConsumptionOptimizationReport` | 183–192 ms |
| `getExecutiveIntelligence` | 143–156 ms |
Each facade does **one** `credit_usage_log` read + one wallet read, aggregated in-process. No N+1, no large payloads (single org, ≤month of rows). **Well within budget.** UI render times not measured (no browser pass).

## SECTION K — EDGE CASES
| Case | Result |
|---|---|
| No wallet (valid UUID, no row) | ✅ graceful: `missing=true`, remaining 0, days_remaining null, **no throw** |
| No consumption (wallet, 0 usage) | ✅ zeros, risk Healthy, no recs, no crash |
| Sparse data (real org) | ✅ handled |
| Malformed UUID | ⚠ DB rejects with `invalid input syntax for type uuid` — surfaces as 500 (callers pass real org ids via `withOrgAccess`, so low real-world risk; could add a UUID guard) |

## SECTION L — SCREENSHOTS
**None captured** — requires an authenticated browser session (no test credentials/org provided) and a UI render pass, which was out of safe reach (see scope boundary). The runtime evidence above is the substitute. To capture: provide a test login + org id, or run `dev:full` against a **non-prod** Supabase, then open `/dashboard` and `/command-center/credit-advisor`.

## SECTION M — PRODUCTION-READINESS VERDICT
| Area | Verdict |
|---|---|
| Forecasting | **Pass with Observations** — math exact; 30-day-average burn understates bursty/recent usage (Issue 4) |
| Optimization | **Pass** — works on real data after Issue 1 fix; savings cascade correctly |
| Runway calculations | **Pass** — all deltas verified arithmetically on live data |
| Upgrade Advisor | **Pass** — optimization-before-upgrade enforced |
| Popup experience | **Pass with Observations** — logic verified live; **UI render/interaction not browser-verified** |
| Banner experience | **Pass with Observations** — payload verified live; visual states not browser-verified |
| **Overall feature** | **Pass with Observations** — backend/calculation layer is production-ready and live-verified (2 bugs fixed); UI layer needs an authenticated browser pass before sign-off |

## SECTION N — ISSUES FOUND
1. **[FIXED] Module attribution mostly "Other."** `credit_usage_log.action` carries process-type-style names beyond the 25 canonical keys; resolution used only the action-key index → **~75% of resolvable spend mislabeled "Other"** (live: Other 89%). Drivers/automations/opportunities were starved.
2. **[FIXED] Spike trigger suppressed.** Phase 31 says "show on consumption spike >25%," but the "Healthy AND opportunity <10%" veto overrode it (`spike=true` yet `base_should_show=false`). The real org had an 806-in-7d spike vs 28.9/day avg.
3. **[OPEN — catalog owner] 3 action names not in the monetization registry** (`blog_brief_suggestions`, `quick_platform_adapt`, `campaign_chat`) → still "Other 61%" after the fix. These need adding to `featureRegistry` (the billing catalog, out of scope for this read-only layer).
4. **[OPEN — observation] Forecast uses 30-day average burn.** For bursty usage it understates the recent trajectory: this org shows **112 days** on the 30d-avg, but the recent-7d rate (115/day) implies **~28 days**. The popup now (correctly) fires on the spike, but still displays the rosy 112-day runway — potentially contradictory.
5. **[ENV — expectation] `credit_usage_log` is sparse** (138 rows DB-wide); most orgs will show light Advisor data until enforcement coverage grows.

## SECTION O — RECOMMENDED FIXES
- **Done (this audit, re-verified on live data):** Issue 1 — added a `resolveFeatureFromProcessType` fallback to `creditAdvisorTaxonomy.ts` (Other 89%→61%, Creator 0.6%→28.3%, a real opportunity now surfaces). Issue 2 — `executiveIntelligenceService` display rule now honors positive triggers directly so genuine spikes surface (`base_should_show` true).
- **Recommended next:**
  - Issue 3 — register `blog_brief_suggestions`, `quick_platform_adapt`, `campaign_chat` (and audit other live `action` values) in `shared/monetization/featureRegistry.ts` so attribution reaches ~100%.
  - Issue 4 — make the forecast recency-aware: use `max(30d-rate, 7d-rate)` or a recency-weighted blend for runway, or surface a secondary "at your recent pace, ~N days" figure so the popup and runway agree.
  - Edge — add a UUID-format guard in the API handlers to return 400 (not 500) on malformed ids.
  - **Before production sign-off:** run an authenticated browser pass (`/verify` with a test org on a non-prod DB) to confirm widget rendering, popup show/dismiss persistence, banner states, and deep-link navigation, and capture screenshots.

---

## VALIDATION OF THE FIXES
- TypeScript: `tsc --noEmit` — **0 errors** in the changed files (`creditAdvisorTaxonomy.ts`, `executiveIntelligenceService.ts`).
- Read-only invariant: unchanged — both fixes are SELECT/pure-arithmetic; no write primitives introduced.
- Re-verified on the same prod org: attribution improved, opportunity surfaced, spike now triggers the popup.

*(The temporary read-only harness scripts used for this audit were removed after the run; reproduction steps are above.)*
