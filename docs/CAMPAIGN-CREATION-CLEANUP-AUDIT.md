# Campaign Creation Cleanup Audit
## Module: Campaign Creation Cleanup | Product: Omnivyra

---

## 1. LEGACY CREATE CAMPAIGN IMPLEMENTATIONS

### LEGACY_CREATE_UI
file: `pages/create-campaign.tsx`
purpose: Dedicated form page for manual campaign creation; collects name, context mode, primary/secondary campaign types, regions; POST /api/campaigns; redirects to campaign-details/[id].
dependencies: useCompanyContext, fetchWithAuth, CampaignAIChat, EngineContextPanel, UnifiedContextModeSelector, campaignTypeHierarchy

### LEGACY_CREATE_UI
file: `pages/campaign-planning.tsx`
purpose: Campaign planning page; supports mode=create and mode=edit; in-memory "New Campaign" or POST /api/campaigns; CampaignAIChat, AIContentIntegration, WeeklyRefinementInterface.
dependencies: fetchWithAuth, CampaignAIChat, AIContentIntegration, ContentCreationPanel, VoiceNotesComponent

### LEGACY_CREATE_UI
file: `pages/campaign-planning/hierarchical.tsx`
purpose: Hierarchical campaign planning view; links to /campaign-planning with campaignId; week/day navigation.
dependencies: campaign navigation state

---

## 2. LEGACY ROUTES

### LEGACY_ROUTE
route: /create-campaign
file: `pages/create-campaign.tsx`
purpose: Dedicated campaign creation form; primary entry for manual create.

### LEGACY_ROUTE
route: /campaign-planning
file: `pages/campaign-planning.tsx`
purpose: Campaign planning / editing; can create or edit campaigns via query params.

### LEGACY_ROUTE
route: /campaign-planning?mode=create
file: `lib/campaign-navigation-logic.ts` (CampaignListButtons.createCampaign)
purpose: Legacy create mode; referenced by campaign-navigation-logic but not used by campaigns.tsx or DashboardPage (they use /create-campaign).

### LEGACY_ROUTE
route: /campaign-planning/hierarchical
file: `pages/campaign-planning/hierarchical.tsx`
purpose: Hierarchical week/day planning view.

---

## 3. NAVIGATION REFERENCES

### NAV_REFERENCE
file: `components/DashboardPage.tsx`
line_number: 595
usage_context: Create Campaign button onClick

### NAV_REFERENCE
file: `components/DashboardPage.tsx`
line_number: 784
usage_context: Create Campaign button onClick

### NAV_REFERENCE
file: `components/DashboardPage.tsx`
line_number: 1070
usage_context: Create Campaign button onClick

### NAV_REFERENCE
file: `components/DashboardPage.tsx`
line_number: 1114
usage_context: Create Campaign button onClick

### NAV_REFERENCE
file: `pages/campaigns.tsx`
line_number: 210
usage_context: Create New Campaign button onClick

### NAV_REFERENCE
file: `pages/campaigns.tsx`
line_number: 312
usage_context: Create Your First Campaign button onClick

### NAV_REFERENCE
file: `pages/campaign-planner.tsx`
line_number: 102
usage_context: Fallback link to /create-campaign in Phase 1 placeholder text

---

## 4. DUPLICATE CREATION LOGIC

### DUPLICATE_CREATION
component: POST /api/campaigns
file: `pages/api/campaigns/index.ts`
creation_method: Direct insert campaigns + campaign_versions; canonical endpoint.

### DUPLICATE_CREATION
component: recommendations/[id]/create-campaign
file: `pages/api/recommendations/[id]/create-campaign.ts`
creation_method: Supabase campaigns.insert + campaign_versions.insert; then runCampaignAiPlan; used by recommendations.tsx handleCreateCampaignFromRecommendation, handlePreparePlanFromRecommendation.

### DUPLICATE_CREATION
component: create-campaign-from-group
file: `pages/api/recommendations/create-campaign-from-group.ts`
creation_method: Supabase campaigns.insert + campaign_versions.insert; then runCampaignAiPlan; used by recommendations.tsx group create flow.

### DUPLICATE_CREATION
component: opportunityService.promoteToCampaign
file: `backend/services/opportunityService.ts`
creation_method: Supabase campaigns.insert + campaign_versions.insert + opportunity_to_campaign; used by POST /api/opportunities/[id]/action (PROMOTED).

### DUPLICATE_CREATION
component: TrendCampaignsTab onBuildCampaignBlueprint
file: `components/recommendations/tabs/TrendCampaignsTab.tsx`
creation_method: If generatedCampaignId: PUT source-recommendation only. Else: POST /api/campaigns with full payload (inline fetch); then redirect to campaign-details.

### DUPLICATE_CREATION
component: boltPipelineService runSourceRecommendation
file: `backend/services/boltPipelineService.ts`
creation_method: If generatedCampaignId: PUT source-recommendation. Else: Supabase campaigns.insert; then campaign_versions.insert; used by BOLT execute.

---

## 5. CAMPAIGN CREATION API CONTRACT

### CREATE_API
endpoint: POST /api/campaigns
file: `pages/api/campaigns/index.ts`

input_schema:
- companyId (required, query or body)
- id, name, description, status, current_stage
- build_mode, context_scope, campaign_types, campaign_weights
- planning_context, source_strategic_theme, execution_config
- source_opportunity_id, recommendation_id, target_regions, context_payload
- virality_playbook_id, market_scope, company_stage, baseline_override

output_schema:
- { success: true, campaign: { id, ... }, message: string } (201)

---

## 6. POTENTIAL CONFLICT

### POTENTIAL_CONFLICT
component: campaign-planning.tsx
file: `pages/campaign-planning.tsx`
reason: Supports mode=create; CampaignAIChat with context campaign-planning; can create campaigns; overlaps with create-campaign and planner.

### POTENTIAL_CONFLICT
component: CampaignAIChat
file: `components/CampaignAIChat.tsx`
reason: campaign-planning context triggers plan generation; used by campaign-planning and campaign-details; planner may need same or different initialization.

### POTENTIAL_CONFLICT
component: lib/campaign-navigation-logic
file: `lib/campaign-navigation-logic.ts`
reason: CampaignListButtons.createCampaign points to /campaign-planning?mode=create; AIIntegration.generate12WeekPlan calls /api/campaigns/create-12week-plan; Routes.createCampaign = /campaign-planning?mode=create; inconsistent with /create-campaign used elsewhere.

### POTENTIAL_CONFLICT
component: campaign-planning/hierarchical
file: `pages/campaign-planning/hierarchical.tsx`
reason: Links to /campaign-planning; href="/campaign-planning"; may receive users expecting create vs edit.

---

## 7. SAFE REMOVAL CANDIDATES

### REMOVAL_CANDIDATE
component: /create-campaign page
file: `pages/create-campaign.tsx`
reason: Replace with redirect to /campaign-planner after planner migration; or serve planner at same path.

### REMOVAL_CANDIDATE
component: campaign-navigation-logic createCampaign reference
file: `lib/campaign-navigation-logic.ts`
reason: Routes.createCampaign and CampaignListButtons.createCampaign point to /campaign-planning?mode=create; not used by campaigns.tsx or DashboardPage (they hardcode /create-campaign); can update to planner or remove if unused.

### REMOVAL_CANDIDATE
component: campaign-planning mode=create branch
file: `pages/campaign-planning.tsx`
reason: If planner becomes canonical create entry; campaign-planning could serve only edit mode (campaignId required).

---

## 8. CORE COMPONENTS TO KEEP

### CORE_COMPONENT
name: campaignAiOrchestrator
file: `backend/services/campaignAiOrchestrator.ts`
purpose: AI plan generation, parsing, validation; runCampaignAiPlan

### CORE_COMPONENT
name: campaignPlanStore
file: `backend/db/campaignPlanStore.ts`
purpose: Save/load blueprint, structured plan

### CORE_COMPONENT
name: generateWeeklyStructureService
file: `backend/services/generateWeeklyStructureService.ts`
purpose: Build daily_content_plans from blueprint

### CORE_COMPONENT
name: contentGenerationPipeline
file: `backend/services/contentGenerationPipeline.ts`
purpose: Content generation for slots; attachGenerationPipelineToDailyItems

### CORE_COMPONENT
name: boltPipelineService
file: `backend/services/boltPipelineService.ts`
purpose: BOLT stages; source-recommendation, ai/plan, commit-plan, generate-weekly-structure, schedule-structured-plan

### CORE_COMPONENT
name: campaigns API POST
file: `pages/api/campaigns/index.ts`
purpose: Canonical campaign creation; inserts campaigns + campaign_versions

### CORE_COMPONENT
name: source-recommendation API
file: `pages/api/campaigns/[id]/source-recommendation.ts`
purpose: Save source_strategic_theme to campaign; used by TrendCampaignsTab, BOLT

### CORE_COMPONENT
name: recommendation create-campaign APIs
file: `pages/api/recommendations/[id]/create-campaign.ts`, `pages/api/recommendations/create-campaign-from-group.ts`
purpose: Recommendation → campaign flows; runCampaignAiPlan

### CORE_COMPONENT
name: opportunityService.promoteToCampaign
file: `backend/services/opportunityService.ts`
purpose: Opportunity → campaign promotion
