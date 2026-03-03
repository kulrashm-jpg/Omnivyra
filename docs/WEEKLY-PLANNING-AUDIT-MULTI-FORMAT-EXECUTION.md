# Weekly Planning Logic — Audit for Scalable Multi-Format Content Execution

**Scope:** Current weekly plan generation, distribution intelligence, weekly→daily readiness, media/visual handling, device/platform context, and external media integration.  
**Date:** 2025-03-02  
**No code was modified; this is a read-only audit.**

---

## 1. Existing Weekly Plan Logic — Step-by-Step Map

### 1.1 Where weekly planning starts

| Step | Location | What happens |
|------|----------|--------------|
| **Entry** | `pages/api/campaigns/ai/plan.ts` | POST handler receives `campaignId`, `mode`, `message`, `durationWeeks`, `conversationHistory`, `collectedPlanningContext`. Loads `getCampaignPlanningInputs(campaignId)`, builds `deterministicPlanningContext` from inputs, merges with conversation-extracted answers (`extractLatestAnswer`, `detectAskedKey`). |
| **Orchestrator** | `backend/services/campaignAiOrchestrator.ts` → `runCampaignAiPlan()` | Resolves context (company, campaign, prefilled planning), runs capacity/frequency validation, optionally builds deterministic skeleton, builds LLM prompt, calls LLM, parses plan. |
| **Skeleton (optional)** | `backend/services/deterministicWeeklySkeleton.ts` → `buildDeterministicWeeklySkeleton()` | When `platform_content_requests` is present and valid: parses per-platform, per–content-type counts; builds `execution_items[]` (one per content_type) with `topic_slots` (topic: null, intent: null). No topics yet — only structure and counts. |
| **LLM** | Same orchestrator, `buildPromptContext()` | Prompt includes WEEKLY_BLUEPRINT_OUTPUT_CONTRACT: theme, phase_label, primary_objective, platform_allocation, content_type_mix, topics_to_cover (2–5), etc. If deterministic skeleton is in payload, LLM is told **not** to invent allocation/counts; only theme, objective, topics_to_cover. |
| **Parse** | `backend/services/campaignPlanParser.ts` → `parseAiPlanToWeeks()` | Extracts plan from `BEGIN_12WEEK_PLAN` / `END_12WEEK_PLAN`; builds structured weeks (platform_allocation, content_type_mix, topics_to_cover, theme, etc.). |
| **Merge** | `campaignAiOrchestrator.ts` (inside `runWithContext`) | If deterministic skeleton exists: for each week, `deriveTopicWeights(topics_to_cover)` → `weightedAssignment(topicsWithWeights, totalSlots)` produces one flat list of topic strings. Each `execution_item` gets a slice of that list; for each slot, intent is filled via `deriveWritingAngle`, `deriveStrategicRole`, `buildRecommendationAlignment`, etc. `master_content_id` assigned per slot. |
| **Output** | `result.plan.weeks` | Weeks with `execution_items`, `posting_execution_map`, `resolved_postings`, `daily_execution_items` (when skeleton path). Persisted via `saveDraftBlueprint(fromStructuredPlan(result.plan.weeks))`. |

### 1.2 How strategic theme is translated into weekly content items

- **Theme source:** LLM output (per-week `theme`, `phase_label`, `primary_objective`) or recommendation/strategy context.
- **Topics:** `topics_to_cover` (2–5 strings per week) from LLM or from strategy blueprint.
- **Content items:**  
  - **With deterministic skeleton:** `execution_items` = one item per (content_type, count_per_week). Topics are assigned to slots by `weightedAssignment`: every topic gets ≥1 slot; remaining slots filled from weighted pool. So one topic can appear in multiple execution_items (e.g. same topic for video and for post).  
  - **Without skeleton:** Only `platform_allocation` and `content_type_mix` at week level; no per-slot topic/intent until daily expansion.

### 1.3 Inputs/questions that influence the plan

| Input key | Where used | Effect |
|-----------|------------|--------|
| **target_audience** | Planning context, intent derivation | Injected into prompt and into slot intent `target_audience`. |
| **audience_professional_segment** | Planning context | Injected into context. |
| **communication_style** | Planning context | Injected. |
| **action_expectation** | Planning context | Injected. |
| **content_depth** | Planning context | Injected. |
| **topic_continuity** | Planning context | Injected. |
| **available_content** | Capacity validator, skeleton | Reduces “supply” in capacity check. |
| **weekly_capacity / content_capacity** | Capacity validator, skeleton | Supply side of capacity check. |
| **platforms / selected_platforms** | Skeleton, prompt | Which platforms get allocation. |
| **platform_content_requests** | **Critical** | Drives `buildDeterministicWeeklySkeleton()`: per-platform, per–content-type counts. Defines format mix (video, post, carousel, etc.) and distribution. |
| **exclusive_campaigns** | Capacity | Reduces effective capacity. |
| **tentative_start** | Plan API | Used for conflict detection; not in blueprint. |
| **key_messages** | Intent derivation | Used in `derivePainPoint` for slot intent. |

**Topic selection:** From LLM `topics_to_cover` (and weights from phase/capsule) or from strategy; then `weightedAssignment` distributes topic strings across all slots (all formats).

**Format selection:** From `platform_content_requests` (user/UI) or from LLM `content_type_mix` / `platform_content_breakdown` when no skeleton. Skeleton path: format = execution_item’s `content_type` (video, post, carousel, etc.).

**Distribution across the week:**  
- **Deterministic path:** `generate-weekly-structure` uses `execution_items` → `spreadEvenlyAcrossDays(count, 7)` for day indices; STAGGERED mode can offset by platform.  
- **AI-only path:** `dailyContentDistributionPlanService.generateDailyDistributionPlan()` assigns `day_index` (1–7) with spread rules and platform hints (e.g. LinkedIn Tue–Thu); can force spread if all slots land on same day.

### 1.4 Format diversity enforcement

- **Explicit enforcement:** None. There is no rule that “video and carousel must not share the same topic” or “same topic must have different angles per format.”
- **Implicit:** `content_type_mix` and `platform_content_requests` define how many of each format; topic assignment is by a single weighted list across all slots, so the same topic string can (and often does) appear in multiple execution_items (e.g. one topic for video, same topic for post). Intent (writing_angle, strategic_role, brief_summary) is derived from **topic + theme** only, not from **format**. So format diversity is structural (counts per type) but not “unique angle per format.”

---

## 2. Distribution Intelligence — Validation (CRITICAL)

### 2.1 Same topic reused across multiple formats

- **Observed:** Yes. In the deterministic path, `allSlots = weightedAssignment(topicsWithWeights, totalSlots)` is one list of topic strings. Each execution_item (e.g. video, post, carousel) takes a contiguous slice. So e.g. topics [T1, T2, T3] with 6 total slots can yield video slots [T1, T2], post slots [T2, T3], carousel [T1]. Same topic (T1 or T2) appears in different formats.
- **Intent:** `deriveWritingAngle(theme, topic)` and `deriveStrategicRole(writingAngle)` do not take `content_type` as input. So “T1 as video” and “T1 as carousel” get the same writing_angle and strategic_role.
- **Risk:** Redundant messaging: same idea, same angle, repeated across video, post, and carousel.

### 2.2 Video / post / carousel receiving unique angles vs duplicated topics

- **Unique angles:** Not enforced. Slot intent is topic + theme driven; format is not a dimension in `deriveWritingAngle`, `pickBriefSummary`, or `buildRecommendationAlignment`.
- **Example:** Topic “3 breathing techniques” could get writing_angle “education” for both a video slot and a carousel slot; no “video = story, carousel = list” differentiation.

### 2.3 Weekly content distribution and redundancy

- **Spread:** Day spread is enforced (spreadEvenlyAcrossDays, or AI daily distribution with “use at least 5 different days”). So calendar spread is addressed.
- **Topic variety:** `weightedAssignment` ensures each topic appears at least once when slots ≥ topics; weight spreads repeats. So topic variety across the week exists, but the same topic can still repeat across formats with the same angle.
- **Content variety (intent/format/audience value):** No explicit variety score or constraint. No check for “no more than N slots with same writing_angle” or “different CTA per format for same topic.”

### 2.4 Flagged problems

| Problem | Severity | Where |
|--------|----------|--------|
| Same idea repeated across formats with same angle | **High** | `campaignAiOrchestrator.ts` topic→slot assignment and intent derivation (no format input). |
| No “angle per format” rule (e.g. video = story, carousel = list) | **High** | Intent derivation and skeleton merge. |
| Weak diversification logic | **Medium** | Only topic weight and day spread; no intent/format/CTA diversity rules. |
| Random distribution risk when AI daily used | **Medium** | AI can assign platforms/days; prompt asks for spread but no hard validation that same topic gets different angles per content_type. |

---

## 3. Weekly → Daily Plan Readiness Audit

### 3.1 What weekly items already contain (available for daily)

| Data | Source | Notes |
|------|--------|------|
| Theme, phase_label, primary_objective | Week level | Yes. |
| topics_to_cover | Week level | Yes. |
| platform_allocation, content_type_mix | Week level | Yes. |
| execution_items[].content_type, count_per_week, selected_platforms | Deterministic path | Yes. |
| topic_slots[].topic, intent (objective, cta_type, target_audience, brief_summary, writing_angle, strategic_role, pain_point, outcome_promise, recommendation_alignment) | Deterministic path | Yes. |
| topic_slots[].master_content_id | Deterministic path | Yes. |
| weeklyContextCapsule (campaignTheme, audienceProfile, weeklyIntent, etc.) | When enriched | Yes. |
| topics[] (WeeklyTopicWritingBrief) with contentTypeGuidance (primaryFormat, maxWordTarget, platformWithHighestLimit) | When LLM/strategy provides | Only when week has full `topics[]`; otherwise default. |
| distribution_strategy (QUICK_LAUNCH / STAGGERED) | Week (optional) | Used in generate-weekly-structure for day spread. |

### 3.2 Gap analysis: missing for daily plan creation

| Missing data | Impact later |
|--------------|--------------|
| **Format-specific guidance** (e.g. video duration, carousel slide count, image aspect ratio) | Daily plan cannot constrain “this slot = 60s video” or “carousel 5 slides”; content generation or creators lack clear specs. |
| **Visual requirements** (visual_goal, visual_style, aspect_ratio, text_overlay) | Exists in `contentGenerationPipeline` at generation time (media_intent, media_search_intent) but not on weekly/daily plan schema; daily planner doesn’t carry them. |
| **Platform context** (e.g. “LinkedIn article” vs “Instagram reel”) | Platform is on daily row; platform rules exist in platformIntelligenceService. Missing: explicit “platform-first” or “format-first” narrative hint per slot. |
| **CTA intent per format** (e.g. video = “subscribe”, post = “comment”) | Only one cta_type per week in blueprint; slot intent has cta_type but not differentiated by content_type. |
| **Content depth indicators** (short vs long, educational vs punchy) | approximateDepth and narrativeStyle exist on WeeklyTopicWritingBrief; not guaranteed on every slot when using skeleton merge. |
| **Repurposing hints** (e.g. “same script as video, adapt for carousel”) | cross_platform_sharing and slot_platforms indicate reuse across platforms; no “source_content_id” or “adapt_from” for repurposing one format to another. |

### 3.3 Summary table

| Category | Available | Missing | Impact |
|----------|-----------|---------|--------|
| Format-specific guidance | primaryFormat, maxWordTarget (when topics[] present) | Duration, slide count, aspect ratio, format-specific narrative | Weak daily specs for video/carousel/image. |
| Visual requirements | — | visual_goal, visual_style, aspect_ratio, image requirements | Filled only at generation time, not in plan. |
| Platform context | platform on daily row, platform rules | Platform-first consumption, format preference | Cannot tailor “mobile-first” or “desktop long-read.” |
| CTA intent | cta_type per week and per slot | Per-format CTA (e.g. video vs post) | Same CTA repeated across formats. |
| Content depth | approximateDepth, narrativeStyle (when briefs exist) | Per-slot depth when only skeleton | Inconsistent depth signals. |
| Repurposing hints | slot_platforms, multi-platform rows | “Adapt from X” / source_content_id | Hard to show “carousel from video” in UI or automation. |

---

## 4. Media & Visual Readiness (All Formats)

### 4.1 Video

| Aspect | Exists | Missing |
|--------|--------|---------|
| Duration hints | No | No duration or length in weekly/daily schema or platform rules. |
| Hooks | No | Hook is in legacy daily schema in parser; not in execution_items or creator card. |
| Storytelling structure | No | No act/structure (e.g. problem–solution–CTA) in plan. |
| Aspect ratio / platform orientation | No | platformIntelligenceService has media_format: 'video' only; no aspect_ratio. contentGenerationPipeline has media_intent.aspect_ratio at generation time only. |
| Visual style metadata | No | visual_style, opening_scene_goal, etc. only in pipeline media_intent at generation. |

### 4.2 Carousel

| Aspect | Exists | Missing |
|--------|--------|---------|
| Slide count logic | No | No slide_count or slide range in blueprint or platform rules. |
| Narrative flow | No | No “slide 1: hook, slide 2–4: points, slide 5: CTA” in plan. |
| Visual storytelling structure | No | No carousel-specific structure in execution_items or daily. |

### 4.3 Posts

| Aspect | Exists | Missing |
|--------|--------|---------|
| Visual attachments | Partially | platform rules have type_map (post, video, etc.); no explicit “post with image” vs “text-only” in plan. |
| Attractiveness (images, charts, icons) | No | No “include chart” or “hero image” in weekly/daily schema. |

### 4.4 Images

| Aspect | Exists | Missing |
|--------|--------|---------|
| Image sourcing | No | contentGenerationPipeline has media_search_intent (primary_query, style_tags) at generation; not in weekly/daily. |
| Image requirements on plan | No | No “needs 1 hero image” or “thumbnail” on slot. |
| Placeholders for external media | Partially | contentGenerationPipeline uses media_assets, media_status ('missing'|'ready'); daily execution item can have media_assets. No standard “asset slot” or “placeholder” on weekly blueprint. |

**Summary:** Format-specific and visual metadata exist mainly in the content generation pipeline (media_intent, media_search_intent) and in platform rules (content_type, media_format). They are **not** part of the weekly or daily plan schema, so planning cannot mandate e.g. “this week’s video is 60s, 16:9” or “carousel 5 slides.”

---

## 5. Device & Platform Context (New Requirement)

### 5.1 Is device preference (mobile vs desktop) available?

- **Company profile:** Not in company_profiles or company_profile_* migrations. No `device_preference` or `consumption_device` field.
- **Analytics:** `database/step13-advanced-analytics.sql` has `device_types JSONB` (Mobile vs Desktop) for analytics, not for planning.

### 5.2 Platform-first formatting logic

- **Current:** Platform is chosen per slot; platform rules (character limits, content_type) are applied at validation/enrichment. No “this content is consumed primarily on mobile” or “desktop long-read” flag.

### 5.3 Content adaptation based on platform behavior

- **Current:** Platform drives content_type and limits (platformIntelligenceService, platformExecutionValidator). No explicit “platform behavior” (e.g. scroll speed, sound-off) in company or plan.

### 5.4 Could it be inferred?

- Partially: from platform (e.g. TikTok/Instagram → mobile-first). Not inferred today in planning logic.

### 5.5 Should it be added as a question?

- **Feasibility:** Yes. A question e.g. “Where will your audience mostly consume this content? (Mobile / Desktop / Both)” could be stored in company_profiles or campaign_planning_inputs and injected into prompt and/or distribution logic.
- **Best insertion point:**  
  - **Option A:** `campaign_planning_inputs` (e.g. `primary_consumption_device` or `device_preference`) so it’s per campaign.  
  - **Option B:** `company_profiles` (e.g. `content_consumption_preference`) so it’s company-wide.  
  Planning prompt and daily distribution (and any future “platform-first” formatting) would read from the chosen store. No implementation recommended here; evaluation only.

---

## 6. External Media Integration Readiness

### 6.1 Where external media metadata would fit

- **Today:** `content_assets` (and related content_* tables) store assets; contentGenerationPipeline uses `media_assets: { id, type, source_url, status }` on execution items and `media_status: 'missing' | 'ready'`.
- **Fit for external provider:**  
  - **Asset row:** Add optional `source_provider`, `external_asset_id`, `license_type`, `watermark_risk` (or similar).  
  - **Execution item / daily content JSON:** Already has `media_assets`; could add `provider_id`, `license_metadata`, `watermark_acceptable` so downstream can block scheduling or show warnings.

### 6.2 Watermark risks

- **Current:** No watermark or licensing field. No handling of “stock with watermark” vs “licensed” in plan or pipeline.
- **Recommendation (conceptual):** Add optional `watermark_policy` or `asset_requirements.watermark_allowed` at company or campaign level; at daily/slot level, optional `watermark_acceptable: boolean` so providers can be filtered or flagged.

### 6.3 Placeholders / asset states

- **Current:** `media_status: 'missing' | 'ready'` and `media_assets[]` on execution item; pipeline checks MEDIA_DEPENDENT_TYPES and blocks or flags when media missing. No “placeholder” type (e.g. “pending_stock”) in schema.
- **Recommendation:** Keep `media_status`; optionally add `asset_state: 'placeholder' | 'attached' | 'external_pending'` and `required_media_role` (e.g. hero_image, thumbnail) so UI and automation can show “needs image” clearly.

### 6.4 Company-level purchasing decisions

- **Current:** No company-level “we use provider X” or “budget for stock” in schema.
- **Recommendation (conceptual):** Optional company or campaign setting: `preferred_media_providers[]`, `media_budget_tier`, or `external_media_policy` (e.g. “stock only”, “licensed only”). Planning does not need to enforce; it would feed into a future “asset sourcing” or “suggest provider” step.

### 6.5 Recommended architecture extension (conceptual)

- **Asset / execution:** Extend `media_assets` or content_assets with optional `source_provider`, `external_id`, `license_type`, `watermark_acceptable`.  
- **Company/campaign:** Optional `external_media_policy` or `preferred_media_providers` for downstream use.  
- **Placeholders:** Standardize `media_status` + optional `asset_state` and `required_media_role` so “needs image/video” is first-class.  
- **Watermark:** Optional policy at company/campaign and per-asset flag; pipeline or scheduler can block or warn when watermark not allowed.

---

## 7. Final Audit Report

### A. Current logic map (text)

```
User / UI
  → campaign_planning_inputs (platforms, platform_content_requests, capacity, …)
  → Capacity/frequency validation
  → If platform_content_requests: buildDeterministicWeeklySkeleton()
       → execution_items[] (one per content_type), topic_slots with topic: null
  → LLM prompt (theme, objectives, topics_to_cover; if skeleton, no allocation invention)
  → parseAiPlanToWeeks() → structured weeks
  → If skeleton: merge topics into slots via weightedAssignment (one list for all formats)
                 fill intent per slot (deriveWritingAngle, etc. — no format input)
                 attach master_content_id, build resolved_postings / daily_execution_items
  → fromStructuredPlan() → CampaignBlueprint → saveDraftBlueprint()
  → getUnifiedCampaignBlueprint() (twelve_week_plan → snapshot → refinements)
  → Generate daily: generate-weekly-structure
       → If execution_items with topic_slots: build DailyPlanItem[] from slots, spread days
       → Else: generateAIDailyDistribution() → slots → DailyPlanItem[]
       → Validate/enrich per item → insert daily_content_plans
  → Activity cards from daily_content_plans (+ optional resolve via execution_id in blueprint)
```

### B. Key structural problems

1. **Single topic list for all formats:** One `weightedAssignment` output is sliced across video, post, carousel; same topic can appear in multiple formats with the same intent.  
2. **Intent agnostic to format:** `deriveWritingAngle`, `deriveStrategicRole`, `pickBriefSummary` do not take content_type; no “video = story, carousel = list.”  
3. **No format-specific fields on plan:** Duration, slide count, aspect ratio, visual requirements live only in generation pipeline, not in blueprint or daily schema.  
4. **Weekly CTA and depth:** One cta_type per week; depth/angle not guaranteed per slot when using skeleton-only merge.

### C. Distribution weaknesses

- Same idea repeated across video/post/carousel.  
- No rule that each format gets a distinct angle for the same topic.  
- Distribution is “topic spread” and “day spread,” not “intent/format/CTA diversity.”  
- AI daily distribution can diversify by day/platform but prompt does not enforce “different angle per format.”

### D. Missing metadata for daily planning

- Format-specific guidance (duration, slides, aspect ratio).  
- Visual requirements and platform-first hints.  
- Per-format CTA and content depth on slot.  
- Repurposing links (e.g. “adapt from master_content_id X”).

### E. Media handling gaps

| Format | Gaps |
|--------|------|
| **Video** | Duration, hooks, storytelling structure, aspect ratio, visual style not in plan. |
| **Carousel** | Slide count, narrative flow, visual structure not in plan. |
| **Posts** | “Post with image” vs text-only not explicit; no attractiveness hints. |
| **Images** | Image sourcing, requirements, placeholders not on plan; only at generation. |

### F. Device/platform missing intelligence

- No device preference (mobile/desktop) in company or campaign.  
- No platform-first or consumption-context field.  
- Could be added via campaign_planning_inputs or company_profiles and used in prompt and distribution.

### G. Ranked improvement priorities

| Priority | Item | Rationale |
|----------|------|-----------|
| **Critical (must fix before scaling)** | **Angle-per-format for same topic** | Avoid redundant “same message” across video, post, carousel; intent derivation (or LLM) should take content_type and assign e.g. video=story, carousel=list. |
| **Critical** | **Format-specific metadata on weekly/daily** | Duration, slide count, aspect ratio (or references to platform defaults) so daily plan and creators have clear specs. |
| **Critical** | **Distribution rule: same topic → different angle per format** | Either in skeleton merge (per-format angle derivation) or in AI daily distribution prompt and validation. |
| **Important (improves quality)** | **Visual/CTA per format** | Optional visual_goal, per-format CTA hint, content depth on slot. |
| **Important** | **Repurposing hints and source_content_id** | “Carousel from video X” so UI and automation can show and use repurposing. |
| **Important** | **Creator card / daily payload includes format specs** | So activity cards show “60s video,” “5-slide carousel,” “image required.” |
| **Optional (future)** | **Device/platform consumption preference** | Company or campaign question + injection into prompt and distribution. |
| **Optional** | **External media: provider, license, watermark** | Company/campaign policy and asset-level fields for third-party providers. |

---

**End of audit.** All references are to the current codebase; no code was modified.
