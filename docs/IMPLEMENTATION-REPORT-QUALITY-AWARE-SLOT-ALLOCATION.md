# Quality-Aware Slot Allocation (Phase 1) — Implementation Report

## 1️⃣ File Created

**`lib/intelligence/slotAllocationIntelligence.ts`**

- **Types**
  - `SlotAllocationAdjustment`: `{ platform: string; weight_multiplier: number }`
- **Functions**
  - `deriveSlotAllocationAdjustments(profile?)`: Returns a list of adjustments from `profile.platform_confidence_average` (0–100). No DB, no side effects.
  - `getWeightForPlatform(platform, adjustments)`: Returns multiplier for a platform (default 1.0 if not in list). Used by the distribution engine for sorting.
- **Logic (v1)**
  - For each platform in the profile:
    - `> 85` → `weight_multiplier = 1.2`
    - `< 60` → `weight_multiplier = 0.8`
    - else → `1.0`
  - Platforms are normalized to lowercase; invalid/missing averages are skipped.

---

## 2️⃣ Distribution Engine Changes

**File:** `lib/planning/distributionEngine.ts`

- **Imports:** `deriveSlotAllocationAdjustments`, `getWeightForPlatform` from `slotAllocationIntelligence`.
- **In `applyDistributionForWeek`:**
  - When `strategy === 'STAGGERED'`:
    - Compute `explicitStrategy` from `week?.distribution_strategy` and `isAUTO = !explicitStrategy || String(explicitStrategy).trim() === ''`.
    - Only when **AUTO** (no explicit strategy), **memoryProfile** is set, and **platforms.length >= 2**:
      - Call `deriveSlotAllocationAdjustments(memoryProfile)`.
      - If adjustments exist, reorder **a copy** of `units` by weight descending: `sort((a, b) => weight(b.platform) - weight(a.platform))` so higher-confidence platforms get earlier weekdays.
      - Pass the reordered array into `applyStaggeredDistribution` (no change to STAGGERED day-assignment logic).
    - No unit removal or duplication; no `execution_id` changes; only order is changed before day assignment.
  - **ALL_AT_ONCE** path is unchanged; no slot allocation applied there.
  - **Explicit strategy:** When `week.distribution_strategy` is set (e.g. explicit STAGGERED or ALL_AT_ONCE), slot allocation reorder is **not** applied (AUTO-only).

---

## 3️⃣ Slot Adjustment Logic

| Condition (platform_confidence_average) | weight_multiplier |
|----------------------------------------|--------------------|
| > 85                                   | 1.2 (boost)        |
| < 60                                   | 0.8 (dampen)      |
| 60–85                                  | 1.0 (neutral)     |

- Platforms not in the profile get default weight 1.0 via `getWeightForPlatform`.
- Sort order: **descending by weight** → higher-weight units get earlier days (Mon, Tue, …) in STAGGERED.

---

## 4️⃣ Before vs After Example

**Scenario:** Confidence LinkedIn 88, Instagram 55, Twitter 72.

**Adjustments:**

- LinkedIn → 1.2  
- Instagram → 0.8  
- Twitter → 1.0  

**Before reorder (input order):**  
`[IG, LI, TW, IG, LI, TW]`

**After weight sort (descending):**  
`[LI, LI, TW, TW, IG, IG]`

**Then STAGGERED day assignment (unchanged):**

- Mon → LI  
- Tue → LI  
- Wed → TW  
- Thu → TW  
- Fri → IG  
- Sat → IG  

Slots and units are unchanged; only the order of units before day assignment is adjusted so higher-confidence platforms get earlier weekdays.

---

## 5️⃣ Edge Cases

- **No profile:** `deriveSlotAllocationAdjustments` returns `[]`; no reorder; behavior same as before.
- **Single platform:** Engine only applies reorder when `platforms.length >= 2`; single-platform weeks are unchanged.
- **Explicit strategy:** If `week.distribution_strategy` is set (STAGGERED or ALL_AT_ONCE), slot allocation is not applied; only AUTO-resolved STAGGERED uses it.
- **ALL_AT_ONCE or HIGH momentum:** Resolved strategy is ALL_AT_ONCE; slot allocation is never run for that branch.
- **Empty adjustments:** If the profile has no platforms in `platform_confidence_average`, adjustments are `[]`; no sort is applied.
- **Stability:** Sort is applied to a copy `[...units]`; original `units` is not mutated. `applyStaggeredDistribution` still only assigns `day` when missing; no removal or duplication of units.

---

## Safety Constraints (Verified)

- No schema changes, no blueprint mutation, no DB writes to weekly plan.
- No unit removal or duplication; no change to `execution_id`.
- No override of explicit `distribution_strategy` or HIGH momentum (ALL_AT_ONCE).
- Reorder is additive, read-time only, and only when AUTO resolves to STAGGERED with profile and multiple platforms.
- Dev-only logging: `[SlotAllocationIntelligence] { adjustments, applied: true }` when reorder is applied.

---

## Files Touched

| File | Change |
|------|--------|
| `lib/intelligence/slotAllocationIntelligence.ts` | **Created** — adjustments derivation + `getWeightForPlatform`. |
| `lib/planning/distributionEngine.ts` | **Modified** — AUTO + STAGGERED branch: optional weight-based reorder before `applyStaggeredDistribution`, with dev log. |
