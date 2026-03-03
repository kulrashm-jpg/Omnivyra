# Momentum Transfer Strength — Small Architectural Refinement

## Objective

Add a qualitative strength indicator to momentum adjustments for future AI-driven intensity. Additive only; no behavior, scheduling, or execution changes.

---

## 1. Updated momentum metadata shape

**File:** `backend/services/momentumAdjustmentService.ts`

**Type:**
```ts
momentum_transfer_strength?: "light" | "moderate" | "heavy"
```

**V1 heuristic (deterministic):**
- Source: `planning_adjustments_summary.reduced.length`
- `reduced.length <= 2` → **"light"**
- `reduced.length 3–5` → **"moderate"**
- `reduced.length > 5` → **"heavy"**

Attached to the same `momentum_adjustments` object on Week 1 and Week 2 when momentum is applied.

---

## 2. Example payload

```json
{
  "absorbed_from_week": [1],
  "reason": "Week 1 workload reduction carried forward.",
  "momentum_transfer_strength": "moderate"
}
```

Exposed as part of `momentum_adjustments` in get-weekly-plans, daily-plans, and activity-workspace/resolve (no separate field; object already passed through).

---

## 3. Example UI snippet

In the momentum line area (text-xs, gray), when `momentum_transfer_strength` is present:

```tsx
{momentumAdjustments?.absorbed_from_week?.length ? (
  <p className="text-xs text-gray-500 mt-0.5">
    Momentum adjusted from Week {momentumAdjustments.absorbed_from_week.join(', ')}
    {momentumAdjustments.momentum_transfer_strength ? (
      <> · Momentum: {momentumAdjustments.momentum_transfer_strength.charAt(0).toUpperCase() + momentumAdjustments.momentum_transfer_strength.slice(1)} adjustment</>
    ) : null}
  </p>
) : null}
```

**Rendered example:**  
`Momentum adjusted from Week 1 · Momentum: Moderate adjustment`

---

## Constraints

- No change to momentum logic, scheduling, or execution_items.
- Metadata only; future use (e.g. AI intensity) can rely on this field without schema change.
