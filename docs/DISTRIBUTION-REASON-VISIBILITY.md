# Distribution Reason Visibility (Optional Enhancement)

## Objective

Provide a human-readable explanation for why a distribution strategy was selected. Explanation only; no logic or planning behavior changes. Purely additive.

---

## 1. Updated planning intelligence return object

**File:** `backend/services/planningIntelligenceService.ts`

**Return type:** from `DistributionStrategy` (string) to:

```ts
interface DistributionStrategyResult {
  strategy: 'AI_OPTIMIZED' | 'STAGGERED' | 'QUICK_LAUNCH';
  reason: string;
}
```

**Reason rules (deterministic):**

| Condition | Reason |
|-----------|--------|
| QUICK_LAUNCH (duration ≤ 1 week) | `"Short campaign duration detected → Quick Launch selected."` |
| QUICK_LAUNCH (demand high) | `"Posting demand exceeds capacity threshold → Quick Launch selected."` |
| STAGGERED | `"Cross-platform reuse across multiple platforms detected → Staggered distribution selected."` |
| AI_OPTIMIZED | `"Standard campaign conditions detected → AI Optimized scheduling selected."` |

---

## 2. Example week JSON

```json
{
  "week_number": 2,
  "phase_label": "Awareness",
  "primary_objective": "Drive awareness",
  "topics_to_cover": ["Problem we solve", "Customer story"],
  "content_type_mix": ["post", "video"],
  "platform_allocation": { "linkedin": 3, "facebook": 2 },
  "distribution_strategy": "STAGGERED",
  "distribution_reason": "Cross-platform reuse across multiple platforms detected → Staggered distribution selected."
}
```

---

## 3. Example UI display

**Activity workspace (header):**

- Primary line (existing): `Week 2 • Tuesday • Problem we solve • Distribution: Staggered`
- Secondary line (new, text-xs): `Why: Cross-platform reuse across multiple platforms detected → Staggered distribution selected.`

**Campaign daily plan (week column):**

- Line 1 (existing): `Week 2: Awareness`
- Line 2 (existing): `Distribution: Staggered`
- Line 3 (new, text-xs): `Why: Cross-platform reuse across multiple platforms detected → Staggered distribution selected.`

Snippet (conceptual):

```tsx
{distributionStrategy && (
  <p className="text-xs text-gray-500 mt-0.5">
    Distribution: {formatStrategy(distributionStrategy)}
  </p>
)}
{distributionReason && (
  <p className="text-xs text-gray-500 mt-0.5">Why: {distributionReason}</p>
)}
```

---

## Constraints

- Strategy logic unchanged.
- Reasoning is not recomputed in the UI (reason comes from API/blueprint).
- Scheduling behavior unchanged.
