# Manager Radar View

High-level campaign health visualization for Company Admin (CMO) and Campaign Content Manager. Signal-based UI only; no board, no message thread, no editing from radar.

---

## 1. Component structure

```
EnterpriseExecutionLayout (center panel)
├── Toggle [Pipeline] [Radar View]
├── centerView === 'pipeline' → ActivityBoard
└── centerView === 'radar' → ManagerRadarView
    ├── Health Summary Cards (row)
    │   ├── Total Activities
    │   ├── Pending Approval
    │   ├── Blocked
    │   ├── Overdue
    │   └── Scheduled
    ├── Stage Radar
    │   └── Per-stage chips: stage name, count, hasIssues highlight; click → open first activity in stage
    └── Attention Feed
        └── List of activities needing action (overdue, waiting approval, unassigned, blocked); click → open side panel
```

**Files**

| Item | Path |
|------|------|
| Aggregation | `components/execution-layout/manager-radar-aggregation.ts` |
| View component | `components/execution-layout/ManagerRadarView.tsx` |
| Toggle + wiring | `components/execution-layout/EnterpriseExecutionLayout.tsx` |
| Types | `CenterViewMode` in `components/execution-layout/types.ts` |

**Behavior**

- Clicking a stage in the radar opens the side panel with the first activity in that stage.
- Clicking an item in the attention feed opens the side panel with that activity.
- No editing in radar; all detail/editing remains in the side panel. No message thread in radar.

---

## 2. Data aggregation logic

**Input:** `activities: Activity[]`, optional `now` (default `Date.now()`).

**Health summary** (`aggregateHealthSummary`):

- **totalActivities** — `activities.length`
- **pendingApproval** — count where `approval_status === 'pending'`
- **blocked** — count where `isBlocked(a)` (pending or request_changes)
- **overdue** — count where `isOverdue(a, now)`
- **scheduled** — count where `stage === 'SCHEDULE'`

**Stage radar** (`aggregateStageRadar`):

- For each stage in ACTIVITY_STAGES: **count**, **overdueCount**, **blockedCount**.
- **hasIssues** — `overdueCount > 0 || blockedCount > 0` (used to highlight the stage).

**Attention feed** (`buildAttentionFeed`):

- Include activity if any: overdue, blocked (pending or request_changes), or unassigned (no owner_id/owner_name).
- Assign a single **reason** per activity (highest-priority one): overdue, waiting_approval (pending), blocked (request_changes), unassigned.
- Sort by **signal priority** (see below); then by title. Dedupe by activity id (one row per activity).

Helpers reused from `board-indicators`: `isOverdue(a, now)`, `isBlocked(a)`.

---

## 3. Signal priority rules

**Attention feed order (left-to-right / top-to-bottom):**

1. **OVERDUE** (100) — due date in the past.
2. **BLOCKED** (90) — approval_status is request_changes (blocked until changes).
3. **WAITING_APPROVAL** (85) — approval_status is pending.
4. **UNASSIGNED** (70) — no owner_id and no owner_name.

Constants in `manager-radar-aggregation.ts`: `ATTENTION_PRIORITY`.  
When an activity matches more than one reason, it appears once with the highest-priority reason.

**Stage “has issues” (radar highlight):**

- A stage is highlighted if it has at least one overdue or at least one blocked activity (same definitions as above).

---

## 4. Integration steps

1. **Aggregation**  
   Add `manager-radar-aggregation.ts`: `HealthSummary`, `StageRadarItem`, `AttentionFeedItem`, `AttentionReason`, `ATTENTION_PRIORITY`, `aggregateHealthSummary`, `aggregateStageRadar`, `buildAttentionFeed`. Use `isOverdue` and `isBlocked` from `board-indicators`.

2. **ManagerRadarView**  
   Add `ManagerRadarView.tsx`: props `activities`, `selectedActivityId`, `onSelectActivity`, optional `now`. Render summary cards, stage radar (click stage → `onSelectActivity(firstActivityInStage.id)`), and attention feed (click row → `onSelectActivity(activity.id)`). No message thread; signal-only (counts, icons, labels).

3. **Center view mode**  
   In `EnterpriseExecutionLayout`: add `centerView` state (`'pipeline' | 'radar'`), optional prop `defaultCenterView`. Add a toggle bar above the center content: [Pipeline] [Radar View]. When `centerView === 'radar'` render `ManagerRadarView` with `filteredActivities`, `selectedActivityId`, and `onSelectActivity(id)` that sets `selectedActivityId` and `panelMode = 'SIDE'`. When `centerView === 'pipeline'` render existing `ActivityBoard`.

4. **Types**  
   Add `CenterViewMode` to `execution-layout/types.ts` and use it in the layout.

5. **Exports**  
   Export `ManagerRadarView` and `manager-radar-aggregation` from `execution-layout/index.ts`.
