# Trend Campaign & Blueprint Flow — Full Implementation Audit

Structured audit for moving deterministic AI Chat questions into structured inputs before theme generation.

---

## 1. Trend Campaign Tab Implementation

### 1.1 Component file(s)

| Item | Path |
|------|------|
| Main tab component | `components/recommendations/tabs/TrendCampaignsTab.tsx` |
| Tab types / props | `components/recommendations/tabs/types.ts` (`OpportunityTabProps`, `OpportunityPayloadTREND`) |
| Card component | `components/recommendations/cards/RecommendationBlueprintCard.tsx` |
| Strategic workspace | `components/recommendations/StrategicWorkspacePanel.tsx` |
| Engine context | `components/recommendations/EngineContextPanel.tsx`, `UnifiedContextModeSelector.tsx`, `StrategicAspectSelector.tsx`, `OfferingFacetSelector.tsx`, `StrategicConsole.tsx` |
| Hierarchy (campaign focus) | `lib/campaignTypeHierarchy.ts` (`PRIMARY_OPTIONS`, `PERSONAL_BRAND_SECONDARY_GROUPS`, `buildHierarchicalPayload`) |

Usage: `pages/recommendations.tsx` imports and renders `<TrendCampaignsTab ... />`.

### 1.2 State variables captured before theme generation

All of the following are in `TrendCampaignsTab.tsx` and are read when the user clicks **Generate Strategic Themes** (see `buildStrategicPayload` and `handleRun`).

| State variable | Type | Used in payload |
|----------------|------|------------------|
| `contextMode` | `ContextMode` ('FULL' \| 'FOCUSED' \| 'NONE') | `context_mode` |
| `companyId` | from props | required for run |
| `selectedAspect` | `string \| null` | `selected_aspect` |
| `selectedFacets` | `string[]` | `selected_offerings` |
| `strategicText` | `string` | `strategic_text` |
| `primaryCampaignType` | `PrimaryCampaignTypeId` | via `hierarchicalPayload` |
| `secondaryCampaignTypes` | `SecondaryOptionId[]` | via `hierarchicalPayload` |
| `regionInput` | `string` (comma-separated) | resolved to `regions` (ISO codes) |
| `clusterInputs` | `ClusterInput[] \| undefined` | `cluster_inputs` |
| `focusedModules` | `FocusModule[]` | `focused_modules` (when contextMode === 'FOCUSED') |
| `additionalDirection` | `string` | `additional_direction` |
| `strategicIntents` | from props (legacy) | campaign focus labels derived from primary + secondaries |

Derived for payload:

- `campaignFocusLabels`: from `primaryCampaignType` + `secondaryCampaignTypes` → `strategic_intents`
- `hierarchicalPayload`: `buildHierarchicalPayload(primaryCampaignType, secondaryCampaignTypes)` → `primary_campaign_type`, `secondary_campaign_types`, `context`, `mapped_core_types`
- `companyContext`: from `fetchProfile()` when `contextMode === 'FULL'` (brand_voice, icp, positioning, themes, geography)

### 1.3 API route used to generate strategic theme cards

| Item | Value |
|------|--------|
| Method | POST |
| Path | `/api/recommendations/generate` |
| Handler | `pages/api/recommendations/generate.ts` |
| Backend service | `backend/services/recommendationEngineService.ts` → `generateRecommendations()` |

Theme “cards” are the **enriched `trends_used`** returned by this API. There is no separate “theme card generation” endpoint; cards are built from that response (topic, polished_title, progression_summary, duration_weeks, etc.) in the recommendation pipeline (see § 5).

### 1.4 Request payload sent to the API

**Source:** `TrendCampaignsTab.tsx` lines 989–997 (`handleRun`).

```json
{
  "companyId": "<string, required>",
  "objective": "<string: first mapped_core_type or primaryCampaignType or 'third_party' or 'brand_awareness'>",
  "durationWeeks": 12,
  "regions": ["<ISO2>", ...],
  "strategicPayload": {
    "context_mode": "FULL" | "FOCUSED" | "NONE",
    "company_context": { "brand_voice", "icp", "positioning", "themes", "geography" },
    "selected_offerings": ["<string>"],
    "selected_aspect": "<string | null>",
    "strategic_text": "<string>",
    "strategic_intents": ["<string>"],
    "regions": ["<ISO2>"],
    "cluster_inputs": [{ "problem_domain", "signal_count", "avg_intent_score", "avg_urgency_score", "priority_score" }],
    "focused_modules": ["<string>"],
    "additional_direction": "<string>",
    "primary_campaign_type": "<PrimaryCampaignTypeId>",
    "secondary_campaign_types": ["<SecondaryOptionId>"],
    "context": "business" | "personal" | "third_party",
    "mapped_core_types": ["<string>"]
  }
}
```

**Payload schema (StrategicPayload):**  
Defined in `TrendCampaignsTab.tsx` as `StrategicPayload` (lines 61–77).

### 1.5 Prompt template for generating theme cards

There is **no single LLM prompt** that “generates theme cards.” Strategic theme cards are produced by:

1. **Topic list**  
   From `generateRecommendations()`: external trend APIs + optional manual context, merged and ranked. `strategicPayload` (and company profile) influence context and strategy modifiers, not a direct “write theme cards” prompt.

2. **Card content**  
   - **polished_title:** `backend/services/recommendationPolishService.ts` — deterministic templates, e.g.  
     - `REFRAME_GENERIC`: "How companies fail at {topic} — and what actually works", "The hidden mistake in {topic} that costs teams", "Why {topic} backfires — and the fix"  
     - `REFRAME_OPPORTUNITY`: "Why {topic} fails — and how teams actually gain focus", "The {topic} gap most companies miss", "Underserved opportunity: {topic}"
   - **progression_summary, duration_weeks, primary_recommendations, supporting_recommendations:**  
     From `backend/services/recommendationBlueprintService.ts` (`buildCampaignBlueprint`) and attached to each card in `backend/services/recommendationCardEnrichmentService.ts` (`enrichRecommendationCards`).

So “theme generation” is: Trend tab payload → recommendation engine (signals + ranking + sequence + blueprint + polish + enrichment) → `trends_used` as theme cards. No dedicated theme-card prompt text exists; the only prompt-like content is the polish reframe templates above.

### 1.6 Default values when fields are missing

| Context | Default |
|---------|--------|
| `regions` | Omitted if empty (no default in request). |
| `durationWeeks` | Always **12** in the Trend tab request. |
| `objective` | First `mapped_core_types[0]`, else `primaryCampaignType === 'third_party' ? 'third_party' : primaryCampaignType`, else **'brand_awareness'**. |
| Company context | Empty `{}` when contextMode !== 'FULL' or profile not loaded. |
| `cluster_inputs` / `focused_modules` / `additional_direction` | Omitted if empty/undefined. |

---

## 2. AI Chat (Blueprint Flow) Question Structure

### 2.1 Source of questions and ordering

- **Backend (orchestrator):** `backend/services/campaignAiOrchestrator.ts`  
  - `GATHER_ORDER` (lines 376–424) — used for QA state and “next question”.  
  - Prompt block “REQUIRED INFO TO GATHER (in order…)” (lines 2611–2624) — can list more/different items than `GATHER_ORDER` (e.g. available_content, available_content_allocation).
- **Frontend quick picks:** `components/CampaignAIChat.tsx` — `getQuickPickConfig(question, platformOptions)` maps AI question text to `QuickPickConfig` (keys, options, progressive style, etc.).

### 2.2 Exact ordered list of questions (from GATHER_ORDER)

| # | Key | Question text |
|---|-----|----------------|
| 1 | target_audience | Who will see your content? (e.g. professionals, parents, students, small business owners) |
| 2 | audience_professional_segment | Which group fits best? (e.g. managers, job seekers, founders) |
| 3 | communication_style | How should your posts sound? Pick one or two. |
| 4 | action_expectation | What do you want people to do after reading? |
| 5 | content_depth | Short reads or longer pieces? Pick one. |
| 6 | topic_continuity | One ongoing story, or different topics each time? Pick one. |
| 7 | tentative_start | When do you want to start? Use a date like 2026-08-15. |
| 8 | campaign_types | What's the main goal? (e.g. get known, get leads, grow engagement, promote a product) |
| 9 | content_capacity | (1) How will you create? Pick one: Manual, AI‑assisted, or Full AI. (2) How many pieces per week? (e.g. 2 posts, 1 video). Answer (1) first, then (2). |
| 10 | campaign_duration | How many weeks? (e.g. 6, 12, or 24) |
| 11 | platforms | Where will you post? (e.g. LinkedIn, Instagram, YouTube, X) |
| 12 | platform_content_types | For each platform you selected, which content types will you use? (We'll set how often next, aligned with your capacity.) |
| 13 | platform_content_requests | Set how often you'll share each content type per platform (match or adjust to your capacity). Then choose: same topic across platforms or different? And: publish same day on all platforms, staggered, or let AI decide? |
| 14 | exclusive_campaigns | Anything only for one platform? (e.g. a LinkedIn-only series, or no) |
| 15 | key_messages | What's the one thing you want people to remember? (e.g. one short line) |
| 16 | success_metrics | What would you like to see improve? (e.g. more likes, more sign-ups, more reach) |

Contingent: `platform_content_types`, `platform_content_requests`, `exclusive_campaigns` are contingent on `platforms` (asked after platforms).

### 2.3 Required vs optional (from backend)

**Required** (`REQUIRED_EXECUTION_FIELDS`, campaignAiOrchestrator.ts 426–439):

- target_audience  
- audience_professional_segment  
- communication_style  
- action_expectation  
- content_depth  
- topic_continuity  
- tentative_start  
- content_capacity  
- campaign_duration  
- platforms  
- platform_content_requests  
- exclusive_campaigns  
- key_messages  

**Optional** (`OPTIONAL_EXECUTION_FIELDS`):

- success_metrics  
- campaign_types  

Note: The **prompt** text (lines 2611–2624) also lists: available_content (2), available_content_allocation (3, only if they have content), and a different order. The **QA state** uses `GATHER_ORDER` + `REQUIRED_EXECUTION_FIELDS`; `available_content` / `available_content_allocation` are not in `GATHER_ORDER`.

### 2.4 Conditional branching

- **available_content_allocation:** In the prompt, only ask when user has existing content (contingent on available_content).
- **platform_content_types, platform_content_requests, exclusive_campaigns:** In `GATHER_ORDER`, `contingentOn: 'platforms'` — only asked after platforms.
- **audience_professional_segment:** Frontend quick pick is triggered when the question includes “which professionals” / “mainly speaking” / “which group fits”.

### 2.5 Prompt template used for AI chat (weekly plan)

**System / user payload construction:** `buildPlanningMessages()` in `backend/services/campaignAiOrchestrator.ts` (approx. 2429–2938).

Relevant blocks:

- **prefilledBlock:** “ALREADY KNOWN (from campaign setup — do NOT re-ask these):” + prefilled key-value pairs + strategic themes / recommended topics + optional “PREPLANNING COMPLETE” line.
- **modeHint (generate_plan):** “ONE-BY-ONE QUESTIONING MODE” + prefilledBlock + governance (userConfirmed, answeredKeys, nextQuestion) + planSkeleton rules + **REQUIRED INFO TO GATHER** list (1–12) + **DURATION ASSESSMENT RULE** + **INFER-AND-PROCEED** (key_messages, success_metrics) + **CRITICAL RULES** (no re-ask, duration consistency, validate answer, available_content “no” handling, confirmation override, etc.).

**Exact “REQUIRED INFO TO GATHER” list from prompt (lines 2611–2624):**

1. target_audience  
2. available_content  
3. available_content_allocation (only if they have content)  
4. tentative_start  
5. campaign_types  
6. content_capacity  
7. campaign_duration  
8. platforms  
9. platform_content_requests  
10. exclusive_campaigns  
11. key_messages  
12. success_metrics  

System line when history exists (lines 2918–2924):  
`Ask one question at a time. CRITICAL: When your last message was "Would you like me to create your plan now?" and the user replies "yes", "sure", "ok", "okay" — OUTPUT BEGIN_12WEEK_PLAN IMMEDIATELY. For "Do you have existing content?" — accept "no", "none", "zero", or messages containing "no" (e.g. "X no" = no content). Move to next question. For key_messages/success_metrics: if user says "you define it" or "you make it", infer and proceed. Wrap the plan with BEGIN_12WEEK_PLAN and END_12WEEK_PLAN.`

### 2.6 Schema of data collected during AI chat

- **Stored in:** Conversation history (messages) and, when submitting to plan API, a **merged context** built from:
  - `prefilledPlanning` (campaign/version/snapshot),
  - `collectedPlanningContext` (client),
  - `recommendationContext?.context_payload` (e.g. from recommendation card),
  - and parsed from the last user message / quick picks.
- **Keys** (planning context): All `GATHER_ORDER` keys plus optional keys such as available_content, available_content_allocation, key_messages, success_metrics, tentative_start, campaign_duration, platforms, platform_content_types, platform_content_requests, exclusive_campaigns, campaign_types, target_regions, suggested_formats, theme_or_description, etc.
- **Final object passed to weekly planning:** Built in `CampaignAIChat.tsx` (e.g. merged `recPayload` with prefilled + collected). Sent to plan API as `conversationHistory` + `prefilledPlanning` / `collectedPlanningContext`; server-side `campaignAiOrchestrator` merges prefilled + conversation-derived context into the payload used for plan generation.

---

## 3. Campaign Schema

### 3.1 Campaign table (relevant fields only)

From `pages/api/campaigns/index.ts` (insert payload) and usage across API routes:

| Column | Type / notes |
|--------|----------------------|
| id | UUID |
| name | string |
| description | text |
| user_id | FK |
| start_date | date (nullable) |
| end_date | date (nullable) |
| status | e.g. 'planning' |
| current_stage | e.g. 'planning' |
| virality_playbook_id | nullable |
| duration_weeks | integer, nullable (set later by pre-planning/run-preplanning/update-duration) |
| duration_locked | boolean |
| blueprint_status | nullable; e.g. null, 'ACTIVE', 'INVALIDATED', 'draft' |

Other migrations add: `weekly_themes` (JSONB), `ai_generated_summary` (TEXT), `thread_id`, etc. No columns named `frequency`, `time_slot`, `market`, `depth`, `persona`, or `execution_mode` on `campaigns` in the audited code.

### 3.2 campaign_versions / campaign_snapshot

- **campaign_versions:** e.g. `campaign_snapshot` (JSONB), `context_scope`, `build_mode`, `campaign_types`, `campaign_weights`; in some migrations `market_scope`, `company_stage`, `baseline_override`.
- **campaign_snapshot** holds: `source_strategic_theme`, `source_recommendation_id`, `target_regions`, `context_payload`, `planning_context`, `weekly_plan`, etc.
- **Planning context** (from snapshot or version): can contain `content_capacity`, `context_mode`, `focused_modules`, `additional_direction`; `context_payload` can hold `formats`, `platforms`, etc.

So: **frequency, time slot, market, depth, persona** are not first-class columns on `campaigns`; they can appear inside **campaign_snapshot** or **planning_context** / **context_payload** as part of the blueprint or AI Chat–derived context. **Execution mode** is not on `campaigns`; it appears in `community_ai_playbooks.execution_modes` (JSONB) and in execution/slot logic (e.g. `executionModeInference.ts`, `buildCreatorInstruction.ts`) per slot/content type, not as a single campaign-level DB column.

---

## 4. Target User Classification (AI Chat)

### 4.1 Does AI Chat ask about target persona / audience maturity / tone / authority vs awareness?

**Yes, in wording equivalent to the following:**

- **Target persona / audience:**  
  - “Who will see your content? (e.g. professionals, parents, students, small business owners)” → key `target_audience`.  
  - “Which group fits best? (e.g. managers, job seekers, founders)” → key `audience_professional_segment` (optional/secondary persona slice).  
  - Quick pick options: `['Professionals', 'Entrepreneurs', 'Students', 'SMB owners', 'Parents']` and `['Managers', 'Job seekers', 'Founders', 'Corporate employees']`.

- **Content tone / communication style:**  
  - “How should your posts sound? Pick one or two.” → key `communication_style`.  
  - Options include: Simple & easy, Professional & expert, Friendly & conversational, Bold & opinionated, Deep & thoughtful, Story-driven, Data-driven, Direct & no-fluff, Inspiring & motivational, Witty & playful (with progressive primary/secondary in `CampaignAIChat.tsx`).

- **Authority vs awareness / CTA:**  
  - “What do you want people to do after reading?” → key `action_expectation`.  
  - Primary intents: Awareness, Engagement, Community Building, Lead Generation, Conversion / Sales; with compatible CTA actions per intent (e.g. Awareness: Like/react, Share, Save, Just understand; Lead Gen: Download, Visit website, Join newsletter, DM).

- **Depth:**  
  - “Short reads or longer pieces? Pick one.” → key `content_depth`.  
  - Options: Short & quick, Medium detail, Deep explanation.

There is no explicit “audience maturity” or “authority vs awareness positioning” question label; positioning is implied by **campaign_types** (“What's the main goal? (e.g. get known, get leads, grow engagement, promote a product)”) and **action_expectation** (CTA/intent). So: **persona, tone, depth, and CTA/intent (authority vs awareness)** are all asked in AI Chat; **audience maturity** is not an explicit question.

---

## 5. Theme Engine Dependencies

### 5.1 Does theme generation depend on AI Chat outputs?

**No.**  
Theme (recommendation cards) generation depends only on:

- **Trend Campaign tab:** companyId, objective, durationWeeks (12), regions, **strategicPayload** (context_mode, company_context, selected_offerings, selected_aspect, strategic_text, strategic_intents, regions, cluster_inputs, focused_modules, additional_direction, primary_campaign_type, secondary_campaign_types, context, mapped_core_types).
- **Backend:** `generateRecommendations()` in `recommendationEngineService.ts` (company profile, external APIs, strategy history, etc.). No conversation history or AI Chat answers are passed to `/api/recommendations/generate`.

### 5.2 Does theme generation only use Trend Campaign inputs?

**Yes.**  
Plus company profile and external trend sources used inside `generateRecommendations()`. No AI Chat flow is involved in producing the theme cards.

### 5.3 Dependency chain (concise)

- **Theme cards:**  
  Trend tab (strategicPayload + companyId + regions + objective) → POST `/api/recommendations/generate` → `generateRecommendations()` → signals + ranking + sequence + blueprint + polish + enrichment → `trends_used` (cards). **No AI Chat.**

- **Weekly plan:**  
  User selects a card → “Build Campaign Blueprint” saves `source_strategic_theme` to campaign (and optionally creates/uses campaign).  
  In campaign details, user opens **AI Chat** → answers GATHER_ORDER questions → context (prefilled + collected) + conversation history sent to plan API → `campaignAiOrchestrator` builds plan.  
  **prefilledPlanning** can include `source_strategic_theme` (themes, progression_summary, duration_weeks, etc.) so weekly plan aligns with the card; that comes from the **Trend card**, not from AI Chat. So: **Theme generation → Trend only. Weekly plan → AI Chat + (optionally) stored theme card as prefilled context.**

---

## 6. Duplication Summary (for moving to structured inputs)

These are currently asked in **AI Chat** and are good candidates to move to **structured inputs** on the Trend Campaign (or campaign setup) page:

- **Target persona / audience:** target_audience, audience_professional_segment  
- **Tone:** communication_style  
- **Depth:** content_depth  
- **Frequency / capacity:** content_capacity (how many pieces per week, manual vs AI)  
- **Campaign focus / market:** campaign_types (goal: get known, leads, engagement, product)  
- **Duration:** campaign_duration  
- **Platforms:** platforms  
- **Start date:** tentative_start  

Keeping in **AI Chat** (differentiation / narrative):

- **key_messages** (one thing you want people to remember)  
- **success_metrics** (what to improve) — can stay or become structured  
- **action_expectation** (CTA) — borderline; could be structured or stay chat  
- **topic_continuity** (ongoing story vs different topics)  
- **platform_content_types** / **platform_content_requests** / **exclusive_campaigns** — can stay or become structured  

Theme generation itself does **not** use any of these; it only uses Trend tab `strategicPayload` and company/external data. Moving the listed items to structured inputs will remove duplication and allow a single source of truth for persona, tone, depth, frequency, market, and duration before weekly plan generation.
