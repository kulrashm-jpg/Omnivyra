# Enterprise 3-Panel Layout for Campaign Execution

Permanent layout separation: **LEFT (Context) | CENTER (Workflow Board) | RIGHT (Activity Workspace)**.  
Board remains visible when panel is open. One activity active at a time. Messages only in the right panel.

---

## 1. Component hierarchy

```
EnterpriseExecutionLayout (container)
├── CampaignContextPanel (LEFT)
│   ├── Current campaign label
│   ├── Campaign navigation list (optional)
│   └── Filters (stage, approval; lightweight static)
├── CENTER (pipeline)
│   └── ActivityBoard
│       └── ActivityCard[] per stage column (horizontal stages; drag/drop unchanged; no messages)
├── RIGHT (when panelMode === SIDE)
│   └── ActivitySidePanel
│       ├── Activity header (title, content type, stage, approval, owner)
│       ├── Approval actions (Approve, Reject, Request changes, Move stage)
│       ├── Activity details
│       ├── Hybrid stage suggestion (after approval)
│       ├── Message thread (vertical)
│       └── Message composer
└── FULLSCREEN overlay (when panelMode === FULLSCREEN)
    └── ActivityPanelFullScreen
        └── Same content as ActivitySidePanel; close → back to SIDE
```

**Files**

| Component | Path |
|-----------|------|
| Types (PanelMode, filters, context) | `components/execution-layout/types.ts` |
| CampaignContextPanel | `components/execution-layout/CampaignContextPanel.tsx` |
| EnterpriseExecutionLayout | `components/execution-layout/EnterpriseExecutionLayout.tsx` |
| Index | `components/execution-layout/index.ts` |
| Board / Panel / FullScreen | Reused from `components/activity-board/` |

---

## 2. State flow

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ EnterpriseExecutionLayout state                                              │
│   activities, messagesByActivity (from props or local)                        │
│   selectedActivityId: string | null   ← only one activity active at a time  │
│   panelMode: 'CLOSED' | 'SIDE' | 'FULLSCREEN'                                 │
│   suggestedNextStageFor: string | null (activity id for stage suggestion)    │
│   filters (from props or local) → filteredActivities for board                │
└─────────────────────────────────────────────────────────────────────────────┘
        │
        ├── Card click → setSelectedActivityId(id), setPanelMode('SIDE')
        │   → RIGHT panel opens with that activity; board stays visible
        │
        ├── Close panel → setPanelMode('CLOSED'), setSelectedActivityId(null)
        │
        ├── Expand (from right panel) → setPanelMode('FULLSCREEN')
        │   → Full-screen overlay mounts; same data; no route change
        │
        ├── Exit full-screen → setPanelMode('SIDE')
        │   → Overlay unmounts; right panel visible again
        │
        └── Approve / Reject / Move stage / Send message
            → update activity and/or messages (activity = source of truth; messages = history)
            → On approve: setSuggestedNextStageFor(activityId) → show “Move to [Next]” [Move now] [Later]
```

**Panel mode behavior**

| panelMode   | Left | Center (board) | Right panel | Full-screen overlay |
|------------|------|----------------|-------------|----------------------|
| CLOSED     | ✓    | ✓              | hidden      | no                   |
| SIDE       | ✓    | ✓              | visible     | no                   |
| FULLSCREEN | ✓    | ✓ (background) | hidden      | visible              |

---

## 3. Layout implementation steps

1. **Types**  
   Add `components/execution-layout/types.ts`: `PanelMode` (`'CLOSED' | 'SIDE' | 'FULLSCREEN'`), `CampaignContextItem`, `ExecutionFilters`.

2. **Left panel**  
   Add `CampaignContextPanel`: fixed width (e.g. 14rem), border-right, background. Sections: current campaign label, optional campaign list (nav), filters (stage, approval) as lightweight controls. No workflow logic; optional `onSelectCampaign`, `onFiltersChange` for host.

3. **Layout shell**  
   Add `EnterpriseExecutionLayout`: single flex row — left (CampaignContextPanel), center (flex-1, min-w-0), right (conditional).  
   - Center: always render `ActivityBoard` with `filteredActivities`, `selectedActivityId`, `onSelectActivity`.  
   - On card select: set `selectedActivityId` and `panelMode = 'SIDE'`.  
   - Right: render `ActivitySidePanel` only when `panelMode === 'SIDE'`; on close set `panelMode = 'CLOSED'` and clear `selectedActivityId`.  
   - Full-screen: render `ActivityPanelFullScreen` only when `panelMode === 'FULLSCREEN'`; on close set `panelMode = 'SIDE'`.

4. **Reuse activity-board**  
   Use existing `ActivityBoard`, `ActivitySidePanel`, `ActivityPanelFullScreen` from `components/activity-board`. No changes to drag/drop or board behavior. Messages remain only in the right panel (and full-screen).

5. **State and handlers**  
   In `EnterpriseExecutionLayout`: own `selectedActivityId`, `panelMode`, `activities`, `messagesByActivity`, `suggestedNextStageFor`. Implement approve/reject/request-changes, move-stage, stage suggestion (confirm/dismiss), send-message; optionally call `onActivityUpdate` / `onMessageAdd` for persistence.

6. **Filters**  
   Apply `filters` (stage, approvalStatus, owner) to `activities` to produce `filteredActivities` for the board. Left panel only renders filter controls; layout applies them.

7. **Integration**  
   On the campaign execution page (e.g. daily plan or dedicated execution view): render `EnterpriseExecutionLayout` with `activities`, optional `currentCampaign`, `campaigns`, `filters`/`onFiltersChange`, and persistence callbacks. Ensure one activity is selected only when panel is SIDE or FULLSCREEN.

---

## 4. UX constraints (summary)

- **Board always visible** when panel is open (SIDE or FULLSCREEN).
- **Only one activity active at a time**: `selectedActivityId` is single; closing panel clears it.
- **Messages live only in the right panel** (and in full-screen when expanded); no messages on the board.
- **Full-screen** is expandable from the right panel; same data; no route change; closing returns to side panel.
