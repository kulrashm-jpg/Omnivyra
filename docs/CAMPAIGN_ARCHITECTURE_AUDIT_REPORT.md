# Campaign-Related Architecture Audit Report

**Date:** February 13, 2025  
**Scope:** Campaign creation flow, recommendation engines, company profile data, campaign data model, AI integration, gaps for structured 12-week planning  
**Methodology:** Code inspection only. No code modifications. No solution proposals.

---

## Executive Summary

The application has **multiple entry points** for campaign creation, a **fragmented** campaign model, and **several recommendation/opportunity engines** that produce varied output formats. Company profile data (commercial strategy, marketing intelligence) exists and is **locked when user-edited**, but most of it is **not used during campaign creation**. AI is invoked in multiple places with **mostly free-form prompts**; some responses are parsed into structured data via OpenAI JSON mode and Zod schemas. The system has **basic 12-week structure** (weekly themes, daily plans, refinements) but lacks baseline metrics, growth targets, production capacity inputs, feasibility checks, and guardrail validation needed for structured 12-week planning.

---

## 1. Current Architecture Map

### High-Level Flow

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│  ENTRY POINTS FOR CAMPAIGN CREATION                                               │
├─────────────────────────────────────────────────────────────────────────────────┤
│  1. /create-campaign        → POST /api/campaigns                                 │
│  2. /campaign-planning      → In-memory "New Campaign" OR POST /api/campaigns     │
│  3. /recommendations        → POST /api/recommendations/[id]/create-campaign     │
│  4. opportunity promote     → POST /api/opportunities/[id]/promote                │
└─────────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│  PERSISTENCE                                                                    │
├─────────────────────────────────────────────────────────────────────────────────┤
│  campaigns          campaign_versions         campaign_goals                     │
│  (core record)      (company_id mapping)      (content goals)                   │
│                     (campaign_snapshot)       weekly_content_refinements       │
│                     target_regions,           daily_content_plans               │
│                     context_payload,           campaign_strategies              │
│                     source_opportunity_id)     campaign_readiness               │
└─────────────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Campaign Creation Flow

### campaign_creation_flow

```json
{
  "entry_points": [
    {
      "path": "/create-campaign",
      "action": "Create campaign via form → POST /api/campaigns",
      "company_profile_used": false,
      "ai_triggered": "Optional (Create + Generate 12-Week Plan)"
    },
    {
      "path": "/campaign-planning",
      "action": "Creates in-memory campaign or redirects to create flow; opens AI chat",
      "company_profile_used": false,
      "ai_triggered": "Yes (generate_plan via CampaignAIChat)"
    },
    {
      "path": "/recommendations → Create Campaign from recommendation",
      "action": "POST /api/recommendations/[id]/create-campaign",
      "company_profile_used": false,
      "ai_triggered": "Yes (runCampaignAiPlan with recommendation context in message)"
    },
    {
      "path": "/recommendations (opportunity promote)",
      "action": "POST /api/opportunities/[id]/promote",
      "company_profile_used": false,
      "ai_triggered": "No at creation; AI later when generating plan"
    }
  ],
  "api_routes": [
    "POST /api/campaigns",
    "POST /api/campaigns/save",
    "POST /api/campaigns/create-12week-plan",
    "POST /api/campaigns/ai/plan",
    "POST /api/recommendations/[id]/create-campaign",
    "POST /api/recommendations/create-campaign-from-group",
    "POST /api/opportunities/[id]/promote"
  ],
  "services_used": [
    "campaignAiOrchestrator (runCampaignAiPlan)",
    "viralitySnapshotBuilder (buildCampaignSnapshotWithHash)",
    "viralityAdvisorService (assessVirality)",
    "omnivyreClient (requestDecision)",
    "campaignPlanParser (parseAiPlanToWeeks, parseAiRefinedDay, parseAiPlatformCustomization)",
    "campaignPlanStore (saveStructuredCampaignPlan, saveStructuredCampaignPlanDayUpdate, savePlatformCustomizedContent)",
    "externalApiService (getPlatformStrategies)",
    "recommendationCampaignBuilder (buildCampaignFromRecommendation)",
    "opportunityService (promoteOpportunityToCampaign)"
  ],
  "database_tables": [
    "campaigns",
    "campaign_versions",
    "campaign_goals",
    "campaign_strategies",
    "weekly_content_refinements",
    "daily_content_plans",
    "campaign_performance",
    "scheduled_posts",
    "ai_threads",
    "campaign_plan_ai_history",
    "opportunity_items",
    "opportunity_to_campaign"
  ],
  "ai_invocations": [
    "campaignAiOrchestrator.generateCampaignPlan (generate_plan, refine_day, platform_customize)",
    "campaignPlanParser.parseAiPlanToWeeks (free-form → JSON)",
    "campaignPlanParser.parseAiRefinedDay",
    "campaignPlanParser.parseAiPlatformCustomization",
    "create-12week-plan: generateWeeklyThemes (hardcoded, not AI)"
  ],
  "output_structure": {
    "create_flow": "Campaign record + campaign_versions row; status 'pending_approval' or 'planning'",
    "ai_plan_flow": "Structured plan with weeks[].theme, weeks[].daily[], persisted to weekly_content_plans/daily_content_plans"
  }
}
```

### Data Sources Feeding Campaign Creation

| Source | Used in create-campaign | Used in campaign-planning | Used in recommendation→campaign | Used in opportunity→campaign |
|--------|-------------------------|--------------------------|---------------------------------|------------------------------|
| Form fields (name, timeframe, dates, goals) | Yes | Yes | No (auto-generated) | Partial (prefill) |
| Company profile | **No** | **No** | **No** | **No** |
| Recommendation snapshot | N/A | N/A | Yes (trend_topic, platforms in message) | N/A |
| Opportunity payload | N/A | N/A | N/A | Yes (context_payload, target_regions in campaign_versions) |
| Campaign snapshot (existing) | N/A | N/A | N/A | N/A |
| Platform strategies | No (AI uses defaults) | Yes (via orchestrator) | Yes (via orchestrator) | Yes (via orchestrator) |

---

## 3. Recommendation Engine Map

### recommendation_engine_map

| name | purpose | inputs | outputs | persistence | company_dependency |
|------|---------|--------|---------|-------------|-------------------|
| **recommendationEngineService** (Trend) | Trend-based recommendations for 12-week planning | companyId, campaignId?, regions, objective, durationWeeks, profile (auto-refined) | weekly_plan, daily_plan, trends_used, trends_ignored, confidence_score, persona_summary | Ephemeral (returned to caller; no dedicated storage for plan) | Yes (profile, platform strategies) |
| **recommendationEngine** (legacy) | Trend scoring with policy weights | companyProfile, trend signals | Array of Recommendation (title, trend, scores, platforms) | Ephemeral (recommendationAuditService logs) | Yes |
| **opportunityGenerators** (TREND) | Strategic theme opportunities | companyId, StrategicPayload (offerings, regions, cluster_inputs) | opportunity_items rows (type=TREND) | opportunity_items | Yes |
| **opportunityGenerators** (LEAD) | Lead-based opportunities | companyId | opportunity_items rows (type=LEAD) | opportunity_items | Yes |
| **opportunityGenerators** (PULSE) | Market pulse / spike opportunities | companyId | opportunity_items rows (type=PULSE) | opportunity_items | Yes |
| **opportunityGenerators** (SEASONAL) | Seasonal/event opportunities | companyId | opportunity_items rows (type=SEASONAL) | opportunity_items | Yes |
| **opportunityGenerators** (INFLUENCER) | Influencer collaboration opportunities | companyId | opportunity_items rows (type=INFLUENCER) | opportunity_items | Yes |
| **opportunityGenerators** (DAILY_FOCUS) | Daily focus actions | companyId | opportunity_items rows (type=DAILY_FOCUS) | opportunity_items | Yes |
| **recommendationConsolidator** | Multi-region trend consolidation | job, raw signals | unified_recommendation, region_wise_differences, campaign_ready_summary | recommendation_analysis | Yes (profile summary) |
| **campaignRecommendationService** | Campaign-specific recommendations | campaignId, companyId | RecommendationItem[] | Ephemeral | Yes |
| **marketPulseJobProcessor** | Process market pulse jobs | job_id, context_payload | Topics per region | market_pulse_* tables | Yes |
| **leadJobProcessor** | Process lead jobs | job_id, context_payload | Lead clusters | lead_* tables | Yes |

### Output Format Summary

| Engine | Output type | Structured | Stored |
|--------|-------------|------------|--------|
| recommendationEngineService | weekly_plan[], daily_plan[], trends_used | Partially (arrays) | No |
| opportunityGenerators | opportunity_items rows | Yes (DB) | Yes |
| recommendationConsolidator | JSON (unified_recommendation, etc.) | Yes | recommendation_analysis |
| create-12week-plan | weeklyThemes (hardcoded), weeklyPlans | Yes (arrays) | campaigns.weekly_themes, weekly_content_refinements |

---

## 4. Company Profile Data Availability

### company_profile_data_map

```json
{
  "commercial_fields": [
    "target_customer_segment",
    "ideal_customer_profile",
    "pricing_model",
    "sales_motion",
    "avg_deal_size",
    "sales_cycle",
    "key_metrics"
  ],
  "marketing_intelligence_fields": [
    "marketing_channels",
    "content_strategy",
    "campaign_focus",
    "key_messages",
    "brand_positioning",
    "competitive_advantages",
    "growth_priorities"
  ],
  "campaign_purpose_intent": {
    "primary_objective",
    "campaign_intent",
    "monetization_intent",
    "dominant_problem_domains",
    "brand_positioning_angle"
  },
  "locked_when_user_edited": "user_locked_fields tracks COMMERCIAL_FIELD_NAMES + MARKETING_INTELLIGENCE_FIELD_NAMES; AI refinement skips these",
  "accessible_in_campaign_flow": [
    "None — create-campaign and campaign-planning do NOT fetch or pass company profile to campaign creation or AI"
  ],
  "unused_but_available": [
    "target_customer_segment",
    "ideal_customer_profile",
    "pricing_model",
    "sales_motion",
    "avg_deal_size",
    "sales_cycle",
    "key_metrics",
    "marketing_channels",
    "content_strategy",
    "campaign_focus",
    "key_messages",
    "brand_positioning",
    "competitive_advantages",
    "growth_priorities",
    "campaign_purpose_intent"
  ],
  "used_elsewhere": [
    "recommendationEngineService uses profile (industry, category, geography, content_themes) for trend signals",
    "opportunityGenerators uses company context via buildUnifiedContext",
    "recommendationConsolidator uses profile summary (industry, category, geography, content_themes)",
    "api/recommendations/generate opportunity analysis uses full profile"
  ]
}
```

### Locking Logic

- Commercial and marketing intelligence fields are editable by user.
- When user saves a non-empty value for any of these fields, the field name is added to `user_locked_fields`.
- AI refinement (refineProfileWithAI) does NOT overwrite locked fields.

---

## 5. Campaign Data Model

### campaign_data_model

```json
{
  "campaign_fields": [
    "id",
    "user_id",
    "name",
    "description",
    "status",
    "current_stage",
    "timeframe",
    "start_date",
    "end_date",
    "thread_id",
    "virality_playbook_id",
    "objective",
    "target_audience",
    "content_focus",
    "target_metrics",
    "campaign_summary",
    "ai_generated_summary",
    "weekly_themes",
    "performance_targets"
  ],
  "weekly_structure_exists": true,
  "weekly_tables": [
    "weekly_content_refinements (theme, focus_area, content_plan)",
    "weekly_content_plans (campaignReadinessService)"
  ],
  "scheduling_logic": true,
  "scheduling_tables": [
    "daily_content_plans",
    "scheduled_posts"
  ],
  "platform_mapping": true,
  "platform_sources": [
    "getPlatformStrategies (externalApiService)",
    "platform_strategies / platform_rules in company"
  ],
  "content_volume_tracking": true,
  "content_tracking_tables": [
    "campaign_goals (quantity, frequency)",
    "campaign_performance (total_reach, total_engagement, etc.)",
    "content_plans (status)"
  ],
  "phase_logic": "No explicit phase (e.g. awareness/consideration/conversion); only weekly themes",
  "company_linkage": "campaign_versions (company_id ↔ campaign_id); campaigns table has NO company_id"
}
```

### Weekly Structure

- **weekly_content_refinements**: theme, focus_area, ai_suggestions, refinement_status.
- **weekly_themes** (campaigns.weekly_themes): JSONB array; used by create-12week-plan with **hardcoded** themes.
- **create-12week-plan**: Uses `generateWeeklyThemes(aiContent)` — themes are **fixed**, not derived from AI content.

---

## 6. AI Integration Audit

### ai_integration_map

```json
{
  "ai_entry_points": [
    "/api/campaigns/ai/plan",
    "/api/ai/generate-content",
    "/api/ai/claude-chat",
    "/api/ai/gpt-chat",
    "backend: campaignAiOrchestrator",
    "backend: campaignPlanParser",
    "backend: contentGenerationService",
    "backend: companyProfileService (refineProfileWithAI, extraction)",
    "backend: opportunityGenerators (runDiagnosticPrompt)",
    "api/recommendations/generate (opportunity analysis)",
    "api/company-profile/define-target-customer",
    "api/company-profile/define-marketing-intelligence",
    "api/company-profile/define-campaign-purpose",
    "api/company-profile/generate-marketing-intelligence"
  ],
  "prompt_locations": [
    "backend/services/campaignAiOrchestrator.ts (buildPromptContext)",
    "backend/services/campaignPlanParser.ts (parse schema instructions)",
    "backend/services/contentGenerationService.ts",
    "backend/services/companyProfileService.ts (buildExtractionPrompt, cleanEvidenceWithAi)",
    "backend/services/opportunityGenerators.ts",
    "pages/api/recommendations/generate.ts (opportunity analysis)"
  ],
  "structured_output": true,
  "structured_output_mechanisms": [
    "campaignPlanParser: Zod schemas (planSchema, dailyPlanSchema, refinedDaySchema)",
    "companyProfileService: response_format json_object + extractionSchema",
    "api/recommendations/generate: response_format json_object for opportunity_analysis"
  ],
  "validation_layer_exists": true,
  "validation_mechanisms": [
    "campaignPlanParser: Zod safeParse",
    "companyProfileService: Zod extractionSchema, buildExtractionWithDefaults"
  ],
  "prompt_nature": {
    "campaign_plan": "Dynamic (snapshot, diagnostics, platform strategies, recommendation context injected)",
    "company_profile": "Static extraction + dynamic evidence",
    "create_12week_plan": "No AI for themes — hardcoded generateWeeklyThemes"
  }
}
```

### AI Models Used

- **OpenAI**: gpt-4o-mini (default), gpt-4 (some endpoints)
- **Anthropic**: claude-sonnet-4-20250514 (claude-chat)
- Model config: `process.env.OPENAI_MODEL`, `process.env.OPENAI_API_KEY`

---

## 7. Data Persistence vs Transient

| Data | Persisted | Where | Transient |
|------|-----------|-------|-----------|
| Campaign record | Yes | campaigns | |
| Company-campaign link | Yes | campaign_versions | |
| Weekly themes (create-12week-plan) | Yes | campaigns.weekly_themes, weekly_content_refinements | |
| AI-generated plan (structured) | Yes | weekly_content_plans, daily_content_plans (via campaignPlanStore) | |
| Recommendation engine result (weekly_plan, daily_plan) | No | | Yes (returned to UI) |
| Opportunity analysis (relevance, narrative_angle) | No | | Yes (in-memory, sometimes in audit_logs metadata) |
| Campaign snapshot for AI | No | | Yes (built on each AI call) |
| Recommendation context (target_regions, context_payload) | Yes | campaign_versions.campaign_snapshot | |

---

## 8. Hardcoded Assumptions

| Location | Assumption |
|----------|------------|
| create-12week-plan.ts | 12 weeks fixed; weekly themes array is hardcoded (Foundation & Awareness, Problem-Solution Fit, etc.); weekly plans use fixed contentItems (linkedin/post, instagram/story, etc.) |
| campaignAiOrchestrator | GATHER_ORDER: 4 required questions (target_audience, platforms, key_messages, success_metrics) |
| recommendationEngineService | DEFAULT_DURATION_WEEKS = 12 |
| campaignReadinessService | Expects weekly_content_plans or weekly_content_refinements |
| viralitySnapshotBuilder | Expects weekly_content_refinements, daily_content_plans, scheduled_posts |
| create-campaign.tsx | timeframes: week, month, quarter, year; end date auto-calculated from start + timeframe |
| lib/campaign-navigation-logic.ts | createCampaign points to /campaign-planning?mode=create (may diverge from actual /create-campaign) |

---

## 9. Identified Gaps (Current System vs Structured 12-Week Planning)

1. **Missing baseline metrics**: No follower count, current reach, or engagement baseline stored or used in planning.

2. **Missing growth targets**: No structured growth targets (e.g., +X% followers, +Y engagement rate) at campaign or company level.

3. **Missing production capacity inputs**: No inputs for content production capacity (e.g., pieces per week, team size, approval latency).

4. **Missing feasibility checks**: No validation that proposed 12-week volume fits production capacity or resource constraints.

5. **Missing weekly breakdown structure in create flow**: create-12week-plan uses hardcoded themes; no AI-derived weekly breakdown during creation.

6. **Missing guardrail validation**: No validation that AI-generated plan stays within capacity, budget, or brand guardrails.

7. **Missing campaign readiness validation at creation**: Readiness is evaluated later (campaignReadinessService); no pre-creation readiness or completeness check.

8. **Company profile not used in campaign creation**: Commercial strategy, marketing intelligence, and campaign_purpose_intent are not passed to create-campaign or campaign-planning flow.

9. **Recommendation context only when promoted**: target_regions, context_payload flow only when campaign is created from opportunity/recommendation; scratch-created campaigns lack this.

10. **Inconsistent campaign creation paths**: create-campaign POST vs campaign-planning in-memory vs recommendation create-campaign vs opportunity promote — different data and status outcomes.

11. **No structured phase logic**: No awareness/consideration/conversion phases; only weekly themes.

12. **Platform strategies from external API, not from profile**: Platform preferences come from externalApiService/platform_rules, not from company profile marketing intelligence.

13. **create-12week-plan bypasses main AI flow**: Uses separate API and hardcoded themes; does not use campaignAiOrchestrator or recommendationEngineService output.

14. **campaign_versions.campaign_snapshot schema variability**: target_regions, context_payload, source_opportunity_id exist but structure varies by source (opportunity vs recommendation).

15. **No production capacity or scheduling guardrails**: Daily plans can be created without checking against team capacity or content calendar conflicts.

16. **Campaigns from recommendation flows not linked to company**: `POST /api/recommendations/[id]/create-campaign` and `POST /api/recommendations/create-campaign-from-group` create campaign records but do NOT insert into `campaign_versions`. Company campaign lists fetch via `campaign_versions`; these campaigns would not appear.

---

## 10. Data Availability Matrix

| Data | Create Campaign (form) | Campaign Planning (AI) | Recommendation→Campaign | Opportunity→Campaign |
|------|------------------------|------------------------|-------------------------|----------------------|
| Campaign name | ✓ (user) | ✓ (user/default) | ✓ (auto: "Trend: {topic}") | ✓ (prefill) |
| Timeframe | ✓ (user) | ✓ (user) | — | — |
| Start/end dates | ✓ (user/calculated) | ✓ (user) | — | — |
| Company profile | ✗ | ✗ | ✗ | ✗ |
| Commercial strategy | ✗ | ✗ | ✗ | ✗ |
| Marketing intelligence | ✗ | ✗ | ✗ | ✗ |
| Trend/recommendation context | ✗ | ✗ | ✓ (in message) | ✓ (campaign_versions) |
| Platform strategies | ✗ | ✓ (orchestrator) | ✓ | ✓ |
| Campaign snapshot (existing) | ✗ | ✓ (orchestrator) | ✓ | ✓ |

---

## Appendix: Key File References

| Area | Files |
|------|-------|
| Campaign creation API | pages/api/campaigns/index.ts |
| Create 12-week plan | pages/api/campaigns/create-12week-plan.ts |
| Campaign AI plan | pages/api/campaigns/ai/plan.ts |
| Campaign orchestrator | backend/services/campaignAiOrchestrator.ts |
| Campaign snapshot | backend/services/viralitySnapshotBuilder.ts |
| Campaign parser | backend/services/campaignPlanParser.ts |
| Company profile | backend/services/companyProfileService.ts |
| Recommendation engine | backend/services/recommendationEngineService.ts |
| Opportunity generators | backend/services/opportunityGenerators.ts |
| Campaign readiness | backend/services/campaignReadinessService.ts |
| Recommendation→campaign | pages/api/recommendations/[id]/create-campaign.ts |
| Opportunity promote | backend/services/opportunityService.ts |
| Create campaign page | pages/create-campaign.tsx |
| Campaign planning page | pages/campaign-planning.tsx |
| Campaign details + AI chat | pages/campaign-details/[id].tsx |

---

*End of audit. No solutions proposed. Based on code inspection only.*
