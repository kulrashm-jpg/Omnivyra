# Distribution Stability Indicator (Phase 1) — Implementation Report

## 1️⃣ Stability Logic File

**`lib/intelligence/distributionStability.ts`**

- **`DistributionStabilityResult`:** `total_weeks`, `strategy_switches`, `volatility_score` (0–100), `stability_level` (`"STABLE"` | `"MODERATE"` | `"VOLATILE"`).
- **`computeDistributionStability(decisions)`:** Input array of `{ week_number, resolved_strategy }` (e.g. timeline items).
  - **&lt; 2 weeks:** Returns `strategy_switches: 0`, `volatility_score: 0`, `stability_level: "STABLE"`, `total_weeks` as given.
  - **≥ 2 weeks:** Sorts by `week_number` ASC, counts adjacent strategy changes, then:
    - `strategy_switches` = number of indices `i` where `strategy[i] !== strategy[i-1]`.
    - `volatility_score` = `Math.round((switches / (total_weeks - 1)) * 100)`, clamped 0–100.
    - `stability_level`: 0–25 → STABLE, 26–60 → MODERATE, 61–100 → VOLATILE.
  - **On throw:** Returns fallback `{ total_weeks: 0, strategy_switches: 0, volatility_score: 0, stability_level: "STABLE" }`.
- Deterministic, no randomness, no DB, no side effects.

---

## 2️⃣ API Extension

**`pages/api/intelligence/decision-timeline.ts`**

- **Import:** `computeDistributionStability` and `DistributionStabilityResult` from `lib/intelligence/distributionStability`.
- **After** building `decisions`: `stability = computeDistributionStability(decisions)` inside try/catch; on catch use fallback (STABLE, 0%).
- **Response:** `DecisionTimelineResponse` extended with `stability: DistributionStabilityResult`.
- **Dev log:** `console.log('[DistributionStability]', stability)` in development.

---

## 3️⃣ UI Section Added

**`pages/campaign-intelligence/[id].tsx`**

- **State:** `stability: StabilityResult | null`, set from decision-timeline API response (`data.stability`).
- **Data:** Timeline request now keeps full response; `setTimeline(data.decisions)` and `setStability(data.stability)`.
- **Section 6 — Distribution Stability** (above Decision Timeline, Activity icon):
  - **Empty:** When `!stability || stability.total_weeks < 2` → “Not enough data to determine stability.”
  - **Content:** Volatility Score (large, 2xl), Stability Level badge (STABLE = emerald, MODERATE = amber, VOLATILE = red), “Strategy Switches: X / N weeks”.

---

## 4️⃣ Example Stability Computation

**Input (decisions ordered by week_number):**  
Week 1 STAGGERED, Week 2 STAGGERED, Week 3 ALL_AT_ONCE, Week 4 ALL_AT_ONCE, Week 5 STAGGERED, Week 6 STAGGERED.

- **Switches:** 2 (week 2→3, week 4→5).
- **total_weeks:** 6.
- **volatility_score:** `round((2 / 5) * 100)` = 40.
- **stability_level:** 26–60 → MODERATE.

**Output:** `{ total_weeks: 6, strategy_switches: 2, volatility_score: 40, stability_level: "MODERATE" }`.

---

## 5️⃣ Edge Cases

- **Empty or single-week timeline:** Returns STABLE, 0%, 0 switches; UI shows “Not enough data to determine stability.”
- **Stability compute throws:** API uses fallback STABLE 0%; UI can show “Not enough data” if total_weeks &lt; 2 or stability null.
- **Timeline API failure:** Page already sets `stability` to null; Stability section shows empty state.
- **All same strategy:** 0 switches, volatility 0%, STABLE.
- **Alternating every week:** volatility 100%, VOLATILE.

---

## 6️⃣ Behavior Confirmation

- **Distribution engine:** Unchanged; no new rules.
- **Decision logging:** Unchanged; no new writes.
- **Stability:** Read-only from existing `decisions` array; no DB, no mutation.
- **Failure handling:** Computation wrapped in try/catch with STABLE fallback; API and UI handle missing/empty data without crashing.
