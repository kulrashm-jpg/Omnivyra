# Board Intelligence Indicators

Icon-first, one-line indicator row on activity cards. Workflow health at a glance without opening activities.

---

## 1. Indicator component model

**Item shape** (per indicator):

```ts
interface BoardIndicatorItem {
  id: string;
  kind: 'attention' | 'approval' | 'collaboration' | 'ownership' | 'flow_blocker' | 'time_risk';
  priority: number;   // higher = render first (left)
  label: string;      // tooltip / a11y
  colorClass: string; // Tailwind icon color (e.g. text-red-500)
  count?: number;     // optional (e.g. message count)
  approvalState?: ApprovalDisplayState; // when kind === 'approval'
}
```

**Components:**

- **`getBoardIndicators(activity, messageCount, now?)`** — pure function in `board-indicators.ts`. Returns `BoardIndicatorItem[]` in priority order.
- **`BoardIntelligenceIndicators`** — presentational component. Accepts `items: BoardIndicatorItem[]`, renders one row of icons (+ optional count). Icon-first; no text except numeric count.

**Icons (lucide-react):**

| Kind           | Icon          | When / variant |
|----------------|---------------|----------------|
| time_risk      | Clock         | Overdue (red), Due soon (amber) |
| attention      | AlertCircle   | Requires action (blocked / waiting approval) |
| approval       | FileEdit / CheckCircle / XCircle / AlertCircle | submitted / approved / rejected / changes_requested |
| collaboration  | MessageSquare | + count when > 0 |
| ownership      | User / UserX  | Assigned / Unassigned |

---

## 2. State mapping

| Indicator       | Source | Condition / display |
|-----------------|--------|----------------------|
| **Attention**   | `approval_status`, due | Overdue **or** `pending` / `request_changes` (blocked). One icon when “requires action”. |
| **Approval**    | `activity.approval_status` | Map: `pending` → submitted, `approved` → approved, `rejected` → rejected, `request_changes` → changes_requested. Always show one approval icon. |
| **Collaboration** | `messageCount` (prop) | Message count; icon + number when > 0. |
| **Ownership**   | `activity.owner_id` / `owner_name` | Assigned (user icon) vs unassigned (UserX / warning color). |
| **Flow blocker** | `approval_status` | Waiting review/approval = `pending` or `request_changes`. Folded into Attention in display (no separate icon). |
| **Time risk**   | `activity.due_date` (+ optional `due_time`) | **Overdue**: due < now. **Near due**: due within 48h. Overdue = red; near due = amber. |

**Helpers in `board-indicators.ts`:**

- `isOverdue(activity, now)` — due date/time in the past.
- `isNearDue(activity, now)` — due within 48 hours.
- `isBlocked(activity)` — `approval_status` in `['pending', 'request_changes']`.
- `needsAttention(activity, now)` — overdue or blocked.

---

## 3. Rendering priority logic

**Rule:** OVERDUE > BLOCKED > APPROVAL > COLLABORATION (then OWNERSHIP last).

**Numeric priority** (higher = left):

1. **OVERDUE** (100) — time_risk when overdue or near due.
2. **BLOCKED** (90) — attention when blocked (waiting approval/changes).
3. **APPROVAL** (80) — approval state icon.
4. **COLLABORATION** (70) — message count.
5. **OWNERSHIP** (60) — assigned / unassigned.

`getBoardIndicators` builds all relevant items, then sorts by `priority` descending so the row order is left-to-right by importance. Flow blocker is not a separate icon; it is represented by the attention indicator when blocked.

---

## 4. Minimal integration steps

1. **Types and logic**  
   Add `components/activity-board/board-indicators.ts`: `BoardIndicatorItem`, `INDICATOR_PRIORITY`, `getBoardIndicators`, `isOverdue`, `isNearDue`, `isBlocked`, `needsAttention`, and approval → display-state mapping.

2. **Indicator row component**  
   Add `BoardIntelligenceIndicators.tsx`: accepts `items: BoardIndicatorItem[]`, renders one row: icon per item, optional count next to collaboration icon. Icon-first; use `title={item.label}` for tooltips. Use lucide-react icons per table above.

3. **Card integration**  
   In `ActivityCard`:  
   - Compute `indicatorItems = getBoardIndicators(activity, messageCount)`.  
   - Replace or add a single row: `<BoardIntelligenceIndicators items={indicatorItems} />`.  
   - Keep card layout compact; no extra text in the indicator row beyond optional count.

4. **No schema change**  
   Use existing `Activity` fields (`approval_status`, `due_date`, `due_time`, `owner_id`, `owner_name`). Optional: add `blocked` later; until then derive blocked from approval_status.

5. **Exports**  
   Export `BoardIntelligenceIndicators` and `board-indicators` from `components/activity-board/index.ts` if other callers need them.
