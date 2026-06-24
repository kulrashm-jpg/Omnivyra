# CUSTOMER_DATA_MATURITY_MODEL.md

Phase 15E · Phase 2 — deterministic maturity model. No subjective judgement; every level is a
function of measured scores.

## Five trust scores (0–100)

| Score | Formula |
|---|---|
| `customer_integrity_score` | real customers / total population × 100 (14I) |
| `telemetry_score` | structural observability coverage (13H) |
| `confidence_score` | (HIGH + MEDIUM signal instances) / total signals (13E) |
| `joinability_score` | joinable customer-entity links / total links |
| `coverage_score` | mean(revenue_coverage, value_coverage) |

`foundation_score = 0.30·integrity + 0.20·telemetry + 0.20·confidence + 0.15·joinability + 0.15·coverage`
(integrity weighted highest — contamination is the platform's central risk).

## Maturity levels

| Level | Meaning | Rule |
|---|---|---|
| **LEVEL_0** | unusable | foundation < 20 |
| **LEVEL_1** | visibility only | foundation 20–40 **OR** integrity < 20 (hard cap) |
| **LEVEL_2** | operational | foundation 40–60 **and** integrity ≥ 20 |
| **LEVEL_3** | recommendation-ready | foundation 60–80 |
| **LEVEL_4** | automation-ready | foundation ≥ 80 |

**Integrity cap:** without a trustworthy customer population (integrity ≥ 20) maturity can
never exceed LEVEL_1 — you cannot operate, recommend, or automate on a contaminated dataset
regardless of how good the other scores are.

## Readiness gates

- **Recommendation** category = READY if all its required scores ≥ 60, PARTIAL if ≥ 35, else
  NOT_READY. Monetization is NOT_READY whenever revenue is UNKNOWN.
- **Automation** category requires the higher bar (≥ 75 / ≥ 55) **and a hard floor of
  integrity ≥ 50** — below that, every automation category is NOT_READY by rule.

## Foundation status

`FOUNDATION_READY` (≥ 60) · `FOUNDATION_PARTIAL` (35–60) · `FOUNDATION_INSUFFICIENT` (< 35).

All thresholds are fixed constants; identical inputs always yield the identical level.
