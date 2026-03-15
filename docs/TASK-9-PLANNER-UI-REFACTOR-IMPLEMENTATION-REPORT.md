# Task 9: Planner UI Refactor — Context Mode + Bottom AI Assistant

## Implementation Report

**Date:** 2025-03-13

---

## 1. FILES MODIFIED

| File | Changes |
|------|---------|
| `components/planner/plannerSessionStore.ts` | Added `trend_campaign` to `CompanyContextMode`; added `TrendContext` interface and `trend_context` to `CampaignDesign`/`PlannerSessionState`; updated `setCampaignDesign` to accept `trend_context` (including explicit `null`); updated `loadPersistedSession` and `persistSession` for `trend_campaign`. |
| `components/recommendations/engine-framework/UnifiedContextModeSelector.tsx` | Added `TREND` to `ContextMode` type; added `showTrendOption` prop; when true, renders "Trend Campaign" radio; updated `loadStored` to accept `TREND` in persisted mode. |
| `components/planner/CampaignContextBar.tsx` | Rendered `UnifiedContextModeSelector` at top with `showTrendOption`; mapped TREND → `trend_campaign`; when FOCUSED, renders `EngineContextPanel` below selector; simplified to Campaign Idea/Title + Description only; collapsed by default; when TREND, enables `trend_context` from `recommendation_context` or `source_ids.recommendation_id`. |
| `pages/campaign-planner.tsx` | Added persistent bottom strip with `AIPlanningAssistantTab`; added `CampaignHealthPanel` above `PlanningCanvas` when `campaignId` exists; imports `CampaignHealthPanel`, `AIPlanningAssistantTab`. |
| `components/planner/PlannerControlPanel.tsx` | Removed `aiChatSection` and `AIPlanningAssistantTab`; removed `MessageSquare` import; `fullPanel` now only contains tab buttons + tab content. |
| `components/recommendations/tabs/MarketPulseTab.tsx` | Added `TREND: 'Trend Campaign'` to `CONTEXT_LABELS` for type exhaustiveness. |

---

## 2. CONTEXT MODE SELECTOR IMPLEMENTATION

**Location:** `CampaignContextBar` (top of collapsible section)

**Options (4):**
- **Full Company Context** → `full_company_context`
- **Focused Context** → `minimal`
- **No Company Context** → `none`
- **Trend Campaign** → `trend_campaign` (shown only in planner via `showTrendOption`)

**State:**
- Stored in `plannerSessionStore.campaign_design.company_context_mode`
- Persisted to localStorage (company-scoped)
- When TREND: `trend_context` is populated from `recommendation_context` or `source_ids.recommendation_id`

**Focused Context modules:**
- When FOCUSED selected, `EngineContextPanel` renders below the selector
- Modules: Target Customer, Problem Domains, Campaign Purpose, Offerings, Geography, Pricing
- Bound to `plannerSessionStore.campaign_design.focus_modules`

---

## 3. AI ASSISTANT RELOCATION

**Before:** Inside `PlannerControlPanel`, at bottom of right panel (h-48, min 180px, max 220px)

**After:** Persistent bottom strip in `pages/campaign-planner.tsx`
- Full width, below PlanningCanvas + PlannerControlPanel
- Height: `h-52 min-h-[200px] max-h-[280px]`
- Always visible (including when drawer mode active)

**Drawer behavior (< 1200px):**
- Planner tabs move to slide-over drawer
- AI Assistant strip remains at bottom of viewport (outside drawer)

---

## 4. UPDATED LAYOUT STRUCTURE

```
┌─────────────────────────────────────────────────────────────────┐
│ Header (Back, Campaign Planner)                                  │
├─────────────────────────────────────────────────────────────────┤
│ CampaignContextBar (collapsed by default)                        │
│   └─ Expand: Context Mode (4 options) + Focus modules (if FOCUSED)│
│      + Campaign Idea / Title + Description + Refine with AI      │
├─────────────────────────────────────────────────────────────────┤
│ ┌──────────────────────────────┬────────────────────────────────┐│
│ │ Left (65%)                   │ Right (35%)                     ││
│ │ CampaignHealthPanel          │ PlannerControlPanel             ││
│ │   (only when campaignId)     │ [Strategy][Structure][Content]  ││
│ │ PlanningCanvas               │                                 ││
│ │ FinalizeSection              │ (drawer when < 1200px)           ││
│ └──────────────────────────────┴────────────────────────────────┘│
├─────────────────────────────────────────────────────────────────┤
│ AI Assistant (persistent bottom strip)                           │
│   h-52 min-h-[200px] max-h-[280px]                              │
└─────────────────────────────────────────────────────────────────┘
```

---

## 5. FINAL UI DESCRIPTION

1. **Campaign Context Bar (collapsed by default):**
   - Single header: "Campaign Context"
   - Expand to see:
     - Context Mode: Full Company / Focused / No Context / Trend Campaign
     - When Focused: EngineContextPanel (company context preview)
     - Campaign Idea / Title input
     - Description textarea
     - Refine with AI button

2. **Main content area:**
   - Left: Campaign health (if editing), Planning canvas (Campaign/Month/Week/Day views), Finalize
   - Right: Strategy / Structure / Content tabs (compact)

3. **Bottom strip:**
   - "AI Assistant" label
   - Chat input + voice + Send
   - Conversation history
   - Always visible, larger than before

4. **Responsive:**
   - < 1200px: Right panel becomes drawer (toggle button)
   - AI Assistant stays at bottom

---

## VALIDATION CHECKLIST

- [x] Context selector updates `company_context_mode`
- [x] Focused mode renders EngineContextPanel
- [x] Trend mode enables `trend_context`, works with `recommendationId` entry
- [x] AI assistant always visible in bottom strip
- [x] Structure / Content / Strategy tabs remain functional
- [x] Drawer behavior preserved; AI strip stays visible
