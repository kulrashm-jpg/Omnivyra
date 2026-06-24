# CUSTOMER_VALUE_REALIZATION_MODEL.md

Phase 14E · Phase 2 — deterministic value-realization model. Evidence-only; UNKNOWN stays
UNKNOWN.

## Value categories (DIRECT signals)

CONTENT (`blogs` + `creator_assets`) · CAMPAIGN (`campaigns`) · PUBLISHING
(`publishing_jobs`) · MARKET_PULSE (`market_pulse_runs`) · REPORTS (`reports`).
A category is *present* when its company_id count > 0.

## Per-company status (deterministic)

| Status | Rule |
|---|---|
| UNKNOWN | value sources unreadable |
| NO_VALUE | 0 categories present |
| EARLY_VALUE | exactly 1 category present |
| REALIZED_VALUE | ≥ 2 categories present |

`value_score` = present categories / 5 × 100. Outputs include `value_signals` (present),
`missing_value_signals`, evidence, confidence (HIGH — counts are definite).

## Value funnel

```
COMPANY_CREATED → ACTIVATED → VALUE_SIGNAL_PRESENT (≥1) → MULTIPLE_VALUE_SIGNALS (≥2) → SUSTAINED_VALUE (≥3)
```
Per stage: reached, lost, conversion %.

## Segments

`PAYING_WITH_VALUE` · `PAYING_WITHOUT_VALUE` · `ACTIVE_WITH_VALUE` · `ACTIVE_WITHOUT_VALUE`
· `NON_PAYING_WITH_VALUE`, assigned by precedence (paying checked before active).

**Caveat:** active companies are a subset of paying companies in the current data, so they
fall into the `PAYING_*` buckets first; the `ACTIVE_*` buckets only capture active-but-NOT-paying
companies. This is a model precedence artifact, reported honestly.

## Billing vs value (association, not causality)

`paying`, `value_realized`, `paying_without_value`. **`value_before_payment` /
`value_after_payment` are NOT_COMPUTABLE** — billing is org-keyed with no reliable
per-company payment timestamp. No causal claim is made.
