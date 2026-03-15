# CAMPAIGN FLOW AUDIT REPORT

**Date:** March 12, 2025  
**Scope:** Campaign Creation + Campaign AI Assistant flow  
**Type:** Technical audit — no implementation changes

---

## 1. FLOW ENTRY ANALYSIS

### How data moves from Recommended Hub → Wizard

**Recommended Hub** is implemented in `components/recommendations/tabs/TrendCampaignsTab.tsx`. Users:

1. Select company contacts
2. Configure execution inputs (audience, frequency, duration, goal, style) in the Execution bar
3. Click **Generate Strategic Themes** → creates campaign via `POST /api/campaigns` and sets `generatedCampaignId`
4. Select a **Strategic Theme Card**
5. Click **Build Campaign Blueprint**

**Two distinct paths:**

| Path | Condition | Action | Where user lands |
|------|-----------|--------|------------------|
| **A** | `generatedCampaignId` exists (campaign pre-created at theme generation) | `PUT /api/campaigns/[id]/source-recommendation` with `source_strategic_theme`, `execution_config` | `router.push('/campaign-details/[id]?companyId=&fromRecommendation=1&recommendationId=')` |
| **B** | No `generatedCampaignId` | No API call; `router.push('/campaign-planner?companyId=&recommendationId=')` | Campaign Planner page |

### Data passed

**Path A (campaign-details):**

- **URL:** `companyId`, `fromRecommendation`, `recommendationId`
- **DB (before wizard opens):**
  - `campaigns` row exists
  - `campaign_versions.campaign_snapshot` contains `source_strategic_theme`, `source_recommendation_id`, `execution_config`
- **On load:** `loadCampaignDetails(id)` fetches `GET /api/campaigns?type=campaign&campaignId=&companyId=`
- **API response:** `prefilledPlanning` built from `campaign_versions.campaign_snapshot` (execution_config, content_capacity, platforms, target_regions, theme_or_description, etc.)
- **recommendationContext:** from `source_strategic_theme`, `context_payload`, `target_regions`

**Path B (campaign-planner):**

- **URL:** `companyId`, `recommendationId` (no campaign yet)
- **DB:** No campaign row before planner opens
- **State:** `PlannerSessionProvider` + `plannerSessionStore` (React Context + localStorage)
- **Strategic themes:** Fetched from `GET /api/planner/strategic-themes?companyId=&recommendationId=`

### Whether campaign exists before wizard opens

- **Path A:** Yes. Campaign and `campaign_versions` snapshot exist before user sees campaign-details.
- **Path B:** No. User lands on campaign-planner without a campaign; campaign is created only when they click **Finalize Campaign Plan** via `POST /api/campaigns/planner-finalize`.

---

## 2. STATE MANAGEMENT ANALYSIS

### Current state architecture

**campaign-details (Campaign AI Assistant / Pre-planning wizard):**

- **React `useState`:** `campaign`, `prePlanningWizardStep`, `questionnaireAnswers`, `prePlanningResult`, `prefilledPlanning`, `plannedStartDate`, `showAIChat`, etc.
- **Context:** `useCompanyContext` for `selectedCompanyId`
- **No Zustand, Redux, or URL state** for wizard steps or form values
- **CampaignAIChat:** `sessionStorage` used for chat messages (`getChatStorageKey(campaignId)`)

**campaign-planner:**

- **PlannerSessionProvider / plannerSessionStore:** React Context + `localStorage`
- **Key:** `omnivyra_planner_session_${companyId}`
- **TTL:** 24 hours
- **Persisted:** idea_spine, campaign_brief, strategy_context, campaign_structure, calendar_plan, campaign_name, strategic_themes, company_context_mode, focus_modules
- **Persistence:** Debounced write to localStorage on every state change

### Weaknesses

1. **campaign-details wizard state is not persisted**
   - `prePlanningWizardStep`, `questionnaireAnswers` live only in React state
   - Page refresh or navigation away loses all wizard progress
   - No localStorage or DB backup for the pre-planning form

2. **Disconnect between campaign-details and campaign-planner**
   - Path A goes to campaign-details; Path B goes to campaign-planner
   - Different UIs, different state stores, no shared “wizard” abstraction

3. **prefilledPlanning is loaded once**
   - Comes from API on `loadCampaignDetails`; not kept in sync if user changes values in AI chat or form
   - `collectedPlanningContext` in AI chat is merged with prefilledPlanning but not written back until plan generation

4. **No draft autosave for campaign-details form**
   - Only `twelve_week_plan` (status=draft) is saved when user uses “Save for Later” with a structured plan
   - Pre-planning questionnaire and wizard step are never saved

---

## 3. NAVIGATION PERSISTENCE

### Back navigation

**campaign-details pre-planning wizard (steps 1–6):**

- Back/Next buttons use `setPrePlanningWizardStep(n)`; state survives as long as the component is mounted
- Back/Next work correctly within a single session

**campaign-planner:**

- Back/Next navigation within the planner is managed by component state and persisted to localStorage
- Survives refresh (24h TTL)

### Refresh behavior

- **campaign-details:** Full loss of wizard state. `prePlanningWizardStep` resets to 0, `questionnaireAnswers` to defaults. Campaign data and `prefilledPlanning` are reloaded from API.
- **campaign-planner:** State survives refresh via localStorage.

### Browser navigation

- **campaign-details:** Back/forward or leaving the page and returning causes full remount; wizard state is lost.
- **campaign-planner:** State survives due to localStorage.

---

## 4. DRAFT STORAGE STATUS

### Current draft system

| Artifact | Storage | When saved |
|----------|---------|------------|
| Campaign row | `campaigns` | At creation (Path A) or planner finalize (Path B) |
| Snapshot / execution config | `campaign_versions.campaign_snapshot` | PUT source-recommendation or POST campaigns |
| Blueprint (structured plan) | `twelve_week_plan` (status=`draft`) | Explicit “Save for Later” or AI “Save draft” |
| Planning inputs | `campaign_planning_inputs` | When `shouldPersistPlanningInputs` is true during AI plan flow |
| Planner session | localStorage | On every state change |

### Missing

- **campaign_drafts table:** Does not exist
- **Wizard form draft:** Pre-planning `questionnaireAnswers` and `prePlanningWizardStep` are not persisted
- **Periodic autosave:** No background autosave of campaign-details form or wizard step
- **Wizard-specific persistence:** No DB or storage layer for the campaign-details multi-step form

---

## 5. FREQUENCY CONFIGURATION SYSTEM

### Current logic

**Frequency inputs:**

- **TrendCampaignsTab:** Execution bar has `frequencyPerWeek` (single value)
- **campaign-details:** Pre-planning wizard steps 4–5 use `questionnaireAnswers` with `videoPerWeek`, `postPerWeek`, `blogPerWeek`, `songPerWeek`
- **StrategyBuilderStep (planner):** `posting_frequency` per platform (e.g. `{ linkedin: 3 }`)
- **CampaignParametersTab:** `postingFrequency` per platform, `posts/week`

**Frequency validation:**

- **`lib/planning/contentDistributionIntelligence.ts`:** `PLATFORM_FREQUENCY_LIMITS` (e.g. LinkedIn 5, Twitter 10), `CONTENT_TYPE_FREQUENCY_LIMITS` (blog 3). Used to analyze an existing weekly plan and return insights; not used as input validation.
- **`backend/services/capacityExpectationValidator.ts`:** `validateCapacityVsExpectation()` compares `platform_content_requests` to capacity and `exclusive_campaigns`. Invoked when `mode === 'generate_plan'`.
- **`capacityFrequencyValidationGateway.ts`:** `validateCapacityAndFrequency()` wraps the above and optionally runs workload balancing.

### When validation runs

- Only during plan generation (`campaignAiOrchestrator` when `mode === 'generate_plan'`)
- Not when the user enters frequency in the wizard or form
- User can enter values that exceed capacity and only discover issues at the final step

### Missing

- **Early frequency validation:** No check at the moment the user sets posts/week or content mix
- **Unified frequency formula:** Different UIs use different structures (single value, per-platform, per-content-type)
- **Limit forecasting:** No “you will need X pieces per week” or “this exceeds plan limits” before finalization
- **Pricing-plan-aware limits:** No campaign-level content/post limits driven by `plan_limits`

---

## 6. PLATFORM DISTRIBUTION MODEL

### Shared vs unique posting

**Backend support:**

- **`cross_platform_sharing`** is supported in:
  - `capacityExpectationValidator.computeUniqueWeeklyTotal()` — sharing on → `max` per content type; off → sum
  - `deterministicWeeklySkeleton.buildDeterministicWeeklySkeleton()` — sharing on → one slot can cover multiple platforms
  - `workloadBalancerService`, `planningIntelligenceService`
- **Default:** `campaignAiOrchestrator` defaults `cross_platform_sharing: { enabled: true }`

**UI support:**

- **CampaignAIChat:** `planningCrossPlatformSharingEnabled` exists; used in planning context and quick picks. No prominent toggle.
- **TrendCampaignsTab, campaign-details wizard, campaign-planner StrategyBuilderStep:** No “Unique vs Shared posting” option.
- **CampaignParametersTab:** Posting frequency per platform only; no distribution mode selector.

**Storage:**

- `cross_platform_sharing` is not stored in `campaign_planning_inputs`; it exists only in runtime context (e.g. `collectedPlanningContext`, `prefilledPlanning`).

### Summary

- **Logic:** Unique vs shared is implemented in backend calculation and scheduling.
- **Config:** No clear user-facing control for “one post → one platform” vs “one post → multiple platforms”.
- **Schema:** No dedicated column; would live in `campaign_snapshot` or `campaign_planning_inputs` if persisted.

---

## 7. PLAN LIMIT VALIDATION

### Where limits are checked

| Resource | Location | When |
|----------|----------|------|
| Campaign duration | `CampaignAIChat` fetches `/api/company-plan-duration-limit` → `planDurationLimit.max_campaign_duration_weeks` | Used in quick picks and when committing duration |
| LLM tokens, API calls, automation | `resolveOrganizationPlanLimits`, `usageEnforcementService` | At execution (e.g. plan API, external APIs) |
| Company config (topics, competitors, etc.) | `companyIntelligenceConfigService.getPlanLimit()` | When mutating company intelligence config |

### Campaign creation flow

- **Duration:** `planDurationLimit` is used in CampaignAIChat quick picks and when accepting duration; not checked in campaign-planner StrategyBuilderStep.
- **Content limits:** No plan-based content or posting limits for campaigns.
- **Platform limits:** No plan-based platform caps for campaign creation.

### Timing

- Duration limit is only enforced when the user interacts with the AI chat’s quick picks or commits duration.
- Campaign-planner does not enforce duration limits before finalize.
- Capacity/frequency validation runs at plan generation, not when setting frequency in the wizard.
- **Result:** Limits can be exceeded until late in the flow (e.g. at blueprint generation or finalize).

---

## 8. FILES INVOLVED

### Pages

| File | Role |
|------|------|
| `pages/campaign-details/[id].tsx` | Campaign details, pre-planning wizard (steps 0–6), CampaignAIChat, blueprint, governance |
| `pages/campaign-planner.tsx` | Campaign planner, PlannerEntryRouter, PlannerSessionProvider |
| `pages/recommendations.tsx` | Recommendations hub; `handleCreateCampaignFromRecommendation` |
| `pages/create-campaign.tsx` | Direct create campaign form (legacy) |
| `pages/campaigns.tsx` | Campaign list; Create Campaign button |

### Components

| File | Role |
|------|------|
| `components/recommendations/tabs/TrendCampaignsTab.tsx` | Recommended Hub; theme generation; `onBuildCampaignBlueprint`, `onBuildCampaignFast` |
| `components/recommendations/cards/RecommendationBlueprintCard.tsx` | Strategic Theme Card; Build Campaign Blueprint button |
| `components/CampaignAIChat.tsx` | Campaign AI Assistant; planning context, quick picks, duration, cross_platform_sharing |
| `components/planner/PlannerEntryRouter.tsx` | Routes planner by query (direct, recommendation, opportunity) |
| `components/planner/PlannerSessionProvider.tsx` | Session state + localStorage |
| `components/planner/plannerSessionStore.ts` | Session state types and persistence |
| `components/planner/CampaignContextBar.tsx` | Context bar |
| `components/planner/CampaignHealthPanel.tsx` | Health panel |
| `components/planner/StrategyBuilderStep.tsx` | Duration, platforms, posting_frequency, content_mix |
| `components/planner/PlanningCanvas.tsx` | Planning canvas |
| `components/planner/StrategyAssistantPanel.tsx` | Strategy assistant |
| `components/planner/AIPlanningAssistantTab.tsx` | AI planning tab |
| `components/planner/CampaignParametersTab.tsx` | Parameters including posting frequency per platform |

### APIs

| File | Role |
|------|------|
| `pages/api/campaigns/index.ts` | GET campaign (prefilledPlanning), POST create |
| `pages/api/campaigns/[id]/source-recommendation.ts` | PUT source_strategic_theme, execution_config |
| `pages/api/campaigns/ai/plan.ts` | POST plan (generate_plan, etc.) |
| `pages/api/campaigns/planner-finalize.ts` | POST finalize planner → create campaign |
| `pages/api/campaigns/save-draft-plan.ts` | POST save draft blueprint |
| `pages/api/planner/strategic-themes.ts` | GET strategic themes for planner |
| `pages/api/company-plan-duration-limit.ts` | GET plan duration limit |

### Services

| File | Role |
|------|------|
| `backend/services/campaignAiOrchestrator.ts` | Plan generation, prefilledPlanning, validation |
| `backend/services/capacityExpectationValidator.ts` | Capacity vs expectation validation |
| `backend/services/capacityFrequencyValidationGateway.ts` | validateCapacityAndFrequency wrapper |
| `backend/services/deterministicWeeklySkeleton.ts` | Weekly skeleton; cross_platform_sharing |
| `backend/services/campaignPlanningInputsService.ts` | get/save campaign_planning_inputs |
| `backend/services/boltPipelineService.ts` | BOLT pipeline; source-recommendation, plan |
| `backend/db/campaignPlanStore.ts` | saveDraftBlueprint, commitDraftBlueprint |
| `backend/db/campaignVersionStore.ts` | saveCampaignVersion |

### Libs / utils

| File | Role |
|------|------|
| `lib/planning/contentDistributionIntelligence.ts` | Platform/content frequency limits (post-hoc analysis) |
| `utils/contentCapacityOptions.ts` | Content type options by mode |

---

## 9. DATABASE STRUCTURE INVOLVED

| Table | Purpose |
|-------|---------|
| `campaigns` | Campaign metadata; id, name, status, start_date, end_date, duration_weeks, etc. |
| `campaign_versions` | Versioned snapshots; `campaign_snapshot` (JSONB) holds source_strategic_theme, execution_config, planning_context |
| `twelve_week_plan` | Blueprint; weeks, blueprint, status (`draft` | `committed` | `edited_committed`) |
| `campaign_planning_inputs` | Planning inputs; available_content, weekly_capacity, platform_content_requests, etc. |
| `plan_limits` | Plan limits; resource_key (e.g. max_campaign_duration_weeks, llm_tokens), limit_value |
| `daily_content_plans` | Daily plans per campaign/week |

**Note:** No `campaign_drafts` table. Drafts are represented by `twelve_week_plan.status = 'draft'` and `campaign_versions` with draft snapshots.

---

## 10. CRITICAL GAPS

1. **Wizard state loss on refresh/navigation (campaign-details)**
   - Pre-planning wizard step and questionnaire answers are not persisted.
   - User loses all wizard progress on refresh or leaving the page.

2. **No early frequency/limit validation**
   - Capacity and frequency are validated only at plan generation.
   - Users can finish the wizard and hit limits at the last step.

3. **No platform distribution selector**
   - Unique vs Shared posting is supported in backend but not exposed in wizard or planner UI.

4. **Inconsistent flow entry**
   - Path A (campaign-details) vs Path B (campaign-planner) differ in state, persistence, and UX.
   - Path B loses recommendation context if user refreshes before finalize.

5. **cross_platform_sharing not persisted**
   - Not stored in `campaign_planning_inputs`; only in runtime context.

6. **No campaign-details draft autosave**
   - Form and wizard step are never saved; only structured plan drafts via “Save for Later”.

7. **Plan limits not enforced in planner**
   - Duration and other limits are not checked before planner finalize.

8. **No unified frequency schema**
   - Different UIs use different structures; no single source of truth for “posts per week per platform”.

---

## 11. IMPLEMENTATION PRIORITY LIST

| # | Item | Impact | Effort |
|---|------|--------|--------|
| 1 | Persist campaign-details wizard state (step + questionnaire) to DB or localStorage | High | Medium |
| 2 | Add early frequency validation when user sets posts/week or content mix | High | Medium |
| 3 | Add platform distribution selector (Unique vs Shared) to wizard/planner | Medium | Low |
| 4 | Implement draft autosave for campaign-details form | High | Medium |
| 5 | Unify Path A and Path B (single wizard with shared state store) | High | High |
| 6 | Persist cross_platform_sharing in campaign_planning_inputs or campaign_snapshot | Medium | Low |
| 7 | Enforce plan duration/content limits in planner before finalize | Medium | Low |
| 8 | Add frequency limit forecasting (e.g. “X pieces needed per week”) to UI | Medium | Medium |
| 9 | Use URL state (e.g. step index) for campaign-details wizard to support deep linking | Low | Low |
| 10 | Create frequency calculation engine shared across wizard, planner, and AI context | Medium | Medium |

---

*End of audit report. No implementation changes were made.*
