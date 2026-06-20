# CREDIT ADVISOR — HARDENING: FORECAST ACCURACY & ATTRIBUTION COMPLETION — DELIVERABLES

**Trustworthiness pass on the economics layer before pricing design.** 2026-06-17. 100% READ-ONLY.
All results validated at runtime against the same real production org used in the live audit.

---

## SECTION A — ARCHITECTURE
```
 getCreditAdvisorReport (facade) — loads rows + wallet ONCE, composes ↓ (all READ-ONLY, deterministic)
   ├─ creditAdvisorTaxonomy.ts        registry (action-key → process-type) + SUPPLEMENTAL_ACTION_MAP  (Phase 1)
   ├─ attributionCoverageService.ts   coverage % + per-module + top gaps                              (Phase 2)
   ├─ forecastStrategyService.ts      3d/7d/30d + weighted burn → conservative/balanced/aggressive
   │                                   runways + explainability (env-configurable weights)            (Phase 3/4/6)
   ├─ spikeIntelligenceService.ts     recent-vs-baseline spike, magnitude, drivers, impact            (Phase 5)
   └─ forecastConfidenceService.ts    confidence score + sparse-data flag                             (Phase 7/8)
 → CreditAdvisorReport gains { forecast_strategy, confidence, spike, coverage }
 → CreditAdvisorDashboard renders a new "Forecast & confidence" card                                  (Phase 9)
```
The original `forecast` (30-day) is **unchanged** — the multi-runway model adds context, it does not replace it.

## SECTION B — FILES CREATED (4)
| File | Phase | Role |
|---|---|---|
| `backend/services/creditAdvisor/forecastStrategyService.ts` | 3/4/6 | Multi-window burn, 3 runway models, explainability, configurable weights |
| `backend/services/creditAdvisor/attributionCoverageService.ts` | 2 | Coverage %, per-module, top unresolved gaps |
| `backend/services/creditAdvisor/spikeIntelligenceService.ts` | 5 | Spike detection, magnitude/duration/drivers/impact |
| `backend/services/creditAdvisor/forecastConfidenceService.ts` | 7/8 | Confidence score + limited-data handling |

## SECTION C — FILES MODIFIED (4)
| File | Change |
|---|---|
| `creditAdvisorTaxonomy.ts` | `SUPPLEMENTAL_ACTION_MAP` (3 prod-confirmed + curated forward-looking) + `isAttributed`; supplemental fallback in `moduleForActionKey`/`activityForActionKey` |
| `consumptionMetricsService.ts` | Added `credits_used_3d` |
| `creditAdvisorTypes.ts` | Added burn-window / multi-runway / confidence / spike / coverage types; extended `CreditAdvisorReport` |
| `creditAdvisorService.ts` (facade) + `CreditAdvisorDashboard.tsx` | Compose + render the new intelligence |

**Zero** changes to any billing/ledger/subscription/pricing/wallet file. The supplemental attribution lives in the Credit-Advisor layer — the monetization catalog is untouched.

## SECTION D — ATTRIBUTION AUDIT (Phase 1) — full DB, real data
`credit_usage_log` holds **7 distinct action values DB-wide** (138 rows, 1053 credits):
| Action | Credits | Mapped Module | Mapped Activity | Resolution |
|---|---|---|---|---|
| `blog_brief_suggestions` | 249 | Content | Blog briefs | **supplemental** (was Other) |
| `creator_content` | 241 | Creator | (process-type) | process-type fallback |
| `quick_platform_adapt` | 230 | Content | Platform adaptation | **supplemental** (was Other) |
| `deep_analysis` | 180 | Reports | (registry) | action-key |
| `content_generation` | 90 | Content | (registry) | action-key |
| `campaign_chat` | 53 | Campaigns | Campaign chat | **supplemental** (was Other) |
| `content_basic` | 10 | Creator | (registry) | action-key |

**Other %: Before 89% → after process-type fallback 51% → after supplemental map 0%.** Residual: **0%** (all 7 live values now resolve). Unmapped/ambiguous: none on current data. The supplemental map also carries forward-looking entries (campaign/content/creator/intelligence/engagement op-keys) so coverage stays high as charging coverage expands.

## SECTION E — FORECASTING CHANGES (Phase 3/4/6) — live
- Burns (target org): **3d = 147/day, 7d = 115/day, 30d = 29/day**, weighted = 114/day (weights 0.5/0.3/0.2, env-overridable via `CREDIT_FORECAST_W3/W7/W30`).
- **Multi-runway:** Conservative **22.2 d** (highest = 3-day), Balanced **28.6 d** (weighted), Aggressive **112.4 d** (30-day avg, = original).
- **Explainability:** "112 days (30-day burn = 29/day) | recent 22 days (3-day burn = 147/day)" + note: *"Recent usage is materially higher than the 30-day average — treat the conservative runway as the real risk."* No black box.

## SECTION F — CONFIDENCE MODEL (Phase 7/8) — live
Factors → score → level. Target org: **High (75)** — usage_history 98, coverage 100, data_volume 85, recent_volatility **0** (the 42× spike correctly tanks the volatility factor). `limited_data=false`. Sparse data (events <20 or span <7d) flags `limited_data` and caps the level at **Low** to avoid false precision.

## SECTION G — SPIKE INTELLIGENCE (Phase 5) — live
Target org: **detected**, magnitude **42.7×** baseline, duration **6 days**, recent 115/day vs baseline 2.7/day, **estimated impact ~84 fewer runway days** than the optimistic view. Primary drivers: **Content 63.5%, Creator 29.9%, Campaigns 6.6%**.

## SECTION H — DASHBOARD CHANGES (Phase 9)
New "Forecast & confidence" card on the Credit Advisor: confidence badge + limited-data chip, the three runways (Conservative/Balanced/Aggressive), the explainability lines, attribution-coverage % + top gaps, and a spike panel (magnitude/drivers/impact) when detected.

## SECTION I — LIVE VALIDATION (Phase 10) — org `4bdbec26-…`
| Metric | Value |
|---|---|
| Attribution coverage | **100%** |
| Residual "Other" | **0%** |
| Forecast confidence | **High (75)** |
| Conservative runway | **22.2 days** |
| Balanced runway | **28.6 days** |
| Aggressive runway | **112.4 days** |
| Spike | 42.7× / 6d / ~84d impact |

Method: read-only `tsx` harness running the real `getCreditAdvisorReport` against prod data (no writes, no workers, no HTTP). Temp scripts removed after the run.

## SECTION J — BEFORE vs AFTER
| Dimension | Before | After |
|---|---|---|
| "Other" attribution | 89% | **0%** |
| Runway shown | 112 days (single, optimistic) | 22 / 29 / 112 days (conservative/balanced/aggressive) + explanation |
| Spike on a "healthy" org | invisible | surfaced: 42.7×, drivers, ~84d impact |
| Forecast trust | implicit / black-box | explicit confidence level + reasoning |
| Sparse data | false precision risk | flagged "Limited data", level capped |

## SECTION K — KNOWN LIMITATIONS
1. **Supplemental map is curated, not exhaustive.** It covers all 7 live action values + high-confidence forward-looking keys; genuinely new/unknown action strings still fall to "Other" (honestly). The durable fix remains registering them in `shared/monetization/featureRegistry.ts` (billing-catalog owner).
2. **Spike magnitude can look extreme** when the baseline window (days 8–30) is near-empty (here 2.7/day → 42.7×). It's accurate (this org genuinely had almost no prior usage), but magnitude is sensitive to a thin baseline — read it alongside `recent_daily`/`baseline_daily`.
3. **Confidence weights volatility at 20%.** A 5× conservative-vs-aggressive divergence still scored "High" because data *quality* (history/coverage/volume) is high; the divergence is surfaced separately via the multi-runway + spike panels. If you want divergence to dominate confidence, raise the volatility weight.
4. **Forecast windows assume the analysis window covers ≥30 days** of rows; for very new orgs the 30-day burn is naturally low and the conservative/recent figures dominate (correct behavior).
5. **UI not browser-verified** — the new card was validated via the report payload at runtime; visual rendering needs an authenticated browser pass (same constraint as the prior audit).

## SECTION L — PRODUCTION-READINESS VERDICT
| Area | Verdict |
|---|---|
| Attribution | **Pass** — 100% coverage on live data; 0% residual; catalog-gap path documented |
| Recency forecasting | **Pass** — multi-window burn + 3 runways verified arithmetically (3252/147 = 22.1 ≈ 22.2) |
| Confidence model | **Pass** — discriminates quality vs volatility; sparse-data honest |
| Spike intelligence | **Pass** — detects + attributes + quantifies impact on real data |
| Explainability | **Pass** — every runway carries its basis |
| **Economics layer overall** | **Pass — trustworthy for pricing design.** Forecasts now reflect recent behavior, attribution is complete, and uncertainty is exposed rather than hidden. Remaining items are the catalog registration (Issue 1) and a browser UI pass. |

---
**Validation:** `tsc --noEmit` → 0 errors in all changed files. Read-only invariant: grep for write primitives across `creditAdvisor/` → zero matches. Live-verified on prod data, read-only.
