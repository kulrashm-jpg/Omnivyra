# Company Profile Architecture Audit

**Audit Date:** Feb 20, 2025  
**Scope:** Analysis and placement only — no implementation, schema migration, or refactor.

---

## SECTION: CURRENT_PROFILE_STRUCTURE

### Table: company_profiles

| field_name | type | used_in | purpose |
|------------|------|---------|---------|
| id | UUID | PK, internal | Primary key |
| company_id | TEXT | All consumers | Unique company identifier |
| name | TEXT | externalApiService, companyMissionContext, define-target-customer | Company name for prompts and runtime |
| industry | TEXT | normalizeCompanyProfile, trendAlignmentService, validateCompanyProfile, externalApiService | Industry for categories, geo, trend fetch |
| category | TEXT | externalApiService, pickProfileCategory | Category hint for trend API and runtime |
| website_url | TEXT | externalApiService, buildSourceList, crawl | Website for extraction, runtime values |
| products_services | TEXT | companyMissionContext, extraction | Products/services description |
| target_audience | TEXT | normalizeCompanyProfile, validateCompanyProfile, buildAudienceKeywords, companyMissionContext | Audience for scoring, gate, opportunities |
| geography | TEXT | trendAlignmentService, externalApiService, companyMissionContext | Geography hint for trends and context |
| brand_voice | TEXT | regenerate-blueprint, normalizeCompanyProfile, contentGenerationService | Brand tone for content and blueprint |
| goals | TEXT | trendAlignmentService, trendDriftService | Goals for theme tokens and scoring |
| competitors | TEXT | extraction | Competitors list |
| unique_value | TEXT | companyMissionContext, content themes | Value prop for mission context |
| content_themes | TEXT | trendAlignmentService, trendDriftService, validateCompanyProfile, regenerate-blueprint | Theme tokens for relevance and drift |
| confidence_score | INTEGER | Internal | Legacy confidence |
| source | TEXT | Audit | user \| ai_refined |
| last_refined_at | TIMESTAMPTZ | Auto-refine logic | Last refinement timestamp |
| created_at, updated_at | TIMESTAMPTZ | Audit | Audit timestamps |
| linkedin_url … blog_url | TEXT | buildSourceList, social discovery | Social URLs for extraction |
| other_social_links | JSONB | buildSourceList | Additional social links |
| industry_list | JSONB | externalApiService, trendAlignmentService, trendDriftService | Industry array for keywords |
| category_list | JSONB | externalApiService | Category array for runtime |
| geography_list | JSONB | recommendationEngineService, companyMissionContext | Multi-geo for trend fetch |
| competitors_list | JSONB | extraction merge | Competitors array |
| content_themes_list | JSONB | externalApiService, trendAlignmentService, trendDriftService | Theme array for keywords |
| products_services_list | JSONB | externalApiService | Products array for runtime |
| target_audience_list | JSONB | buildAudienceKeywords, validateCompanyProfile | Audience array for scoring |
| goals_list | JSONB | trendAlignmentService, trendDriftService | Goals array for tokens |
| brand_voice_list | JSONB | extraction merge | Brand voice array |
| social_profiles | JSONB | validateCompanyProfile, selectPlatforms | Platform list for gate and platform selection |
| field_confidence | JSONB | Merge logic | Per-field confidence |
| overall_confidence | INTEGER | Merge logic | Overall confidence |
| source_urls | JSONB | Refinement audit | URLs used in extraction |
| target_customer_segment | TEXT | companyMissionContext, campaignAiOrchestrator | ICP/segment for mission block |
| ideal_customer_profile | TEXT | companyMissionContext, campaignAiOrchestrator, regenerate-blueprint | ICP for prompts |
| pricing_model | TEXT | campaignAiOrchestrator, contextResolver | Commercial context |
| sales_motion | TEXT | campaignAiOrchestrator | Commercial context |
| avg_deal_size | TEXT | campaignAiOrchestrator, group-preview | Deal size for revenue logic (referenced but not in schema per older audit) |
| sales_cycle | TEXT | campaignAiOrchestrator | Commercial context |
| key_metrics | TEXT | campaignAiOrchestrator | Commercial context |
| user_locked_fields | JSONB | Merge protection | Fields locked by user |
| last_edited_by | TEXT | Audit | Last editor |
| marketing_channels | TEXT | campaignAiOrchestrator | Marketing intelligence |
| content_strategy | TEXT | companyMissionContext (deriveDisqualifiedSignals), campaignAiOrchestrator | Exclusions and context |
| campaign_focus | TEXT | trendAlignmentService, trendDriftService, companyMissionContext, campaignAiOrchestrator | Focus for tokens and mission |
| key_messages | TEXT | companyMissionContext, campaignAiOrchestrator | Key messages for mission |
| brand_positioning | TEXT | companyMissionContext, campaignAiOrchestrator, regenerate-blueprint | Positioning for mission |
| competitive_advantages | TEXT | companyMissionContext, campaignAiOrchestrator | Advantages for context |
| growth_priorities | TEXT | companyMissionContext, campaignAiOrchestrator | Priorities for mission |
| campaign_purpose_intent | JSONB | companyMissionContext, campaignAiOrchestrator, define-target-customer | primary_objective, campaign_intent, monetization_intent, dominant_problem_domains, brand_positioning_angle |

**Note:** `avg_deal_size` is referenced in `group-preview.ts` but was previously reported as a gap; `company-profiles.sql` now includes it. `identity_safe_topics` is referenced in `deriveDisqualifiedSignals` but not in schema; treated as optional cast.

---

### Table: company_profile_refinements

| field_name | type | used_in | purpose |
|------------|------|---------|---------|
| id | UUID | PK | Primary key |
| company_id | TEXT | Index | Company reference |
| before_profile | JSONB | Audit | Snapshot before refinement |
| after_profile | JSONB | Audit | Snapshot after refinement |
| source_urls | JSONB | Audit | URLs used |
| source_summaries | JSONB | Audit | Summaries fetched |
| changed_fields | JSONB | Audit | Diff of changed fields |
| extraction_output | JSONB | Audit | Raw extraction result |
| missing_fields_questions | JSONB | Audit | Generated questions |
| overall_confidence | INTEGER | Audit | Confidence at refinement |
| created_at | TIMESTAMPTZ | Index | Timestamp |

---

### Derived context builders

| Builder | location | input | output | purpose |
|---------|----------|-------|--------|---------|
| CompanyMissionContext | companyMissionContext.ts | Profile | company_name, mission_statement, core_problem_domains, target_persona, transformation_outcome, disqualified_signals, opportunity_intent, geography | Mission block for trend/market pulse generators |
| NormalizedCompanyProfile | companyProfileService.ts | Profile | base, categories, target_audience, geo_focus, brand_type | recommendationEngine scoring (categories, geo, audience, brand_type) |
| formatMissionContextForPrompt | companyMissionContext.ts | CompanyMissionContext | String | Prompt-ready mission block |
| buildCompanyContextBlock | campaignAiOrchestrator.ts | Profile | String | Commercial + marketing + campaign_purpose for AI prompt |
| buildProfileRuntimeValues | externalApiService.ts | Profile | category, brand, website, keywords | External API template values |
| buildProfileKeywords | trendAlignmentService.ts | Profile | string[] | Token list for relevance/novelty |
| buildThemeTokens | trendDriftService.ts | Profile | Set\<string\> | Token set for drift detection |
| buildAudienceKeywords | detected-opportunities.ts | Profile | string[] | Audience tokens for growth_opportunity_score |

---

### Campaign snapshots / profile copies

| Entity | location | profile fields | purpose |
|--------|----------|----------------|---------|
| recommendation_audit_logs.company_profile_used | JSONB | Full profile at recommendation time | Audit snapshot |
| campaign_versions.campaign_snapshot | JSONB | planning_context, context_payload, target_regions, campaign metadata | Campaign-level planning state; not a profile copy |
| recommendation_snapshots | DB | trend_topic, final_score, category, audience, geo, platforms | Trend snapshots; no profile copy |

---

## SECTION: PROFILE_USAGE_MAP

**Flow: Company → Market → Campaign → Content → Execution**

### Company stage

| Consumer | fields used | fields ignored | missing identity signals |
|----------|-------------|----------------|--------------------------|
| companyProfileService (get/save) | All fields | — | — |
| define-target-customer | name, industry, category | Most | Guided capture of commercial + campaign_purpose_intent |
| validateCompanyProfile | industry_list, industry, target_audience_list, target_audience, content_themes_list, content_themes, goals_list, goals, social_profiles | Rest | — |
| selectPlatforms | social_profiles | Rest | — |

### Market stage (trends / opportunities)

| Consumer | fields used | fields ignored | missing identity signals |
|----------|-------------|----------------|--------------------------|
| externalApiService.buildProfileRuntimeValues | category, category_list, industry, industry_list, content_themes_list, products_services_list, name, website_url | geography, audience, commercial, marketing | — |
| trendAlignmentService | geography_list, geography, content_themes_list, industry_list, goals_list, content_themes, industry, goals, campaign_focus | commercial, marketing, campaign_purpose_intent | — |
| trendDriftService | content_themes_list, industry_list, goals_list, content_themes, industry, goals, campaign_focus | commercial, marketing | — |
| recommendationEngineService (pickProfileGeo/Category) | geography, geography_list, category, industry_list | — | — |
| getTrendRelevance (OmniVyra) | full profile | — | external black-box; no visibility into which fields used |
| detected-opportunities.buildAudienceKeywords | target_audience_list, target_audience | — | — |
| buildUnifiedContext / companyMissionContext | campaign_purpose_intent, campaign_focus, content_themes, target_customer_segment, ideal_customer_profile, growth_priorities, brand_positioning, key_messages, unique_value, competitive_advantages, geography | — | — |
| opportunityGenerators | Via buildUnifiedContext | — | — |

### Campaign stage

| Consumer | fields used | fields ignored | missing identity signals |
|----------|-------------|----------------|--------------------------|
| campaignAiOrchestrator.buildCompanyContextBlock | target_customer_segment, ideal_customer_profile, pricing_model, sales_motion, avg_deal_size, sales_cycle, key_metrics, marketing_channels, content_strategy, campaign_focus, key_messages, brand_positioning, competitive_advantages, growth_priorities, campaign_purpose_intent | geography, audience lists, content_themes | — |
| regenerate-blueprint / suggest-themes | brand_voice, ideal_customer_profile, brand_positioning, content_themes, geography | commercial, marketing details | — |
| campaignEnrichmentService | None (works on recommendation input only) | All | Does not consume profile |

### Content stage

| Consumer | fields used | fields ignored | missing identity signals |
|----------|-------------|----------------|--------------------------|
| contentGenerationService | full companyProfile (JSON) | — | Uses whole object; no structured problem/transformation fields |
| group-preview | avg_deal_size | Most | Revenue/ROI logic |

### Execution stage

| Consumer | fields used | fields ignored | missing identity signals |
|----------|-------------|----------------|--------------------------|
| campaignHealthService | target_audience_list, target_audience | — | — |
| platformIntelligenceService | target_audience_list, target_audience | — | — |
| recommendationEngine (fuse) | normalizeCompanyProfile → categories, geo_focus, target_audience, brand_type | — | — |

---

## SECTION: PROFILE_SECTIONS

### Company Identity

| existing fields | purpose |
|-----------------|---------|
| name, company_id | Identity |
| industry, industry_list, category, category_list | Classification |
| website_url | Primary presence |
| linkedin_url … blog_url, other_social_links, social_profiles | Social presence |

### Brand Strategy

| existing fields | purpose |
|-----------------|---------|
| brand_voice, brand_voice_list | Tone and voice |
| brand_positioning | Positioning |
| unique_value | Value prop |
| key_messages | Core messages |
| competitive_advantages | Differentiators |

### Customer / ICP

| existing fields | purpose |
|-----------------|---------|
| target_audience, target_audience_list | Broad audience |
| target_customer_segment | Segment |
| ideal_customer_profile | Ideal buyer description |

### Campaign & Content Guidance

| existing fields | purpose |
|-----------------|---------|
| content_themes, content_themes_list | Themes |
| campaign_focus | Focus areas |
| content_strategy | Content strategy |
| campaign_purpose_intent | primary_objective, campaign_intent, monetization_intent, dominant_problem_domains, brand_positioning_angle |
| growth_priorities | Priorities |

### Commercial / Growth

| existing fields | purpose |
|-----------------|---------|
| pricing_model, sales_motion, avg_deal_size, sales_cycle | Commercial model |
| key_metrics | Metrics |
| marketing_channels | Channels |
| goals, goals_list | Goals |

### Safety / Boundaries

| existing fields | purpose |
|-----------------|---------|
| content_strategy (partial) | Used in deriveDisqualifiedSignals |
| identity_safe_topics (optional, not in schema) | Exclusions |

### Geography

| existing fields | purpose |
|-----------------|---------|
| geography, geography_list | Geo scope |

---

## SECTION: NEW_FIELDS_PLACEMENT

### core_problem_statement

| attribute | value |
|-----------|-------|
| section | Campaign & Content Guidance (or new Problem-Transformation) |
| rationale | Central problem definition for trend filtering, content framing, and mission context. Adjacent to campaign_purpose_intent.primary_objective. |
| requires_new_column | yes |

### pain_symptoms[]

| attribute | value |
|-----------|-------|
| section | Campaign & Content Guidance |
| rationale | Symptoms tied to core problem; supports content angles and audience match. Fits with dominant_problem_domains but more concrete. |
| requires_new_column | yes |

### awareness_gap

| attribute | value |
|-----------|-------|
| section | Campaign & Content Guidance |
| rationale | Describes what the audience doesn’t yet understand; informs messaging. Part of problem framing. |
| requires_new_column | yes |

### problem_impact

| attribute | value |
|-----------|-------|
| section | Campaign & Content Guidance |
| rationale | Describes consequences of the problem; useful for urgency and positioning. |
| requires_new_column | yes |

### life_with_problem

| attribute | value |
|-----------|-------|
| section | Customer / ICP (or Problem-Transformation) |
| rationale | “Before” state for the audience; supports empathy and story arcs. Related to transformation_outcome in mission context. |
| requires_new_column | yes |

### life_after_solution

| attribute | value |
|-----------|-------|
| section | Customer / ICP (or Problem-Transformation) |
| rationale | “After” state; pairs with life_with_problem. Already partially covered by transformation_outcome (derived from campaign_focus, unique_value). |
| requires_new_column | Reuse transformation_outcome derivation path or add explicit field. Prefer new column for clarity. |

### desired_transformation

| attribute | value |
|-----------|-------|
| section | Campaign & Content Guidance |
| rationale | Desired change for the audience; distinct from transformation_outcome (which is company-derived). |
| requires_new_column | yes |

### transformation_mechanism

| attribute | value |
|-----------|-------|
| section | Campaign & Content Guidance |
| rationale | How the solution delivers transformation; supports mechanism-based messaging. |
| requires_new_column | yes |

### authority_domains[]

| attribute | value |
|-----------|-------|
| section | Brand Strategy (or Campaign & Content Guidance) |
| rationale | Domains where the company has authority; complements dominant_problem_domains. Can reuse dominant_problem_domains if semantics align. |
| requires_new_column | Could extend campaign_purpose_intent JSONB with authority_domains array. Prefer new column or JSONB subfield for clarity. |

---

**Optional structural change:** Introduce a **Problem-Transformation** section for: core_problem_statement, pain_symptoms[], awareness_gap, problem_impact, life_with_problem, life_after_solution, desired_transformation, transformation_mechanism. This aligns with existing CompanyMissionContext transformation_outcome and dominant_problem_domains.

---

## SECTION: FIELD_POPULATION_STRATEGY

### core_problem_statement

| attribute | value |
|-----------|-------|
| source_type | admin_input + AI_assisted |
| confidence_level | Medium–High when admin-confirmed |
| recommended collection method | Guided interview (extend define-target-customer) or dedicated Problem Definition flow. Not reliably on website. |

### pain_symptoms[]

| attribute | value |
|-----------|-------|
| source_type | admin_input + AI_assisted |
| confidence_level | Medium |
| recommended collection method | Interview questions: “What symptoms do your ideal customers show when they have this problem?” AI can infer from ICP and content_themes. |

### awareness_gap

| attribute | value |
|-----------|-------|
| source_type | admin_input |
| confidence_level | Medium |
| recommended collection method | Explicit question in onboarding or Problem Definition flow. Rarely on website. |

### problem_impact

| attribute | value |
|-----------|-------|
| source_type | admin_input + AI_inferred |
| confidence_level | Medium |
| recommended collection method | Can infer from testimonials/case study text in extraction; otherwise admin input. |

### life_with_problem

| attribute | value |
|-----------|-------|
| source_type | admin_input + AI_assisted |
| confidence_level | Low–Medium |
| recommended collection method | Guided question: “Describe your customer’s typical day/life before your solution.” |

### life_after_solution

| attribute | value |
|-----------|-------|
| source_type | admin_input + AI_assisted |
| confidence_level | Medium |
| recommended collection method | Can partially reuse transformation_outcome; explicit question improves clarity. |

### desired_transformation

| attribute | value |
|-----------|-------|
| source_type | admin_input + AI_assisted |
| confidence_level | Medium |
| recommended collection method | Clarify vs transformation_outcome; add to define-target-customer or Problem Definition. |

### transformation_mechanism

| attribute | value |
|-----------|-------|
| source_type | admin_input + AI_inferred |
| confidence_level | Low–Medium |
| recommended collection method | Can infer from unique_value, products_services; admin confirmation improves quality. |

### authority_domains[]

| attribute | value |
|-----------|-------|
| source_type | admin_input + AI_inferred |
| confidence_level | Medium |
| recommended collection method | Infer from industry_list, content_themes_list, growth_priorities; admin can refine. |

---

**Population patterns:** Reuse `define-target-customer` flow for problem and transformation fields. Optionally extend extraction schema to try inference from website (low confidence). Use `user_locked_fields` and confidence merge logic for admin overrides.

---

## SECTION: GAP_SUMMARY

### Strong profile sections

- **Company Identity:** name, industry, category, geography, website, social profiles.
- **Customer/ICP:** target_audience, target_customer_segment, ideal_customer_profile used across trends, scoring, and planning.
- **Commercial:** pricing_model, sales_motion, avg_deal_size, sales_cycle, key_metrics used in campaign AI.
- **Campaign purpose:** campaign_purpose_intent (primary_objective, campaign_intent, dominant_problem_domains, etc.) drives mission context.
- **Content themes:** content_themes / content_themes_list used in trend alignment and drift.

### Missing strategic intelligence

- Explicit **core problem statement** and **pain symptoms**.
- **Awareness gap** and **problem impact** (before/after framing).
- **Life with problem** and **life after solution** (full transformation arc).
- **Desired transformation** and **transformation mechanism**.
- **Authority domains** (distinct from dominant_problem_domains).

### Current flows that would benefit

| Flow | benefit |
|------|---------|
| Trend filtering (OmniVyra fallback, buildProfileKeywords) | Stronger alignment via core_problem_statement, pain_symptoms, authority_domains. |
| CompanyMissionContext | Richer mission block for generators. |
| campaignAiOrchestrator | Problem-aware context for planning. |
| contentGenerationService | Better hooks (pain → solution arcs). |
| detected-opportunities | Audience fit using pain/transformation signals. |

### Risk level of adding fields

| Risk | level | notes |
|------|-------|------|
| Schema addition | Low | Add nullable columns; no breaking changes. |
| Extraction pipeline | Medium | New extraction fields; low confidence expected. |
| Onboarding UX | Medium | New flows; extend define-target-customer. |
| Consumer wiring | Medium | Update companyMissionContext, buildProfileKeywords, campaignAiOrchestrator. |
| Backward compatibility | Low | Null/missing fields retain current behavior. |

**Overall risk:** **Medium** — incremental changes with clear consumers and population paths.

---

*End of audit. No implementation, schema migration, or refactor performed.*
