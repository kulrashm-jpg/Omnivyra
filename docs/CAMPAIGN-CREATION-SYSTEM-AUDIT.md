# Campaign Creation System Audit
## Module: Campaign Creation System | Product: Omnivyra

---

## 1. ENTRY POINTS

### ENTRY_POINT
name: Manual Create Campaign (dedicated page)
file: `pages/create-campaign.tsx`
trigger: UI
description: User fills form (name, context mode, primary/secondary campaign types, regions), clicks Create Campaign. Creates campaign via POST /api/campaigns, redirects to campaign-details/[id].
service_invoked: `pages/api/campaigns/index.ts` (POST handler)

### ENTRY_POINT
name: Dashboard Create Campaign
file: `components/DashboardPage.tsx`
trigger: UI
description: "Create Campaign" button navigates to /create-campaign.
service_invoked: None (navigation only)

### ENTRY_POINT
name: Campaigns List Create Campaign
file: `pages/campaigns.tsx`
trigger: UI
description: "Create Campaign" button navigates to /create-campaign (via window.location.href).
service_invoked: None (navigation only)

### ENTRY_POINT
name: Campaign Planning Mode Create
file: `lib/campaign-navigation-logic.ts`
trigger: UI (logic reference)
description: createCampaign action points to /campaign-planning?mode=create per legacy flow; campaigns.tsx and index may use /create-campaign instead.
service_invoked: N/A (navigation logic)

### ENTRY_POINT
name: Single Recommendation → Create Campaign
file: `pages/api/recommendations/[id]/create-campaign.ts`
trigger: API (POST)
description: Creates campaign from one recommendation snapshot. Inserts campaigns + campaign_versions, runs runCampaignAiPlan(mode: generate_plan), links recommendation to campaign.
service_invoked: `campaignAiOrchestrator.runCampaignAiPlan`

### ENTRY_POINT
name: Group Recommendations → Create Campaign
file: `pages/api/recommendations/create-campaign-from-group.ts`
trigger: API (POST)
description: Creates campaign from grouped recommendations. Inserts campaigns + campaign_versions, runs runCampaignAiPlan(mode: generate_plan).
service_invoked: `campaignAiOrchestrator.runCampaignAiPlan`

### ENTRY_POINT
name: Recommendation Card → Build Campaign Blueprint (save card)
file: `pages/api/campaigns/[id]/source-recommendation.ts`
trigger: API (PUT)
description: Saves selected recommendation card (source_strategic_theme, source_recommendation_id) to campaign_versions. Used when user clicks "Build Campaign Blueprint" on a card after campaign exists.
service_invoked: Supabase (campaign_versions update)

### ENTRY_POINT
name: Recommendation Card → Build Campaign Blueprint (create + save)
file: `components/recommendations/tabs/TrendCampaignsTab.tsx` (onBuildCampaignBlueprint ~line 2084)
trigger: UI
description: If generatedCampaignId exists: PUT source-recommendation. Else: POST /api/campaigns to create campaign, then PUT source-recommendation. Redirects to campaign-details.
service_invoked: POST /api/campaigns or PUT /api/campaigns/[id]/source-recommendation

### ENTRY_POINT
name: BOLT Execute (turbo / fast blueprint)
file: `pages/api/bolt/execute.ts`
trigger: API (POST)
description: Starts BOLT background run. Creates bolt_execution_runs row, enqueues BullMQ job. Stages: source-recommendation → ai/plan → commit-plan → generate-weekly-structure → schedule-structured-plan.
service_invoked: `boltPipelineService` (via BullMQ worker)

### ENTRY_POINT
name: Opportunity → Promote to Campaign
file: `pages/api/opportunities/[id]/action.ts`
trigger: API (POST) with action: PROMOTED
description: Calls promoteToCampaign. Creates campaign, campaign_versions (with source_opportunity_id), opportunity_to_campaign link.
service_invoked: `opportunityService.promoteToCampaign`

### ENTRY_POINT
name: Campaign Creation (direct API)
file: `pages/api/campaigns/index.ts`
trigger: API (POST)
description: Insert campaigns + campaign_versions. Accepts campaign data, planning_context, source_strategic_theme, execution_config, etc.
service_invoked: Supabase (campaigns, campaign_versions)

---

## 2. CAMPAIGN DATA MODEL

### TABLE
name: campaigns
purpose: Core campaign entity: name, description, status, dates, user, playbook.
fields: id, user_id, name, description, virality_playbook_id, start_date, end_date, status, current_stage, duration_weeks, duration_locked, blueprint_status, budget, goals, target_audience, brand_voice, content_themes, hashtag_strategy, posting_schedule, objective, target_metrics, campaign_summary, ai_generated_summary, weekly_themes, performance_targets, created_at, updated_at
foreign_keys: user_id → users(id), virality_playbook_id → virality_playbooks(id)
indexes: idx_campaigns_user_id, idx_campaigns_status, idx_campaigns_dates, idx_campaigns_current_stage, idx_campaigns_scheduler_lock_id

### TABLE
name: campaign_versions
purpose: Company-campaign link and campaign snapshot (planning context, source recommendation, execution config).
fields: id, company_id, campaign_id, campaign_snapshot (JSONB), status, version, created_at, build_mode, context_scope, campaign_types, campaign_weights, company_stage, market_scope, baseline_override
foreign_keys: campaign_id → campaigns(id) (via TEXT/UUID)
indexes: idx_campaign_versions_company, idx_campaign_versions_campaign

### TABLE
name: twelve_week_plan
purpose: AI-generated and recommendation-based 12-week blueprints.
fields: id, campaign_id, snapshot_hash, mode, response, omnivyre_decision, source, weeks, raw_plan_text, blueprint, refined_day, platform_content, created_at, updated_at
foreign_keys: campaign_id → campaigns(id) ON DELETE CASCADE
indexes: idx_twelve_week_plan_campaign, idx_twelve_week_plan_campaign_snapshot, idx_twelve_week_plan_created

### TABLE
name: content_plans
purpose: Content planning records per campaign (draft/ai_generated_plan, week_number, alignment_status).
fields: id, campaign_id, content_type, status, week_number, alignment_status, scheduled_at, ...
foreign_keys: campaign_id → campaigns(id)
indexes: idx_content_plans_campaign_id, idx_content_plans_status, idx_content_plans_week_number

### TABLE
name: daily_content_plans
purpose: Daily slot plans (week_number, day_of_week, platform, content JSON, ai_generated).
fields: id, campaign_id, week_number, day_of_week, platform, content (JSONB), topic, objective, ai_generated, status, ...
foreign_keys: campaign_id → campaigns(id)
indexes: idx_daily_plans_campaign_date, idx_daily_plans_week_day

### TABLE
name: scheduled_posts
purpose: Platform posts scheduled for publishing (LinkedIn, Twitter, Instagram, etc.).
fields: id, user_id, social_account_id, campaign_id, template_id, platform, content_type, content, scheduled_for, status, ...
foreign_keys: campaign_id → campaigns(id) ON DELETE SET NULL, user_id → users(id)
indexes: Per migration

### TABLE
name: bolt_execution_runs
purpose: BOLT async execution runs (source-recommendation → ai/plan → commit-plan → generate-weekly-structure → schedule-structured-plan).
fields: id, company_id, campaign_id, target_campaign_id, user_id, current_stage, status, progress_percentage, payload, result_campaign_id, error_message, ...
foreign_keys: campaign_id, target_campaign_id
indexes: Per bolt_execution.sql

### TABLE
name: bolt_execution_events
purpose: Stage-level events for BOLT runs.
fields: id, run_id, stage, status, metadata, ...
foreign_keys: run_id → bolt_execution_runs(id)

### TABLE
name: opportunity_items
purpose: Opportunity slots (content_marketing, thought_leadership, etc.) that can be promoted to campaigns.
fields: id, company_id, type, title, summary, status, slot_state, action_taken, scheduled_for, ...
foreign_keys: company_id

### TABLE
name: opportunity_to_campaign
purpose: Links promoted opportunities to campaigns.
fields: opportunity_id, campaign_id, promoted_at, promoted_by
foreign_keys: opportunity_id → opportunity_items(id), campaign_id → campaigns(id)

### TABLE
name: campaign_opportunities
purpose: Campaign opportunities derived from strategic themes (campaignOpportunityEngine).
fields: theme_id, opportunity_type, ...
foreign_keys: theme_id → strategic_themes

### TABLE
name: campaign_narratives
purpose: Narratives derived from content opportunities.
fields: Per database/campaign_narratives.sql

### TABLE
name: recommendation_snapshots
purpose: Stored recommendation results (trend_topic, platforms, etc.); linked via campaign_id when used.
fields: id, company_id, trend_topic, campaign_id, snapshot_hash, ...
foreign_keys: company_id

### TABLE
name: audit_logs
purpose: Actions like RECOMMENDATION_CONVERTED_TO_CAMPAIGN, RECOMMENDATIONS_GROUPED_TO_CAMPAIGN.
fields: action, actor_user_id, company_id, metadata, created_at

---

## 3. CAMPAIGN CREATION FLOW

### FLOW
name: Manual Create Campaign
entry_file: `pages/create-campaign.tsx`
step_1: User fills form (name, context mode, primary/secondary types, regions).
step_2: createCampaign() calls POST /api/campaigns with campaign payload.
step_3: API inserts campaigns + campaign_versions.
step_4: Redirect to /campaign-details/[newCampaignId].
final_output: Campaign in planning stage; user completes pre-planning in campaign details.

### FLOW
name: Single Recommendation → Create Campaign
entry_file: `pages/api/recommendations/[id]/create-campaign.ts`
step_1: Load recommendation, decision state, team opinion.
step_2: Insert campaigns + campaign_versions (build_mode: recommendation).
step_3: runCampaignAiPlan({ mode: 'generate_plan', message: recommendation context }).
step_4: Link recommendation to campaign; audit log RECOMMENDATION_CONVERTED_TO_CAMPAIGN.
final_output: { campaign_id, snapshot_hash, omnivyre_decision }; plan in draft blueprint.

### FLOW
name: Group Recommendations → Create Campaign
entry_file: `pages/api/recommendations/create-campaign-from-group.ts`
step_1: Load snapshots by snapshot_hashes, team opinion.
step_2: Insert campaigns + campaign_versions (build_mode: recommendation).
step_3: runCampaignAiPlan({ mode: 'generate_plan', message: grouping + suggestions }).
step_4: Link recommendations; audit log RECOMMENDATIONS_GROUPED_TO_CAMPAIGN.
final_output: { campaign_id, snapshot_hash, omnivyre_decision }.

### FLOW
name: Recommendation Card → Build Campaign Blueprint
entry_file: `components/recommendations/tabs/TrendCampaignsTab.tsx` (onBuildCampaignBlueprint)
step_1: If generatedCampaignId: PUT /api/campaigns/[id]/source-recommendation. Else: POST /api/campaigns, then PUT source-recommendation.
step_2: source-recommendation merges source_strategic_theme, source_recommendation_id, execution_config into campaign_versions.campaign_snapshot.
step_3: Optionally: BOLT execute (POST /api/bolt/execute) or redirect to campaign-details.
step_4: User lands on campaign-details; CampaignAIChat available for plan generation.
final_output: Campaign with saved card; blueprint generated later via AI plan or BOLT.

### FLOW
name: BOLT Turbo / Fast Blueprint
entry_file: `pages/api/bolt/execute.ts`
step_1: Create bolt_execution_runs row; enqueue BullMQ job.
step_2: source-recommendation: create/update campaign, save source_strategic_theme.
step_3: ai/plan: runCampaignAiPlan → twelve_week_plan.
step_4: commit-plan: save blueprint to campaign.
step_5: generate-weekly-structure: daily_content_plans.
step_6: schedule-structured-plan: scheduled_posts (optional).
final_output: Campaign with committed plan, daily plans, optionally scheduled posts.

### FLOW
name: Opportunity → Promote to Campaign
entry_file: `pages/api/opportunities/[id]/action.ts` (action: PROMOTED)
step_1: promoteToCampaign(opportunityId, companyId, userId).
step_2: Insert campaigns (name from opportunity.title).
step_3: Insert campaign_versions (source_opportunity_id, target_regions, context_payload).
step_4: Insert opportunity_to_campaign; takeAction(opportunityId, 'PROMOTED').
final_output: { campaignId }; campaign in planning; no AI plan yet.

---

## 4. AI SYSTEMS USED

### AI_COMPONENT
name: generateCampaignPlan
file_location: `backend/services/aiGateway.ts`
purpose: Generate 12-week campaign plan from prompt.
input_structure: messages (system + user), model, temperature
output_structure: string (JSON or text)
where_used: campaignAiOrchestrator.runCampaignAiPlan → ai/plan stage

### AI_COMPONENT
name: generateRecommendation
file_location: `backend/services/aiGateway.ts`
purpose: Generate recommendation / trend cards.
input_structure: messages, model, temperature
output_structure: string
where_used: recommendationEngineService (Trend Campaigns generate)

### AI_COMPONENT
name: generateDailyPlan
file_location: `backend/services/aiGateway.ts`
purpose: Generate daily content plan from weekly structure.
input_structure: messages, model, temperature
output_structure: string
where_used: campaignRecommendationService, campaignAiOrchestrator

### AI_COMPONENT
name: generateDailyDistributionPlan
file_location: `backend/services/aiGateway.ts`
purpose: Generate daily distribution plan.
input_structure: messages, model, temperature
output_structure: string
where_used: campaignAiOrchestrator, planning flows

### AI_COMPONENT
name: contentGenerationService.generateContentForDay
file_location: `backend/services/contentGenerationService.ts`
purpose: Generate platform-specific content (headline, caption, hook, CTA, hashtags).
input_structure: companyProfile, campaign, weekPlan, dayPlan, platform, trend
output_structure: { headline, caption, hook, callToAction, hashtags, script?, blogDraft?, tone, reasoning }
where_used: content generation pipeline, autopilot

### AI_COMPONENT
name: runCampaignAiPlan
file_location: `backend/services/campaignAiOrchestrator.ts`
purpose: Orchestrates AI plan generation, parsing, validation, persistence.
input_structure: CampaignAiPlanInput (campaignId, mode, message, durationWeeks, collectedPlanningContext, ...)
output_structure: CampaignAiPlanResult (plan, snapshot_hash, omnivyre_decision, ...)
where_used: create-campaign, create-campaign-from-group, ai/plan API, BOLT ai/plan stage

---

## 5. CONTENT CLASSIFICATION

### CONTENT_CLASSIFICATION
location: `daily_content_plans.ai_generated`
logic: Boolean; true when row built from AI distribution path (generate-weekly-structure AI branch); false when from blueprint execution_items path. Not used to infer CREATOR_REQUIRED vs AI_AUTOMATED (use content_type + media instead).
storage_location: daily_content_plans row
ui_usage: activity-workspace may show ai_generated; calendar/Activity type does not map it; executionCategoryColors (AI Assisted = green, Creator Dependent = red)

### CONTENT_CLASSIFICATION
location: `campaigns.ai_generated_summary`
logic: AI-generated campaign summary text.
storage_location: campaigns table
ui_usage: Campaign summary display

### CONTENT_CLASSIFICATION
location: `content_plans.content_type` = 'ai_generated_plan'
logic: Draft/AI plan content type.
storage_location: content_plans
ui_usage: Plan retrieval

### CONTENT_CLASSIFICATION
location: `components/weekly-board/executionCategoryColors.ts`
logic: AI Assisted = green, Hybrid = orange, Creator Dependent = red (border/display).
storage_location: Frontend
ui_usage: Activity card color coding

### CONTENT_CLASSIFICATION
location: `CampaignAIChat.tsx` CREATOR_DEPENDENT_PLANNING_LABELS
logic: Labels like video, audio, podcast treated as creator-dependent for planning options.
storage_location: components/CampaignAIChat.tsx
ui_usage: Content type picker filtering

---

## 6. CALENDAR / SCHEDULING

### SCHEDULING_SYSTEM
service_name: findDuePostsAndEnqueue
file_location: `backend/scheduler/schedulerService.ts`
input: Query scheduled_posts where status='scheduled' AND scheduled_for <= NOW()
output: Creates queue_jobs, enqueues BullMQ publish jobs; skips if campaign not active/ready
dependencies: BullMQ, campaignReadinessService, scheduled_posts

### SCHEDULING_SYSTEM
service_name: scheduleStructuredPlan
file_location: `backend/services/structuredPlanScheduler.ts` (invoked by boltPipelineService)
input: Plan, campaign, platforms
output: scheduled_posts rows
dependencies: boltPipelineService, daily_content_plans, campaigns

### SCHEDULING_SYSTEM
service_name: cron scheduler
file_location: `backend/scheduler/cron.ts`
input: CRON_INTERVAL_MS (default 60s)
output: Runs findDuePostsAndEnqueue; governance audit; auto-optimization; intelligence polling; signal clustering; opportunity slots; etc.
dependencies: schedulerService, jobs

### SCHEDULING_SYSTEM
service_name: weeklyScheduleAllocator
file_location: `backend/services/weeklyScheduleAllocator.ts`
input: Campaign, weekly plan, distribution config
output: Schedule allocation for daily slots
dependencies: campaignAiOrchestrator, planning intelligence

### SCHEDULING_SYSTEM
service_name: generateWeeklyStructure
file_location: `backend/services/generateWeeklyStructureService.ts`
input: Campaign, blueprint, execution config
output: daily_content_plans rows
dependencies: boltPipelineService, campaignPlanStore

---

## 7. DEPENDENCIES

### DEPENDENCY
name: trend signals / recommendation engine
service_location: `backend/services/recommendationEngineService.ts`
used_by: Create campaign from recommendation, TrendCampaignsTab generate, Build Campaign Blueprint

### DEPENDENCY
name: company profile
service_location: `backend/services/companyProfileService.ts`
used_by: campaignAiOrchestrator, contentGenerationService, recommendation flows

### DEPENDENCY
name: external APIs
service_location: `backend/services/externalApiService.ts`
used_by: recommendation engine, campaign audit, platform strategies

### DEPENDENCY
name: campaign planning inputs
service_location: `backend/services/campaignPlanningInputsService.ts`
used_by: create-campaign, create-campaign-from-group, ai/plan

### DEPENDENCY
name: content generation pipeline
service_location: `backend/services/contentGenerationPipeline.ts` (attachGenerationPipelineToDailyItems)
used_by: campaignAiOrchestrator, autopilot, BOLT

### DEPENDENCY
name: media / content assets
service_location: `backend/db/contentAssetStore.ts`, `backend/services/contentAssetService.ts`
used_by: Content generation, scheduled posts

### DEPENDENCY
name: platform eligibility
service_location: `backend/utils/platformEligibility.ts`
used_by: boltPipelineService, planning flows

### DEPENDENCY
name: opportunity engines
service_location: `backend/services/campaignOpportunityEngine.ts`, `backend/services/contentOpportunityEngine.ts`
used_by: Background cron; creates campaign opportunities from strategic themes (does not create campaigns directly)

### DEPENDENCY
name: RBAC
service_location: `backend/services/rbacService.ts`
used_by: campaigns API, create-campaign, create-campaign-from-group, opportunities action

---

## 8. REUSABLE COMPONENTS

### REUSABLE_COMPONENT
name: AI content generation (campaign plan)
location: `backend/services/campaignAiOrchestrator.ts`, `backend/services/aiGateway.ts`
purpose: Generate and parse 12-week plans, refine days, platform customize

### REUSABLE_COMPONENT
name: Content generation pipeline
location: `backend/services/contentGenerationPipeline.ts`, `backend/services/contentGenerationService.ts`
purpose: Generate platform-specific content (headline, caption, hook, etc.)

### REUSABLE_COMPONENT
name: Publishing pipeline
location: `backend/scheduler/schedulerService.ts`, BullMQ publish worker, queue_jobs
purpose: Find due scheduled_posts, enqueue publish jobs

### REUSABLE_COMPONENT
name: Platform integrations
location: `backend/services/externalApiService.ts`, social_accounts, scheduled_posts
purpose: Platform strategies, posting

### REUSABLE_COMPONENT
name: Structured plan scheduler
location: `backend/services/structuredPlanScheduler.ts`
purpose: Convert plan to scheduled_posts

### REUSABLE_COMPONENT
name: Trend / recommendation intelligence
location: `backend/services/recommendationEngineService.ts`, signalClusterEngine, signalIntelligenceEngine
purpose: Trend cards, strategic themes

### REUSABLE_COMPONENT
name: Campaign blueprint adapter
location: `backend/services/campaignBlueprintAdapter.ts`
purpose: Convert between plan formats (fromStructuredPlan, fromRecommendationPlan)

### REUSABLE_COMPONENT
name: Campaign plan store
location: `backend/db/campaignPlanStore.ts`
purpose: Save/load blueprint, structured plan, daily updates

---

## 9. POTENTIAL BREAKPOINTS

### BREAKPOINT
component: campaign_versions.company_id → campaign list
reason: Campaign list fetches via campaign_versions; campaigns created without campaign_versions row (or wrong company_id) do not appear
risk_level: high

### BREAKPOINT
component: source_strategic_theme on campaign_versions
reason: regenerate-blueprint and plan API use source_strategic_theme for week plan; missing/incomplete theme degrades plan quality
risk_level: medium

### BREAKPOINT
component: runCampaignAiPlan input (collectedPlanningContext, recommendationContext)
reason: create-campaign flows merge getCampaignPlanningInputs + body; changing create flow must preserve or replace these inputs
risk_level: high

### BREAKPOINT
component: BOLT payload (sourceStrategicTheme, executionConfig)
reason: BOLT expects these; replacing Create Campaign must ensure BOLT-invoking paths still receive valid payload
risk_level: medium

### BREAKPOINT
component: RBAC / CREATE_CAMPAIGN permission
reason: Dashboard, campaigns list, create-campaign page check canCreateCampaign; API enforces CREATE_CAMPAIGN
risk_level: low

### BREAKPOINT
component: /create-campaign vs /campaign-planning?mode=create
reason: lib/campaign-navigation-logic points to campaign-planning?mode=create; some UI uses /create-campaign; inconsistent entry
risk_level: low

### BREAKPOINT
component: TrendCampaignsTab onBuildCampaignBlueprint
reason: Inline logic creates campaign or updates source-recommendation; depends on generatedCampaignId, POST campaigns contract, PUT source-recommendation contract
risk_level: high

### BREAKPOINT
component: opportunityService.promoteToCampaign
reason: Creates campaign + campaign_versions + opportunity_to_campaign; campaign_versions schema must match
risk_level: medium

### BREAKPOINT
component: boltPipelineService stage order
reason: source-recommendation → ai/plan → commit-plan → generate-weekly-structure → schedule-structured-plan; stages depend on prior outputs
risk_level: high

### BREAKPOINT
component: aiGateway / usage enforcement
reason: checkUsageBeforeExecution can reject with PLAN_LIMIT_EXCEEDED; create-campaign flows invoke AI
risk_level: medium
