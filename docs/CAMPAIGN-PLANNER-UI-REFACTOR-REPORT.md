# Campaign Planner UI Refactor — Implementation Report

**Product:** Omnivyra  
**Module:** Campaign Planner UI Refactor  
**Date:** 2025-03-08  

---

## FILES_CREATED

| file | purpose |
|------|---------|
| `components/planner/CampaignContextBar.tsx` | Collapsible top bar with Campaign Idea/Topic, Pain Point, Audience, Campaign Goal, Campaign Theme, Communication Style, Primary CTA. AI refinement button. Stores values in `idea_spine` and `campaign_brief`. |
| `components/planner/StrategyAssistantPanel.tsx` | Right-side panel with tabs: Campaign Parameters, AI Planning Assistant. Collapse/expand support. |
| `components/planner/CampaignParametersTab.tsx` | Fields: start_date, duration_weeks, platforms, content_types, posting_frequency. On submit calls `/api/campaigns/ai/plan` to generate calendar structure; updates `plan_preview` in planner state. |
| `components/planner/AIPlanningAssistantTab.tsx` | Chat interface with voice input placeholder and conversation history. User prompts call `/api/campaigns/ai/plan`; updates planner state with returned plan. |
| `components/planner/PlanningCanvas.tsx` | Left-side canvas with view switch [Campaign] [Month] [Week] [Day]. Renders activity cards (platform, content type, title/theme). Click action opens ActivityWorkspace when `campaignId` exists. |

---

## FILES_MODIFIED

| file | change_summary |
|------|----------------|
| `pages/campaign-planner.tsx` | Replaced multi-step (idea → strategy → calendar) flow with single-page layout. Top: CampaignContextBar. Body: PlanningCanvas (left) + StrategyAssistantPanel (right). Added Canvas Focus Mode toggle, collapse for right panel. Added FinalizeSection for campaign creation. |
| `components/planner/plannerSessionStore.ts` | Added `CampaignBrief` interface and `campaign_brief` to state. Added `setCampaignBrief`. Persisted and restored `campaign_brief` in localStorage. |
| `components/planner/index.ts` | Exported `CampaignContextBar`, `StrategyAssistantPanel`, `CampaignParametersTab`, `AIPlanningAssistantTab`, `PlanningCanvas`. Exported `CampaignBrief` type. |

---

## LAYOUT_IMPLEMENTATION

| zone | implementation |
|------|----------------|
| **left_panel** | PlanningCanvas: flexible width, view modes Campaign/Month/Week/Day, activity cards with platform, content_type, title. Empty state when no plan. |
| **right_panel** | StrategyAssistantPanel: fixed width 320px, tabs Campaign Parameters and AI Planning Assistant. Collapsible to narrow strip. |
| **context_bar** | CampaignContextBar: full-width collapsible bar at top. Fields for idea, pain point, audience, goal, theme, style, CTA. AI Refine button. |

---

## PLANNER_CANVAS_TEST

| item | status |
|------|--------|
| **view_modes** | Campaign, Month, Week, Day views implemented. Switch buttons render; Campaign shows week cards; Week shows activities per week; Day shows activity cards grid. |
| **calendar_render** | Data sourced from `plannerState.plan_preview.weeks`. Flattens `execution_items` and `daily_execution_items` into activity cards. Fallback to week theme when no items. |

---

## STATE_INTEGRATION_TEST

| item | status |
|------|--------|
| **form_updates_state** | CampaignContextBar: `setIdeaSpine` and `setCampaignBrief` on blur. CampaignParametersTab: `setStrategyContext` on submit; `setPlanPreview` after API success. |
| **chat_updates_state** | AIPlanningAssistantTab: `setPlanPreview` with `{ weeks }` after `/api/campaigns/ai/plan` success. Same state as form path. |

---

## COMPILATION_STATUS

| item | value |
|------|-------|
| **status** | Pending (build lock prevented full run) |
| **errors** | None reported by linter on `components/planner` and `pages/campaign-planner.tsx` |
| **warnings** | None |

---

## CONSTRAINTS OBSERVED

- **No backend changes:** strategyContextService, AI planning services, planning core services, database schema, BOLT pipeline — unchanged.
- **UI-only refactor:** Layout, components, and wiring only. Existing APIs reused: `/api/campaigns/ai/plan`, `/api/campaigns/planner-finalize`, `/api/campaign-planner/refine-idea`.

---

## ACTIVITY WORKSPACE INTEGRATION

- **With campaignId:** Click on activity card builds workspace payload, stores in `sessionStorage`, opens `/activity-workspace?workspaceKey=...` in new tab. Resolve API can load payload when needed.
- **Without campaignId (preview):** Shows alert: "Finalize your campaign to open the Activity Workspace."
