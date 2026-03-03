# Activity Side Panel Architecture

Additive UI and interaction layer only. No redesign of existing workflow or RBAC. Preserves activity lifecycle.

---

## 1. Component structure overview

```
ActivityBoardWithPanel (container)
├── ActivityBoard (pipeline)
│   └── ActivityCard[] (per stage column)
├── ActivitySidePanel (when panel open, not full-screen)
│   ├── Header (sticky): title, content type, stage badge, approval, owner, Approve / Reject / Move stage, Expand, Close
│   ├── Activity details: execution info, platforms, due dates, metadata
│   ├── Stage suggestion block (after approval): “Move to [Next]” [Move now] [Later]
│   ├── ActivityMessageThread (vertical, chronological)
│   └── ActivityMessageComposer (input + Send)
└── ActivityPanelFullScreen (when expanded)
    └── Renders same ActivitySidePanel with isFullScreen + onExpand = exit
```

**Files**

| Component | Path |
|-----------|------|
| Types + stage constants | `components/activity-board/types.ts` |
| ActivityCard | `components/activity-board/ActivityCard.tsx` |
| ActivityBoard | `components/activity-board/ActivityBoard.tsx` |
| ActivitySidePanel | `components/activity-board/ActivitySidePanel.tsx` |
| ActivityMessageThread | `components/activity-board/ActivityMessageThread.tsx` |
| ActivityMessageComposer | `components/activity-board/ActivityMessageComposer.tsx` |
| ActivityPanelFullScreen | `components/activity-board/ActivityPanelFullScreen.tsx` |
| ActivityBoardWithPanel | `components/activity-board/ActivityBoardWithPanel.tsx` |
| Index | `components/activity-board/index.ts` |

---

## 2. State flow (text)

```
┌─────────────────────────────────────────────────────────────────────────┐
│ HOST (e.g. campaign-daily-plan or activity-board page)                  │
│   - Owns or fetches activities (Activity[])                             │
│   - Optionally: messagesByActivity, currentUser*, onActivityUpdate,      │
│     onMessageAdd                                                         │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│ ActivityBoardWithPanel                                                   │
│   - activities (state, init from props)                                  │
│   - messagesByActivity (state, keyed by activity_id)                      │
│   - selectedActivityId | null                                            │
│   - fullScreenOpen (boolean)                                             │
│   - suggestedNextStageFor (activity id | null, set after approve)        │
└─────────────────────────────────────────────────────────────────────────┘
        │                    │                    │
        ▼                    ▼                    ▼
   Board view           Side panel          Full-screen overlay
   (selected            (single             (same content,
   card highlighted)    activity)           close → panel)
        │                    │                    │
        └────────────────────┴────────────────────┘
                             │
        ┌────────────────────┼────────────────────┐
        ▼                    ▼                    ▼
   onSelectActivity    Approve / Reject /    Expand → set
   → set selectedId    Request changes       fullScreenOpen=true
                      → update activity      Close → set false
                      → add auto message
                      → set suggestedNextStageFor (on approve)
                             │
                             ▼
   Confirm stage suggestion → update activity.stage, add SYSTEM message,
   clear suggestedNextStageFor
   Dismiss suggestion → clear suggestedNextStageFor
```

- **Activity** = source of truth for approval_status, stage, approved_by, approved_at.
- **Messages** = history only (thread); approval/transition messages are created by UI logic.

---

## 3. Key interaction events

| Event | Behavior |
|-------|----------|
| **Open panel** | User clicks activity card → `onSelectActivity(id)` → `selectedActivityId` set → panel shows that activity; card highlighted on board. |
| **Switch activity** | User clicks another card → `onSelectActivity(newId)` → panel content updates to new activity; new card highlighted. |
| **Expand full-screen** | User clicks Expand in panel → `onExpand()` → `fullScreenOpen = true` → overlay mounts with same panel content; board stays in background. |
| **Exit full-screen** | User clicks Minimize/Close in overlay → `onClose()` → `fullScreenOpen = false` → overlay unmounts, side panel visible again with same activity. |
| **Approve** | User clicks Approve → update activity `approval_status`, `approved_by`, `approved_at`; append APPROVAL message (e.g. “✔ Approved by Alice (Campaign Manager)”); set `suggestedNextStageFor = activityId`. |
| **Stage suggestion** | After approve, panel shows “Suggested next step: Move to [NextStage]” with [Move now] / [Later]. Move now → update activity.stage, append SYSTEM “Suggested transition: [Stage] stage.”, clear suggestion. Later → clear suggestion only. No automatic move. |

---

## 4. Minimal implementation steps (PR-sized)

1. **Types and constants**  
   Add `components/activity-board/types.ts`: `Activity`, `ActivityMessage`, `ActivityStage`, `ACTIVITY_STAGES`, `STAGE_COLORS`/badge classes, `ApprovalStatus`, `MessageType`, `SenderRole`, `ROLE_ACCENT_CLASSES`.

2. **Board**  
   Add `ActivityCard` and `ActivityBoard`: horizontal columns PLAN → CREATE → REPURPOSE → SCHEDULE → SHARE with stage colors; cards show title, content type, stage badge, approval status, owner only (no messages). Click → callback with activity id.

3. **Side panel**  
   Add `ActivitySidePanel`: right-side layout with sticky header (title, badges, Approve / Reject / Move stage, Expand, Close), details block, message thread, composer. Support `suggestedNextStage` and [Move now] / [Later].

4. **Message thread and composer**  
   Add `ActivityMessageThread` (chronological, role-based accent, approval/rejection styling) and `ActivityMessageComposer` (input + @mention structure; submit → callback).

5. **Full-screen mode**  
   Add `ActivityPanelFullScreen`: full-screen overlay rendering `ActivitySidePanel` with `isFullScreen` and `onExpand` = exit. No new route.

6. **Container and wiring**  
   Add `ActivityBoardWithPanel`: holds activities, messagesByActivity, selectedActivityId, fullScreenOpen, suggestedNextStageFor; implements approve/reject/request-changes (update activity + add message), move-stage, confirm/dismiss stage suggestion, send message. Passes all handlers into panel and full-screen.

7. **Integration**  
   On campaign-daily-plan (or new activity-board page): map existing grid/plan data to `Activity[]` (assign default stage e.g. PLAN if missing); render `ActivityBoardWithPanel`. Optionally wire `onActivityUpdate` / `onMessageAdd` to APIs when available.

8. **Docs**  
   Add this document; no RBAC or workflow logic changes.

---

## 5. Board view rules (reminder)

- Board = pipeline overview only; no messages on cards.
- Side panel = single source of activity editing; selecting another card updates panel.
- Full-screen = same content as panel for deep editing; close returns to panel.
- Messages are not draggable and not counted as tasks. Approval history lives in the thread; activity holds approval state.
