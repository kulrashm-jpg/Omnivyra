# AI Adaptation — Invisible Behavior

AI adaptation (preventive-option reordering) is **invisible**: the system learns silently, with no leadership insights or behavioral analytics in the UI. Workflow stays focused.

---

## Final adaptation rules

| Rule | Implementation |
|------|----------------|
| System learns user preferences silently | Selections stored per user (localStorage or backend); no UI shows what was learned. |
| No leadership pattern insights shown | No text like "Preferred based on past choices" or "You often choose X". |
| No behavioral analytics UI | No dashboards, charts, or reports about user or team option choices. |
| Reorder preventive action options only | Only the order of Suggested Options changes; no other UI or data is adapted. |
| All options remain visible | No option is hidden or demoted out of view. |
| No explicit explanation of reordering | Users are not told why options appear in a given order. |

---

## UX stability safeguards

| Safeguard | Implementation |
|-----------|----------------|
| No sudden reordering during active viewing | Option order is **frozen** when the portfolio view is loaded. Pattern is captured once per load (via `loadKey` = campaign set identity). |
| Apply ordering on next load or refresh | New preference data affects order only on the **next** time the user opens Portfolio or refreshes; `frozenPatternRef` is updated only when `loadKey` changes (new campaign list / fetch). |
| No mid-session reflow | `displayCards` depends only on `sortedCards`; it does not depend on a live pattern, so recording a selection never reorders the current view. |

**Code reference:** `CmoPortfolioRadarView` uses `lastLoadKeyRef` and `frozenPatternRef` so that the pattern used for reordering is fixed for the lifetime of the current portfolio data. When the user returns to Portfolio or the data is refetched, `loadKey` changes and a new pattern is frozen.

---

## Implementation checklist

- [x] **Learning:** Track user-selected option type (CLEAR / ASSIGN / ADVANCE) per user with timestamp (and optional campaign_id). No UI for this data.
- [x] **Preference scoring:** Frequency + recency weighting; `getUserDecisionPattern(userId)` returns preferred order or null (insufficient history).
- [x] **Reordering:** `reorderOptionsByPreference(options, pattern)` in engine; used only for Suggested Options order.
- [x] **No preference label:** Do not show "Preferred based on past choices" or any explanation of order.
- [x] **No analytics UI:** Do not add screens or widgets that surface choice patterns or behavioral insights.
- [x] **Freeze per view:** Capture pattern once per portfolio load; use frozen pattern for `displayCards` so order does not change during the same view.
- [x] **Apply on next load:** New selections affect order only when the user loads Portfolio again (or refreshes).
- [x] **Layout:** Pass `currentUserId` only so the view can call `getDecisionPattern` and `onRecordSelection`; no exposure of patterns to parent.

---

## Goal

Keep AI intelligence **invisible** and **workflow-focused**: users get slightly more relevant option order over time without any visible "AI" or analytics layer.
