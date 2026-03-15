# Campaign Planner UI Layout + Context Selection Audit

**Date:** 2025-03-13  
**Objective:** Audit the current campaign planner UI to prepare a clean layout refactor that reduces clutter and introduces campaign context selection (Company Context, Focused Context, No Context, Trend Campaign), moving planner controls into a compact panel.

---

## 1. Current Layout Architecture

### Component Hierarchy

```
CampaignPlannerPage
└── CampaignPlannerWithSession (PlannerSessionProvider)
    └── CampaignPlannerContent (PlannerEntryRouter)
        └── CampaignPlannerInner
            ├── Header (Back, title)
            ├── PlanLoader (fetch retrieve-plan when campaignId)
            └── Main container (flex flex-col)
                ├── CampaignContextBar (top, collapsible)
                └── flex row (PlanningCanvas + PlannerControlPanel)
                    ├── PlanningCanvas (flex-[0.65], ~65%)
                    │   ├── View mode bar [Campaign|Month|Week|Day]
                    │   ├── View content
                    │   └── FinalizeSection (at bottom of canvas area)
                    └── PlannerControlPanel (flex-[0.35], ~35%, min-w-[280px] max-w-[420px])
                        ├── Tab buttons [Strategy|Structure|Content]
                        ├── Tab content (overflow-y-auto)
                        └── AI Assistant (border-t, fixed height)
                            └── AIPlanningAssistantTab
```

### Layout Structure

| Zone | Component | Proportion / Size | Notes |
|------|-----------|-------------------|-------|
| Header | Custom header | full width | Back button, title |
| Context Bar | CampaignContextBar | full width | Collapsible, border-b |
| Left Body | PlanningCanvas | 65% (flex-[0.65]) | Canvas + FinalizeSection |
| Right Body | PlannerControlPanel | 35% (flex-[0.35]) | min-w 280px, max-w 420px |
| Right Panel Tabs | Strategy, Structure, Content | — | Controlled by PlannerControlPanel |
| Right Panel Bottom | AIPlanningAssistantTab | h-48 (180–220px) | Fixed height section |

**File:** `pages/campaign-planner.tsx` (lines 126–166)

**Note:** `CampaignHealthPanel` is exported from planner but **not currently rendered** in `campaign-planner.tsx`. Docs indicate it was previously above PlanningCanvas; it is absent in the current implementation.

---

## 2. Tab Rendering Flow

### Tab State Controller

| Responsibility | Location |
|----------------|----------|
| Tab state | `PlannerControlPanel.tsx` — `useState<PlannerControlTabId>('strategy')` |
| Tab buttons | Inline in PlannerControlPanel |
| Tab content | Conditionally rendered by `activeTab` |

### Tab Mapping

| Tab ID | Component | File |
|--------|-----------|------|
| `structure` | StructureTab | `components/planner/tabs/StructureTab.tsx` |
| `content` | ContentTab | `components/planner/tabs/ContentTab.tsx` |
| `strategy` | StrategyTab | `components/planner/tabs/StrategyTab.tsx` |

**Default tab:** `strategy` (line 28 in PlannerControlPanel.tsx)

---

## 3. Campaign Context Input Components

### Inputs and Storage

| Input | Component | Storage Location |
|-------|-----------|------------------|
| Campaign Idea / Title | CampaignContextBar | `state.campaign_design.idea_spine.title`, `refined_title` |
| Description | CampaignContextBar | `state.campaign_design.idea_spine.description`, `refined_description` |
| Campaign Direction (angles) | CampaignContextBar | `state.campaign_design.idea_spine.selected_angle` |
| Target Audience | StrategyTab | `state.execution_plan.strategy_context.target_audience` |
| Campaign Goal | StrategyTab | `state.execution_plan.strategy_context.campaign_goal` |

### Rendering Details

| Input | Rendered In | Type |
|-------|-------------|------|
| Campaign Idea / Title | CampaignContextBar | `<input type="text">` (line ~156) |
| Description | CampaignContextBar | `<textarea>` (lines ~167–175) |
| Campaign Direction | CampaignContextBar | Chips (when `normalizedAngles.length > 0`) |
| Campaign Goal | StrategyTab | `<select>` with `CAMPAIGN_GOAL_OPTIONS` |
| Target Audience | StrategyTab | Chip buttons with `TARGET_AUDIENCE_OPTIONS` |

**Note:** Per CampaignContextBar comment: *"Goal and Audience live in Strategy tab (selection-based)."*

---

## 4. Existing Context Mode Logic

### Planner Session Store

**File:** `components/planner/plannerSessionStore.ts`

- `CompanyContextMode`: `'full_company_context' | 'minimal' | 'none'`
- `campaign_design.company_context_mode` — stored
- `campaign_design.focus_modules` — stored (for FOCUSED mode)
- No `trend_context` or Trend Campaign mode in the current store (per `CAMPAIGN-PLANNER-CONTEXT-MODE-REPORT.md` these were planned but may be absent)

### CampaignContextBar

- **Imports** `UnifiedContextModeSelector` and `EngineContextPanel` but **does not render them**.
- Reads `company_context_mode` from store (default `full_company_context`).
- **No visible UI** for changing context mode.

### UnifiedContextModeSelector

**File:** `components/recommendations/engine-framework/UnifiedContextModeSelector.tsx`

| Mode | Unified | Planner Mapping |
|------|---------|-----------------|
| Full Company Context | `FULL` | `full_company_context` |
| Focused Context | `FOCUSED` | `minimal` |
| No Company Context | `NONE` | `none` |
| **Trend Campaign** | ❌ **Not present** | — |

`UnifiedContextModeSelector` has only FULL, FOCUSED, NONE. **Trend Campaign** must be added.

### TrendCampaign

- `TrendCampaignsTab` is in `components/recommendations/tabs/TrendCampaignsTab.tsx` (Recommendation Hub).
- Used for trend-based theme generation and “Build Campaign Blueprint” → `/campaign-planner?companyId=X&recommendationId=Y`.
- Not a planner context mode; it is an entry path into the planner.

---

## 5. AI Chat Mount Location

### Mount Point

**File:** `components/planner/PlannerControlPanel.tsx` (lines 103–113)

```tsx
const aiChatSection = (
  <div className="border-t border-gray-200 flex-shrink-0">
    <div className="px-2 py-1.5 text-xs font-medium text-gray-500 flex items-center gap-1">
      <MessageSquare className="h-3.5 w-3.5" />
      AI Assistant
    </div>
    <div className="h-48 min-h-[180px] max-h-[220px]">
      <AIPlanningAssistantTab companyId={companyId} />
    </div>
  </div>
);
```

### Placement

- Inside `PlannerControlPanel`, below tab content.
- Layout: `tabButtons` → `tabContent` → `aiChatSection`.
- Fixed height: `h-48 min-h-[180px] max-h-[220px]`.
- Hidden in drawer mode when panel is closed.

### Move to Persistent Bottom Panel?

- Yes. `AIPlanningAssistantTab` uses `usePlannerSession()` and is self-contained.
- It can be moved to a persistent bottom strip in `campaign-planner.tsx`.
- Would require layout changes in CampaignPlannerInner and PlannerControlPanel.

---

## 6. Platform Content Matrix Rendering Location

### Location

**File:** `components/planner/tabs/StructureTab.tsx` (line 182)

```tsx
<PlatformContentMatrix companyId={companyId} durationWeeks={durationWeeks} />
```

### Tab

- Rendered inside **StructureTab**.
- StructureTab content: Start date, Duration, CampaignTypeSelector, Presets, **PlatformContentMatrix**, Generate Skeleton.

### StructureTab Dependencies

- `PlatformContentMatrix` uses `companyId` and `durationWeeks` (from StructureTab state).
- It does not depend on StructureTab-specific logic beyond those props.
- Could be moved to another tab or compact panel without structural changes.

---

## 7. Layout Controller Components

### Responsive Behavior (< 1200px)

**File:** `components/planner/PlannerControlPanel.tsx` (lines 32–43)

```tsx
useEffect(() => {
  const check = () => {
    const w = typeof window !== 'undefined' ? window.innerWidth : 1400;
    setIsDrawer(w < 1200);
    if (w >= 1200) setDrawerOpen(false);
  };
  check();
  if (typeof window !== 'undefined') {
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }
}, []);
```

- Below 1200px: `isDrawer = true` → floating button + overlay panel.
- Panel width: `min(400px, 90vw)`.
- Layout logic is fully inside **PlannerControlPanel**; `campaign-planner.tsx` does not handle drawer.

### Panel Layout

| Aspect | Controlled By |
|--------|---------------|
| 65/35 split | `campaign-planner.tsx` (flex-[0.65], flex-[0.35]) |
| Right panel width | `campaign-planner.tsx`: min-w-[280px] max-w-[420px] |
| Drawer breakpoint | `PlannerControlPanel.tsx` (1200px) |
| Tab order | `PlannerControlPanel.tsx` |
| AI chat height | `PlannerControlPanel.tsx` |

---

## 8. Replace vs Refactor Recommendation

| Component | Recommendation | Rationale |
|-----------|----------------|----------|
| **CampaignContextBar** | **REFACTOR** | Add UnifiedContextModeSelector (plus Trend Campaign), optionally EngineContextPanel for focus modules. Remove dead imports or wire them. Simplify idea/description UI. |
| **StructureTab** | **KEEP** | Working; can be made more compact in a unified control panel. |
| **StrategyTab** | **KEEP** | Goal, audience, opportunity insights; minimal change. |
| **ContentTab** | **KEEP** | Activity editing; minimal change. |
| **AIPlanningAssistantTab** | **RELOCATE** | Move to a persistent bottom panel in `campaign-planner.tsx` for always-visible AI assistant. |
| **PlanningCanvas** | **KEEP** | Core canvas; layout remains. |
| **PlannerControlPanel** | **REFACTOR** | Compact panel; remove AI chat block after relocation; optionally collapse tabs or reorganize for new layout. |
| **PlatformContentMatrix** | **KEEP** | Stays in StructureTab; no structural change needed. |

### Summary Actions

1. **CampaignContextBar:** Wire and render `UnifiedContextModeSelector`, add Trend Campaign mode, sync with `setCompanyContextMode`/`setCampaignDesign`.
2. **UnifiedContextModeSelector:** Extend with a fourth option: **Trend Campaign**.
3. **plannerSessionStore:** Add `trend_context` if Trend Campaign requires extra fields.
4. **AIPlanningAssistantTab:** Extract from PlannerControlPanel and mount in a bottom strip in `campaign-planner.tsx`.
5. **PlannerControlPanel:** Remove AI chat block, adjust layout for compact control panel.
6. **campaign-planner.tsx:** Add bottom strip for AI chat; optionally reintroduce `CampaignHealthPanel` when `campaignId` is present.

---

## Appendix: File Reference

| File | Purpose |
|------|---------|
| `pages/campaign-planner.tsx` | Main page, layout orchestrator |
| `components/planner/PlannerControlPanel.tsx` | Right panel, tabs, drawer, AI chat |
| `components/planner/CampaignContextBar.tsx` | Idea, description, refine (context mode UI missing) |
| `components/planner/PlanningCanvas.tsx` | Campaign/Month/Week/Day views, activity cards |
| `components/planner/tabs/StructureTab.tsx` | Structure + PlatformContentMatrix |
| `components/planner/tabs/StrategyTab.tsx` | Goal, audience, Opportunity Insights |
| `components/planner/tabs/ContentTab.tsx` | Activity editor |
| `components/planner/AIPlanningAssistantTab.tsx` | AI chat for plan generation |
| `components/planner/PlatformContentMatrix.tsx` | Platform × content frequency matrix |
| `components/planner/plannerSessionStore.ts` | Session state (idea_spine, strategy_context, company_context_mode) |
| `components/recommendations/engine-framework/UnifiedContextModeSelector.tsx` | Context mode (FULL/FOCUSED/NONE) |
