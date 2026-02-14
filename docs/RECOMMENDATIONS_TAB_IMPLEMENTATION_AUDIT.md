# Recommendations Tab Implementation Audit

**Scope:** pages/recommendations.tsx, components/recommendations/*, components/opportunities/*, pages/api/opportunities/*, backend/services/opportunity*, shared components used by tabs.

**Date:** Audit only; no code modified.

---

## SECTION 1 — TAB STRUCTURE

### 1. Trend Campaigns (type=TREND)

| # | Question | Answer |
|---|----------|--------|
| 1 | Which React component renders the tab? | `TrendCampaignsTab` (components/recommendations/tabs/TrendCampaignsTab.tsx) |
| 2 | Unique UI or shared component? | **Unique UI.** Renders inline `TrendCard` component; does not use shared OpportunityGrid or OpportunityCard. |
| 3 | Layout | **Grid:** `grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4` |
| 4 | Props passed | `companyId`, `regions` (optional), `onPromote`, `onAction`, `fetchWithAuth` |
| 5 | Local vs shared state | **Local (hook):** opportunities, activeCount, loading, error from `useOpportunities`. **Shared (page):** companyId, opportunityRegions (parsed as regions), fetchWithAuth, promote/action handlers. |
| 6 | API endpoints | **Shared:** GET `/api/opportunities?companyId=&type=TREND`; POST `/api/opportunities` (body: companyId, type, optional regions) for refill; POST `/api/opportunities/[id]/action` for actions. |
| 7 | Payload fields used | `formats` (array), `reach_estimate` (number/string). Core: title, summary. |
| 8 | Tab-specific actions? | **Yes:** "Promote to Campaign", "Save as Possibility" (→ REVIEWED), "Dismiss" (→ DISMISSED). Save as Possibility is TREND-only. |
| 9 | What happens when Promote is clicked? | `handleOpportunityPromote(opportunityId)` → POST `/api/opportunities/[id]/action` with `action: 'PROMOTED'`, then redirect to `/campaigns/[campaignId]`. Backend creates new DRAFT campaign. |
| 10 | Unique filters? | **No.** Uses shared Company + Region selector from page; regions passed into hook for refill POST. |

---

### 2. Active Leads (type=LEAD)

| # | Question | Answer |
|---|----------|--------|
| 1 | Which React component renders the tab? | `ActiveLeadsTab` (components/recommendations/tabs/ActiveLeadsTab.tsx) |
| 2 | Unique UI or shared component? | **Unique UI.** Renders inline `LeadRow` (table row); no shared grid/card. |
| 3 | Layout | **Table:** `<table>` with columns Platform, Public snippet, Problem domain, ICP match, Urgency, Actions. |
| 4 | Props passed | `companyId`, `onPromote`, `onAction`, `fetchWithAuth` (no regions) |
| 5 | Local vs shared state | Same pattern: useOpportunities state local; companyId and handlers from page. |
| 6 | API endpoints | Same GET/POST /api/opportunities (type=LEAD); POST /api/opportunities/[id]/action for actions. |
| 7 | Payload fields used | `platform`, `snippet`, `icp_match`, `urgency_score`. Core: summary, problem_domain. |
| 8 | Tab-specific actions? | **Yes:** "Create Outreach Plan" (placeholder alert), "Promote to Campaign", "Dismiss". Create Outreach Plan is LEAD-only (non-campaign artifact; not implemented). |
| 9 | Promote click | Same as all tabs: action API PROMOTED → new DRAFT campaign → redirect `/campaigns/[campaignId]`. |
| 10 | Unique filters? | **No.** No regions passed to this tab. |

---

### 3. Market Pulse (type=PULSE)

| # | Question | Answer |
|---|----------|--------|
| 1 | Which React component renders the tab? | `MarketPulseTab` (components/recommendations/tabs/MarketPulseTab.tsx) |
| 2 | Unique UI or shared component? | **Unique UI.** Renders inline `PulseRow` with rank badge; no shared grid/card. |
| 3 | Layout | **Ranked list:** `space-y-0` list of rows; each row has index badge (1, 2, 3…), topic, spike reason, shelf life, action buttons. |
| 4 | Props passed | `companyId`, `regions` (optional), `onPromote`, `onAction`, `fetchWithAuth` |
| 5 | Local vs shared state | useOpportunities (with getRegions for regions); page supplies companyId, regions, handlers. |
| 6 | API endpoints | Same GET/POST /api/opportunities (type=PULSE); action API for actions. |
| 7 | Payload fields used | `spike_reason`, `shelf_life_hours`. Core: title, summary. |
| 8 | Tab-specific actions? | **Yes:** "Generate Quick Content Draft" (placeholder alert), "Promote to Campaign", "Archive" (→ ARCHIVED). |
| 9 | Promote click | Same: PROMOTED → new campaign → redirect. |
| 10 | Unique filters? | **No.** Uses shared Company + Region selector; regions passed to hook. |

---

### 4. Seasonal & Regional (type=SEASONAL)

| # | Question | Answer |
|---|----------|--------|
| 1 | Which React component renders the tab? | `SeasonalRegionalTab` (components/recommendations/tabs/SeasonalRegionalTab.tsx) |
| 2 | Unique UI or shared component? | **Unique UI.** Renders inline `EventCard` (event name, region, date, suggested angle, suggested offer, schedule/create/dismiss). |
| 3 | Layout | **Grid of cards:** `grid grid-cols-1 md:grid-cols-2 gap-4`. Not a calendar; event cards only. |
| 4 | Props passed | `companyId`, `regions`, `onPromote`, `onAction`, `fetchWithAuth` |
| 5 | Local vs shared state | useOpportunities with getRegions(regions); page supplies companyId, regions, handlers. |
| 6 | API endpoints | Same GET/POST /api/opportunities (type=SEASONAL, regions in POST); action API with optional `scheduled_for` for SCHEDULED. |
| 7 | Payload fields used | `event_date`, `suggested_offer`. Core: title, summary, region_tags[0]. |
| 8 | Tab-specific actions? | **Yes:** "Schedule Campaign for Event" (→ SCHEDULED with event_date or user date), "Create Campaign Now" (→ Promote), "Dismiss". Only tab with SCHEDULED + date. |
| 9 | Promote click | Same: PROMOTED → new campaign → redirect. "Create Campaign Now" uses same promote flow. |
| 10 | Unique filters? | **No.** Uses shared Company + Region selector; regions passed to generator. |

---

### 5. Influencers (type=INFLUENCER)

| # | Question | Answer |
|---|----------|--------|
| 1 | Which React component renders the tab? | `InfluencersTab` (components/recommendations/tabs/InfluencersTab.tsx) |
| 2 | Unique UI or shared component? | **Unique UI.** Renders inline `InfluencerCard`; list grouped by platform via useMemo(byPlatform). |
| 3 | Layout | **Grouped list:** Sections per platform; each section has `h4` (platform name) and a grid of cards (1 col md:2). |
| 4 | Props passed | `companyId`, `onPromote`, `onAction`, `fetchWithAuth` (no regions) |
| 5 | Local vs shared state | useOpportunities; local derived state `byPlatform` from opportunities. |
| 6 | API endpoints | Same GET/POST /api/opportunities (type=INFLUENCER); action API. |
| 7 | Payload fields used | `platform`, `audience_overlap_score`, `engagement_rate`. Core: title. |
| 8 | Tab-specific actions? | **Yes:** "Create Collaboration Plan" (placeholder alert), "Promote to Campaign", "Dismiss". Collaboration plan is INFLUENCER-only (non-campaign; not implemented). |
| 9 | Promote click | Same: PROMOTED → new campaign → redirect. |
| 10 | Unique filters? | **No.** No regions passed to this tab. |

---

### 6. Daily Focus (type=DAILY_FOCUS)

| # | Question | Answer |
|---|----------|--------|
| 1 | Which React component renders the tab? | `DailyFocusTab` (components/recommendations/tabs/DailyFocusTab.tsx) |
| 2 | Unique UI or shared component? | **Unique UI.** Renders inline `DailyItem` (headline, why today, expected impact; Act Now / Promote / Mark Reviewed). |
| 3 | Layout | **Compact list:** `space-y-0` list, max 10 items (`displayList = opportunities.slice(0, MAX_ITEMS)`). |
| 4 | Props passed | `companyId`, `onPromote`, `onAction`, `fetchWithAuth`, `onSwitchTab`, `onOpenGenerator` (Daily-only). |
| 5 | Local vs shared state | useOpportunities; page supplies setActiveOpportunityTab as onSwitchTab and setGeneratorModalTarget as onOpenGenerator. |
| 6 | API endpoints | Same GET/POST /api/opportunities (type=DAILY_FOCUS); action API for PROMOTED and REVIEWED. |
| 7 | Payload fields used | `action_type`, `target_type`; optional `why_today`, `expected_impact`. Core: title, summary. |
| 8 | Tab-specific actions? | **Yes:** "Act Now" (branches on action_type: OPEN_TAB → switch tab, CREATE_CAMPAIGN → promote, OPEN_GENERATOR → open modal), "Promote to Campaign", "Mark Reviewed" (→ REVIEWED). |
| 9 | Promote click | Same: PROMOTED → new campaign → redirect. Act Now with CREATE_CAMPAIGN also calls onPromote. |
| 10 | Unique filters? | **No.** No regions passed. |

---

## SECTION 2 — SHARED LOGIC ANALYSIS

### Shared components used across all tabs

- **useOpportunities** (components/recommendations/tabs/useOpportunities.ts): Used by all six tabs. Fetches GET `/api/opportunities?companyId=&type=<TYPE>`, stores opportunities + activeCount + loading + error, and if activeCount < 10 calls POST `/api/opportunities` with companyId, type, optional regions, then refetches. Returns refetch for use after actions.
- **payloadHelpers** (components/recommendations/tabs/types.ts): Shared helpers to read type-specific payload fields (formats, reachEstimate, platform, snippet, icpMatch, urgencyScore, spikeReason, shelfLifeHours, eventDate, suggestedOffer, audienceOverlapScore, engagementRate, actionType, targetType, whyToday, expectedImpact). Each tab uses a subset.
- **OpportunityTabProps** (types.ts): Shared prop type (companyId, regions?, onPromote, onAction, fetchWithAuth, onSwitchTab?, onOpenGenerator?). All tabs receive the same callbacks from the page.

### Shared opportunity grid or card

- **OpportunityGrid** (components/recommendations/tabs/OpportunityGrid.tsx) and **OpportunityCard** (components/OpportunityCard.tsx): **Present but not used by any of the six tabs.** Each tab implements its own card/row component (TrendCard, LeadRow, PulseRow, EventCard, InfluencerCard, DailyItem). So there is no shared grid/card in the current tab UI.

### Shared slot counter logic

- **Same in every tab:** A header row with description on the left and `{activeCount} / 10 Active` on the right (top-right of tab content). activeCount comes from useOpportunities. No separate shared component; each tab repeats the same JSX pattern.

### Shared refill logic

- **Centralized in useOpportunities:** After GET, if `count < 10`, POST to `/api/opportunities` with companyId, type, and (when options.getRegions provided) regions. Then GET again and update state. Tabs that pass regions (TREND, PULSE, SEASONAL) send regions on refill; LEAD, INFLUENCER, DAILY_FOCUS do not.

### Shared API mapping

- **Single endpoint pattern:** All tabs use the same GET (with type parameter) and same POST (with type + optional regions). Action endpoint is shared: POST `/api/opportunities/[id]/action` with action (PROMOTED, REVIEWED, SCHEDULED, ARCHIVED, DISMISSED). Response shape is the same (opportunities array + activeCount); UI differentiates by payload and layout only.

### Is the UI truly differentiated per tab or just filtered by type?

- **Differentiated.** Each tab has a **different layout** (grid of cards vs table vs ranked list vs event cards vs grouped-by-platform vs compact list) and **different item component** (TrendCard, LeadRow, PulseRow, EventCard, InfluencerCard, DailyItem). Each uses a **different subset of payload and core fields** and exposes **different actions** (e.g. Save as Possibility, Create Outreach Plan, Generate Quick Content Draft, Schedule for Event, Create Collaboration Plan, Act Now / Mark Reviewed). So the UI is not “one grid filtered by type”; it is six distinct UIs that share the same data fetching hook and API.

---

## SECTION 3 — API FLOW PER TAB

| Tab | On load | On action | Generator mapped | Generator actually different? | Data returned |
|-----|---------|-----------|-------------------|-------------------------------|---------------|
| TREND | GET /api/opportunities?companyId=&type=TREND. If count<10: POST /api/opportunities { companyId, type, regions? }. | POST /api/opportunities/[id]/action { action: PROMOTED \| REVIEWED \| DISMISSED }. | getGenerator(companyId, 'TREND', { regions }) → generateTrendOpportunities(companyId, regions) | **No.** Stub returns []. | opportunities (ACTIVE only), activeCount. |
| LEAD | GET with type=LEAD. If count<10: POST (no regions). | action: PROMOTED \| DISMISSED. | getGenerator(companyId, 'LEAD') → generateLeadOpportunities(companyId) | **No.** Stub returns []. | Same. |
| PULSE | GET type=PULSE. If count<10: POST with regions?. | action: PROMOTED \| ARCHIVED. | getGenerator(companyId, 'PULSE', { regions }) → generatePulseOpportunities(companyId, regions) | **No.** Stub returns []. | Same. |
| SEASONAL | GET type=SEASONAL. If count<10: POST with regions. | action: PROMOTED \| SCHEDULED { scheduled_for } \| DISMISSED. | getGenerator(companyId, 'SEASONAL', { regions }) → generateSeasonalOpportunities(companyId, regions) | **No.** Stub returns []. | Same. |
| INFLUENCER | GET type=INFLUENCER. If count<10: POST (no regions). | action: PROMOTED \| DISMISSED. | getGenerator(companyId, 'INFLUENCER') → generateInfluencerOpportunities(companyId) | **No.** Stub returns []. | Same. |
| DAILY_FOCUS | GET type=DAILY_FOCUS. If count<10: POST (no regions). | action: PROMOTED \| REVIEWED; Act Now uses onPromote / onSwitchTab / onOpenGenerator. | getGenerator(companyId, 'DAILY_FOCUS') → generateDailyFocusOpportunities(companyId) | **No.** Stub returns []. | Same. |

**Note:** After a closing action (SCHEDULED, ARCHIVED, DISMISSED), the action API calls `fillOpportunitySlots(..., getGenerator(..., type))` **without** passing regions. So refill triggered by an action does not use the shared region filter; only the initial refill from the tab (useOpportunities) sends regions for TREND, PULSE, SEASONAL.

---

## SECTION 4 — FUNCTIONAL DIFFERENCE MATRIX

| Tab | Unique Layout? | Unique Actions? | Unique Generator? | Unique Filters? | Unique Payload Structure? |
|-----|----------------|-----------------|-------------------|-----------------|----------------------------|
| Trend Campaigns | YES (grid of topic cards) | YES (Save as Possibility, Dismiss, Promote) | NO (stub) | NO | YES (formats, reach_estimate) |
| Active Leads | YES (table) | YES (Create Outreach Plan, Promote, Dismiss) | NO (stub) | NO | YES (platform, snippet, icp_match, urgency_score) |
| Market Pulse | YES (ranked list + spike) | YES (Quick Draft, Promote, Archive) | NO (stub) | NO | YES (spike_reason, shelf_life_hours) |
| Seasonal & Regional | YES (event cards grid) | YES (Schedule for Event, Create Now, Dismiss) | NO (stub) | NO | YES (event_date, suggested_offer) |
| Influencers | YES (grouped by platform) | YES (Collaboration Plan, Promote, Dismiss) | NO (stub) | NO | YES (platform, audience_overlap_score, engagement_rate) |
| Daily Focus | YES (compact list, cap 10) | YES (Act Now, Promote, Mark Reviewed) | NO (stub) | NO | YES (action_type, target_type; why_today, expected_impact) |

---

## SECTION 5 — REDUNDANCIES & GAPS

### Duplicated UI

- **Slot counter:** Same “{activeCount} / 10 Active” + description row repeated in all six tabs (same structure, different copy).
- **Loading/error/empty states:** Same pattern in each tab (no company → message; loading → “Loading …”; error → red text; empty → “No …” message).
- **Button styling and “run” pattern:** Each tab has its own card/row component with local `busy` state and a `run(async fn)` helper that sets busy, calls fn, calls onActionComplete, clears busy. Logic is duplicated, not shared.

### Tab rendering identical structure

- **No.** No two tabs share the same layout or the same item component. TREND/SEASONAL/INFLUENCER all use a grid of cards but with different card content and actions.

### Unused props

- **OpportunityGrid / OpportunityCard:** Not used by any tab. Could be removed or reserved for a future “generic” view.
- **regions:** Not passed to LEAD, INFLUENCER, or DAILY_FOCUS; only TREND, PULSE, SEASONAL receive it. Intentional.
- **onSwitchTab / onOpenGenerator:** Only DailyFocusTab receives them; other tabs do not use these props.

### Endpoints not used

- **POST /api/opportunities/[id]/promote:** The page uses `/api/opportunities/[id]/action` with `action: 'PROMOTED'` for promotion. The standalone promote endpoint exists but is not called by the current tab UI.

### Payload fields not consumed by UI

- **Core fields:** conversion_score, first_seen_at, last_seen_at, status, scheduled_for are returned by the API but not displayed in any tab (except Seasonal uses event_date from payload and core region_tags/summary/title).
- **DAILY_FOCUS:** why_today and expected_impact are optional payload fields; types define them and UI shows fallback to summary/empty if missing. Fully consumed when present.

### Functionality implied but not implemented

- **Create Outreach Plan (LEAD):** Opens alert “Outreach plan creation will open here. Not yet implemented.” Non-campaign artifact; table `outreach_plans` and POST /api/outreach-plans exist but are not wired from this button.
- **Generate Quick Content Draft (PULSE):** Alert only; no generator modal or API called.
- **Create Collaboration Plan (INFLUENCER):** Alert only; table `collaboration_plans` and POST /api/collaboration-plans exist but are not wired from this button.
- **Quick-content generator modal (Daily Focus OPEN_GENERATOR):** Modal opens with target type label; body says “Integrate your existing quick-content generator here.” No actual generator UI wired.
- **All generators:** generateTrendOpportunities, generateLeadOpportunities, generatePulseOpportunities, generateSeasonalOpportunities, generateInfluencerOpportunities, generateDailyFocusOpportunities all return [] (stubs). No real data source per type.

---

## SECTION 6 — CAMPAIGN INTEGRATION

| Tab | Campaign creation differs? | Scheduling differs? | Non-campaign artifacts? | Chat capability triggered differently? |
|-----|----------------------------|---------------------|--------------------------|----------------------------------------|
| Trend Campaigns | **No.** Promote → same action API → new DRAFT campaign → redirect /campaigns/[id]. | **No.** No scheduling in this tab. | **No.** “Save as Possibility” only sets REVIEWED (slot stays ACTIVE). | **No.** No chat in tab. |
| Active Leads | **No.** Same promote flow. | **No.** No scheduling. | **Yes (intended).** “Create Outreach Plan” should create outreach_plans row; not wired. | **No.** |
| Market Pulse | **No.** Same promote flow. | **No.** No scheduling. | **No.** “Generate Quick Content Draft” is placeholder only. | **No.** |
| Seasonal & Regional | **No.** Same promote flow for “Create Campaign Now.” | **Yes.** Only tab with “Schedule Campaign for Event”: sends SCHEDULED with scheduled_for (event_date or user date); closes slot and refills; no campaign created until later. | **No.** | **No.** |
| Influencers | **No.** Same promote flow. | **No.** No scheduling. | **Yes (intended).** “Create Collaboration Plan” should create collaboration_plans row; not wired. | **No.** |
| Daily Focus | **No.** Act Now with CREATE_CAMPAIGN or default calls same onPromote. | **No.** No scheduling in tab. | **No.** Act Now OPEN_TAB/OPEN_GENERATOR are navigation/modal, not artifacts. | **No.** |

**Summary:** Campaign creation is the same for all tabs (PROMOTED → promoteToCampaign → new DRAFT → redirect). Scheduling is only implemented in Seasonal (SCHEDULED + scheduled_for). Non-campaign artifacts (outreach_plans, collaboration_plans) exist as APIs/tables but are not triggered from the tab buttons. Chat is not tied to opportunity tabs.

---

## SECTION 7 — SUMMARY

### Are these six tabs functionally distinct?

- **Yes, in UI and intended behavior.** Layouts differ (grid vs table vs ranked list vs event cards vs grouped list vs compact list). Actions differ (Save as Possibility, Create Outreach Plan, Quick Draft, Schedule for Event, Create Collaboration Plan, Act Now / Mark Reviewed). Payload usage differs per type. Scheduling and “act now” routing exist only where specified (Seasonal, Daily Focus).

### Or are they currently just filtered views?

- **No.** They are not a single view filtered by type. Each tab has its own component, own item UI, and own action set. The same API (GET by type) and same refill/promote/action endpoints are shared, but the presentation and actions are differentiated.

### What percentage of code is shared?

- **Rough estimate:**  
  - **Shared:** useOpportunities (~70 lines), types.ts payload types and payloadHelpers (~100 lines), page-level handlers and shared filters (~50 lines), API routes and backend opportunityService/opportunityGenerators (shared by type parameter).  
  - **Per-tab unique:** Each tab file is ~80–170 lines (component + inline card/row).  
  - Overall, roughly **40–50%** of tab-related code is shared (hook, types, API, page wiring); the rest is per-tab UI and action wiring.

### What needs structural redesign?

- **Generators:** All six generators are stubs. To make tabs meaningfully different by data, each generator needs a real source (trends API, leads CRM, pulse/detected-opportunities, seasonal calendar, influencer discovery, daily priorities).
- **Non-campaign actions:** Wire “Create Outreach Plan” to POST /api/outreach-plans and “Create Collaboration Plan” to POST /api/collaboration-plans (and optionally navigate or show success). Replace “Generate Quick Content Draft” placeholder with a real flow or modal.
- **Quick-content generator:** Replace the placeholder modal for OPEN_GENERATOR with the actual generator UI when it exists.
- **Refill after action:** The action API refill (after SCHEDULED/ARCHIVED/DISMISSED) does not pass regions into getGenerator; if region-scoped refill is desired after actions, the API would need to accept and forward regions (e.g. from request body or context).
- **Optional:** Reduce duplication of slot counter and loading/error/empty patterns by extracting a small shared “TabShell” or “OpportunityTabLayout” that takes description, activeCount, children, and optional empty message.
- **Optional:** Use or remove OpportunityGrid and OpportunityCard; currently dead code for the six tabs.

---

*End of audit.*
