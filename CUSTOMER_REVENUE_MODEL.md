# CUSTOMER_REVENUE_MODEL.md

Phase 15D · Phase 2 — revenue model. **Evidence-backed only.** Metrics without a real source
remain UNKNOWN; nothing is estimated, inferred, modelled from plan names, extrapolated, or
forecast.

| Metric | Source | Formula | Confidence | UNKNOWN condition |
|---|---|---|---|---|
| **MRR** | *(none)* | — | UNKNOWN | **always** — no recurring/subscription amount exists |
| **ARR** | *(none)* | — | UNKNOWN | **always** — derived from MRR which is UNKNOWN |
| **ACTIVE_SUBSCRIPTIONS** | *(none)* | — | UNKNOWN | **always** — no subscription table with amounts |
| **PAYING_CUSTOMERS** | `canonical_revenue_events` | count(distinct company_id with ≥ 1 event) | HIGH (recorded) | n/a (0 if no events) |
| **OBSERVABLE_REVENUE** | `canonical_revenue_events` | Σ `revenue_amount` per `currency_code` (never summed across currencies) | HIGH per company; MEDIUM if mixed currency | none recorded → 0 |
| **REVENUE_CONCENTRATION** | `canonical_revenue_events` | per-currency top-1/3/5 company share | HIGH | < 1 company with revenue |
| **EXPANSION** | *(needs time-series subscription deltas)* | — | UNKNOWN | **always** — no recurring baseline |
| **CONTRACTION** | *(needs recurring deltas)* | — | UNKNOWN | **always** |
| **CHURN** | *(needs recurring lapse)* | — | UNKNOWN | **always** — one-time events only |
| **REACTIVATION** | *(needs recurring history)* | — | UNKNOWN | **always** |

## Per-company revenue

`revenue_by_currency` = Σ recorded `revenue_amount` grouped by currency. `total_revenue` is a
number **only when a single currency is present**; with mixed currencies it is **UNKNOWN**
(no FX inference). `confidence` = HIGH (single currency) / MEDIUM (mixed) / UNKNOWN (no events).

## Cross-signal (Phase 6) — only when revenue is measurable

`REVENUE_WITHOUT_VALUE`, `VALUE_WITHOUT_REVENUE`, `REVENUE_WITHOUT_ADOPTION`,
`REVENUE_WITHOUT_EXECUTION` — counts over companies with recorded revenue. If **no** company
has measurable revenue, all four are **UNKNOWN**.

## Coverage & confidence

`revenue_coverage_pct = customers_with_recorded_revenue / total`. `revenue_confidence` =
UNKNOWN (0 recorded) / LOW (recorded but no CUSTOMER-class revenue) / MEDIUM (≥ 1 CUSTOMER
with revenue). HIGH is reserved for verified per-company single-currency totals.
