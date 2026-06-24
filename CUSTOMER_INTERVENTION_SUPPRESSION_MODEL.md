# CUSTOMER_INTERVENTION_SUPPRESSION_MODEL.md

Phase 15A · Phase 5 — suppression model. **Documentation only. No persistence, no writes.**
Suppression is computed live; nothing is stored.

## Suppression rules (evaluated in order)

| # | Suppression | Rule | Status produced |
|---|---|---|---|
| 1 | **Population-integrity** | tenant_class ≠ CUSTOMER (INTERNAL / QA / TEST / DEMO / UNKNOWN) | SUPPRESSED — `POPULATION_INTEGRITY: <class>` |
| 2 | **No-gap (contradictory)** | the intervention's capability is already satisfied | BLOCKED — `NO_GAP` |
| 3 | **Unknown-signal** | the gap is undeterminable (area signal UNKNOWN) | UNKNOWN |
| 4 | **Customer-state** | company's state ∉ the intervention's eligible states | SUPPRESSED — `CUSTOMER_STATE: <state>` |
| 5 | **Confidence / stale-signal** | signal confidence UNKNOWN, or below the intervention's minimum (LOW < MEDIUM) — 13E confidence already folds freshness, so stale signals read LOW | SUPPRESSED — `LOW_CONFIDENCE` / `UNKNOWN_CONFIDENCE` |

Only a company passing **all** of these (real customer, real gap, fitting state, confident
fresh signal) yields **ELIGIBLE**.

## Examples (live behavior)

- **QA tenants → suppressed** (rule 1) — all 24 QA companies are globally suppressed.
- **INTERNAL tenant (Omnivyra) → suppressed** (rule 1).
- **TEST tenants → suppressed** (rule 1) — all 8.
- **UNKNOWN confidence → suppressed** (rule 5) — a stale/unreadable signal blocks its
  intervention even for a real customer.
- **Already-verified domain → BLOCKED** (rule 2) — no gap, nothing to do.

## Not implemented (by design — no persistence)

- **Duplicate suppression** (don't re-trigger a recently-sent intervention) requires
  persisted intervention history. **This phase persists nothing**, so duplicate suppression
  is documented but not active — it would be added only alongside a (separately governed)
  delivery+history layer.

## Guarantees

Read-only, deterministic, no writes. The model only *classifies* eligibility; it never
suppresses by mutating state — there is no suppression state to mutate.
