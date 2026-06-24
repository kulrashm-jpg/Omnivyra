# VALUE_DRIVER_MODEL.md

Phase 14F · Phase 2 — deterministic value-driver association model. **ASSOCIATION IS NOT
CAUSATION.** UNKNOWN stays UNKNOWN.

## Outcome

`value_realizing` = company has ≥ 1 measurable value category (content / campaign /
publishing / reports / market-pulse). Buckets: NO_VALUE (0), EARLY_VALUE (1),
REALIZED_VALUE (≥ 2).

## Per-signal association metrics

For each signal: `population_with`, `population_without`, `value_realized_with`,
`value_realized_without`, `rate_with`, `rate_without`, `lift` (= rate_with / rate_without),
`support` (= population_with / total), `delta` (= rate_with − rate_without).

## Strength classification (deterministic)

| Condition (first match) | Strength |
|---|---|
| `population_with < 3` OR `population_without < 3` | **INSUFFICIENT_DATA** |
| lift ≥ 2 AND delta ≥ 30 (or rate_without = 0 AND delta ≥ 30) | **STRONG_ASSOCIATION** |
| lift ≥ 1.5 AND delta ≥ 15 (or rate_without = 0 AND delta ≥ 15) | **MODERATE_ASSOCIATION** |
| otherwise | **WEAK_ASSOCIATION** |
| signal unobservable | **UNKNOWN** |

## Circularity guard

The 5 **value-constituent** signals are flagged `circular` and reported separately — they
*define* the outcome, so their association is not evidence of a driver and is **excluded from
ranking**. Only the 8 capability signals are ranked.

## Outputs

- **Driver ranking:** capability associations sorted by strength → delta → population.
  Top-positive, neutral, insufficient-data, never-observed, observed-but-never-with-value.
- **Path analysis:** capability signature per value bucket (REALIZED / EARLY / NO_VALUE),
  with count + value rate.
- **Gap comparison:** capability presence % in REALIZED vs NO_VALUE companies, with delta;
  largest/smallest gaps, shared and realized-unique behaviors.

## Confidence caveat

Even STRONG associations may rest on **tiny populations** (n = 3–4 platform-wide). Strength
is mechanical; real confidence is bounded by population size and is reported alongside.
