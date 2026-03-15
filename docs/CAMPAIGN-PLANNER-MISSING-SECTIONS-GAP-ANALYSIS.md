# Campaign Planner — Missing Sections Gap Analysis

**Date:** 2025-03-12  
**Purpose:** Document sections the user believes are missing from the campaign planner page, compare with Trend Campaigns / existing flows, and outline what would need to be added.

---

## Current Campaign Planner Layout

```
Campaign Planner Page
├── CampaignContextBar (collapsible)
│   ├── Campaign Idea / Title
│   ├── Target Audience
│   ├── Description
│   ├── Campaign Goal
│   ├── Campaign Direction (from Refine with AI)
│   └── Refine with AI
├── PlanningCanvas
│   ├── Campaign Structure (weekly phases)
│   └── Generate Preview
├── FinalizeSection
│   ├── Create Campaign
│   └── Finalize Campaign Plan
└── StrategyAssistantPanel (right)
    ├── Parameters tab (start date, duration, platforms, content types, posting frequency)
    ├── AI Assistant tab (text + voice input)
    └── Opportunity Insights tab
```

---

## What Exists (Passed to Backend but Not in UI)

The planner session store and API already accept (with defaults):

- `company_context_mode`: `'full_company_context' | 'minimal' | 'none'` (docs mention `'focused_context'`, `'trend_campaign'` but store type differs)
- `focus_modules`: string[] (e.g. Target Customer, Offerings, Geography)

These are sent to `/api/campaigns/ai/plan` but **no UI exists** on the campaign planner to set them. They always default to `full_company_context` and `[]`.

---

## Missing Sections (Per User Feedback)

### 1. Company Context Mode Selector

**Desired options:**

- **Full Company Context** — Use full company profile for planning
- **Focused Context** — Use only selected focus modules
- **No Company Context / Trend Campaign** — Plan without company context or trend-driven
- **Trend Campaign** — Add trend_topic, trend_source, trend_signal_strength when selected

**Reference:** `UnifiedContextModeSelector` (TrendCampaignsTab) + `docs/CAMPAIGN-PLANNER-CONTEXT-MODE-REPORT.md`.

---

### 2. Focus Modules (When Focused Context)

**Desired checkboxes when Focused Context is selected:**

- Target Customer
- Problem Domains
- Campaign Purpose
- Offerings
- Geography
- Pricing

**Reference:** `UnifiedContextModeSelector` FOCUS_MODULES.

---

### 3. Strategic Aspect Selector

**Desired:** Dropdown or selector for company strategic aspects (e.g. "Personal Clarity & Mental Peace", "Professional Growth", etc.). Loaded from `GET /api/company-profile` → `strategic_inputs.strategic_aspects` or `strategic_intelligence.strategic_aspects`.

**Reference:** `StrategicAspectSelector` on TrendCampaignsTab.

---

### 4. Offerings Selector

**Desired:** After selecting a strategic aspect, show offerings for that aspect. Loaded from `offerings_by_aspect[selectedAspect]` in company profile / strategic config.

**Reference:** `OfferingFacetSelector` on TrendCampaignsTab.

---

### 5. Campaign Type (Lead Gen, Brand Awareness, etc.)

**Desired:** Primary campaign type selector:

- Brand Awareness
- Authority Positioning
- Network Expansion
- Engagement Growth
- Lead Generation
- Product Promotion
- Personal Brand Promotion
- Third-Party Campaign

**Reference:** `lib/campaignTypeHierarchy.ts` `PRIMARY_OPTIONS` — used on TrendCampaignsTab.

---

### 6. Strategic Theme Card Builder Options

**Desired:** Mode to build strategic theme card:

- **Full AI** — LLM-only
- **Hybrid** — Combine API + LLM (default on Trend)
- **Trend API** — External APIs only

**Reference:** `insightSource` / `insight_source` on TrendCampaignsTab (`'hybrid' | 'api' | 'llm'`), `recommendationEngineService` input.

---

### 7. Extended Description for Strategic Context

**Desired:** Optional rich description that can include:

- Strategic intents
- Additional direction
- Context to feed strategic theme generation

**Reference:** `strategic_text`, `additional_direction`, `strategic_intents` in StrategicPayload.

---

### 8. Flow: Structure → Week Plan → Daily Plan → AI Refinement

**Desired flow:**
1. User creates campaign structure (phases)
2. Use all above context to create **detailed week plan**
3. Generate **daily plan** from week plan
4. Refine further via **AI chat (voice or text)** to adjust structure, weeks, or days

**Current:** Generate Preview produces campaign_structure + calendar_plan in one step. No separate “week plan” and “daily plan” steps. AI Assistant can regenerate plan but doesn’t drive a staged week → day flow.

---

## Recommended Implementation Approach

| Section             | Component to Reuse / Create                                  | Effort |
|--------------------|--------------------------------------------------------------|--------|
| Company context mode | Add `UnifiedContextModeSelector` to CampaignContextBar       | Medium |
| Focus modules      | Already in UnifiedContextModeSelector                         | Low    |
| Trend Campaign     | Extend selector + add trend_topic, trend_source, trend_signal  | Medium |
| Strategic aspect   | Add `StrategicAspectSelector` (needs companyId → profile)      | Medium |
| Offerings          | Add `OfferingFacetSelector` (after aspect selected)           | Medium |
| Campaign type      | Add primary type selector (PRIMARY_OPTIONS)                    | Low    |
| Theme builder mode | Add insight_source: full AI / hybrid / trend API selector     | Low    |
| Extended description | Enlarge description textarea, link to strategic_text         | Low    |
| Week → daily flow  | Split generate into week plan step, then daily plan step       | High   |

---

## Backend Readiness

- `company_context_mode`, `focus_modules` — already accepted by `/api/campaigns/ai/plan` and `campaignIntelligenceService`.
- `primary_campaign_type`, `selected_offerings`, `selected_aspect` — used by recommendation engine; campaign planner would need to pass them in the plan request.
- Strategic config (aspects, offerings) — available from `GET /api/company-profile` when companyId is set.

---

## Files to Modify (If Implemented)

| File                                   | Change                                                  |
|----------------------------------------|---------------------------------------------------------|
| `components/planner/CampaignContextBar.tsx` | Add context mode, focus modules, trend fields, strategic aspect, offerings, campaign type, theme mode |
| `components/planner/plannerSessionStore.ts` | Extend CampaignDesign with trend_context, primary_campaign_type, selected_offerings, selected_aspect, insight_source |
| `pages/api/campaigns/ai/plan.ts`       | Accept new fields from request body                      |
| `backend/types/campaignPlanning.ts`    | Add types for new planning inputs                        |
| `components/planner/AIPlanningAssistantTab.tsx` | Pass new fields in plan request                    |
| `components/planner/CampaignParametersTab.tsx` | Pass new fields in plan request                    |
| `components/planner/FinalizeSection.tsx` | Pass new fields to planner-finalize                    |

---

## Next Step

Do you want to proceed with implementing these missing sections? Suggested order:

1. **Phase 1:** Company context mode + focus modules + campaign type (quick wins)
2. **Phase 2:** Strategic aspect + offerings (needs company profile fetch)
3. **Phase 3:** Trend Campaign mode + theme builder mode (insight_source)
4. **Phase 4:** Week plan → daily plan staged flow (larger change)

Please confirm which phases (if any) you want implemented before edits are made.
