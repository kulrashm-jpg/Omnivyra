# Campaign Radar — Dynamic AI Weekly Summary Refresh

The Weekly Summary narrative updates when meaningful workflow events occur, with throttling and a subtle "Summary updated" indicator. Narrative tone stays stable (same generator; no change to wording rules).

---

## 1. Event trigger list

Summary regeneration is driven by **health and activities** changing. Those change when the layout’s state is updated by:

| Trigger event | What updates | Narrative recomputes when |
|---------------|--------------|----------------------------|
| **Approval actions** (approve / reject / request changes) | Activity `approval_status`; optional message | Health/activities change → narrative useMemo runs |
| **Stage transitions** (move stage) | Activity `stage` | Health/activities change |
| **Activity becomes overdue** | Time-based; health recomputed with current `now` | Health depends on `isOverdue(activity, now)`; activities or time context change |
| **Activity assigned / unassigned** | Activity `owner_id` / `owner_name` | Health/activities change |
| **Major status changes** | Any activity field that affects health (e.g. due date) | Health/activities change |

**Do NOT refresh on:**

- **Messages or text edits** — Adding a message updates `messagesByActivity` only; it does **not** change `activities` or the health engine input, so the narrative does not regenerate.
- **Non-workflow UI changes** — e.g. expanding the panel, toggling view; no activity/health change.

So: **workflow event → layout updates activities (or health input) → health recomputed → narrative useMemo runs → throttle gate → display update + optional "Summary updated".**

---

## 2. Refresh throttling logic

- **Max one narrative refresh per 5 minutes** (configurable constant `NARRATIVE_REFRESH_THROTTLE_MS = 5 * 60 * 1000` in `ManagerRadarView.tsx`).
- **Displayed narrative** is kept in component state; **computed narrative** comes from `useMemo(() => generateWeeklySummaryNarrative(health, activities), [health, activities])`.
- When **computed narrative** changes (new reference from useMemo):
  - If **throttle passed** (time since last update ≥ 5 min) **or** first load (`lastNarrativeUpdateRef === 0`):
    - Update **displayed narrative** to the new computed value.
    - Set **last update time** to now.
    - If this is a **refresh** (not first load), show **"Summary updated"** for 4 seconds, then hide.
  - If **throttle not passed**: do **not** update displayed narrative; user keeps seeing the previous summary until the next allowed refresh.

So rapid workflow events (e.g. several approvals in one minute) only cause one visible update per 5 minutes; the narrative stays stable and tone is unchanged.

---

## 3. Narrative regeneration flow

```
Workflow event (approve / stage move / assign / etc.)
    → Layout updates activity state (e.g. setActivities / updateActivity)
    → health = computeCampaignHealth(activities)  [in layout]
    → ManagerRadarView receives new health + activities
    → computedNarrative = useMemo(generateWeeklySummaryNarrative(health, activities))
    → useEffect: computedNarrative changed?
        → If throttle passed (or first load):
            → setDisplayedNarrative(computedNarrative)
            → If refresh (not first load): show "Summary updated" for 4s
        → Else: keep displayedNarrative unchanged
    → UI renders displayedNarrative; optional "Summary updated" text
```

- **Health engine** is not event-aware; it only recomputes when the layout passes new `activities` (and optional `now`). The layout already recomputes health when activities change (approve, move stage, etc.).
- **Narrative tone** is unchanged: same `generateWeeklySummaryNarrative` and GUIDED/positivity rules; only the **when** and **throttling** of display updates are new.

---

## 4. UI behavior

- **"Summary updated"** — Small, subtle text (e.g. `text-xs text-gray-500 italic`) next to the "Weekly Summary" heading, visible only for a few seconds after a throttled refresh. No intrusive animation. Uses `aria-live="polite"` for accessibility.
- **No refresh on messages or text edits** — Handled by not tying narrative to `messagesByActivity`; only `health` and `activities` drive regeneration.

---

## 5. Implementation notes

- Throttle and indicator duration are constants in `ManagerRadarView.tsx`: `NARRATIVE_REFRESH_THROTTLE_MS`, `SUMMARY_UPDATED_INDICATOR_DURATION_MS`.
- To change throttle to 10 minutes, set `NARRATIVE_REFRESH_THROTTLE_MS = 10 * 60 * 1000`.
- First time the summary is shown (or when opening Radar), the narrative is set once without showing "Summary updated"; the indicator only appears on a **subsequent** refresh after the throttle window has passed.
