# Smart Preview Activity Cards

Board cards optimized for **~3 second scannability**. No long text, message previews, or strategy; deep content stays in the side panel.

---

## 1. Card component structure

```
ActivityCard (Smart Preview)
├── Container (div)
│   ├── Stage color accent (left border: 4px)
│   ├── [Clickable body — Open]
│   │   ├── 1. Title (single line, truncate)
│   │   ├── 2. Content type badge
│   │   ├── 3. Owner name (optional)
│   │   ├── 4. Approval status (pill + color dot)
│   │   ├── 5. Due date (optional)
│   │   └── 6. Small indicators row (message count; approval dot in pill; stage = left border)
│   └── [Hover only] Quick actions bar
│       ├── Open (primary)
│       ├── Move (optional, from parent)
│       └── Approve (optional, role-based; hidden if already approved)
└── Props: activity, isSelected, messageCount?, onClick, onMove?, onApprove?, canApprove?
```

**File:** `components/activity-board/ActivityCard.tsx`

**Excluded from card (per spec):** long descriptions, message previews, strategy information, stage text badge (stage = column + left border).

---

## 2. Visual hierarchy definition

| Level | Element | Purpose |
|-------|---------|--------|
| **1** | Title | Primary identifier; single line, truncate; font-medium, text-sm |
| **2** | Content type badge, Approval status | Type and state at a glance; compact pills |
| **3** | Owner name, Due date | Attribution and timing; text-xs, muted |
| **4** | Indicators | Message count (icon + number), approval dot (inside pill); stage = left border color |

**Spacing:** Compact vertical (e.g. `p-2.5`, `mt-1` / `mt-1.5` between rows).

**Stage accent:** Left border only (`border-l-4` + stage color: blue / purple / orange / teal / green). No stage text on card (column header is the stage).

**Approval indicator:** Colored dot + pill (pending = amber, approved = emerald, rejected = red, request_changes = amber).

**Hover:** Quick actions bar appears at bottom of card (Open, Move, Approve when `canApprove`); does not trigger on body click (Open = click body or Open button).

---

## 3. Implementation steps

1. **Card content (only)**  
   - Title (truncate, one line).  
   - Content type badge (single pill).  
   - Owner name (optional, truncate).  
   - Approval status (pill with small color dot + label).  
   - Due date (optional; `due_date` + optional `due_time`).  
   - Indicators row: message count (icon + number when `messageCount > 0`); approval state via pill dot; stage via left border.

2. **Visual rules**  
   - Stage color as left border (`STAGE_BORDER_CLASSES`).  
   - Approval pill and dot colors (`APPROVAL_PILL_CLASSES`, `APPROVAL_DOT_CLASSES`).  
   - Compact padding and vertical spacing; no stage badge text on card.

3. **Interactions**  
   - Card body click → Open (same as `onClick`).  
   - Hover → show quick actions bar (Open, Move, Approve).  
   - Open: trigger `onClick`.  
   - Move: call `onMove(activity.id)` if provided (parent can show stage picker or open panel).  
   - Approve: call `onApprove(activity.id)` when `canApprove` and not already approved; hide Approve when `approval_status === 'approved'`.

4. **Board wiring**  
   - `ActivityBoard` accepts `messageCountByActivity`, `onMove`, `onApprove`, `canApprove`.  
   - Pass `messageCount={messageCountByActivity[id] ?? 0}`, `onMove`, `onApprove`, `canApprove(activity)` to each card.

5. **Layout integration**  
   - `EnterpriseExecutionLayout` / `ActivityBoardWithPanel`: compute `messageCountByActivity` from `messagesByActivity` (e.g. `Object.fromEntries(Object.entries(msgs).map([id, arr] => [id, arr.length]))`).  
   - Pass `onApprove`, `canApprove` (e.g. `(a) => a.approval_status !== 'approved'`).  
   - Optionally pass `onMove` for card-level move (e.g. open panel or inline stage dropdown).

6. **Scannability**  
   - No descriptions, message previews, or strategy on card.  
   - All deep content remains in side panel.  
   - Target: scannable within ~3 seconds.
