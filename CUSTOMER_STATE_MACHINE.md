# CUSTOMER_STATE_MACHINE.md

Phase 15A · Phase 3 — deterministic customer lifecycle. Every company resolves to **exactly
one** state. No manual overrides. UNKNOWN stays UNKNOWN.

## States & rules (first match wins — this IS the tie-break)

| # | State | Entry rule |
|---|---|---|
| 1 | **UNKNOWN** | tenant unclassified AND no onboarding progress AND not active |
| 2 | **AT_RISK** | evolution trajectory = DECLINING; OR (paying AND not active AND no value AND stale > 30d) |
| 3 | **EXPANDING** | active AND `value_category_count ≥ 2` |
| 4 | **VALUE_REALIZING** | active AND has value |
| 5 | **ADOPTING** | active (no value yet) |
| 6 | **ACTIVATING** | not active AND has progress (PROFILE or WEBSITE ready, or adoption > 0) |
| 7 | **ONBOARDING** | not active AND not stale (recently created, minimal progress) |
| 8 | **CHURNED** | stale > 30d AND no progress AND no 30-day activity AND no value |
| 9 | **PROSPECT** | otherwise (created, no onboarding progress) |

## Entry / exit / tie-break

- **Entry** = the first rule above that matches (ordered, total). **Exit** = a recompute
  places the company under a different rule (states are recomputed each request, never
  persisted). **Tie-break** = the fixed first-match order; no two rules can both "win".
- A company moves ONBOARDING → ACTIVATING when a profile/domain/adoption signal appears;
  ACTIVATING → ADOPTING/VALUE_REALIZING when it becomes active; → EXPANDING with multiple
  value signals; → AT_RISK on decline or paying-stall; → CHURNED when stale and dead.

## Confidence

State confidence = the company's overall signal confidence (13E). A state computed from
UNKNOWN/LOW-confidence signals carries that confidence forward, and the suppression model
(Phase 5) blocks interventions on it.

## Determinism

Pure function of observable signals + a fixed clock (`nowMs`). No randomness, no AI, no
manual overrides. Identical inputs → identical state.
