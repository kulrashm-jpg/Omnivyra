# Language Refinement Layer — Repository Analysis

**Goal:** Introduce a Language Layer that refines AI-generated text before display, enforcing campaign tone, language style, and complexity across the system.

**Scope:** Strategic Theme cards, Weekly Plan cards, Activity Workspace content, Repurpose suggestions.

---

## 1. AI Generation Entry Points

### 1.1 Primary LLM Gateway

| File | Role | Function |
|------|------|----------|
| `backend/services/aiGateway.ts` | Central LLM gateway for campaign/recommendation flows | `runCompletion()` → OpenAI `chat.completions.create` |
| | | Returns `{ output: string, metadata }` |

**All campaign-related LLM calls** go through `generateCampaignPlan`, `generateDailyPlan`, `generateDailyDistributionPlan`, `generateRecommendation`, etc. — each calls `runCompletion`.

### 1.2 LLM Interaction Points by Output Type

| Output Type | File(s) | Function(s) | Return / Structure |
|-------------|---------|-------------|-------------------|
| **Weekly Plan** | `backend/services/campaignAiOrchestrator.ts` | `runWithContext()` → `generateCampaignPlan()` | Raw text → `parseAiPlanToWeeks()` → `{ weeks: [...] }` |
| | | `buildPromptContext()`, `parseAiPlanToWeeks()` | `campaignPlanParser.ts` |
| **Daily Distribution** | `backend/services/dailyContentDistributionPlanService.ts` | `generateDailyDistributionPlan()` (aiGateway) | JSON `daily_plan[]` with `short_topic`, `full_topic`, etc. |
| **Activity Master Content** | `backend/services/contentGenerationPipeline.ts` | `generateMasterContentFromIntent()` → `generateCampaignPlan()` | `MasterContentPayload` `{ content, generation_status, ... }` |
| **Platform Variants (Repurpose)** | `backend/services/contentGenerationPipeline.ts` | `buildPlatformVariantsFromMaster()` → `requestVariant()` → `generateCampaignPlan()` | `PlatformVariantPayload[]` `{ generated_content, platform, content_type, ... }` |
| **Refine / Improve Variant** | `pages/api/activity-workspace/content.ts` | `generateCampaignPlan()` (action: refine_variant, improve_variant) | `refined_content` or `improved_variant.generated_content` |
| **Discoverability Optimization** | `backend/services/contentGenerationPipeline.ts` | `optimizeDiscoverabilityForPlatform()` → `generateCampaignPlan()` | JSON `keyword_clusters`, `hashtags`, `youtube_tags` |
| **Content for Day** | `backend/services/contentGenerationService.ts` | `generateContentForDay()` → **direct OpenAI** (not aiGateway) | `contentSchema` `{ headline, caption, hook, callToAction, hashtags, tone, ... }` |
| **Regenerate Content** | `backend/services/contentGenerationService.ts` | `regenerateContent()` → direct OpenAI | Same schema |
| **Strategic Themes** | `backend/services/strategicThemeEngine.ts` | `generateThemeFromTopic()` | **No LLM** — template: `"The Rise of " + TitleCase(topic)` |

### 1.3 Additional LLM Entry Points (Less Central)

| File | Function | Output |
|------|----------|--------|
| `backend/services/aiGateway.ts` | `generatePrePlanningExplanation()` | Human-readable explanation string |
| `backend/services/aiGateway.ts` | `suggestDurationForOpportunity()`, `suggestDurationFromQuestionnaire()` | `{ suggested_weeks, rationale }` |
| `backend/services/aiGateway.ts` | `moderateChatMessage()` | `{ allowed, reason, code }` |
| `backend/services/companyProfileService.ts` | `refineProblemTransformationAnswers()` | Refined Q&A for problem transformation |
| `pages/api/ai/generate-content.ts` | `generateWeeklyPlan()` (legacy) | Demo or AI weekly theme/focus |
| `pages/api/ai/generate-topics.ts` | `generateAITopics()` | Topics array |
| `pages/api/voice/transcribe.ts` | `generateCampaignSuggestions()`, `generateWeeklySuggestions()` | Suggestion arrays |

---

## 2. Data Flow Diagrams

### 2.1 Weekly Plan Flow

```
User (CampaignAIChat)
  → POST /api/campaigns/ai/plan
  → runCampaignAiPlan (campaignAiOrchestrator)
  → buildPromptContext()
  → generateCampaignPlan (aiGateway)
  → OpenAI API
  → raw text (BEGIN_12WEEK_PLAN ... END_12WEEK_PLAN)
  → parseAiPlanToWeeks() (campaignPlanParser)
  → structured { weeks: [{ theme, primary_objective, topics_to_cover, ... }] }
  → API response plan.weeks
  → CampaignAIChat UI (weekly cards, refine day, platform customize)
```

### 2.2 Activity Workspace & Repurpose Flow

```
Activity Workspace
  → POST /api/activity-workspace/content { action: generate_master }
  → generateMasterContentFromIntent() (contentGenerationPipeline)
  → generateCampaignPlan()
  → MasterContentPayload.content
  → API: { master_content }
  → UI: master content displayed

  → POST /api/activity-workspace/content { action: generate_variants }
  → buildPlatformVariantsFromMaster()
  → requestVariant() per platform
  → generateCampaignPlan() (rewrite for platform)
  → applyAlgorithmicFormatting() (CTA at end, sentence layout)
  → PlatformVariantPayload[]
  → API: { platform_variants }
  → UI: variant cards, Repurpose Content button

  → action: refine_variant, improve_variant
  → generateCampaignPlan() (refine / improve)
  → API: { refined_content } or { improved_variant }
  → UI: updated variant
```

### 2.3 Strategic Theme Flow (No LLM)

```
Strategic Theme Engine (scheduler/cron)
  → generateStrategicThemes() (template: "The Rise of X")
  → strategic_themes table

Campaign Builder / suggest-themes
  → getStrategicThemesAsOpportunities()
  → API: { themes: [{ id, title, summary, payload }] }
  → RecommendationBlueprintCard, TrendCampaignsTab
```

### 2.4 Daily Distribution Flow

```
generate-weekly-structure API
  → dailyContentDistributionPlanService.generateDailyDistributionPlan()
  → generateDailyDistributionPlan (aiGateway)
  → JSON daily_plan[] (short_topic, full_topic, content_type, platform, ...)
  → Mapped to DailyPlanItem
  → campaign-daily-plan page, calendar
```

---

## 3. Recommended Insertion Point

### Evaluation of Options

| Location | Pros | Cons |
|----------|------|------|
| **A) Immediately after LLM response** | Single place in aiGateway | aiGateway is generic; different outputs need different refinement; would need `card_type` passed in; contentGenerationService does NOT use aiGateway |
| **B) In backend service returning to API** | Per-domain control | Multiple services; duplicated logic; inconsistent application |
| **C) In shared AI orchestration service** | Centralized for campaign flows | contentGenerationPipeline, contentGenerationService, activity-workspace API are NOT orchestrated by campaignAiOrchestrator |
| **D) In middleware before response serialization** | Runs once per response | No access to `campaign_tone`, `card_type` without parsing; would need to infer from API path; brittle |

### Recommended: Hybrid — Shared Language Refiner Service + Per-Caller Integration

**Insertion point:** Create a **new `languageRefinementService`** that is invoked **immediately after each AI text output is received and before it is stored/returned**.

**Integration pattern:**

1. **aiGateway wrapper (optional):** Add an optional post-processor: `runCompletion(..., { refineLanguage?: { card_type, campaign_tone, ... } })`. When set, run the refiner on `content` before returning.
2. **Caller-level integration (primary):** Each service that produces user-facing AI text calls `refineLanguageOutput()` before returning.

**Rationale:**

- **Single shared logic** — one service, one interface
- **No UI changes** — refinement happens server-side before response
- **Context-aware** — caller passes `card_type`, `campaign_tone`, `language_style`, `complexity`
- **Opt-in** — can roll out per output type (start with weekly plan + activity content)
- **Handles all paths** — works for aiGateway, contentGenerationPipeline, contentGenerationService, activity-workspace API, etc.

**Concrete insertion points:**

| Output | Insert After | File |
|--------|--------------|------|
| Weekly plan (theme, objective, topics) | `parseAiPlanToWeeks()` returns | `campaignAiOrchestrator.ts` — apply to each week’s text fields before returning |
| Daily distribution (short_topic, full_topic) | `generateDailyDistributionPlan` returns | `dailyContentDistributionPlanService.ts` or `generate-weekly-structure.ts` |
| Master content | `generateMasterContentFromIntent()` returns | `contentGenerationPipeline.ts` |
| Platform variants | After `requestVariant()` in `buildPlatformVariantsFromMaster` | `contentGenerationPipeline.ts` |
| Refine/improve variant | After `generateCampaignPlan` in activity-workspace/content.ts | `pages/api/activity-workspace/content.ts` |
| Content for day | After `generateContentForDay` / `regenerateContent` | `contentGenerationService.ts` |

---

## 4. Reusable Modules

### 4.1 Existing Text Post-Processing

| Module | File | Purpose | Reusable? |
|--------|------|---------|-----------|
| **applyAlgorithmicFormatting** | `contentGenerationPipeline.ts` | CTA at end, sentence-per-line, max sentences per paragraph | **Yes** — platform-specific formatting; could be extended or preceded by Language Layer |
| **formatContentForPlatform** | `backend/utils/contentFormatter.ts` | Truncation, hashtag limits, link handling | **Yes** — for scheduling/publishing; different from tone/complexity |
| **trendNormalizationService** | `backend/services/trendNormalizationService.ts` | Normalize external API trend titles/descriptions | **Partial** — `normalizeString` is generic; not tone/complexity |

### 4.2 Tone / Style Handling

| Location | Purpose |
|----------|---------|
| `contentGenerationService.ts` `platformTone()` | Maps platform → tone (professional, emotional, concise, etc.) — used in prompts |
| `docs/TREND-CAMPAIGN-BLUEPRINT-AUDIT.md` | Documents `communication_style`, `toneGuidance` in weekly briefs |
| `lib/campaign-health-engine.ts`, `RADAR-WEEKLY-SUMMARY-NARRATIVE.md` | "GUIDED tone" rules for executive narrative |
| `community-ai/PlaybookEditor` | `tone: { style, emoji_allowed, max_length }` — per-playbook configuration |

**Conclusion:** No existing **post-LLM** language refinement layer. Tone/style is either prompt-level or rule-based for specific surfaces. A new `languageRefinementService` would be net new.

---

## 5. Content Object Schemas

### 5.1 Strategic Theme Cards

```ts
// From getStrategicThemesAsOpportunities
{
  title: string,      // theme_title from DB
  summary: string | null,  // theme_description
  payload: { momentum_score, trend_direction, companies, keywords, influencers, strategic_theme_id }
}
```

**Note:** Themes are **template-generated**, not LLM. Language Layer would apply if we later add LLM-based theme enrichment.

### 5.2 Weekly Plan

```ts
// From campaignPlanParser / weeklyBlueprintSchemaBase
{
  week: number,
  phase_label: string,
  primary_objective: string,
  platform_allocation: Record<string, number>,
  content_type_mix: string[],
  cta_type: string,
  total_weekly_content_count: number,
  weekly_kpi_focus: string,
  theme: string,           // ← user-facing
  topics_to_cover: string[]  // ← user-facing
}
```

### 5.3 Activity Workspace

```ts
// Master content
MasterContentPayload: {
  content: string,         // ← user-facing
  generation_status, generation_source, ...
}

// Platform variant (repurpose)
PlatformVariantPayload: {
  platform, content_type,
  generated_content: string,  // ← user-facing
  ...
}
```

### 5.4 Repurpose / Recommendation Card (Strategic)

```ts
// RecommendationBlueprintCard
recommendation: {
  title?: string,         // from theme/recommendation
  summary?: string,
  problem?: string,
  transformation?: string,
  primary_pain_point?: string,
  desired_transformation?: string,
  ...
}
```

---

## 6. Proposed Architecture

### 6.1 New Service: `backend/services/languageRefinementService.ts`

```ts
export type LanguageRefinementInput = {
  content: string | string[];
  card_type: 'weekly_plan' | 'daily_slot' | 'master_content' | 'platform_variant' | 'repurpose_card' | 'strategic_theme' | 'general';
  campaign_tone?: string;      // e.g. from campaign or profile
  language_style?: string;     // e.g. professional, casual
  complexity?: 'simple' | 'standard' | 'detailed';
  platform?: string;            // for platform-specific refinement
};

export type LanguageRefinementOutput = {
  refined: string | string[];
  metadata?: { applied: boolean; reason?: string };
};

export async function refineLanguageOutput(
  input: LanguageRefinementInput
): Promise<LanguageRefinementOutput>;
```

**Implementation options:**

- **A) LLM-based:** Single follow-up LLM call: "Refine this text to match tone X, style Y, complexity Z. Return only the refined text."
- **B) Rule-based:** Apply rules (sentence length, vocabulary, structure) without LLM.
- **C) Hybrid:** Rules for fast path; LLM for high-impact surfaces (weekly plan, master content).

### 6.2 Integration Pattern

```ts
// Example: campaignAiOrchestrator after parseAiPlanToWeeks
const structured = await parseAiPlanToWeeks(planText);
if (campaignTone) {
  for (const week of structured.weeks) {
    week.theme = (await refineLanguageOutput({
      content: week.theme,
      card_type: 'weekly_plan',
      campaign_tone: campaignTone,
      language_style: languageStyle,
    })).refined as string;
    week.primary_objective = (await refineLanguageOutput({
      content: week.primary_objective,
      card_type: 'weekly_plan',
      campaign_tone: campaignTone,
    })).refined as string;
    week.topics_to_cover = (await refineLanguageOutput({
      content: week.topics_to_cover,
      card_type: 'weekly_plan',
    })).refined as string[];
  }
}
```

### 6.3 Feature Flag

```env
LANGUAGE_REFINEMENT_ENABLED=true
LANGUAGE_REFINEMENT_CARD_TYPES=weekly_plan,master_content,platform_variant
```

---

## 7. Implementation Risks

### 7.1 UI / Contract Expectations

| Risk | Mitigation |
|------|------------|
| **Weekly plan parser** expects specific structure (phase_label enum, cta_type enum) | Refiner must NOT change enum values; only refine free-form text (theme, primary_objective, topics_to_cover) |
| **Activity workspace** expects `generated_content` string | Refiner returns string; no structure change |
| **Recommendation cards** expect `title`, `summary` | Refiner must preserve semantics; avoid truncation that loses key info |

### 7.2 Cached / Stored Outputs

| Risk | Mitigation |
|------|------------|
| **SessionStorage draft plans** | Refinement happens before save; cached data is already refined |
| **DB: strategic_themes** | Template-generated; out of scope unless we add LLM enrichment |
| **Draft blueprint** | `saveDraftBlueprint` runs after orchestrator returns; refinement is before that |
| **getLatestDraftPlan** restore | Returns pre-refined draft; refinement applies to new AI output only |

### 7.3 Streaming Responses

| Risk | Mitigation |
|------|------------|
| **Campaign AI Chat** | Plan generation is **non-streaming** (full response then parse). No streaming. |
| **gpt-chat / claude-chat** | Streaming for general chat; not in scope for plan/activity/repurpose |
| **Activity workspace** | Non-streaming |

### 7.4 Token Limits & Latency

| Risk | Mitigation |
|------|------------|
| **Extra LLM call per text field** | Batch refinement (e.g. all weekly themes in one call); or rule-based for low-impact fields |
| **Token cost** | Feature flag; opt-in per card type; consider rule-based first |
| **Timeouts** | Refinement should be fast; add circuit breaker (skip on timeout) |

### 7.5 contentGenerationService Bypasses aiGateway

`contentGenerationService.ts` uses **direct OpenAI client**, not aiGateway. Any gateway-level post-processor would not apply. Integration must be **caller-level** for this service.

---

## Summary

| Item | Recommendation |
|------|----------------|
| **Insertion point** | New `languageRefinementService` + caller-level integration at each AI output site |
| **Primary files** | `campaignAiOrchestrator.ts`, `contentGenerationPipeline.ts`, `pages/api/activity-workspace/content.ts`, `contentGenerationService.ts`, `dailyContentDistributionPlanService.ts` |
| **Reusable modules** | `applyAlgorithmicFormatting`, `formatContentForPlatform` — extend or run after refinement; no existing tone post-processor |
| **Content schemas** | Documented above for weekly plan, activity, repurpose, strategic theme |
| **Risks** | Enum preservation, no streaming in scope, contentGenerationService uses direct OpenAI; feature-flag rollout advised |

---

## 8. Implementation Summary (Completed)

### 8.1 Created Service File

**File:** `backend/services/languageRefinementService.ts`

- **Interface:** `LanguageRefinementInput` / `LanguageRefinementOutput` with `refineLanguageOutput()`
- **Card types:** `weekly_plan`, `daily_slot`, `master_content`, `platform_variant`, `repurpose_card`, `strategic_theme`, `general`
- **Rule-based refinement:** Removes filler words (`in many different ways`, `to be able to`, `in order to`, etc.), normalizes casing, enforces sentence length, headline-style capitalization for themes, deduplicates repeated phrases, punctuation consistency

### 8.2 Integration Points Added

| Location | File | Line / Function | Fields Refined |
|----------|------|-----------------|----------------|
| Weekly Plan | `campaignAiOrchestrator.ts` | After `recoverNarrativeMomentum`, before return | `theme`, `primary_objective`, `topics_to_cover` per week |
| Daily Distribution | `dailyContentDistributionPlanService.ts` | After slot mapping, before `same_day_per_topic` / staggered logic | `short_topic`, `full_topic` per slot |
| Master Content | `contentGenerationPipeline.ts` | After `generateCampaignPlan`, before return in `generateMasterContentFromIntent` | `content` |
| Platform Variants | `contentGenerationPipeline.ts` | After expansion block, before return in `generatePlatformVariantFromMaster` | `generated_content` |
| Improve Variant | `pages/api/activity-workspace/content.ts` | After `generateCampaignPlan` for `improve_variant` | `generated_content` |
| Refine Variant | `pages/api/activity-workspace/content.ts` | After `generateCampaignPlan` for `refine_variant` | `refined_content` |
| Content for Day | `contentGenerationService.ts` | After parse in `generateContentForDay` | `headline`, `caption`, `hook`, `callToAction`, `reasoning`, `script`, `blogDraft` (batched) |
| Regenerate Content | `contentGenerationService.ts` | After parse in `regenerateContent` | Same fields (batched) |

### 8.3 Feature Flag

- **Env var:** `LANGUAGE_REFINEMENT_ENABLED=true` (default: disabled when unset)
- **Added to:** `.env.local`
- **Behavior:** When `false` or unset → `refineLanguageOutput()` returns original content unchanged with `metadata.applied: false`

### 8.4 Schema Risks Discovered

- **None introduced.** Refinement only touches free-text string fields. Enums (`phase_label`, `cta_type`, `weekly_kpi_focus`, `content_type`, `platform`) are never passed to the refiner.
- **contentGenerationService:** Uses direct OpenAI (not aiGateway); integrated at caller level. Batched refinement for multiple text fields in one call.

### 8.5 Performance Impact Estimate

- **Rule-based:** ~1–5 ms per call (pure string operations, no I/O)
- **Weekly plan:** ~3–5 calls per week (theme + objective + topics array) × 12 weeks ≈ 36–60 calls per full plan
- **contentGenerationService:** 1 batched call per generate/regenerate
- **Daily distribution:** 2 calls per slot (short_topic + full_topic)
- **Total:** Sub-second for typical flows; no external API calls

### 8.6 Unit Test Added

**File:** `backend/tests/unit/languageRefinementService.test.ts`

- Filler removal / shortening
- Feature-flag bypass when disabled
- Array batch refinement
- Error handling (returns original on failure)
