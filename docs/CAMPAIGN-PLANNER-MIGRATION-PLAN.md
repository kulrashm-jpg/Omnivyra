# Campaign Planner Migration Plan
## Module: Campaign Planner Migration | Product: Omnivyra

---

## 1. CURRENT SYSTEM COMPONENT MAP

### FUNCTION_GROUP
name: Campaign Creation
components: Create campaign page, campaigns API POST, create-campaign-from-group, recommendations/[id]/create-campaign, source-recommendation PUT, opportunity promoteToCampaign
file_locations: `pages/create-campaign.tsx`, `pages/api/campaigns/index.ts`, `pages/api/recommendations/create-campaign-from-group.ts`, `pages/api/recommendations/[id]/create-campaign.ts`, `pages/api/campaigns/[id]/source-recommendation.ts`, `backend/services/opportunityService.ts`

### FUNCTION_GROUP
name: Recommendation Engine
components: recommendationEngineService, generate API, recommendationCampaignBuilder, recommendationBlueprintValidationService, RecommendationBlueprintCard, TrendCampaignsTab onBuildCampaignBlueprint
file_locations: `backend/services/recommendationEngineService.ts`, `pages/api/recommendations/generate.ts`, `backend/services/recommendationCampaignBuilder.ts`, `backend/services/recommendationBlueprintValidationService.ts`, `components/recommendations/cards/RecommendationBlueprintCard.tsx`, `components/recommendations/tabs/TrendCampaignsTab.tsx`

### FUNCTION_GROUP
name: AI Campaign Planning
components: campaignAiOrchestrator, aiGateway (generateCampaignPlan, generateDailyPlan, generateDailyDistributionPlan), ai/plan API, campaignPlanParser, aiOutputValidationService
file_locations: `backend/services/campaignAiOrchestrator.ts`, `backend/services/aiGateway.ts`, `pages/api/campaigns/ai/plan.ts`, `backend/services/campaignPlanParser.ts`, `backend/services/aiOutputValidationService.ts`

### FUNCTION_GROUP
name: Content Generation
components: contentGenerationService, contentGenerationPipeline, autopilotExecutionPipeline
file_locations: `backend/services/contentGenerationService.ts`, `backend/services/contentGenerationPipeline.ts`, `backend/services/autopilotExecutionPipeline.ts`

### FUNCTION_GROUP
name: Calendar / Daily Plans
components: daily_content_plans, generateWeeklyStructure, daily-plans API, campaign-calendar, activity-workspace
file_locations: `backend/services/generateWeeklyStructureService.ts`, `pages/api/campaigns/daily-plans.ts`, `pages/campaign-calendar/[id].tsx`, `pages/activity-workspace.tsx`

### FUNCTION_GROUP
name: Scheduling / Publishing
components: schedulerService (findDuePostsAndEnqueue), cron, BullMQ publish worker, queue_jobs, scheduled_posts, structuredPlanScheduler
file_locations: `backend/scheduler/schedulerService.ts`, `backend/scheduler/cron.ts`, `backend/services/structuredPlanScheduler.ts`, `database/step3-scheduling-tables.sql`

### FUNCTION_GROUP
name: Opportunity Promotion
components: opportunityService.promoteToCampaign, opportunity_items, opportunity_to_campaign, opportunities/[id]/action API
file_locations: `backend/services/opportunityService.ts`, `pages/api/opportunities/[id]/action.ts`

### FUNCTION_GROUP
name: BOLT Execution Pipeline
components: bolt/execute API, boltPipelineService, boltQueue, bolt_execution_runs, bolt_execution_events
file_locations: `pages/api/bolt/execute.ts`, `backend/services/boltPipelineService.ts`, `backend/queue/boltQueue.ts`

---

## 2. COMPONENTS TO KEEP (UNCHANGED)

### REUSED_COMPONENT
name: campaignAiOrchestrator
file_location: `backend/services/campaignAiOrchestrator.ts`
purpose: Orchestrates AI plan generation, parsing, validation, persistence; runCampaignAiPlan
dependency_chain: aiGateway → campaignPlanParser → campaignPlanStore; used by BOLT, create-campaign, ai/plan API

### REUSED_COMPONENT
name: aiGateway (campaign planning operations)
file_location: `backend/services/aiGateway.ts`
purpose: generateCampaignPlan, generateDailyPlan, generateDailyDistributionPlan
dependency_chain: OpenAI client; used by campaignAiOrchestrator

### REUSED_COMPONENT
name: contentGenerationPipeline
file_location: `backend/services/contentGenerationPipeline.ts`
purpose: attachGenerationPipelineToDailyItems, content generation for slots
dependency_chain: contentGenerationService, companyProfileService; used by campaignAiOrchestrator, autopilot

### REUSED_COMPONENT
name: contentGenerationService
file_location: `backend/services/contentGenerationService.ts`
purpose: generateContentForDay (headline, caption, hook, CTA, hashtags)
dependency_chain: aiGateway; used by contentGenerationPipeline

### REUSED_COMPONENT
name: schedulerService
file_location: `backend/scheduler/schedulerService.ts`
purpose: findDuePostsAndEnqueue, campaign readiness check
dependency_chain: BullMQ, campaignReadinessService, scheduled_posts

### REUSED_COMPONENT
name: cron
file_location: `backend/scheduler/cron.ts`
purpose: Run scheduler cycle, governance, intelligence polling
dependency_chain: schedulerService, jobs

### REUSED_COMPONENT
name: structuredPlanScheduler
file_location: `backend/services/structuredPlanScheduler.ts`
purpose: Convert plan to scheduled_posts
dependency_chain: boltPipelineService, daily_content_plans

### REUSED_COMPONENT
name: recommendationEngineService
file_location: `backend/services/recommendationEngineService.ts`
purpose: Generate recommendation / trend cards
dependency_chain: aiGateway, externalApiService, companyProfileService

### REUSED_COMPONENT
name: boltPipelineService
file_location: `backend/services/boltPipelineService.ts`
purpose: BOLT stages: source-recommendation, ai/plan, commit-plan, generate-weekly-structure, schedule-structured-plan
dependency_chain: runCampaignAiPlan, campaignPlanStore, generateWeeklyStructureService, structuredPlanScheduler

### REUSED_COMPONENT
name: campaignPlanStore
file_location: `backend/db/campaignPlanStore.ts`
purpose: Save/load blueprint, structured plan, daily updates
dependency_chain: Supabase; used by boltPipelineService, campaignAiOrchestrator

### REUSED_COMPONENT
name: campaignBlueprintAdapter
file_location: `backend/services/campaignBlueprintAdapter.ts`
purpose: Convert between plan formats (fromStructuredPlan, fromRecommendationPlan)
dependency_chain: campaignPlanStore; used by boltPipelineService, campaignOptimizationService

### REUSED_COMPONENT
name: generateWeeklyStructureService
file_location: `backend/services/generateWeeklyStructureService.ts`
purpose: Build daily_content_plans from blueprint
dependency_chain: campaignPlanStore; used by boltPipelineService

### REUSED_COMPONENT
name: campaigns API POST handler
file_location: `pages/api/campaigns/index.ts`
purpose: Insert campaigns + campaign_versions (core creation contract)
dependency_chain: Supabase; used by create-campaign, TrendCampaignsTab, BOLT

### REUSED_COMPONENT
name: source-recommendation API
file_location: `pages/api/campaigns/[id]/source-recommendation.ts`
purpose: Save source_strategic_theme, source_recommendation_id to campaign_versions
dependency_chain: Supabase; used by TrendCampaignsTab, BOLT

### REUSED_COMPONENT
name: bolt execute API
file_location: `pages/api/bolt/execute.ts`
purpose: Start BOLT run, enqueue BullMQ
dependency_chain: boltPipelineService; used by TrendCampaignsTab (optional), Quick Start

---

## 3. COMPONENTS TO MODIFY

### MODIFIED_COMPONENT
name: create-campaign page
file_location: `pages/create-campaign.tsx`
change_required: Replace form-only flow with AI-guided planner. Accept entry modes: direct-idea, turbo-quick-start; preserve POST /api/campaigns for final campaign creation; add planner initialization (idea spine, strategy builder).
impact_scope: Dashboard and campaigns list "Create Campaign" buttons point here; must support all three entry types (Recommendation, Direct Idea, Turbo).

### MODIFIED_COMPONENT
name: Dashboard Create Campaign button
file_location: `components/DashboardPage.tsx`
change_required: Update onClick to navigate to planner route (e.g. /campaign-planner or /campaign-planner?mode=direct).
impact_scope: Primary entry for "Create Campaign" from dashboard.

### MODIFIED_COMPONENT
name: Campaigns list Create Campaign button
file_location: `pages/campaigns.tsx`
change_required: Update navigation target from /create-campaign to planner route.
impact_scope: Secondary entry from campaigns list.

### MODIFIED_COMPONENT
name: campaign-navigation-logic
file_location: `lib/campaign-navigation-logic.ts`
change_required: Update createCampaign.action to planner route; align with /create-campaign replacement.
impact_scope: Any consumer of CampaignListButtons.createCampaign.

### MODIFIED_COMPONENT
name: TrendCampaignsTab onBuildCampaignBlueprint
file_location: `components/recommendations/tabs/TrendCampaignsTab.tsx`
change_required: Redirect to planner with recommendation context (source_strategic_theme, recId) instead of directly to campaign-details; or preserve current flow and add planner as alternative path. Planner must accept ?recommendationId= or ?sourceTheme=.
impact_scope: Recommendation → Campaign Planning entry; BOLT may still be invoked from planner.

### MODIFIED_COMPONENT
name: Recommendation create-campaign APIs
file_location: `pages/api/recommendations/[id]/create-campaign.ts`, `pages/api/recommendations/create-campaign-from-group.ts`
change_required: Optional: add planner_init mode that creates campaign shell and returns to planner UI for guided planning instead of immediate runCampaignAiPlan. Preserve existing synchronous flow for backward compatibility.
impact_scope: Recommendation → Campaign handoff; planner can call these or POST /api/campaigns + source-recommendation.

### MODIFIED_COMPONENT
name: opportunityService.promoteToCampaign
file_location: `backend/services/opportunityService.ts`
change_required: No change to promotion logic. Opportunity → campaign may redirect to planner with source_opportunity_id for post-creation planning. Optional: add redirect URL or mode flag.
impact_scope: Opportunity → Campaign Planning entry.

### MODIFIED_COMPONENT
name: opportunities action API
file_location: `pages/api/opportunities/[id]/action.ts`
change_required: On PROMOTED, return campaignId; client (or new planner entry) can redirect to planner with campaignId for guided planning.
impact_scope: Opportunity promotion handoff.

---

## 4. COMPONENTS TO REMOVE OR DEPRECATE

### DEPRECATED_COMPONENT
name: /create-campaign as primary create flow
file_location: `pages/create-campaign.tsx`
reason: Replaced by Campaign Planner; page becomes planner or redirects to planner.

### DEPRECATED_COMPONENT
name: campaign-planning?mode=create
file_location: `lib/campaign-navigation-logic.ts` (Routes.createCampaign)
reason: Legacy create mode; consolidate to single planner route.

### DEPRECATED_COMPONENT
name: Duplicate navigation targets
file_location: `components/DashboardPage.tsx`, `pages/campaigns.tsx`
reason: Remove /create-campaign references; use planner route only.

---

## 5. NEW COMPONENTS REQUIRED

### NEW_COMPONENT
name: Campaign Planner UI
type: UI
file_location_suggestion: `pages/campaign-planner.tsx` or `pages/campaign-planner/index.tsx`
purpose: AI-guided wizard replacing /create-campaign; supports entry modes: recommendation, direct-idea, turbo. Steps: idea spine → strategy builder → calendar preview → transition to campaign-details.
dependencies: Campaign creation API, ai/plan API, CampaignAIChat or planner-specific chat, CompanyContext

### NEW_COMPONENT
name: Idea Spine Handler
type: service / UI
file_location_suggestion: `backend/services/ideaSpineService.ts`, `components/planner/IdeaSpineStep.tsx`
purpose: Accept free-form idea or recommendation/opportunity payload; normalize to planner input structure for strategy builder.
dependencies: recommendationContext shape, source_strategic_theme, opportunity payload

### NEW_COMPONENT
name: Campaign Strategy Builder
type: UI / service
file_location_suggestion: `components/planner/StrategyBuilderStep.tsx`
purpose: Guided collection of duration, platforms, content capacity, themes; can invoke runCampaignAiPlan or delegate to CampaignAIChat.
dependencies: campaignPlanningInputsService, getCampaignPlanningInputs, ai/plan API

### NEW_COMPONENT
name: Calendar Planner
type: UI
file_location_suggestion: `components/planner/CalendarPlannerStep.tsx`
purpose: Preview weekly/daily structure before committing; read-only or light edit before transition.
dependencies: retrieve-plan API, daily-plans API, campaignPlanStore

### NEW_COMPONENT
name: Activity Card Generator
type: service
file_location_suggestion: `backend/services/plannerActivityCardService.ts` (optional)
purpose: Generate preview activity cards from plan without persisting; or reuse existing daily-plans shape.
dependencies: campaignAiOrchestrator plan output, execution item format

### NEW_COMPONENT
name: Planner → Execution Transition
type: API / service
file_location_suggestion: `pages/api/campaign-planner/commit.ts` or extend `pages/api/campaigns/ai/plan.ts`
purpose: Finalize planner session: ensure campaign + campaign_versions exist, save blueprint (commit-plan), optionally trigger BOLT or generate-weekly-structure.
dependencies: POST /api/campaigns, source-recommendation, campaignPlanStore, bolt execute (optional)

### NEW_COMPONENT
name: Planner entry routing
type: UI
file_location_suggestion: `components/planner/PlannerEntryRouter.tsx` or logic in campaign-planner.tsx
purpose: Route recommendation, direct-idea, turbo queries to correct planner step and prefilled context.
dependencies: URL params (recommendationId, sourceTheme, opportunityId, mode)

---

## 6. NEW DATA STRUCTURES (IF REQUIRED)

### DATA_CHANGE
type: none
target_table: N/A
fields: N/A
reason: Existing campaigns, campaign_versions, campaign_snapshot (source_strategic_theme, execution_config, source_opportunity_id), twelve_week_plan, daily_content_plans support planner. Planner uses same contracts.

### DATA_CHANGE
type: field_addition (optional)
target_table: campaign_versions.campaign_snapshot
fields: planner_session_id (optional JSON key), planner_entry_mode (optional)
reason: Track planner origin for analytics; not required for functionality.

### DATA_CHANGE
type: none
target_table: bolt_execution_runs
fields: N/A
reason: BOLT payload (sourceStrategicTheme, executionConfig) unchanged; planner produces compatible payload.

---

## 7. MIGRATION SEQUENCE

### MIGRATION_STEP
step_number: 1
component: Campaign Planner UI shell
action: Create pages/campaign-planner.tsx with entry-mode detection (recommendation, direct, turbo); no replacement of /create-campaign yet.
dependency: None

### MIGRATION_STEP
step_number: 2
component: Idea Spine Handler
action: Implement IdeaSpineStep and ideaSpineService; accept recommendation/opportunity/direct payload.
dependency: Step 1

### MIGRATION_STEP
step_number: 3
component: Strategy Builder step
action: Implement StrategyBuilderStep; wire to getCampaignPlanningInputs and ai/plan API; no campaign creation yet (preview only).
dependency: Step 2

### MIGRATION_STEP
step_number: 4
component: Calendar Planner step
action: Implement CalendarPlannerStep; consume retrieve-plan or ai/plan output for preview.
dependency: Step 3

### MIGRATION_STEP
step_number: 5
component: Planner commit API
action: Create /api/campaign-planner/commit or extend plan API; create campaign + campaign_versions, save blueprint, optional BOLT trigger.
dependency: POST /api/campaigns, campaignPlanStore

### MIGRATION_STEP
step_number: 6
component: Planner → Execution transition
action: Wire planner final step to commit API; redirect to campaign-details/[id].
dependency: Step 5

### MIGRATION_STEP
step_number: 7
component: Recommendation → Planner handoff
action: Update TrendCampaignsTab onBuildCampaignBlueprint to support planner path (e.g. ?recommendationId=, ?sourceTheme=); preserve BOLT path.
dependency: Step 1, 6

### MIGRATION_STEP
step_number: 8
component: Dashboard and campaigns list buttons
action: Change Create Campaign navigation from /create-campaign to /campaign-planner.
dependency: Step 6

### MIGRATION_STEP
step_number: 9
component: campaign-navigation-logic
action: Update Routes.createCampaign to planner route.
dependency: Step 8

### MIGRATION_STEP
step_number: 10
component: Deprecate create-campaign
action: Redirect /create-campaign to /campaign-planner or remove page.
dependency: Step 8

---

## 8. ROUTING CHANGES

### ROUTE_CHANGE
route: /create-campaign
current_behavior: Dedicated form page; POST /api/campaigns; redirect to campaign-details.
new_behavior: Redirect to /campaign-planner or serve planner at same path.

### ROUTE_CHANGE
route: /campaign-planning?mode=create
current_behavior: Legacy create mode (campaign-navigation-logic).
new_behavior: Redirect to /campaign-planner or equivalent planner route.

### ROUTE_CHANGE
route: Recommendation → campaign
current_behavior: TrendCampaignsTab: POST campaigns or PUT source-recommendation, redirect to campaign-details; or BOLT execute.
new_behavior: Option to redirect to /campaign-planner?recommendationId=X&sourceTheme=... for guided flow; BOLT remains alternative.

### ROUTE_CHANGE
route: Dashboard / campaigns list Create Campaign
current_behavior: Navigate to /create-campaign.
new_behavior: Navigate to /campaign-planner or /campaign-planner?mode=direct.

### ROUTE_CHANGE
route: Opportunity PROMOTED
current_behavior: promoteToCampaign; return campaignId; client may redirect to campaign-details.
new_behavior: Return campaignId; client redirects to /campaign-planner?campaignId=X&sourceOpportunityId=Y or campaign-details.

### ROUTE_CHANGE
route: Turbo / Quick Start
current_behavior: BOLT execute from TrendCampaignsTab or similar.
new_behavior: /campaign-planner?mode=turbo with minimal inputs; invokes BOLT or equivalent fast path.

---

## 9. SYSTEM INTEGRATION CHECKPOINTS

### CHECKPOINT
name: BOLT pipeline intact
component: boltPipelineService, bolt/execute API
verification_method: Run BOLT from TrendCampaignsTab or planner; verify source-recommendation → ai/plan → commit-plan → generate-weekly-structure → schedule-structured-plan completes.

### CHECKPOINT
name: Recommendation flow intact
component: TrendCampaignsTab, create-campaign APIs, source-recommendation
verification_method: Generate themes, Build Campaign Blueprint; verify campaign created, source_strategic_theme saved, redirect works.

### CHECKPOINT
name: Scheduler intact
component: schedulerService, cron
verification_method: Scheduled posts due; verify findDuePostsAndEnqueue creates queue_jobs and publishes.

### CHECKPOINT
name: Content generation intact
component: contentGenerationPipeline, contentGenerationService
verification_method: Trigger content generation from campaign (autopilot or manual); verify content produced.

### CHECKPOINT
name: Campaign list visibility
component: campaign_versions, campaigns API GET
verification_method: Create campaign via planner; verify campaign appears in company campaign list.

### CHECKPOINT
name: Plan retrieval
component: retrieve-plan API, daily-plans API
verification_method: Commit planner; verify plan retrievable, daily_content_plans populated.

### CHECKPOINT
name: RBAC
component: CREATE_CAMPAIGN permission, campaigns API
verification_method: User without CREATE_CAMPAIGN cannot create; planner respects same permission.

### CHECKPOINT
name: Opportunity promotion
component: opportunityService.promoteToCampaign, opportunities action
verification_method: PROMOTED action creates campaign, campaign_versions, opportunity_to_campaign; campaign visible.
