# Content Intelligence System — Implementation Audit

**Focus**: Company → Market (Trends) → Campaign Idea Generation  
**Audit Date**: Feb 20, 2025

---

## 1. Current Implementation Summary

### 1.1 Data Source

| Layer | Location | Storage |
|-------|----------|---------|
| Company profile | `company_profiles` table | Supabase |
| Read/write | `backend/services/companyProfileService.ts` | `getProfile()`, `saveProfile()` |
| Normalization | `companyProfileService.ts` | `normalizeCompanyProfile()` |

### 1.2 Execution Paths: Company Fields Consumed

#### Trend Detection / Fetch

| Data Source | Function / Module | Fields Consumed | Output |
|-------------|-------------------|-----------------|--------|
| company_profiles | `externalApiService.buildProfileRuntimeValues` | `category`, `category_list`, `industry`, `industry_list`, `content_themes_list`, `products_services_list`, `name`, `website_url` | `runtimeValues` (category, brand, website, keywords) passed to external API templates |
| company_profiles | `recommendationEngineService` → `fetchExternalApis` | via `pickProfileGeo`: `geography`, `geography_list[0]`; via `pickProfileCategory`: `category`, `industry_list[0]` | geo + category passed to external APIs |
| company_profiles | `trendAlignmentService.fetchTrendsFromApis` | `geography_list[0]`, `geography` | geo hint for trend fetch; no category passed |

#### Trend Filtering / Scoring

| Data Source | Function / Module | Fields Consumed | Output |
|-------------|-------------------|-----------------|--------|
| company_profiles | `recommendationEngineService` → `getTrendRelevance` | full `profile` as `companyProfile` | OmniVyra relevance filter (external service) |
| company_profiles | `trendAlignmentService.buildProfileKeywords` | `content_themes_list`, `industry_list`, `goals_list`, `content_themes`, `industry`, `goals` | relevance/novelty scores vs weekly themes |
| company_profiles | `trendDriftService.buildThemeTokens` | `content_themes_list`, `industry_list`, `goals_list`, `content_themes`, `industry`, `goals` | drift detection (relevant new topics) |
| company_profiles | `detected-opportunities` → `buildAudienceKeywords` | `target_audience_list`, `target_audience` | audience match score in `growth_opportunity_score` |

#### Topic / Campaign Idea Generation

| Data Source | Function / Module | Fields Consumed | Output |
|-------------|-------------------|-----------------|--------|
| company_profiles | `contextResolver` → `companyMissionContext` | `campaign_purpose_intent`, `campaign_focus`, `content_themes`, `target_customer_segment`, `ideal_customer_profile`, `growth_priorities`, `brand_positioning`, `key_messages`, `unique_value`, `competitive_advantages`, `geography`, `geography_list` | mission block for trend/market pulse prompts |
| company_profiles | `opportunityGenerators.generateTrendOpportunities` | via `buildUnifiedContext`; geography from mission context | strategic theme pillars |
| company_profiles | `opportunityGenerators.generateMarketPulseForRegion` | via `buildUnifiedContext` | market pulse topics per region |
| company_profiles | `regenerate-blueprint` → `companyContext` | `brand_voice`, `ideal_customer_profile`, `brand_positioning`, `content_themes`/`content_themes_list`, `geography` | payload to `generateTrendOpportunities` |
| recommendation_snapshots | `getRecommendedTopicsForCompany` | `trend_topic`, `final_score` (by company_id) | topic set for blueprint regeneration |

#### Planning / Orchestration

| Data Source | Function / Module | Fields Consumed | Output |
|-------------|-------------------|-----------------|--------|
| company_profiles | `campaignRecommendationService.validateCompanyProfile` | `industry_list`, `industry`, `target_audience_list`, `target_audience`, `content_themes_list`, `content_themes`, `goals_list`, `goals`, `social_profiles` | gate (ready/blocked) |
| company_profiles | `campaignRecommendationService.selectPlatforms` | `social_profiles` | platform list |
| company_profiles | `campaignAiOrchestrator.buildCompanyContextBlock` | `target_customer_segment`, `ideal_customer_profile`, `pricing_model`, `sales_motion`, `avg_deal_size`, `sales_cycle`, `key_metrics`, `marketing_channels`, `content_strategy`, `campaign_focus`, `key_messages`, `brand_positioning`, `competitive_advantages`, `growth_priorities`, `campaign_purpose_intent` | company context string for AI prompt |

---

## 2. Existing Capabilities

| Capability | Existing Fields | Where Used | Status |
|------------|-----------------|------------|--------|
| Geo for trend API fetch | `geography`, `geography_list` | `recommendationEngineService`, `trendAlignmentService`, `externalApiService` (via runtimeValues) | Implemented |
| Category for trend API fetch | `category`, `industry_list` | `recommendationEngineService`, `externalApiService.buildProfileRuntimeValues` | Implemented |
| Profile keywords for API requests | `category_list`, `industry_list`, `content_themes_list`, `products_services_list` | `buildProfileRuntimeValues` → keywords | Implemented |
| Trend relevance scoring (token match) | `content_themes_list`, `industry_list`, `goals_list`, `content_themes`, `industry`, `goals` | `trendAlignmentService.buildProfileKeywords`, `trendDriftService.buildThemeTokens` | Implemented |
| OmniVyra trend relevance | full profile | `getTrendRelevance` | Implemented (black-box external) |
| Audience match for opportunities | `target_audience_list`, `target_audience` | `detected-opportunities.buildAudienceKeywords` | Implemented |
| Mission/problem context for generators | `campaign_purpose_intent`, `campaign_focus`, `content_themes`, `target_customer_segment`, `ideal_customer_profile`, `growth_priorities`, `geography` | `companyMissionContext`, `contextResolver`, `opportunityGenerators` | Implemented |
| Campaign AI company context | commercial + marketing intelligence + `campaign_purpose_intent` | `campaignAiOrchestrator.buildCompanyContextBlock` | Implemented |
| Blueprint topic derivation | `brand_voice`, `ideal_customer_profile`, `brand_positioning`, `content_themes`, `geography` | `regenerate-blueprint`, `suggest-themes` | Implemented |
| Profile gate for planning | `industry`, `target_audience`, `content_themes`, `goals`, `social_profiles` | `validateCompanyProfile` | Implemented |
| Platform selection | `social_profiles` | `selectPlatforms` | Implemented |
| Historical topic reuse | `recommendation_snapshots.trend_topic` | `getRecommendedTopicsForCompany` | Implemented |

---

## 3. Gaps

| Missing Capability | Why Missing | Impact |
|--------------------|-------------|--------|
| **Explicit company-aligned trend filter before OmniVyra** | Trend scoring relies on OmniVyra or post-fetch token matching; no pre-filter using `disqualified_signals` or `core_problem_domains` | Off-brand or off-problem trends can reach scoring; wasted API calls and noisy recommendations |
| **Geography not passed to trendAlignmentService** | `fetchTrendsFromApis` called with `geoHint` but `category` is `undefined` | Trends fetched without category alignment; relevance weaker |
| **campaign_purpose_intent not used in trend filtering** | `disqualified_signals` and `dominant_problem_domains` live in mission context but are only in LLM prompts, not in deterministic filters | No identity-safe constraint at trend-selection stage |
| **disqualified_signals not enforced** | `deriveDisqualifiedSignals` returns static defaults; profile-derived exclusions not implemented | No exclusion of events, seminars, generic content at filter level |
| **target_customer_segment / ICP only in prompts** | Used in mission context for generators; not in scoring/filtering for trend cards | Audience fit is soft (audience match in detected-opportunities) but not in core trend selection |
| **content_strategy, campaign_focus underused** | In company context block and mission derivation; not in trend alignment or blueprint topic seed | Strategic focus not wired into trend-to-topic flow |
| **growth_priorities not in trend scoring** | In mission context and company block only | Trend selection does not prioritize growth themes |
| **Multi-region company geography** | `geography_list` exists but only `[0]` used; multi-region requires explicit `input.regions` | Single-geo assumption; multi-region needs explicit input |
| **campaign_focus not in buildProfileKeywords** | `trendAlignmentService` uses themes, industry, goals but not campaign_focus | Alignment misses stated campaign focus |

---

## 4. Minimal Additions + Usage

| Add / Reuse | Location in Flow | Usage Logic |
|-------------|------------------|-------------|
| **Reuse** `core_problem_domains` | Trend stage: before/after OmniVyra | Filter out trends with zero token overlap with `core_problem_domains`. Apply in `recommendationEngineService` after `getTrendRelevance` or in fallback path. |
| **Reuse** `disqualified_signals` | Trend stage: filter | Extend `deriveDisqualifiedSignals` to include profile-driven exclusions (e.g. from `campaign_focus`, `content_strategy`). Add deterministic filter in `recommendationEngineService`: exclude trends whose topic contains disqualified keywords. |
| **Reuse** `campaign_focus` | Trend stage: `buildProfileKeywords` | Add `campaign_focus` (parsed) to `trendAlignmentService.buildProfileKeywords` and `trendDriftService.buildThemeTokens`. Strengthens theme alignment. |
| **Reuse** `growth_priorities` | Campaign idea stage: `StrategicPayload` | When building `company_context` for `generateTrendOpportunities`, include `growth_priorities` as `selected_offerings` or `additional_direction` if not already surfaced. Verify `contextResolver` passes it. |
| **Reuse** `geography_list` | Trend stage: multi-region | When `input.regions` is empty, use `profile.geography_list` as regions for multi-region fetch instead of single geo. Requires minor change in `recommendationEngineService` region resolution. |
| **Reuse** `category` in trendAlignmentService | Trend stage: `buildTrendAssessments` | Pass `pickProfileCategory(profile)` as second arg to `fetchTrendsFromApis` (currently `undefined`). Improves API alignment. |
| **Add** `identity_safe_topics` (optional) | Planning stage: blueprint/plan context | Optional JSON array on profile: topics the brand will never touch. Inject as constraint in `buildPromptContext`: “Never suggest themes in: {list}.” |

---

## 5. Quick Reference: Field Usage by Stage

| Stage | Fields Actually Used |
|-------|----------------------|
| **Trend fetch** | geography, geography_list, category, industry_list, category_list, content_themes_list, products_services_list, name, website_url |
| **Trend filter/score** | content_themes_list, industry_list, goals_list, content_themes, industry, goals, target_audience_list, target_audience, full profile (OmniVyra) |
| **Topic generation** | campaign_purpose_intent, campaign_focus, content_themes, target_customer_segment, ideal_customer_profile, growth_priorities, brand_positioning, key_messages, unique_value, competitive_advantages, geography, brand_voice |
| **Planning/orchestration** | industry, target_audience, content_themes, goals, social_profiles, commercial + marketing intelligence, campaign_purpose_intent |
