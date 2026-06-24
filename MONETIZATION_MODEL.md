# MONETIZATION_MODEL.md

Phase 14H · Phase 2 — deterministic monetization-alignment model. Evidence-only; UNKNOWN
stays UNKNOWN. **ASSOCIATION IS NOT CAUSATION.**

## Inputs (all per-company, no new DB reads)

`is_paying` (`billing_ready = READY`) · `is_active` (`tenant_status = ACTIVE`) · `has_value`
(≥ 1 value category, 14E) · `is_executing` (activity volume > 0, 14G) · `plan` (name).
**No revenue amount is available.**

## Per-company status (deterministic)

| Status | Rule |
|---|---|
| UNKNOWN | sources unreadable |
| PAYING_ACTIVE_VALUE | paying & active & value |
| PAYING_ACTIVE_NO_VALUE | paying & active & ¬value |
| PAYING_INACTIVE | paying & ¬active |
| FREE_ACTIVE_VALUE | ¬paying & active & value |
| FREE_ACTIVE_NO_VALUE | ¬paying & active & ¬value |
| FREE_INACTIVE | ¬paying & ¬active |

## Monetization funnel (independent reach)

```
COMPANY_CREATED → BILLING_ACTIVE → ACTIVATED → EXECUTING → VALUE_REALIZED
```
Per stage: reached, lost, conversion %.

## Billing–value alignment

| Cohort | Meaning |
|---|---|
| billing + value | aligned (paying *and* realizing value) |
| no_billing + no_value | aligned (not paying, not realizing — consistent) |
| billing + no_value | **misaligned** (paying without value) |
| value + no_billing | **misaligned** (value without paying) |

`alignment_% = (billing+value + none) / total`; `misalignment_% = the rest`.

## Concentration

- **revenue / credits → UNKNOWN** (no per-company amount; **never estimated**).
- **plan** → company-count share by plan name (NOT revenue).
- **value / execution** → activity-volume share (top-1/3/5). Note (per 14G) volume is
  dominated by the vendor org + QA, so these distributions are not customer-representative.
