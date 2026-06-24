# CAMPAIGN_EXECUTION_ADOPTION_MODEL.md

Phase 14G · Phase 2 — deterministic execution-adoption model. Evidence-only; UNKNOWN stays
UNKNOWN. **ASSOCIATION IS NOT CAUSATION.**

## Execution measures

- **breadth** = number of execution categories with count > 0 (of 5: CONTENT, CAMPAIGN,
  PUBLISHING, MARKET_PULSE, REPORTS).
- **frequency** = total execution volume (sum of counts across categories).
- **execution_score** = breadth / 5 × 100.

## Per-company status (deterministic)

| Status | Rule |
|---|---|
| UNKNOWN | sources unreadable |
| NO_EXECUTION | frequency = 0 |
| EARLY_EXECUTION | frequency = 1 (single execution) |
| ACTIVE_EXECUTION | frequency ≥ 2 or breadth ≥ 2 |
| SUSTAINED_EXECUTION | frequency ≥ 10 or breadth ≥ 3 |

**Caveat:** frequency is **lifetime volume** (no per-period cadence available), so
SUSTAINED is a volume/breadth proxy, not time-based recurrence.

## Execution funnel (independent reach)

```
ACTIVATED → FIRST_CONTENT → FIRST_CAMPAIGN → FIRST_PUBLICATION → REPEATED_EXECUTION (≥2) → SUSTAINED_EXECUTION
```
Per stage: reached, lost, conversion %. Non-strict (independent reach).

## Depth & concentration

- **Depth bands:** single-use (freq = 1), repeat (2–9), sustained (≥ 10); plus frequency and
  per-category volume bands (0 / 1 / 2–5 / 6–20 / 20+).
- **Concentration:** total execution volume + top-1 and top-3 company share %. High
  concentration means a few companies generate most execution.

## Patterns (association only)

Execution-category signature (e.g. `CONTENT_ONLY`, `CONTENT+REPORTS`, `CONTENT+CAMPAIGN`,
full execution) grouped by value bucket (REALIZED / EARLY / NO_VALUE), with count + value
rate. No causal claim.
