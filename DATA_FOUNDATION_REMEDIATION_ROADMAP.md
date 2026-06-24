# DATA_FOUNDATION_REMEDIATION_ROADMAP.md

Phase 16A · Phase 8 — remediation items ranked by impact on foundation score, effort, and
risk. Evidence-based; no forecasts.

| # | Item | Foundation impact | Effort | Risk | Type |
|---|---|---|---|---|---|
| **1** | **Exclude non-customers from analytics** (read `customer_population_classification`, filter to CUSTOMER) | **HIGHEST** — integrity 13.2 → ~100, removes the maturity cap (LEVEL_1 → LEVEL_2/3) | **LOW** (a `WHERE classification='CUSTOMER'` at the population source) | LOW (read-only filter; data untouched) | DATA |
| **2** | **Use `organization_id == company_id`** for revenue / engagement / community / billing loaders | HIGH — joinability ↑ (~64 → ~91), unlocks engagement/community/retention + revenue attribution | LOW–MED (treat org_id as company_id in loaders; verified 28/29 + 3/3 match) | LOW | DATA |
| **3** | **signup_intents email-domain join** (`email`→`companies.admin_email_domain/website_domain`) | MED — acquisition/onboarding joinability (23/24 = 96% recoverable) | LOW | LOW | DATA |
| **4** | **Run profile scoring on the 26 unscored profiles** (they have field data, `last_refined_at` null) | MED — coverage ↑ (profile completion stops reading as "low confidence") | MED (trigger the scoring/refinement pipeline) | MED (product pipeline) | **PRODUCT** |
| **5** | **Run the daily snapshot job ≥ 2 days** (13B cron) | MED — activates Evolution/Outcome/Attribution + retention deltas | LOW (schedule the cron) | LOW | TELEMETRY (time) |
| **6** | **Recurring-revenue / subscription model** for MRR/ARR | MED (monetization journey) | **HIGH** (billing/product change) | HIGH | **PRODUCT** |
| **7** | **Support-journey telemetry** (no source exists) | LOW | HIGH (new instrumentation) | MED | TELEMETRY (new) |

## Sequencing

- **Quick wins (items 1–3, all DATA, low risk):** get to LEVEL_2 and likely LEVEL_3 with
  query/code changes only — no new telemetry, no product change.
- **Product track (items 4, 6):** profile scoring + recurring billing — require product work.
- **Time/telemetry track (items 5, 7):** snapshot accrual + support instrumentation.

The estimated post-remediation ceiling (items 1–4) is **foundation ≈ 76.6 → LEVEL_3
(recommendation-ready)** — see the report.
