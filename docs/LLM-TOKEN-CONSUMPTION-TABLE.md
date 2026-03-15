# LLM Token Consumption — Comprehensive Inventory

**Objective:** Inventory all functions that consume LLM tokens (input and output) across the platform, from company profile through campaign management, social engagement, market pulse, active leads, and every smaller activity.

**Note:** Token ranges are tentative estimates based on prompt sizes, output structures, and existing audits. Actual usage varies with content length and model behavior.

---

## 1. Company Profile & Onboarding

| # | Function / Operation | File / API | Gateway / Path | Input Tokens (Est.) | Output Tokens (Est.) | Trigger / Frequency |
|---|----------------------|------------|----------------|---------------------|----------------------|---------------------|
| 1 | Profile refinement (Q&A) | `companyProfileService.ts` | aiGateway `refineProblemTransformation` | 800–1,500 | 200–500 | Per profile Q&A refinement |
| 2 | Profile enrichment (clean evidence) | `companyProfileService.ts` | aiGateway `profileEnrichment` | 1,500–3,000 | 300–800 | When cleaning scraped evidence |
| 3 | Profile extraction (structured) | `companyProfileService.ts` | aiGateway `profileExtraction` | 2,000–5,000 | 500–1,500 | Per profile build from evidence |
| 4 | Generate missing field questions | `companyProfileService.ts` | aiGateway `profileEnrichment` | 600–1,200 | 200–500 | When fields are missing |
| 5 | Define problem transformation | `pages/api/company-profile/define-problem-transformation.ts` | Direct OpenAI | 800–1,500 | 300–600 | On user define/refine |
| 6 | Infer problem transformation | `pages/api/company-profile/infer-problem-transformation.ts` | Direct OpenAI | 600–1,200 | 200–500 | Auto-infer from inputs |
| 7 | Define campaign purpose | `pages/api/company-profile/define-campaign-purpose.ts` | Direct OpenAI | 500–1,000 | 200–400 | Per purpose definition |
| 8 | Define target customer | `pages/api/company-profile/define-target-customer.ts` | Direct OpenAI | 500–1,000 | 200–400 | Per target audience step |
| 9 | Define marketing intelligence | `pages/api/company-profile/define-marketing-intelligence.ts` | Direct OpenAI | 600–1,200 | 200–500 | Per intelligence block |
| 10 | Generate marketing intelligence | `pages/api/company-profile/generate-marketing-intelligence.ts` | Direct OpenAI | 800–1,500 | 300–700 | On generate from URL/content |

---

## 2. Campaign Management (All Four Options)

### 2.1 Plan Generation (BOLT / Manual / Opportunity / Questionnaire)

| # | Function / Operation | File / API | Gateway / Path | Input Tokens (Est.) | Output Tokens (Est.) | Trigger / Frequency |
|---|----------------------|------------|----------------|---------------------|----------------------|---------------------|
| 11 | Generate campaign plan (main) | `campaignAiOrchestrator.ts` via `aiPlanningService` | aiGateway `generateCampaignPlan` | 8,000–15,000 | 2,000–6,000 | 1 per plan |
| 12 | Plan repair / regeneration | `campaignAiOrchestrator.ts` | aiGateway via `generateCampaignPlanAI` | 6,000–12,000 | 1,500–4,000 | 0–2 per plan (on validation failure) |
| 13 | Parse plan to weeks | `campaignPlanParser.ts` | aiGateway `parsePlanToWeeks` | 2,500–4,000 | 1,000–2,000 | 1 per plan |
| 14 | Parse refined day | `campaignPlanParser.ts` | aiGateway `parseRefinedDay` | 400–700 | 150–350 | On refine_day mode |
| 15 | Parse platform customization | `campaignPlanParser.ts` | aiGateway `parsePlatformCustomization` | 300–600 | 80–200 | On platform_customize mode |
| 16 | Plan preview | `planPreviewService.ts` | via `generateCampaignPlanAI` | 6,000–12,000 | 2,000–5,000 | On preview only |

### 2.2 Daily Distribution & Content Generation

| # | Function / Operation | File / API | Gateway / Path | Input Tokens (Est.) | Output Tokens (Est.) | Trigger / Frequency |
|---|----------------------|------------|----------------|---------------------|----------------------|---------------------|
| 17 | Generate daily distribution plan | `dailyContentDistributionPlanService.ts` | aiGateway `generateDailyDistributionPlan` | 3,000–5,000 | 600–1,200 | Per week (e.g. 12 for 12-week) |
| 18 | Generate master content from intent | `contentGenerationPipeline.ts` | aiGateway `generateCampaignPlan` | 400–700 | 200–450 | Per daily item (5–7/week) |
| 19 | Generate platform variant | `contentGenerationPipeline.ts` | aiGateway `generatePlatformVariants` | 500–900 | 150–400 | 1–2 per platform per item |
| 20 | Optimize discoverability | `contentGenerationPipeline.ts` | aiGateway `generateCampaignPlan` | 300–500 | 100–250 | 1 per platform (if AI enabled) |
| 21 | Generate content for day (legacy) | `contentGenerationService.ts` | aiGateway `generateContentForDay` | 2,000–4,000 | 400–700 | Per day/platform (legacy) |
| 22 | Regenerate content | `contentGenerationService.ts` | aiGateway `regenerateContent` | 600–1,200 | 300–600 | On overlap / user request |
| 23 | Refine variant (activity workspace) | `pages/api/activity-workspace/content.ts` | aiGateway `generateCampaignPlan` | 500–800 | 150–350 | On-demand user action |
| 24 | Improve variant (activity workspace) | `pages/api/activity-workspace/content.ts` | aiGateway `generateCampaignPlan` | 500–800 | 150–350 | On-demand user action |

### 2.3 Campaign Optimization & Duration

| # | Function / Operation | File / API | Gateway / Path | Input Tokens (Est.) | Output Tokens (Est.) | Trigger / Frequency |
|---|----------------------|------------|----------------|---------------------|----------------------|---------------------|
| 25 | Optimize week | `campaignOptimizationService.ts` | aiGateway `optimizeWeek` | 1,500–3,000 | 500–1,200 | On-demand |
| 26 | Suggest duration (opportunity) | aiGateway | `suggestDurationForOpportunity` | 600–1,000 | 100–250 | 1 per opportunity |
| 27 | Suggest duration (questionnaire) | aiGateway | `suggestDurationFromQuestionnaire` | 700–1,200 | 100–300 | 1 per questionnaire submit |
| 28 | Pre-planning explanation | aiGateway | `generatePrePlanningExplanation` | 150–350 | 80–150 | 1 per pre-planning eval |
| 29 | Planner suggest update | `pages/api/campaigns/planner/suggest-update.ts` | aiGateway `runCompletionWithOperation` | 400–800 | 150–400 | On user "suggest" action |
| 30 | Refine campaign idea (Idea Spine) | `ideaRefinementService.ts` | aiGateway `refineCampaignIdea` | 500–1,000 | 200–500 | On "Refine with AI" click |
| 31 | Campaign recommendation extension | `campaignRecommendationExtensionService.ts` | aiGateway `generateCampaignRecommendations` | 600–1,200 | 200–500 | On extension use |

---

## 3. Recommendations & Opportunities

| # | Function / Operation | File / API | Gateway / Path | Input Tokens (Est.) | Output Tokens (Est.) | Trigger / Frequency |
|---|----------------------|------------|----------------|---------------------|----------------------|---------------------|
| 32 | Generate recommendation (manual) | `pages/api/recommendations/generate.ts` | aiGateway `generateRecommendation` | 800–1,500 | 150–400 | When manual opportunity |
| 33 | Group preview | `pages/api/recommendations/group-preview.ts` | aiGateway `generateRecommendation` | 1,200–2,000 | 400–700 | On-demand |
| 34 | Detected opportunity analysis | `pages/api/recommendations/detected-opportunities.ts` | aiGateway `generateRecommendation` | 1,200–2,000 | 400–700 | On detected opportunity |
| 35 | Trend recommendation (per region) | `opportunityGenerators.ts` | `runDiagnosticPrompt` | 1,500–3,000 | 400–1,000 | Per region in multi-region |
| 36 | Strategic summary (consolidation) | `recommendationConsolidator.ts` | `runDiagnosticPrompt` | 800–1,500 | 200–500 | Per consolidation pass |

---

## 4. Market Pulse

| # | Function / Operation | File / API | Gateway / Path | Input Tokens (Est.) | Output Tokens (Est.) | Trigger / Frequency |
|---|----------------------|------------|----------------|---------------------|----------------------|---------------------|
| 37 | Market pulse per region | `opportunityGenerators.ts` | `runDiagnosticPrompt` | 1,000–2,500 | 300–800 | Per region (PULSE opportunity) |
| 38 | Strategic theme generation (additional) | `strategicThemeEngine.ts` | aiGateway `generateAdditionalStrategicThemes` | 600–1,200 | 200–500 | When requesting more themes |

**Note:** `marketPulseCategoryClassifier` is rule-based — no LLM.

---

## 5. Social Engagement & Inbox

| # | Function / Operation | File / API | Gateway / Path | Input Tokens (Est.) | Output Tokens (Est.) | Trigger / Frequency |
|---|----------------------|------------|----------------|---------------------|----------------------|---------------------|
| 39 | Response generation | `responseGenerationService.ts` | aiGateway `responseGeneration` | 800–2,000 | 100–400 | Per suggested reply |
| 40 | Conversation memory summary | `conversationMemoryService.ts` | aiGateway `conversationMemorySummary` | 500–1,500 | 150–400 | Per conversation summary |
| 41 | Conversation triage | `conversationTriageService.ts` | aiGateway `conversationTriage` | 400–1,000 | 80–200 | Per thread triage |
| 42 | Chat moderation | aiGateway / `GlobalChatPolicy` | aiGateway `chatModeration` | 200–400 | 30–80 | Per chat message (pre-send) |
| 43 | Insight content ideas | `insightContentService.ts` | aiGateway `generateContentIdeas` | 400–800 | 150–400 | On insight content generation |

---

## 6. Active Leads

| # | Function / Operation | File / API | Gateway / Path | Input Tokens (Est.) | Output Tokens (Est.) | Trigger / Frequency |
|---|----------------------|------------|----------------|---------------------|----------------------|---------------------|
| 44 | Lead qualifier | `leadQualifier.ts` | `runDiagnosticPrompt` | 500–1,000 | 100–300 | Per lead qualifier run |
| 45 | Lead predictive qualifier | `leadPredictiveQualifier.ts` | `runDiagnosticPrompt` | 600–1,200 | 150–400 | Per predictive qualifier |
| 46 | Outreach plan | `pages/api/leads/outreach-plan.ts` | `runDiagnosticPrompt` | 800–1,500 | 300–700 | Per outreach plan request |

---

## 7. AI Chat & Diagnostics

| # | Function / Operation | File / API | Gateway / Path | Input Tokens (Est.) | Output Tokens (Est.) | Trigger / Frequency |
|---|----------------------|------------|----------------|---------------------|----------------------|---------------------|
| 47 | GPT Chat (context-aware) | `pages/api/ai/gpt-chat.ts` | Direct OpenAI (user API key) | 300–1,500 | 100–1,000 | Per user message |
| 48 | Virality diagnostics | `viralityAdvisorService.ts` | `runDiagnosticPrompt` | 1,500–3,000 | 400–1,000 | Per diagnostic run |
| 49 | Virality comparisons | `viralityAdvisorService.ts` | `runDiagnosticPrompt` | 1,000–2,500 | 300–700 | Per comparison run |
| 50 | Virality summary | `viralityAdvisorService.ts` | `runDiagnosticPrompt` | 800–1,500 | 200–500 | Per summary run |
| 51 | Recommendation consolidator diagnostic | `recommendationConsolidator.ts` | `runDiagnosticPrompt` | 800–1,500 | 200–500 | Consolidation |

---

## 8. Content & Analysis (Non-Core)

| # | Function / Operation | File / API | Gateway / Path | Input Tokens (Est.) | Output Tokens (Est.) | Trigger / Frequency |
|---|----------------------|------------|----------------|---------------------|----------------------|---------------------|
| 52 | Content analyzer (platform optimization) | `lib/content-analyzer.ts` | Direct OpenAI | 400–1,000 | 200–600 | On content analysis |
| 53 | Voice transcription (Whisper) | `pages/api/voice/transcribe.ts` | OpenAI Whisper API | N/A (audio) | Audio duration–based | Per voice input |

---

## 9. Embeddings (Different Token Model)

| # | Function / Operation | File / API | Gateway / Path | Input Tokens (Est.) | Output Tokens (Est.) | Trigger / Frequency |
|---|----------------------|------------|----------------|---------------------|----------------------|---------------------|
| 54 | Signal embeddings | `signalEmbeddingService.ts` | OpenAI `text-embedding-3-small` | ~50–200 per topic | 0 (embedding) | Per signal/topic embedding |

**Note:** Embeddings use input tokens only; output is vector, not tokens.

---

## 10. Summary Ranges by Domain

| Domain | Min In | Max In | Min Out | Max Out | Operations Count |
|--------|--------|--------|---------|---------|------------------|
| Company Profile | 500 | 5,000 | 200 | 1,500 | 10 |
| Campaign Management | 300 | 15,000 | 80 | 6,000 | 21 |
| Recommendations | 800 | 3,000 | 150 | 1,000 | 5 |
| Market Pulse | 600 | 2,500 | 200 | 800 | 2 |
| Social Engagement | 200 | 2,000 | 30 | 400 | 5 |
| Active Leads | 500 | 1,500 | 100 | 700 | 3 |
| AI Chat & Diagnostics | 300 | 3,000 | 30 | 1,000 | 5 |
| Content & Misc | 400 | 1,000 | 200 | 600 | 2 |
| Embeddings | 50 | 200 | 0 | 0 | 1 |

---

## 11. Highest Token Consumers (Single Call)

| Rank | Operation | Typical Input | Typical Output | Notes |
|------|-----------|---------------|----------------|-------|
| 1 | Generate campaign plan (main) | 8–15K | 2–6K | Largest single call |
| 2 | Plan repair / regeneration | 6–12K | 1.5–4K | On validation failure |
| 3 | Plan preview | 6–12K | 2–5K | Preview-only path |
| 4 | Generate daily distribution plan | 3–5K | 0.6–1.2K | Once per week |
| 5 | Parse plan to weeks | 2.5–4K | 1–2K | Post-plan parse |
| 6 | Profile extraction | 2–5K | 0.5–1.5K | Full profile build |
| 7 | Virality diagnostics | 1.5–3K | 0.4–1K | Advisory |
| 8 | Trend recommendation (per region) | 1.5–3K | 0.4–1K | Per region |
| 9 | Generate content for day (legacy) | 2–4K | 0.4–0.7K | Legacy content path |
| 10 | Profile enrichment | 1.5–3K | 0.3–0.8K | Evidence cleaning |

---

## 12. Per-Campaign Estimate (12-Week Run)

| Phase | Calls | Est. Input | Est. Output | Total Tokens (approx.) |
|-------|-------|------------|-------------|-------------------------|
| Plan generation | 1–3 | 8–15K each | 2–6K each | 20–63K |
| Parse plan | 1 | 2.5–4K | 1–2K | 3.5–6K |
| Daily distribution | 12 | 3–5K each | 0.6–1.2K each | 43–74K |
| Master content | 60 | 0.4–0.7K each | 0.2–0.45K each | 36–69K |
| Platform variants | 120 | 0.5–0.9K each | 0.15–0.4K each | 78–156K |
| **Total per campaign** | | | | **~180–368K tokens** |

---

## 13. BOLT Pipeline — Detailed Stage-by-Stage Breakdown

### 13.1 BOLT Entry Paths

| Entry Path | AI Chat Used? | Notes |
|------------|---------------|-------|
| **BOLT (Fast Mode)** | No | Skips AI Chat; single message "Yes, generate my full 12-week plan now." |
| **Blueprint (Full Flow)** | Yes | AI Chat → iterative planning → final plan generation |

When using **Recommendations → BOLT**, the strategic theme card is already generated (via `generateRecommendations`, which may use `generateRecommendation` from aiGateway when manual/detected opportunities are analyzed). Theme generation itself is mostly signal-based; LLM is used when refining/analyzing single opportunities.

---

### 13.2 BOLT Stage Sequence & LLM Calls

| BOLT Stage | LLM Used? | Function / Service | Input Tokens (Est.) | Output Tokens (Est.) | Per-Run Count |
|------------|------------|--------------------|---------------------|----------------------|---------------|
| **source-recommendation** | No | Saves card to campaign / creates campaign | — | — | 1 |
| **ai/plan** | Yes | `runCampaignAiPlan` → `generateCampaignPlanAI` → `parseAndValidatePlanFromRaw` | 8,000–15,000 | 2,000–6,000 | 1 (plan) + 0–2 (repair/regen) |
| **ai/plan** (parse) | Yes | `parseAiPlanToWeeks` (inside orchestrator) | 2,500–4,000 | 1,000–2,000 | 1 |
| **commit-plan** | No | `saveCampaignBlueprintFromLegacy` | — | — | 1 |
| **generate-weekly-structure-week-1..N** | Yes | `generateWeeklyStructure` → `generateDailyDistributionPlan` or `generateDailyDistributionPlanBatch` | 3,000–5,000 (per week) | 600–1,200 (per week) | Batched: ceil(weeks/4) calls; fallback: 1 per week |
| **schedule-structured-plan** | Yes | `scheduleStructuredPlan` with `generateContent: true` → `generateContentForDailyPlans` | See 13.4 | See 13.4 | Per unique (topic, week) |

---

### 13.3 Weekly Structure (generate-weekly-structure)

| Step | Service | LLM Call | Input Tokens | Output Tokens | Frequency |
|------|---------|----------|--------------|---------------|-----------|
| Batch distribution (up to 4 weeks) | `dailyContentDistributionPlanService` | `callDistributionLLM` (`generateDailyDistributionPlan`) | 5,000–15,000 (batched) | 1,500–4,000 (batched) | 1 call per 4 weeks |
| Per-week fallback | `generateDailyDistributionPlan` | Same | 3,000–5,000 | 600–1,200 | 1 per week if batch fails |
| Slot topic refinement | `refineLanguageOutput` | **No LLM** (rule-based) | — | — | Per slot short_topic, full_topic |

**Example for 4-week BOLT:**  
1 batch call (weeks 1–4): ~8–12K in, ~2–3K out.

---

### 13.4 Daily Plans → Master Content → Repurpose Per Platform

When **schedule-structured-plan** runs with `generateContent: true`, it triggers:

```
generateContentForDailyPlans(campaignId, dailyPlans)
  └─ For each unique (topic, week) group:
       ├─ generateMasterContentFromIntent(item)     ← 1 LLM call per topic
       └─ buildPlatformVariantsFromMaster(item)      ← 1 LLM call (batched) or N calls (per platform)
```

#### Master Content (per unique topic+week)

| Operation | File | Input Tokens | Output Tokens | Notes |
|-----------|------|--------------|---------------|-------|
| **Master content** | `contentGenerationPipeline.generateMasterContentFromIntent` | 500–800 | 250–500 | 1 call per unique (topic, week); uses `generateCampaignPlan` |

**Note:** Content blueprint (hook, key_points, cta) may be cached via `contentBlueprintCache`. If cache hit, `generateContentBlueprint` is skipped. If miss: +1 LLM call (600–1,000 in, 200–400 out).

#### Repurpose Per Platform (platform variants)

| Operation | File | Input Tokens | Output Tokens | Notes |
|-----------|------|--------------|---------------|-------|
| **Platform variants (batched)** | `generatePlatformVariantsInOneCall` | 800–2,000 | 300–800 | 1 call for all platforms when 2+ targets |
| **Platform variant (per platform)** | `requestVariant` | 500–900 | 150–400 | 1–2 calls per platform when deterministic insufficient (e.g. YouTube) |
| **Discoverability (optional)** | `optimizeDiscoverabilityForPlatform` | 300–500 | 100–250 | 1 per platform **only if** `DISCOVERABILITY_OPTIMIZER_AI=true` |

**Typical BOLT (text-only):** LinkedIn + Instagram → 1 batched variant call per topic.  
**With discoverability AI:** +2 calls per topic (one per platform).

---

### 13.5 Token Summary: 4-Week BOLT Run

| Stage | LLM Calls | Est. Input Total | Est. Output Total |
|-------|-----------|------------------|-------------------|
| ai/plan | 1–2 | 8–15K (+ 2.5–4K parse) | 2–6K (+ 1–2K parse) |
| generate-weekly-structure | 1 (batch) | 5–12K | 1.5–4K |
| schedule (master content) | ~5–7 (topics) | 2.5–5.6K | 1.25–3.5K |
| schedule (platform variants) | ~5–7 (batched) | 4–14K | 1.5–5.6K |
| schedule (discoverability, if AI) | ~10–14 | 3–7K | 1–3.5K |
| **4-week BOLT total** | **~22–35** | **~25–55K** | **~8–22K** |

---

### 13.6 Blueprint Flow vs BOLT (AI Chat)

| Flow | AI Chat Messages | Plan LLM Calls | Extra LLM |
|------|------------------|----------------|-----------|
| **BOLT** | 0 (single canned message) | Same as above | None |
| **Blueprint** | N (user ↔ AI) | Same | `moderateChatMessage` per user message (~300 in, ~50 out) |

Blueprint uses the same `ai/plan` → `generate-weekly-structure` → `schedule-structured-plan` pipeline; the difference is conversational context from AI Chat before plan generation.

---

### 13.7 Recommendations → BOLT (Upstream)

| Step | LLM? | Operation | Notes |
|------|------|-----------|-------|
| Strategic theme cards | Maybe | `generateRecommendations` | Mostly signal-based; `generateRecommendation` used for manual/detected opportunity analysis |
| BOLT button click | No | Validation, API calls | Execution bar validation only |
| ai/plan | Yes | As in 13.2 | — |

---

## 13. BOLT Pipeline — Stage-by-Stage Token Detail

Detailed breakdown for BOLT (Build Campaign Blueprint) from Recommendations tab through weekly plan, daily slots, master content, and platform repurpose.

### 13.1 Entry Paths: Recommended vs Blueprint vs BOLT

| Path | AI Chat | LLM at Entry | Notes |
|------|---------|--------------|-------|
| **Recommended → BOLT** | Skipped | No (uses theme from card) | BOLT Fast Mode: single message "Yes, generate my full plan now." |
| **Recommended → Blueprint** | Yes | Per chat turn | AI Chat guides planning; plan API called on final submit |
| **Manual / Opportunity / Questionnaire** | Optional | Varies | May use AI Chat or direct plan |

**Recommendations tab (strategic themes):** `generateRecommendations()` produces theme cards. When user clicks BOLT, themes are passed to `executeBoltPipeline`; no additional LLM at source-recommendation stage.

---

### 13.2 BOLT Stage Flow & LLM Usage

| Stage | LLM Calls | Operation | Input Tokens (Est.) | Output Tokens (Est.) | Per Run |
|-------|-----------|-----------|---------------------|----------------------|---------|
| **source-recommendation** | 0 | — | — | — | No LLM |
| **ai/plan** | 1–3 | `generateCampaignPlan` (+ repair/regen if validation fails) | 8K–15K each | 2K–6K each | 21K–63K total |
| **commit-plan** | 0 | — | — | — | No LLM |
| **generate-weekly-structure-week-1..N** | Per week or batched | `generateDailyDistributionPlan` | 3K–5K per week (or ~12K–20K per 4-week batch) | 0.6K–1.2K per week | See below |
| **schedule-structured-plan** | Master + variants | `generateMasterContentFromIntent` + `buildPlatformVariantsFromMaster` (+ optional discoverability) | Per topic+week | Per topic+week | See below |

---

### 13.3 Weekly Structure (generate-weekly-structure)

- **Service:** `dailyContentDistributionPlanService.generateDailyDistributionPlan` / `generateDailyDistributionPlanBatch`
- **Batching:** Up to 4 weeks per LLM call (BATCH_WEEK_SIZE=4); fallback to per-week if batch fails
- **Per week (4-week BOLT):** Typically 1 batch call covering all 4 weeks
- **Per 4-week campaign:** 1 call → ~12K–20K in / ~2.5K–5K out
- **Additional:** `refineLanguageOutput` for `short_topic` and `full_topic` per slot — **no LLM** (rule-based)

| BOLT Duration | Weekly LLM Calls | Est. Input | Est. Output |
|---------------|------------------|------------|-------------|
| 1 week | 1 | 3K–5K | 0.6K–1.2K |
| 2 weeks | 1 | 6K–10K | 1.2K–2.4K |
| 3 weeks | 1 | 9K–15K | 1.8K–3.6K |
| 4 weeks | 1 | 12K–20K | 2.4K–4.8K |

---

### 13.4 Daily Slots

- **Source:** Output of `generate-weekly-structure` (from `generateDailyDistributionPlan`)
- **No additional LLM** — slots are derived from weekly LLM output
- **Enrichment:** `short_topic`, `full_topic` refined via `refineLanguageOutput` (rule-based, no LLM)

---

### 13.5 Master Content (schedule-structured-plan → generateContentForDailyPlans)

- **Service:** `contentGenerationPipeline.generateMasterContentFromIntent`
- **Grouping:** By `(topic, week)` — one master per unique topic per week
- **Flow:** Intent + writer brief → 1 LLM call → master content (then `refineLanguageOutput` — no LLM)

| Item | LLM Calls | Input (Est.) | Output (Est.) |
|------|-----------|--------------|----------------|
| Per unique topic+week | 1 | 400–700 | 200–450 |

**Example (4-week BOLT, ~5 posts/week, 2 platforms):** ~20 unique topics → 20 master calls → ~8K–14K in / ~4K–9K out

---

### 13.6 Repurpose Per Platform

- **Service:** `contentGenerationPipeline.buildPlatformVariantsFromMaster`
- **Strategy:** Prefer `generatePlatformVariantsInOneCall` (1 call for 2+ platforms) or `requestVariant` per platform
- **Per platform:** Up to 2 calls (main + expand if content too short)

| Scenario | LLM Calls per Topic | Input (Est.) | Output (Est.) |
|----------|---------------------|--------------|---------------|
| Single platform | 1 | 500–900 | 150–400 |
| 2 platforms (batched) | 1 | 700–1.4K | 300–800 |
| 3 platforms (batched) | 1 | 1K–2K | 450–1.2K |
| Per platform (non-batched) | 1–2 each | 500–900 each | 150–400 each |

**Optional discoverability** (`DISCOVERABILITY_OPTIMIZER_AI=true`):

| Per platform | Input | Output |
|--------------|-------|--------|
| 1 | 300–500 | 100–250 |

---

### 13.7 Content Blueprint (Optional Path)

- **When used:** Some flows call `generateContentBlueprint` before master (e.g. activity workspace, full pipeline)
- **Service:** `contentGenerationPipeline.generateContentBlueprint`
- **Per item:** 1 LLM call

| Item | Input (Est.) | Output (Est.) |
|------|--------------|---------------|
| Content blueprint | 500–1K | 200–500 |

---

### 13.8 BOLT Token Summary (4-Week, outcomeView: campaign_schedule)

| Phase | LLM Calls | Est. Input | Est. Output | Total Tokens |
|-------|-----------|------------|-------------|--------------|
| source-recommendation | 0 | — | — | 0 |
| ai/plan | 1 | 8K–15K | 2K–6K | 10K–21K |
| commit-plan | 0 | — | — | 0 |
| generate-weekly-structure | 1 (batch) | 12K–20K | 2.4K–4.8K | 14K–25K |
| schedule-structured-plan | | | | |
| ├─ Master content | ~20 | 8K–14K | 4K–9K | 12K–23K |
| ├─ Platform variants | ~20 | 10K–28K | 3K–12K | 13K–40K |
| └─ Discoverability (if AI) | ~40 | 12K–20K | 4K–10K | 16K–30K |
| **Total (no discoverability AI)** | **~42** | | | **~49K–109K** |
| **Total (with discoverability AI)** | **~82** | | | **~65K–139K** |

---

### 13.9 Recommendations Tab → BOLT (Pre-BOLT)

| Step | LLM? | Operation | Input (Est.) | Output (Est.) |
|------|------|-----------|--------------|---------------|
| Generate strategic themes | Yes | `generateRecommendations` (orchestration) | Varies | Varies |
| Single-opportunity analysis (manual) | Yes | `generateRecommendation` | 800–1.5K | 150–400 |
| Group preview | Yes | `generateRecommendation` | 1.2K–2K | 400–700 |
| Detected opportunity analysis | Yes | `generateRecommendation` | 1.2K–2K | 400–700 |

**Note:** Theme cards come from `generateRecommendations`; BOLT consumes those themes without extra LLM at source-recommendation.

---

### 13.10 Blueprint Path (AI Chat) vs BOLT

| Flow | AI Chat | Plan generation | Weekly | Daily | Master + repurpose |
|------|---------|-----------------|--------|-------|---------------------|
| **BOLT** | Skipped | 1 message "Yes, generate..." | Same | Same | Same |
| **Blueprint** | Multi-turn | Final submit | Same | Same | Same |

AI Chat (`/api/ai/gpt-chat` or campaign planner chat): 300–1.5K in / 100–1K out **per user message**. Not part of BOLT pipeline; used only in Blueprint flow.

---

## 13. BOLT Pipeline — Detailed Stage-by-Stage Token Breakdown

This section provides granular token estimates for each BOLT (Build Campaign Blueprint) stage, from Recommendations + AI Chat through weekly, daily, master content, and per-platform repurpose.

### 13.1 BOLT vs Blueprint Flow

| Path | AI Chat | Plan Generation | Daily Distribution | Content Generation |
|------|---------|-----------------|--------------------|---------------------|
| **BOLT (Fast Mode)** | Skipped | 1 call: "Yes, generate my full plan now." | Yes | Yes (when outcome = schedule) |
| **Blueprint (Full)** | Yes, interactive | 1–3 calls (plan + optional repair) | Yes | Yes (when outcome = schedule) |

---

### 13.2 Recommendations Tab (Before BOLT)

| Step | Operation | Input Tokens | Output Tokens | When |
|------|-----------|--------------|---------------|------|
| Generate strategic themes | `generateRecommendations` (orchestration) | — | — | Tab load / refresh |
| Single opportunity analysis | `generateRecommendation` (aiGateway) | 800–1,500 | 150–400 | Manual opportunity create |
| Group preview | `generateRecommendation` | 1,200–2,000 | 400–700 | On group preview |
| Theme polish / additional themes | `generateAdditionalStrategicThemes` | 600–1,200 | 200–500 | "Generate more themes" |
| **Total (per BOLT trigger)** | | **0–2,000** | **0–700** | Depends on manual/group use |

**Note:** Strategic theme cards come from `generateRecommendations` (ranking + signals). That flow may call `generateRecommendation` only when manual/group opportunity is used. BOLT itself does not invoke recommendation LLM—it uses the card data as input.

---

### 13.3 AI Chat (Blueprint Path Only)

| Step | Operation | Input Tokens | Output Tokens | When |
|------|-----------|--------------|---------------|------|
| Pre-send moderation | `moderateChatMessage` | 200–400 | 30–80 | Per user message |
| Chat response | GPT Chat API (user key) | 300–1,500 | 100–1,000 | Per user message |
| **Total per message** | | **500–1,900** | **130–1,080** | Interactive chat |

BOLT skips AI Chat and sends a single message: `"Yes, generate my full 12-week plan now."`

---

### 13.4 BOLT Stage 1: source-recommendation

| Step | LLM? | Input | Output | Notes |
|------|------|-------|--------|-------|
| Save card to campaign / create campaign | No | — | — | DB only |

**Tokens: 0** — No LLM calls.

---

### 13.5 BOLT Stage 2: ai/plan

| Step | Operation | Input Tokens | Output Tokens | Notes |
|------|-----------|--------------|---------------|-------|
| Main plan generation | `generateCampaignPlanAI` → `generateCampaignPlan` | 8,000–15,000 | 2,000–6,000 | 1 call |
| Plan repair (if validation fails) | `generateCampaignPlanAI` | 6,000–12,000 | 1,500–4,000 | 0–2 calls |
| Parse plan to weeks | `parseAiPlanToWeeks` | 2,500–4,000 | 1,000–2,000 | 1 call |

| Scenario | Total Input | Total Output |
|----------|-------------|--------------|
| Happy path | 10,500–19,000 | 3,000–8,000 |
| With 1 repair | 16,500–31,000 | 4,500–12,000 |

---

### 13.6 BOLT Stage 3: commit-plan

| Step | LLM? | Input | Output | Notes |
|------|------|-------|--------|-------|
| Sanitize & save blueprint | No | — | — | DB + fromStructuredPlan |

**Tokens: 0** — No LLM calls.

---

### 13.7 BOLT Stage 4: generate-weekly-structure (Weekly → Daily)

Weeks are processed in batches of 4. Each batch = 1 LLM call (or per-week fallback).

| Step | Operation | Input Tokens | Output Tokens | Per |
|------|-----------|--------------|---------------|-----|
| Daily distribution (batch) | `generateDailyDistributionPlanBatch` → `callDistributionLLM` | 8,000–16,000 | 2,400–4,800 | 4 weeks |
| Daily distribution (per week fallback) | `generateDailyDistributionPlan` | 3,000–5,000 | 600–1,200 | 1 week |
| Refine slot short/full topic | `refineLanguageOutput` | 0 | 0 | Rule-based |

| Campaign Length | Batched (4-wk) | Per-Week Fallback | Est. Input | Est. Output |
|------------------|----------------|-------------------|------------|-------------|
| 4 weeks | 1 batch | — | 8–16K | 2.4–4.8K |
| 8 weeks | 2 batches | — | 16–32K | 4.8–9.6K |
| 12 weeks | 3 batches | — | 24–48K | 7.2–14.4K |
| 12 weeks (fallback) | — | 12 calls | 36–60K | 7.2–14.4K |

---

### 13.8 BOLT Stage 5: schedule-structured-plan (Master Content + Repurpose per Platform)

When `outcomeView` = `campaign_schedule`, BOLT calls `scheduleStructuredPlan` with `generateContent: true`, which triggers:

1. **Master content** — 1 LLM call per unique (topic, week)
2. **Platform variants** — 1 batched call per topic (or 1 call per platform if not batched)
3. **Discoverability** (optional) — 1 call per platform when `DISCOVERABILITY_OPTIMIZER_AI=true`

#### Master Content

| Operation | Input Tokens | Output Tokens | Per |
|-----------|--------------|---------------|-----|
| `generateMasterContentFromIntent` | 400–700 | 200–450 | Unique topic+week |

#### Repurpose per Platform

| Operation | Input Tokens | Output Tokens | Per |
|-----------|--------------|---------------|-----|
| `generatePlatformVariantsInOneCall` (batched) | 800–1,500 | 400–900 | All platforms for 1 topic |
| `requestVariant` (per platform, non-batch) | 500–900 | 150–400 | 1 platform |
| Expand variant (too short) | 500–900 | 150–400 | 0–1 per variant |
| `optimizeDiscoverabilityForPlatform` (if AI) | 300–500 | 100–250 | 1 platform |

#### Example: 4-Week BOLT, 5 posts/week, 2 platforms (LinkedIn, Instagram)

| Item | Unique Topics | Master Calls | Variant Calls | Discoverability (if AI) |
|------|---------------|--------------|---------------|--------------------------|
| 4 weeks × 5 posts | ~15–20 unique | 15–20 | 15–20 (batched) or 30–40 (per platform) | 0–40 |

| Phase | Calls | Input Range | Output Range |
|-------|-------|-------------|--------------|
| Master content | 15–20 | 6–14K | 3–9K |
| Platform variants (batched) | 15–20 | 12–30K | 6–18K |
| Platform variants (per platform) | 30–40 | 15–36K | 4.5–16K |
| Discoverability (AI) | 30–40 | 9–20K | 3–10K |

---

### 13.9 BOLT End-to-End Token Summary (4-Week Example)

| Stage | Input Range | Output Range |
|-------|-------------|--------------|
| source-recommendation | 0 | 0 |
| ai/plan | 10,500–19,000 | 3,000–8,000 |
| commit-plan | 0 | 0 |
| generate-weekly-structure (4 weeks, 1 batch) | 8,000–16,000 | 2,400–4,800 |
| schedule-structured-plan (master + variants) | 18–44K | 9–28K |
| **Total per 4-week BOLT** | **36,500–79,000** | **14,400–40,800** |

---

### 13.10 Content Blueprint Cache

When `getCachedBlueprint` returns a hit, `generateContentBlueprint` is skipped. That avoids:

- 1 LLM call per blueprint (input ~600–1,000, output ~200–400)
- Downstream blueprint-to-master flow may still call `generateMasterContentFromIntent` if master is not cached

---

*Ranges are indicative; measure actual usage via `usage_events` / `logUsageEvent` for production planning.*

---

## Appendix A: BOLT Pipeline — Per-Stage Token Breakdown

Detailed token consumption by BOLT stage, from strategic theme (recommended) through AI Chat (Blueprint only), weekly structure, daily slots, master content, and repurpose-per-platform.

### A.1 BOLT vs Blueprint Flow (Entry Points)

| Flow | Entry | AI Chat | LLM at Entry | Notes |
|------|-------|---------|--------------|-------|
| **BOLT (Fast)** | Recommendation card → ⚡ BOLT | **Skipped** | None at card | Single message `"Yes, generate my full 12-week plan now."` passed to ai/plan |
| **Blueprint** | Recommendation card → Build Blueprint | **Yes** | Per user message | User chats with AI; final message triggers plan API |
| **Both** | ai/plan stage | — | Same plan LLM | Identical `runCampaignAiPlan` after context is built |

### A.2 BOLT Stages (in order)

| Stage | Description | LLM Used? | Input Tokens (Est.) | Output Tokens (Est.) | Calls per Run |
|-------|-------------|-----------|---------------------|----------------------|---------------|
| **source-recommendation** | Save card to campaign or create campaign | No | 0 | 0 | 0 |
| **ai/plan** | Generate weekly blueprint via AI | Yes | 8,000–15,000 | 2,000–6,000 | 1 (or 1–3 with repair) |
| **commit-plan** | Save blueprint to DB, parse to weeks | Yes* | 2,500–4,000 | 1,000–2,000 | 1 (parse only) |
| **generate-weekly-structure-week-1..N** | Daily distribution per week | Yes | 3,000–5,000 per week | 600–1,200 per week | Batched: ceil(N/4) or N |
| **schedule-structured-plan** | Create daily_content_plans + optional content | Yes** | See A.4 | See A.4 | When `generateContent: true` |

\* Parse (`parseAiPlanToWeeks`) runs inside `runCampaignAiPlan` — part of ai/plan, not a separate BOLT event.  
\** Content generation runs inside `scheduleStructuredPlan` when `generateContent: true`.

### A.3 Recommended (Strategic Themes) → BOLT Path

| Step | Where | LLM? | Input (Est.) | Output (Est.) |
|------|-------|------|--------------|---------------|
| Generate Strategic Themes | `generateRecommendations` (Trend tab) | Yes | 800–3,000 | 150–1,000 |
| User selects card, clicks BOLT | — | No | — | — |
| Execution bar validation | — | No | — | — |
| source-recommendation | `boltPipelineService` | No | 0 | 0 |
| ai/plan | `runCampaignAiPlan` | Yes | 8–15K | 2–6K |

**Note:** Strategic theme generation happens **before** BOLT. BOLT only consumes tokens from ai/plan onward. If the card came from `generateRecommendations`, that LLM cost is separate (recommendations domain).

### A.4 AI Chat (Blueprint flow only)

| Step | When | LLM? | Input (Est.) | Output (Est.) |
|------|------|------|--------------|---------------|
| User message | Each chat message | Yes (moderation) | 200–400 | 30–80 |
| Moderation | `moderateChatMessage` before send | Yes | 200–400 | 30–80 |
| GPT response | `pages/api/ai/gpt-chat.ts` (user API key) | Yes | 300–1,500 | 100–1,000 |
| Final "generate plan" | Last message triggers plan API | Yes | 8–15K | 2–6K |

Per Blueprint session: 2–10+ chat turns × (moderation + GPT) + 1 plan call.

### A.5 Weekly Stage (`generate-weekly-structure`)

| Sub-step | Service / Function | LLM? | Input (Est.) | Output (Est.) | Per 4-Week BOLT |
|----------|-------------------|------|--------------|---------------|------------------|
| Daily distribution (batch) | `generateDailyDistributionPlanBatch` | Yes | 8K–18K (4 weeks) | 1.5K–4K | 1 call if batch |
| Daily distribution (per week) | `generateDailyDistributionPlan` | Yes | 3K–5K | 0.6K–1.2K | 4 calls if no batch |
| Slot topic refinement | `refineLanguageOutput` (short_topic, full_topic) | **No** (rule-based) | 0 | 0 | — |

**BOLT 4-week example:** 1 batch call ≈ 8–18K in, 1.5–4K out, or 4 × (3–5K in, 0.6–1.2K out).

### A.6 Daily Slots

| Step | LLM? | Notes |
|------|------|-------|
| Create daily_content_plans | No | Deterministic from weekly distribution + allocation |
| Enrich slot (short_topic, full_topic) | No | `refineLanguageOutput` is rule-based |

Daily slots themselves do not consume LLM; they are outputs of the weekly distribution stage.

### A.7 Master Content (`generateContentForDailyPlans` → `generateMasterContentFromIntent`)

Triggered when `schedule-structured-plan` runs with `generateContent: true`.

| Item | Per unique (topic, week) | Input (Est.) | Output (Est.) |
|------|--------------------------|--------------|---------------|
| Master content | 1 call | 400–700 | 200–450 |
| Content blueprint (cache miss) | 0–1 call | 800–1,500 | 250–600 |

**Per 4-week BOLT (≈15–20 unique topics):** 15–20 master calls ≈ 6–14K in, 3–9K out.

### A.8 Repurpose per Platform (`buildPlatformVariantsFromMaster`)

| Path | When | LLM Calls per (topic, platforms) | Input (Est.) | Output (Est.) |
|------|------|----------------------------------|--------------|---------------|
| **Batch** (2+ platforms) | `generatePlatformVariantsInOneCall` | 1 | 600–1,200 | 300–800 |
| **Per platform** | `requestVariant` (deterministic insufficient) | 1–2 per platform | 500–900 each | 150–400 each |
| **Discoverability** (optional) | `optimizeDiscoverabilityForPlatform` | 1 per platform if `DISCOVERABILITY_OPTIMIZER_AI=true` | 300–500 | 100–250 |

**Example (2 platforms × 15 topics, no discoverability AI):** 15 × 1 batch call ≈ 9–18K in, 4.5–12K out.  
**Example (2 platforms × 15 topics, per-platform variant):** 30 × 1 call ≈ 15–27K in, 4.5–12K out.

### A.9 End-to-End BOLT Token Summary (4-Week, outcomeView: schedule)

| Stage | Input Tokens | Output Tokens | Total |
|-------|--------------|---------------|-------|
| ai/plan | 8,000–15,000 | 2,000–6,000 | 10K–21K |
| Parse (inside ai/plan) | 2,500–4,000 | 1,000–2,000 | 3.5K–6K |
| Weekly (batch 4 weeks) | 8,000–18,000 | 1,500–4,000 | 9.5K–22K |
| Master content (≈16 topics) | 6,400–11,200 | 3,200–7,200 | 9.6K–18.4K |
| Platform variants (≈32) | 9,600–19,200 | 4,800–12,800 | 14.4K–32K |
| **Total (4-week BOLT)** | | | **~47K–100K tokens** |

### A.10 BOLT 4-Week vs 12-Week Comparison

| Duration | ai/plan | Weekly | Master | Variants | Total (Est.) |
|----------|---------|--------|--------|----------|--------------|
| 4 weeks | 10–21K | 9.5–22K | 9.6–18K | 14–32K | **~47–93K** |
| 12 weeks | 10–21K | 43–74K | 36–69K | 78–156K | **~167–320K** |

---

## Appendix B: Engagement Pipeline — Per-Activity Token Breakdown

Detailed token consumption for Engagement (inbox, replies, insights, AI-assisted responses, etc.).

### B.1 Engagement Activities Using LLM (Direct OpenAI/aiGateway)

| Activity | Service / API | Operation | Input Tokens (Est.) | Output Tokens (Est.) | Trigger |
|----------|---------------|-----------|---------------------|----------------------|---------|
| **AI-assisted reply (per response)** | `responseGenerationService.ts` | aiGateway `responseGeneration` | 800–2,000 | 100–400 | Each "Suggest Reply" or auto-reply |
| **Conversation memory (summary)** | `conversationMemoryService.ts` | aiGateway `conversationMemorySummary` | 500–1,500 | 150–400 | Per thread when messages change (every 5+ new messages) |
| **Conversation triage (classification)** | `conversationTriageService.ts` | aiGateway `conversationTriage` | 400–1,000 | 80–200 | Per thread classification |
| **Creating insights → content ideas** | `insightContentService.ts` | aiGateway `generateContentIdeas` | 400–800 | 150–400 | Per insight when "Generate Content Ideas" used |

### B.2 AI-Assisted Per Response Flow

| Step | Service | LLM? | Input (Est.) | Output (Est.) | When |
|------|---------|------|--------------|---------------|------|
| 1. Resolve policy (template) | `responsePolicyEngine` | No | — | — | Rule-based |
| 2. Get thread memory | `conversationMemoryService.getThreadMemory` | No | — | — | DB read (summary built earlier) |
| 3. Generate reply text | `responseGenerationService.generateResponse` | **Yes** | 800–2,000 | 100–400 | Per reply request |
| 4. Format for platform | `platformResponseFormatter` | No | — | — | Rule-based |

**Flow:** `responseOrchestrator.orchestrateResponse` → `generateResponse` → 1 LLM call per suggested reply.

**API:** `POST /api/response/generate` or `POST /api/engagement/reply` (suggest or execute)

### B.3 Creating Insights → Content Ideas

| Step | Service | LLM? | Input (Est.) | Output (Est.) | When |
|------|---------|------|--------------|---------------|------|
| 1. User selects insight | — | No | — | — | UI |
| 2. Generate content ideas | `insightContentService.generateContentIdeas` | **Yes** | 400–800 | 150–400 | Per insight (4–6 ideas) |

**API:** `POST /api/insight/content-ideas`

**Context passed:** title, summary, recommended_action, insight_type → 4–6 content ideas (post, article, video, thread).

### B.4 Conversation Memory (Background)

| Step | Service | LLM? | Input (Est.) | Output (Est.) | When |
|------|---------|------|--------------|---------------|------|
| 1. Fetch last 10 messages | `conversationMemoryService` | No | — | — | Worker / on new message |
| 2. Generate summary | `generateSummary` → aiGateway `conversationMemorySummary` | **Yes** | 500–1,500 | 150–400 | When message distance ≥ 5 since last rebuild |

**Trigger:** `engagementConversationMemoryWorker` or equivalent; fires when `updateThreadMemory` is called and skip conditions not met.

### B.5 Conversation Triage (Thread Classification)

| Step | Service | LLM? | Input (Est.) | Output (Est.) | When |
|------|---------|------|--------------|---------------|------|
| 1. Load thread context | `conversationTriageService.loadThreadContext` | No | — | — | Messages, memory, lead signals, opportunities |
| 2. Classify thread | `classifyThread` → aiGateway `conversationTriage` | **Yes** | 400–1,000 | 80–200 | Per thread classification |

**Output:** classification_category, sentiment, triage_priority (1–10).

### B.6 OmniVyra (External API — Not Direct OpenAI)

| Activity | Service | LLM? | Notes |
|----------|---------|------|-------|
| Reply suggestions (OmniVyra) | `engagementAiAssistantService` → `evaluateCommunityAiEngagement` | External | OmniVyra API; tokens consumed by OmniVyra, not platform |
| Conversation intelligence | `engagementConversationIntelligenceService` | External | Same OmniVyra call |
| Community AI evaluation | `communityAiOmnivyraService` | External | Same OmniVyra call |

**When OmniVyra disabled:** `engagementAiAssistantService` returns static fallback replies — **no LLM**.

### B.7 Engagement Activities — No LLM

| Activity | Service | Notes |
|----------|---------|-------|
| Daily digest | `engagementDigestService` | Rule-based aggregation (counts, sorting) |
| Buyer intent / clusters / opportunities | `engagementInsightService` | Rule-based (keywords, topic grouping) |
| Response policy resolution | `responsePolicyEngine` | Template matching |
| Platform formatting | `platformResponseFormatter` | Rule-based |

### B.8 Per-Session Engagement Token Estimate

| User Action | LLM Calls | Est. Input | Est. Output | Total |
|-------------|-----------|------------|-------------|-------|
| Suggest reply (1 message) | 1 | 800–2,000 | 100–400 | 900–2,400 |
| Generate content ideas (1 insight) | 1 | 400–800 | 150–400 | 550–1,200 |
| Open inbox (N threads triaged) | N | 400–1,000 each | 80–200 each | 480–1,200 per thread |
| Background: memory rebuild (1 thread) | 1 | 500–1,500 | 150–400 | 650–1,900 |

### B.9 End-to-End: Responding to 10 Messages

| Phase | LLM Calls | Est. Input | Est. Output |
|-------|-----------|------------|-------------|
| Triage 10 threads | 10 | 4–10K | 0.8–2K |
| Memory rebuild (2 threads) | 2 | 1–3K | 0.3–0.8K |
| Suggest reply (10 clicks) | 10 | 8–20K | 1–4K |
| **Total** | **22** | **~13–33K** | **~2.1–6.8K** |

---

*Ranges are indicative; measure actual usage via `usage_events` / `logUsageEvent` for production planning.*

---

## Appendix B: Engagement Pipeline — Token Breakdown

Per-message and per-thread LLM usage for inbox, AI-assisted replies, insights, triage, and conversation memory.

### B.1 AI-Assisted Per Response

| Step | Service / API | LLM Call | Input Tokens (Est.) | Output Tokens (Est.) | When |
|------|---------------|----------|---------------------|----------------------|------|
| **Template-based reply** | `responseGenerationService.generateResponse` | aiGateway `responseGeneration` | 800–2,000 | 100–400 | Per "Suggest reply" or auto-reply |
| **Reply suggestions** (OmniVyra) | `engagementAiAssistantService.generateReplySuggestions` | External OmniVyra API | N/A (external) | N/A | Per "Get suggestions" (OmniVyra enabled) |
| **Reply suggestions** (fallback) | — | No LLM | 0 | 0 | OmniVyra disabled → static templates |

**Flow:** `responseOrchestrator.orchestrateResponse` → `resolveResponsePolicy` → `generateResponse` (aiGateway). Each response uses thread memory (if available), brand voice, strategies, reply intelligence, opportunities.

### B.2 Conversation Memory (Per Thread)

| Step | Service | LLM Call | Input Tokens (Est.) | Output Tokens (Est.) | When |
|------|---------|----------|---------------------|----------------------|------|
| **Thread summary** | `conversationMemoryService.updateThreadMemory` | aiGateway `conversationMemorySummary` | 500–1,500 | 150–400 | Per thread when message distance ≥ 5; fire-and-forget |

**Trigger:** Worker processes `conversation_memory` queue after new messages. Uses last 10 messages, truncated to ~300 chars each.

### B.3 Conversation Triage (Per Thread)

| Step | Service | LLM Call | Input Tokens (Est.) | Output Tokens (Est.) | When |
|------|---------|----------|---------------------|----------------------|------|
| **Thread classification** | `conversationTriageService.classifyThread` | aiGateway `conversationTriage` | 400–1,000 | 80–200 | Per thread when triage requested |

**Categories:** question_request, recommendation_request, competitor_complaint, problem_discussion, product_comparison, general_comment.

### B.4 Creating Insights (Content Ideas from Insights)

| Step | Service / API | LLM Call | Input Tokens (Est.) | Output Tokens (Est.) | When |
|------|---------------|----------|---------------------|----------------------|------|
| **Content ideas from insight** | `insightContentService.generateContentIdeas` | aiGateway `generateContentIdeas` | 400–800 | 150–400 | Per insight "Generate content ideas" |

**API:** `GET/POST /api/insight/content-ideas` — input: insight title, summary, recommended_action. Output: 4–6 content ideas (post, article, video, thread).

### B.5 Engagement Digest (Daily)

| Step | Service | LLM? | Notes |
|------|---------|------|-------|
| **Daily digest** | `engagementDigestService.generateDailyDigest` | **No** | Rule-based aggregation; counts, sorts, stores — no LLM |

### B.6 Engagement Insight Detection (Signals → Opportunities)

| Step | Service | LLM? | Notes |
|------|---------|------|-------|
| **Buyer intent** | `engagementInsightService.detectBuyerIntent` | **No** | Keyword-based |
| **Conversation clusters** | `engagementInsightService.detectConversationClusters` | **No** | Rule-based topic grouping |
| **Opportunity signals** | `engagementInsightService.detectOpportunitySignals` | **No** | Keyword + score rules |

### B.7 OmniVyra (External)

| Step | Service | LLM? | Notes |
|------|---------|------|-------|
| **Community AI engagement** | `omnivyraClientV1.evaluateCommunityAiEngagement` | External API | Tokens consumed by OmniVyra; not in our `usage_events` |
| **Reply suggestions** | `engagementAiAssistantService` via OmniVyra | External | When OmniVyra enabled |

### B.8 Per-Response Flow (Full Path)

| Stage | LLM Call | Input | Output |
|-------|----------|-------|--------|
| Thread memory (if stale) | `conversationMemorySummary` | 500–1.5K | 150–400 |
| Triage (if requested) | `conversationTriage` | 400–1K | 80–200 |
| Response generation | `responseGeneration` | 800–2K | 100–400 |
| **Total per "Suggest reply"** | 1–2 | 800–2K (or 1.3–3.5K with memory) | 100–600 |

### B.9 Engagement Token Summary

| Activity | LLM Calls | Input (Est.) | Output (Est.) |
|----------|-----------|--------------|---------------|
| Suggest reply (1 message) | 1 | 800–2,000 | 100–400 |
| Thread memory update | 1 | 500–1,500 | 150–400 |
| Thread triage | 1 | 400–1,000 | 80–200 |
| Content ideas from insight | 1 | 400–800 | 150–400 |
| **Per 10 inbox replies (with memory)** | ~12–15 | ~10–25K | ~2–5K |

---

## Appendix B: Engagement Pipeline — Per-Activity Token Breakdown

Detailed token consumption for social engagement: AI-assisted per-response, creating insights, conversation triage, memory summary, OmniVyra path, and related flows.

### B.1 Engagement Activities That Use LLM

| Activity | Service / API | Operation | Input Tokens (Est.) | Output Tokens (Est.) | Trigger |
|----------|---------------|-----------|---------------------|----------------------|---------|
| **AI-assisted response** | `responseGenerationService` | aiGateway `responseGeneration` | 800–2,000 | 100–400 | Per suggested reply (inbox or auto-reply) |
| **Reply suggestions (OmniVyra)** | `engagementAiAssistantService` | External OmniVyra API | Varies (external) | Varies | Per "Suggest reply" click when OmniVyra enabled |
| **Conversation memory summary** | `conversationMemoryService` | aiGateway `conversationMemorySummary` | 500–1,500 | 150–400 | Per thread when messages ≥5 new since last summary |
| **Conversation triage** | `conversationTriageService` | aiGateway `conversationTriage` | 400–1,000 | 80–200 | Per thread classification (inbox grouping/priority) |
| **Creating insights → content ideas** | `insightContentService` | aiGateway `generateContentIdeas` | 400–800 | 150–400 | Per insight when "Generate content ideas" used |

### B.2 Engagement Activities That Do NOT Use LLM

| Activity | Service | Notes |
|----------|--------|-------|
| **Daily digest** | `engagementDigestService` | Rule-based aggregation (counts, sorts) |
| **Buyer intent / clusters / opportunity signals** | `engagementInsightService` | Keyword-rule and clustering; no LLM |
| **OmniVyra disabled fallback** | `engagementAiAssistantService` | Returns static template replies |

### B.3 Per-Response Flow (AI-Assisted Reply)

When user requests a suggested reply or auto-reply executes:

```
responseOrchestrator.orchestrateResponse()
  ├─ resolveResponsePolicy (DB/templates — no LLM)
  ├─ getThreadMemory(thread_id)       ← May trigger conversationMemoryService if rebuild needed
  └─ generateResponse()               ← responseGenerationService: 1 LLM call
```

| Step | LLM? | Input (Est.) | Output (Est.) |
|------|------|--------------|---------------|
| Thread memory (if rebuild) | Yes | 500–1,500 | 150–400 |
| Response generation | Yes | 800–2,000 | 100–400 |
| **Total per AI-assisted reply** | | **1,300–3,500** | **250–800** |

### B.4 Conversation Memory Summary

| Trigger | Service | Input (Est.) | Output (Est.) | When |
|---------|---------|--------------|---------------|------|
| Rebuild summary | `conversationMemoryService.updateThreadMemory` | 500–1,500 | 150–400 | When `latest_message_id` ≠ `last_processed` and message distance ≥ 5 |
| Load (no rebuild) | `getThreadMemory` | 0 | 0 | Read from DB; no LLM |

### B.5 Conversation Triage (Thread Classification)

| Trigger | Service | Input (Est.) | Output (Est.) | When |
|---------|---------|--------------|---------------|------|
| Classify thread | `conversationTriageService.classifyThread` | 400–1,000 | 80–200 | Per thread for inbox grouping/priority (question_request, recommendation_request, competitor_complaint, etc.) |

### B.6 Creating Insights → Content Ideas

| Step | API / Service | Input (Est.) | Output (Est.) | When |
|------|---------------|--------------|---------------|------|
| Generate content ideas | `pages/api/insight/content-ideas.ts` → `insightContentService.generateContentIdeas` | 400–800 | 150–400 | User selects insight and clicks "Generate content ideas" (4–6 ideas: post, article, video, thread) |

### B.7 OmniVyra Path (External API)

| Step | Service | LLM Location | Notes |
|------|---------|--------------|-------|
| Reply suggestions | `engagementAiAssistantService` → `evaluateCommunityAiEngagement` | **OmniVyra API** (external) | Tokens consumed on OmniVyra side; not in our `usage_events` |
| Conversation intelligence | `engagementConversationIntelligenceService` | OmniVyra API | Same |
| Community AI evaluation | `communityAiOmnivyraService` | OmniVyra API | Same |

When OmniVyra is **disabled**: `engagementAiAssistantService` returns static templates — **0 tokens**.

### B.8 Engagement Token Summary (Per Inbox Session Example)

| Activity | Calls | Est. Input | Est. Output |
|----------|-------|------------|-------------|
| Triage 10 threads | 10 | 4–10K | 0.8–2K |
| Memory rebuild (2 threads) | 2 | 1–3K | 0.3–0.8K |
| AI-assisted replies (5 messages) | 5 | 4–10K | 0.5–2K |
| Content ideas from 1 insight | 1 | 0.4–0.8K | 0.15–0.4K |
| **Session total** | | **~9–24K** | **~1.75–5.2K** |

---

## Appendix B: Engagement Pipeline — Per-Activity Token Breakdown

Detailed token consumption for engagement inbox flows: AI-assisted reply, insights, content ideas, conversation memory, triage, and related activities.

### B.1 Engagement Flow Overview

| Flow | Trigger | LLM Services | Notes |
|------|---------|--------------|-------|
| **Per-response (AI suggested reply)** | User clicks "Suggest reply" / auto-reply | `responseGenerationService` | 1 call per suggestion request |
| **Conversation memory** | New messages (worker, message distance ≥5) | `conversationMemoryService` | 1 call per thread when summary rebuilt |
| **Conversation triage** | Thread classification (inbox grouping) | `conversationTriageService` | 1 call per thread when triaged |
| **Insight → content ideas** | User generates ideas from strategic insight | `insightContentService` | 1 call per insight |
| **Reply suggestions (OmniVyra)** | User opens suggestion panel | External OmniVyra API | Not direct OpenAI — external service |

### B.2 AI-Assisted Per Response

| Step | Service / API | Operation | Input Tokens (Est.) | Output Tokens (Est.) | When |
|------|---------------|-----------|---------------------|----------------------|------|
| Policy + template resolution | `responseOrchestrator` | — | 0 | 0 | DB lookup |
| Thread memory (context) | `conversationMemoryService.getThreadMemory` | — | 0 | 0 | Read cached summary |
| **Response generation** | `responseGenerationService.generateResponse` | aiGateway `responseGeneration` | 800–2,000 | 100–400 | Per suggested reply |
| Platform formatting | — | Rule-based | 0 | 0 | — |

**Per-response total:** ~800–2,000 in, ~100–400 out (1 LLM call).

**Upstream:** If thread memory was stale, `conversationMemoryService.updateThreadMemory` may run first: +500–1,500 in, 150–400 out.

### B.3 Creating Insights

| Operation | Service | LLM? | Input (Est.) | Output (Est.) | When |
|-----------|---------|------|--------------|---------------|------|
| **Insight → content ideas** | `insightContentService.generateContentIdeas` | Yes | 400–800 | 150–400 | User selects insight, clicks "Generate content ideas" |
| Engagement insight detection | `engagementInsightService` | **No** | 0 | 0 | Rule-based (buyer keywords, clusters) |
| Daily digest | `engagementDigestService` | **No** | 0 | 0 | Rule-based aggregation |

**Note:** `engagementInsightService` (buyer intent, clusters, opportunity signals) is rule-based. Only `insightContentService` uses LLM to turn insights into content ideas.

### B.4 Conversation Memory Summary

| Step | Service | Input (Est.) | Output (Est.) | Frequency |
|------|---------|--------------|---------------|-----------|
| Rebuild summary | `conversationMemoryService.updateThreadMemory` | 500–1,500 | 150–400 | When message distance ≥ 5 or stale 24h |

Triggered by worker when new messages arrive. Uses up to 10 recent messages, truncated to 300 chars each.

### B.5 Conversation Triage (Thread Classification)

| Step | Service | Input (Est.) | Output (Est.) | Frequency |
|------|---------|--------------|---------------|-----------|
| Classify thread | `conversationTriageService.classifyThread` | 400–1,000 | 80–200 | Per thread when triaged |

Context: last 10 messages, conversation memory, lead signals, opportunities.

### B.6 OmniVyra vs Direct OpenAI

| Path | LLM Provider | Token Tracking | Notes |
|------|---------------|----------------|-------|
| **Reply suggestions (OmniVyra)** | External OmniVyra API | Not in `usage_events` | `evaluateCommunityAiEngagement` — external service |
| **Response generation (policy-based)** | OpenAI via aiGateway | Yes | `responseGenerationService` — logged |

When OmniVyra is disabled, `engagementAiAssistantService` returns static fallbacks (no LLM).

### B.7 Engagement Token Summary (Typical Day)

| Activity | Calls/day (Est.) | Input Range | Output Range |
|----------|------------------|-------------|--------------|
| AI suggested replies | 10–50 | 8K–100K | 1K–20K |
| Conversation memory (new threads) | 5–20 | 2.5K–30K | 0.75K–8K |
| Conversation triage | 5–30 | 2K–30K | 0.4K–6K |
| Insight → content ideas | 0–5 | 0–4K | 0–2K |
| **Total (engagement domain)** | | **~12K–164K** | **~2K–36K** |

### B.8 No-LLM Engagement Components

| Component | Notes |
|-----------|-------|
| `engagementDigestService` | Rule-based aggregation (counts, priority sort) |
| `engagementInsightService` | Rule-based (keywords, simple clustering) |
| `engagementAiAssistantService` (OmniVyra off) | Static fallback replies |
| `responseOrchestrator` (policy resolution) | DB + rules |
| `refineLanguageOutput` | Rule-based (no LLM) |

---

## Appendix B: Engagement Pipeline — Per-Stage Token Breakdown

Detailed token consumption for social engagement: creating insights, AI-assisted per response, triage, conversation memory, digest, and OmniVyra paths.

### B.1 Engagement LLM Paths Overview

| Path | LLM Source | Input (Est.) | Output (Est.) | Trigger |
|------|------------|--------------|---------------|---------|
| **Response generation** (policy-based) | aiGateway `responseGeneration` | 800–2,000 | 100–400 | Per suggested reply (template + context) |
| **Reply suggestions** (OmniVyra) | External OmniVyra API | N/A* | N/A* | Per thread when AI panel opened |
| **Conversation memory** | aiGateway `conversationMemorySummary` | 500–1,500 | 150–400 | Per thread when messages ≥5 new |
| **Conversation triage** | aiGateway `conversationTriage` | 400–1,000 | 80–200 | Per thread classification |
| **Insight content ideas** | aiGateway `generateContentIdeas` | 400–800 | 150–400 | Per strategic insight → content ideas |
| **Chat moderation** | aiGateway `chatModeration` | 200–400 | 30–80 | Per chat message (Blueprint/general) |

\* OmniVyra consumes its own tokens; not tracked in `usage_events`.

### B.2 AI-Assisted Per Response (Response Generation)

**Flow:** `responseOrchestrator` → `generateResponse` → aiGateway `responseGeneration`

| Step | Service | Input Tokens | Output Tokens | When |
|------|---------|--------------|---------------|------|
| Resolve policy | `responsePolicyEngine` | 0 | 0 | Rule-based template selection |
| Get thread memory | `conversationMemoryService.getThreadMemory` | 0 | 0 | DB read (prior LLM summary) |
| Generate reply | `responseGenerationService.generateResponse` | 800–2,000 | 100–400 | Per "suggest reply" or auto-reply |

**Context included in prompt:** brand voice, platform rules, template structure, conversation summary, strategy guidance, reply intelligence, active opportunities.

**API entry:** `POST /api/response/generate` or `autoReplyService.attemptAutoReply`

### B.3 Reply Suggestions (OmniVyra / AI Engagement Assistant)

| Path | LLM Source | Input (Est.) | Output (Est.) | When |
|------|------------|--------------|---------------|------|
| OmniVyra enabled | External API | ~500–1,500 | ~200–600 | `engagementAiAssistantService.generateReplySuggestions` |
| OmniVyra disabled | None | 0 | 0 | Returns static fallbacks |

**API entry:** `GET /api/engagement/suggestions?message_id=...`  
**UI:** AISuggestionPanel, AIEngagementAssistant when user opens AI suggestions.

### B.4 Creating Insights (Content Ideas from Insights)

| Step | Service | Input Tokens | Output Tokens | When |
|------|---------|--------------|---------------|------|
| Content ideas from insight | `insightContentService.generateContentIdeas` | 400–800 | 150–400 | Per insight "Generate content ideas" |

**API entry:** `POST /api/insight/content-ideas`  
**Input:** `{ title, summary, insight_type?, recommended_action?, supporting_signals? }`  
**Output:** 4–6 content ideas (post, article, video, thread).

### B.5 Conversation Memory Summary

| Step | Service | Input Tokens | Output Tokens | When |
|------|---------|--------------|---------------|------|
| Summarize thread | `conversationMemoryService.updateThreadMemory` | 500–1,500 | 150–400 | When message distance ≥5 or stale >24h |

**Trigger:** `conversationMemoryWorker` (queue) or on-demand when response generation needs context.  
**Content:** Last 10 messages, truncated to 300 chars each.

### B.6 Conversation Triage (Thread Classification)

| Step | Service | Input Tokens | Output Tokens | When |
|------|---------|--------------|---------------|------|
| Classify thread | `conversationTriageService.classifyThread` | 400–1,000 | 80–200 | Per thread triage run |

**Categories:** question_request, recommendation_request, competitor_complaint, problem_discussion, product_comparison, general_comment.  
**Output:** classification_category, classification_confidence, sentiment, triage_priority.

### B.7 Engagement Digest

| Step | LLM? | Notes |
|------|------|-------|
| `engagementDigestService.generateDailyDigest` | **No** | Rule-based aggregation (counts, recommended threads) |

**No LLM tokens.** Daily digest uses DB queries and deterministic ranking.

### B.8 Engagement Insight Service (Buyer Intent, Clusters)

| Step | LLM? | Notes |
|------|------|-------|
| `engagementInsightService.detectBuyerIntent` | **No** | Keyword matching (price, demo, etc.) |
| `engagementInsightService.detectConversationClusters` | **No** | Topic clustering by keywords |
| `engagementInsightService.detectOpportunitySignals` | **No** | Rule-based signal detection |

**No LLM tokens.** All rule-based.

### B.9 End-to-End Engagement Token Summary (Per Day Example)

| Activity | Calls/Day (Est.) | Input Total | Output Total | Total Tokens |
|----------|------------------|-------------|--------------|--------------|
| Response generation (10 replies) | 10 | 8–20K | 1–4K | 9–24K |
| Conversation memory (5 threads) | 5 | 2.5–7.5K | 0.75–2K | 3.25–9.5K |
| Conversation triage (20 threads) | 20 | 8–20K | 1.6–4K | 9.6–24K |
| Insight content ideas (3 insights) | 3 | 1.2–2.4K | 0.45–1.2K | 1.65–3.6K |
| **Total (OpenAI only)** | | | | **~23–61K/day** |

**Note:** OmniVyra reply suggestions are external; add separately if tracking that provider.

---

## Appendix B: Engagement Pipeline — Token Breakdown

Per-stage token detail for engagement inbox: AI-assisted response generation, insights, conversation memory, triage, reply suggestions, and related flows.

### B.1 Engagement Flow Overview

| Flow | LLM Used? | Service / API | Notes |
|------|------------|---------------|-------|
| **Reply suggestions (OmniVyra)** | External* | `engagementAiAssistantService` → `evaluateCommunityAiEngagement` | Tokens consumed by OmniVyra API, not local OpenAI |
| **AI-assisted per response** | Yes | `responseOrchestrator` → `generateResponse` → `responseGenerationService` | Policy + template → LLM reply |
| **Conversation memory** | Yes | `conversationMemoryService.updateThreadMemory` | Summary per thread |
| **Conversation triage** | Yes | `conversationTriageService.classifyThread` | Category, sentiment, priority |
| **Creating insights (content ideas)** | Yes | `insightContentService.generateContentIdeas` | From strategic insight → 4–6 content ideas |
| **Daily digest** | No | `engagementDigestService` | Rule-based aggregation |
| **Engagement insights (buyer/clusters)** | No | `engagementInsightService` | Rule-based keyword matching |

\* OmniVyra is an external API; token consumption is on OmniVyra side, not local.

---

### B.2 AI-Assisted Per Response

**Flow:** User clicks "Suggest reply" or auto-reply triggers → `responseOrchestrator.orchestrateResponse` → `generateResponse` (responseGenerationService).

| Step | Operation | Input Tokens (Est.) | Output Tokens (Est.) | When |
|------|-----------|---------------------|----------------------|------|
| Policy resolution | `resolveResponsePolicy` | 0 | 0 | Rule/template lookup |
| Thread memory | `getThreadMemory` | 0 | 0 | Cached summary (no LLM) |
| **Response generation** | `runCompletionWithOperation` (`responseGeneration`) | 800–2,000 | 100–400 | Per suggested reply |

**Prompt includes:** Brand voice, platform rules, template structure, conversation context (from memory), adaptive strategies, reply intelligence, opportunities.

**API:** `POST /api/response/generate` or auto-reply via `attemptAutoReply` → `orchestrateResponse`.

---

### B.3 Conversation Memory (Summary)

**Flow:** New messages inserted → worker/job triggers `updateThreadMemory` when message distance ≥ 5 and latest ≠ last_processed.

| Step | Operation | Input Tokens (Est.) | Output Tokens (Est.) | When |
|------|-----------|---------------------|----------------------|------|
| **Generate summary** | `runCompletionWithOperation` (`conversationMemorySummary`) | 500–1,500 | 150–400 | Per thread rebuild |

**Prompt:** Last 10 messages (up to 300 chars each) → 3–5 sentence summary.

**Frequency:** Only when rebuild criteria met (message distance ≥ 5, not already current).

---

### B.4 Conversation Triage (Classification)

**Flow:** Thread classification for inbox grouping/prioritization.

| Step | Operation | Input Tokens (Est.) | Output Tokens (Est.) | When |
|------|-----------|---------------------|----------------------|------|
| **Classify thread** | `runCompletionWithOperation` (`conversationTriage`) | 400–1,000 | 80–200 | Per thread classification |

**Categories:** question_request, recommendation_request, competitor_complaint, problem_discussion, product_comparison, general_comment.  
**Output:** classification_category, confidence, sentiment, triage_priority (1–10).

---

### B.5 Creating Insights (Content Ideas from Insight)

**Flow:** Strategic insight → generate 4–6 content ideas (post, article, video, thread).

| Step | Operation | Input Tokens (Est.) | Output Tokens (Est.) | When |
|------|-----------|---------------------|----------------------|------|
| **Generate content ideas** | `runCompletionWithOperation` (`generateContentIdeas`) | 400–800 | 150–400 | On "Generate content ideas" from insight |

**API:** `POST /api/insight/content-ideas` with insight (title, summary, recommended_action).

---

### B.6 Reply Suggestions (OmniVyra vs Fallback)

| Path | LLM? | Operation | Notes |
|------|------|-----------|-------|
| **OmniVyra enabled** | External | `evaluateCommunityAiEngagement` | OmniVyra API returns suggested_actions (reply text) |
| **OmniVyra disabled** | No | Static fallback | Hardcoded template replies |

**API:** `GET /api/engagement/suggestions?message_id=...` → `engagementAiAssistantService.generateReplySuggestions`.

---

### B.7 Engagement Token Summary (Per Typical Session)

| Action | LLM Calls | Input (Est.) | Output (Est.) | Total |
|--------|------------|--------------|---------------|-------|
| Suggest reply (1 message) | 1 | 800–2,000 | 100–400 | ~900–2,400 |
| Thread triage (1 thread) | 1 | 400–1,000 | 80–200 | ~480–1,200 |
| Memory summary (1 thread rebuild) | 1 | 500–1,500 | 150–400 | ~650–1,900 |
| Content ideas from insight (1 insight) | 1 | 400–800 | 150–400 | ~550–1,200 |
| **10 replies + 5 triages + 2 memory rebuilds** | **17** | **~12K–25K** | **~2K–6K** | **~14K–31K** |

---

### B.8 Services That Do NOT Use LLM

| Service | Notes |
|---------|-------|
| `engagementDigestService` | Rule-based aggregation (new threads, leads, opportunities) |
| `engagementInsightService` | Rule-based (buyer keywords, topic clustering) |
| `engagementAiAssistantService` (OmniVyra off) | Static fallback replies |

---

## Appendix B: Engagement Pipeline — Per-Activity Token Breakdown

Detailed token consumption for social engagement: AI-assisted responses, insights, content ideas, triage, and conversation memory. OmniVyra (external API) is noted separately.

### B.1 Engagement LLM Paths Overview

| Activity | Service / API | LLM Path | Input (Est.) | Output (Est.) | Trigger |
|----------|---------------|----------|--------------|---------------|---------|
| **AI-assisted per response** | `responseGenerationService` | aiGateway `responseGeneration` | 800–2,000 | 100–400 | Per suggested reply / auto-reply |
| **Conversation memory** | `conversationMemoryService` | aiGateway `conversationMemorySummary` | 500–1,500 | 150–400 | Per thread when 5+ new messages |
| **Thread triage** | `conversationTriageService` | aiGateway `conversationTriage` | 400–1,000 | 80–200 | Per thread classification |
| **Insight → content ideas** | `insightContentService` | aiGateway `generateContentIdeas` | 400–800 | 150–400 | Per strategic insight (e.g. from dashboard) |
| **Reply suggestions (OmniVyra)** | `engagementAiAssistantService` | External OmniVyra API | N/A* | N/A* | Per "Suggest" in inbox (when OmniVyra enabled) |

\* OmniVyra is an external API; tokens consumed on OmniVyra side, not logged in `usage_events`.

---

### B.2 AI-Assisted Per Response Flow

**Path:** Inbox → Select thread → Click "Suggest" or "Auto reply" → `orchestrateResponse` → `generateResponse`

| Step | Service | LLM? | Input (Est.) | Output (Est.) | Notes |
|------|---------|------|--------------|---------------|-------|
| Resolve response policy | `responsePolicyEngine` | No | — | — | Template + rules |
| Get thread memory | `conversationMemoryService.getThreadMemory` | No | — | — | Cached summary (from prior LLM) |
| **Generate reply text** | `responseGenerationService.generateResponse` | **Yes** | 800–2,000 | 100–400 | Template + context + strategies + opportunities |
| Format for platform | `formatForPlatform` | No | — | — | Rule-based |

**Per-response token range:** ~900–2,400 total tokens (in + out).

---

### B.3 Conversation Memory (Summary)

**Trigger:** Worker processes `engagement_memory_rebuild` queue when thread has 5+ new messages since last summary.

| Step | Service | LLM? | Input (Est.) | Output (Est.) | Frequency |
|------|---------|------|--------------|---------------|-----------|
| **Generate summary** | `conversationMemoryService.generateSummary` | **Yes** | 500–1,500 | 150–400 | Per thread, when message distance ≥ 5 |

**Note:** `getThreadMemory` is read-only; no LLM. Summary is consumed by `responseGenerationService` as context for reply generation.

---

### B.4 Conversation Triage (Classification)

**Trigger:** Thread classification for inbox grouping, prioritization, or when triage_priority is computed.

| Step | Service | LLM? | Input (Est.) | Output (Est.) | Frequency |
|------|---------|------|--------------|---------------|-----------|
| **Classify thread** | `conversationTriageService.classifyThread` | **Yes** | 400–1,000 | 80–200 | Per thread (on demand or batch) |

**Output:** `classification_category`, `sentiment`, `triage_priority` — used for inbox sorting and response policy selection.

---

### B.5 Creating Insights → Content Ideas

**Path:** Strategic insight (e.g. from dashboard / engagement signals) → "Generate content ideas" → `insightContentService.generateContentIdeas`

| Step | Service / API | LLM? | Input (Est.) | Output (Est.) | Frequency |
|------|---------------|------|--------------|---------------|-----------|
| **Content ideas from insight** | `insightContentService.generateContentIdeas` | **Yes** | 400–800 | 150–400 | Per insight (4–6 ideas) |

**Note:** `engagementInsightService` (buyer intent, clusters, opportunity signals) uses **rule-based** logic — no LLM.

---

### B.6 Engagement Digest

**Service:** `engagementDigestService.generateDailyDigest`

| Step | LLM? | Notes |
|------|------|-------|
| Aggregate counts, sort threads | **No** | Rule-based; no LLM |

**Tokens: 0** — Engagement digest does not use LLM.

---

### B.7 Reply Suggestions (OmniVyra vs OpenAI)

| Path | When | LLM Source | Notes |
|------|------|------------|-------|
| **OmniVyra enabled** | `engagementAiAssistantService.generateReplySuggestions` | External OmniVyra | `evaluateCommunityAiEngagement` — not in `usage_events` |
| **OmniVyra disabled** | Same | **No LLM** | Returns static fallback templates |
| **Response generation** | `responseOrchestrator` → `generateResponse` | aiGateway | Uses template + policy; logged |

---

### B.8 Engagement Token Summary (Typical Day)

| Activity | Calls/Day (Est.) | Input Total | Output Total |
|----------|------------------|-------------|--------------|
| AI-assisted responses | 10–50 | 8–100K | 1–20K |
| Conversation memory | 5–20 | 2.5–30K | 0.75–8K |
| Thread triage | 5–30 | 2–30K | 0.4–6K |
| Insight content ideas | 0–5 | 0–4K | 0–2K |
| **Total (OpenAI)** | | **~13–164K** | **~2–36K** |

---

## Appendix B: Engagement Pipeline — Per-Stage Token Breakdown

Detailed token consumption for social engagement: inbox triage, AI-assisted reply generation, conversation memory, insight creation, and related flows.

### B.1 Engagement LLM Entry Points (Overview)

| Operation | Service / API | Input Tokens | Output Tokens | Trigger |
|-----------|---------------|--------------|---------------|---------|
| **Response generation** | `responseGenerationService.generateResponse` | 800–2,000 | 100–400 | Per "Generate reply" / auto-reply |
| **Conversation memory** | `conversationMemoryService.generateSummary` | 500–1,500 | 150–400 | Per thread when messages ≥5 since last |
| **Conversation triage** | `conversationTriageService.classifyThread` | 400–1,000 | 80–200 | Per thread classification |
| **Insight content ideas** | `insightContentService.generateContentIdeas` | 400–800 | 150–400 | Per insight "Generate content ideas" |
| **Reply suggestions (OmniVyra)** | `engagementAiAssistantService` → external OmniVyra | External API | External API | Per "Suggest replies" (not OpenAI) |

---

### B.2 AI-Assisted Per Response (Response Generation Flow)

When a user clicks "Generate reply" or auto-reply runs:

| Step | Operation | Input Tokens | Output Tokens | Notes |
|------|-----------|--------------|---------------|-------|
| 1 | `getThreadMemory(thread_id)` | 0 | 0 | DB read; summary may have been built earlier via B.3 |
| 2 | `responseGenerationService.generateResponse` | 800–2,000 | 100–400 | Template + brand + strategies + opportunities + context |
| **Total per reply** | | **800–2,000** | **100–400** | 1 LLM call |

**Prompt includes:** brand voice, platform rules, template structure, conversation context (from memory), adaptive strategy guidance, high-performing reply styles, active opportunities, original message.

---

### B.3 Conversation Memory (Background Summary)

Triggered when new messages are added and message distance ≥ 5 since last processed.

| Step | Operation | Input Tokens | Output Tokens | Notes |
|------|-----------|--------------|---------------|-------|
| 1 | `conversationMemoryService.generateSummary` | 500–1,500 | 150–400 | Up to 10 messages × 300 chars |
| **Total per rebuild** | | **500–1,500** | **150–400** | 1 call per thread summary |

**Frequency:** Fire-and-forget; only when `latest_message_id` ≠ `last_processed_message_id` and distance ≥ 5.

---

### B.4 Conversation Triage (Thread Classification)

When a thread is classified for inbox grouping/prioritization:

| Step | Operation | Input Tokens | Output Tokens | Notes |
|------|-----------|--------------|---------------|-------|
| 1 | `conversationTriageService.classifyThread` | 400–1,000 | 80–200 | Messages + memory + lead signals + opportunities |
| **Total per triage** | | **400–1,000** | **80–200** | 1 call per thread |

**Output:** `classification_category`, `classification_confidence`, `sentiment`, `triage_priority`.

---

### B.5 Creating Insights (Content Ideas from Insight)

When user selects an insight and clicks "Generate content ideas":

| Step | Operation | Input Tokens | Output Tokens | Notes |
|------|-----------|--------------|---------------|-------|
| 1 | `insightContentService.generateContentIdeas` | 400–800 | 150–400 | Title, summary, recommended_action |
| **Total per insight** | | **400–800** | **150–400** | 4–6 ideas (post, article, video, thread) |

**API:** `pages/api/insight/content-ideas.ts` → `generateContentIdeas`.

---

### B.6 Reply Suggestions (OmniVyra vs Fallback)

| Path | LLM? | Notes |
|------|------|-------|
| **OmniVyra enabled** | External API | `evaluateCommunityAiEngagement` → OmniVyra service; tokens not in our OpenAI meter |
| **OmniVyra disabled** | No | Returns static fallback suggestions (no LLM) |

**Service:** `engagementAiAssistantService.generateReplySuggestions` → `evaluateCommunityAiEngagement` (OmniVyra).

---

### B.7 Engagement Digest (Daily)

| Step | LLM? | Notes |
|------|------|-------|
| `engagementDigestService.generateDailyDigest` | **No** | Rule-based aggregation; DB queries only |

---

### B.8 Engagement Insight Service (Buyer Intent, Clusters)

| Step | LLM? | Notes |
|------|------|-------|
| `engagementInsightService.detectBuyerIntent` | **No** | Keyword-based |
| `engagementInsightService.detectConversationClusters` | **No** | Topic clustering (rule-based) |
| `engagementInsightService.detectOpportunitySignals` | **No** | Rule-based |

---

### B.9 Engagement Token Summary (Typical Day)

| Activity | Calls/Day (Est.) | Input Range | Output Range |
|----------|------------------|-------------|--------------|
| Response generation (replies) | 10–50 | 8–100K | 1–20K |
| Conversation memory | 5–20 | 2.5–30K | 0.75–8K |
| Conversation triage | 5–30 | 2–30K | 0.4–6K |
| Insight content ideas | 0–5 | 0–4K | 0–2K |
| **Total (OpenAI only)** | | **~12–164K** | **~2–36K** |

*OmniVyra reply suggestions are external and not included in OpenAI token totals.*

---

## Appendix B: Engagement Pipeline — Per-Stage Token Breakdown

Detailed token consumption for engagement: inbox, AI-assisted reply suggestions, response generation, insights, conversation triage, memory summaries, and related flows.

### B.1 Engagement LLM Flow Overview

| Activity | LLM? | Service / API | When Triggered |
|----------|------|---------------|----------------|
| **AI-assisted reply (suggestions)** | Yes* | `responseGenerationService` / OmniVyra | Per message when user clicks "Suggest reply" |
| **Auto reply execution** | Yes | `responseGenerationService` | When policy matches and auto_reply enabled |
| **Conversation triage** | Yes | `conversationTriageService` | Per thread classification (inbox priority) |
| **Conversation memory** | Yes | `conversationMemoryService` | Per thread when messages added (rebuild threshold) |
| **Creating insights (content ideas)** | Yes | `insightContentService` | When user requests content ideas from insight |
| **Engagement digest** | No | `engagementDigestService` | Rule-based aggregation; no LLM |
| **Engagement insights (buyer intent, clusters)** | No | `engagementInsightService` | Rule-based keyword matching; no LLM |

\* OmniVyra path uses external API; tokens not in our ledger. Response engine path uses aiGateway.

---

### B.2 AI-Assisted Per-Response (Response Generation)

**Flow:** `responseOrchestrator.orchestrateResponse` → `responseGenerationService.generateResponse`

| Step | Operation | Input Tokens (Est.) | Output Tokens (Est.) | Per Response |
|------|-----------|---------------------|----------------------|--------------|
| Policy resolution | `resolveResponsePolicy` | No LLM | — | Rule/template lookup |
| Generate reply | `runCompletionWithOperation` (`responseGeneration` op) | 800–2,000 | 100–400 | 1 call |

**Context included:** Template structure, brand voice, platform rules, thread memory (if any), strategies, reply intelligence, opportunities.

**Trigger:** `POST /api/response/generate` or `attemptAutoReply` when user requests suggested reply or auto-reply executes.

---

### B.3 Reply Suggestions (Alternative Path: OmniVyra)

**Flow:** `engagementAiAssistantService.generateReplySuggestions` → `evaluateCommunityAiEngagement` (OmniVyra API)

| Step | LLM? | Notes |
|------|------|-------|
| Reply suggestions (OmniVyra) | External | `omnivyraClientV1.evaluateCommunityAiEngagement()` — tokens consumed by OmniVyra, not OpenAI |
| Fallback (OmniVyra disabled) | No | Static template replies |

**Trigger:** `GET /api/engagement/suggestions` or AI Suggestion Panel.

---

### B.4 Conversation Memory Summary

**Flow:** `conversationMemoryService.updateThreadMemory` → `generateSummary`

| Step | Operation | Input Tokens (Est.) | Output Tokens (Est.) | Per Thread Rebuild |
|------|-----------|---------------------|----------------------|--------------------|
| Summarize messages | `runCompletionWithOperation` (`conversationMemorySummary` op) | 500–1,500 | 150–400 | 1 call |

**When:** Rebuild only when `latest_message_id != last_processed` and message distance ≥ 5. Fire-and-forget on new messages.

---

### B.5 Conversation Triage

**Flow:** `conversationTriageService.classifyThread`

| Step | Operation | Input Tokens (Est.) | Output Tokens (Est.) | Per Thread |
|------|-----------|---------------------|----------------------|------------|
| Classify thread | `runCompletionWithOperation` (`conversationTriage` op) | 400–1,000 | 80–200 | 1 call |

**Output:** `classification_category`, `classification_confidence`, `sentiment`, `triage_priority`.

**When:** When thread needs classification for inbox grouping/prioritization.

---

### B.6 Creating Insights (Content Ideas from Insight)

**Flow:** `insightContentService.generateContentIdeas`

| Step | Operation | Input Tokens (Est.) | Output Tokens (Est.) | Per Request |
|------|-----------|---------------------|----------------------|-------------|
| Generate content ideas | `runCompletionWithOperation` (`generateContentIdeas` op) | 400–800 | 150–400 | 1 call |

**Input:** Insight title, summary, recommended_action, supporting_signals.

**Output:** 4–6 content ideas (title, format, summary) — post, article, video, thread.

**Trigger:** `POST /api/insight/content-ideas` or Content Insights panel "Generate ideas" action.

---

### B.7 Chat Moderation (Pre-Send)

**Flow:** `moderateChatMessage` (aiGateway) — used by `GlobalChatPolicy` before chat messages.

| Step | Operation | Input Tokens (Est.) | Output Tokens (Est.) | Per Message |
|------|-----------|---------------------|----------------------|-------------|
| Moderation | `runCompletionWithOperation` (`chatModeration` op) | 200–400 | 30–80 | 1 call |

**When:** Before user sends a chat message in campaign planner or other chat contexts.

---

### B.8 Engagement Conversation Intelligence (OmniVyra)

**Flow:** `engagementConversationIntelligenceService` / `communityAiOmnivyraService` → `evaluateCommunityAiEngagement`

- **LLM:** External OmniVyra API — tokens not in our usage ledger
- **Fallback:** When OmniVyra disabled, uses templates / rules

---

### B.9 Per-Inbox-Day Token Estimate (Engagement)

| Activity | Est. Calls/Day (per org) | Input Total | Output Total |
|----------|---------------------------|-------------|--------------|
| Response generation (suggested replies) | 5–20 | 4–40K | 0.5–8K |
| Conversation triage (new threads) | 3–15 | 1.2–15K | 0.24–3K |
| Conversation memory (rebuilds) | 2–10 | 1–15K | 0.3–4K |
| Insight content ideas | 0–5 | 0–4K | 0–2K |
| **Total (typical inbox day)** | | **~6–74K** | **~1–17K** |

---

### B.10 Engagement Paths Without LLM

| Component | Notes |
|------------|-------|
| `engagementDigestService` | Rule-based aggregation (counts, sorts) |
| `engagementInsightService` | Keyword-based buyer intent, topic clustering |
| `responsePolicyEngine` | Template + rule resolution |
| `responseOrchestrator` (policy only) | Resolves policy; LLM only when calling `generateResponse` |

---

## Appendix B: Engagement Pipeline — Per-Stage Token Breakdown

Detailed token consumption for social engagement, inbox, insights creation, AI-assisted responses, conversation triage, memory, and related flows.

### B.1 Engagement Flow Overview

| Step | LLM? | Service / API | Input (Est.) | Output (Est.) | Trigger |
|------|------|---------------|--------------|---------------|---------|
| **AI-assisted per response** | Yes | `responseGenerationService.generateResponse` | 800–2,000 | 100–400 | Per suggested reply (manual or auto-reply) |
| **Reply suggestions (OmniVyra)** | External | `evaluateCommunityAiEngagement` | N/A (external API) | N/A | When OmniVyra enabled; not our OpenAI |
| **Reply suggestions (fallback)** | No | Static templates | 0 | 0 | When OmniVyra disabled |
| **Conversation triage** | Yes | `conversationTriageService.classifyThread` | 400–1,000 | 80–200 | Per thread classification |
| **Conversation memory** | Yes | `conversationMemoryService.generateSummary` | 500–1,500 | 150–400 | Per thread summary rebuild |
| **Creating insights (content ideas)** | Yes | `insightContentService.generateContentIdeas` | 400–800 | 150–400 | Per insight → content ideas |
| **Engagement digest** | No | `engagementDigestService` | 0 | 0 | Rule-based aggregation |
| **Engagement insight (buyer/cluster)** | No | `engagementInsightService` | 0 | 0 | Rule-based keyword matching |

---

### B.2 AI-Assisted Per Response (Response Generation)

**Flow:** User opens thread → clicks "Suggest Reply" or auto-reply triggers → `responseOrchestrator.orchestrateResponse` → `responseGenerationService.generateResponse`

| Component | Source | Input Tokens | Output Tokens | Notes |
|-----------|--------|--------------|---------------|-------|
| Conversation context | `getThreadMemory` | 0 (cached) | 0 | May trigger memory rebuild (see B.5) |
| Template structure | `response_templates` | — | — | Structured blocks in prompt |
| Strategy guidance | `responseStrategyIntelligenceService` | — | — | High-performing strategies |
| Reply intelligence | `replyIntelligenceService` | — | — | Past reply styles |
| Opportunities | `engagementOpportunityService` | — | — | Active opportunities |
| **LLM call** | `runCompletionWithOperation` op: `responseGeneration` | 800–2,000 | 100–400 | Single reply generation |

**Per reply:** 1 LLM call ≈ 900–2,400 total tokens.

---

### B.3 Reply Suggestions (Engagement AI Assistant)

| Path | LLM? | Operation | Notes |
|------|------|-----------|-------|
| **OmniVyra enabled** | External | `evaluateCommunityAiEngagement` (OmniVyra API) | Tokens consumed by OmniVyra; not our OpenAI |
| **OmniVyra disabled** | No | Static fallback (4 preset replies) | No LLM |

**API:** `GET /api/engagement/suggestions` → `engagementAiAssistantService.generateReplySuggestions`

---

### B.4 Conversation Triage (Thread Classification)

**Flow:** New thread or periodic re-classification → `conversationTriageService.classifyThread`

| Input | Source | Est. Size |
|-------|--------|-----------|
| Messages (last 10) | `engagement_messages` | 300–800 chars each |
| Conversation summary | `engagement_thread_memory` | 100–300 chars |
| Lead signals | `engagement_lead_signals` | 50–200 chars |
| Opportunities | `engagement_opportunities` | 50–200 chars |

| Operation | Input Tokens | Output Tokens | When |
|-----------|--------------|---------------|------|
| `classifyThread` | 400–1,000 | 80–200 | Per thread triage (inbox grouping/priority) |

---

### B.5 Conversation Memory Summary

**Flow:** New messages → worker or inline → `conversationMemoryService.updateThreadMemory` → `generateSummary`

| Condition | Rebuild? | LLM Call |
|-----------|----------|----------|
| `latest_message_id == last_processed` | No | — |
| Message distance &lt; 5 | No | — |
| Stale &lt; 24h, distance &lt; 5 | No | — |
| Otherwise | Yes | 1 call |

| Operation | Input Tokens | Output Tokens | Per |
|-----------|--------------|---------------|-----|
| `generateSummary` (conversationMemorySummary) | 500–1,500 | 150–400 | Thread summary rebuild |

---

### B.6 Creating Insights (Content Ideas from Insights)

**Flow:** User has strategic insight → "Generate content ideas" → `insightContentService.generateContentIdeas`

| Operation | Input Tokens | Output Tokens | Output |
|-----------|--------------|---------------|--------|
| `generateContentIdeas` | 400–800 | 150–400 | 4–6 content ideas (post, article, video, thread) |

**API:** `POST /api/insight/content-ideas`

---

### B.7 Services That Do NOT Use LLM

| Service | Purpose | Method |
|---------|---------|--------|
| `engagementDigestService` | Daily digest (new threads, leads, opportunities) | Rule-based aggregation |
| `engagementInsightService` | Buyer intent, conversation clusters, opportunity signals | Keyword matching, topic grouping |
| `engagementAiAssistantService` (OmniVyra off) | Reply suggestions | Static templates |

---

### B.8 Engagement Token Summary (Per Day, Example)

| Activity | Calls/Day (Est.) | Input | Output | Total |
|----------|-------------------|-------|--------|-------|
| AI-assisted replies | 5–20 | 4–40K | 0.5–8K | 4.5–48K |
| Conversation triage | 10–50 | 4–50K | 0.8–10K | 4.8–60K |
| Conversation memory | 5–30 | 2.5–45K | 0.75–12K | 3.25–57K |
| Insight content ideas | 1–5 | 0.4–4K | 0.15–2K | 0.55–6K |
| **Total (engagement domain)** | | | | **~13–171K/day** |

---

---

## Appendix B: Engagement Pipeline — Token Breakdown

Detailed token consumption for engagement (inbox, AI-assisted response, insights, triage, memory, etc.).

### B.1 Engagement Flow Overview

| Step | LLM? | Service / API | Input (Est.) | Output (Est.) | Trigger |
|------|------|---------------|--------------|---------------|---------|
| **Per response (AI-assisted)** | Yes | `responseGenerationService` → aiGateway `responseGeneration` | 800–2,000 | 100–400 | Each "Suggest reply" / auto-reply |
| **Reply suggestions (OmniVyra)** | External* | `engagementAiAssistantService` → `evaluateCommunityAiEngagement` | — | — | When OmniVyra enabled |
| **Conversation memory** | Yes | `conversationMemoryService` → aiGateway `conversationMemorySummary` | 500–1,500 | 150–400 | Per thread when messages change (every 5+ msgs) |
| **Conversation triage** | Yes | `conversationTriageService` → aiGateway `conversationTriage` | 400–1,000 | 80–200 | Per thread classification |
| **Creating insights (content ideas)** | Yes | `insightContentService` → aiGateway `generateContentIdeas` | 400–800 | 150–400 | Per insight "Generate content ideas" |
| **Daily digest** | No | `engagementDigestService` | — | — | Rule-based aggregation |
| **Engagement insight (buyer/clusters)** | No | `engagementInsightService` | — | — | Rule-based keyword/cluster |

\* OmniVyra is an external API; tokens consumed there, not in our OpenAI gateway.

---

### B.2 AI-Assisted Per Response (responseGenerationService)

**Flow:** `responseOrchestrator` → `generateResponse` (when policy matched) → aiGateway `responseGeneration`

| Input Component | Est. Tokens |
|-----------------|-------------|
| System: brand voice, tone, platform rules, strategy guidance, reply intelligence, opportunities | 400–1,200 |
| User: conversation context (from memory), original message, template structure | 400–1,000 |
| **Total input** | **800–2,200** |
| **Output** | **100–400** |

**Per response:** 1 LLM call.

**Called from:**
- `POST /api/response/generate` — Suggest reply / execute reply
- `autoReplyService.attemptAutoReply` — Auto-reply when policy allows

---

### B.3 Conversation Memory (conversationMemoryService)

**Purpose:** Summarize last 10 messages for context in response generation.

| Input | Output | Trigger |
|-------|--------|---------|
| 500–1,500 (messages truncated 300 chars each) | 150–400 | When `updateThreadMemory` runs (every 5+ new messages) |

**Per thread rebuild:** 1 LLM call. Used by `getThreadMemory` (no LLM) when generating response.

---

### B.4 Conversation Triage (conversationTriageService)

**Purpose:** Classify thread (question_request, recommendation_request, competitor_complaint, etc.) for inbox grouping.

| Input | Output | Trigger |
|-------|--------|---------|
| 400–1,000 (messages + memory + lead signals + opportunities) | 80–200 (JSON: category, confidence, sentiment, triage_priority) | Per thread when triage needed |

**Per thread:** 1 LLM call.

---

### B.5 Creating Insights — Content Ideas (insightContentService)

**API:** `pages/api/insight/content-ideas.ts` → `generateContentIdeas`

**Purpose:** From strategic insight (title, summary, recommended_action) → 4–6 content ideas (post, article, video, thread).

| Input | Output | Trigger |
|-------|--------|---------|
| 400–800 | 150–400 (JSON array) | Per "Generate content ideas" click |

**Per insight:** 1 LLM call.

---

### B.6 OmniVyra (External — Not Our Tokens)

| Service | Operation | Notes |
|---------|-----------|-------|
| `engagementAiAssistantService` | `evaluateCommunityAiEngagement` | Reply suggestions when OmniVyra enabled |
| `communityAiOmnivyraService` | `evaluateEngagement` | Community AI analysis |
| `engagementConversationIntelligenceService` | Same | Conversation intelligence |

**Token cost:** Consumed by OmniVyra service; not tracked in our `usage_events`.

---

### B.7 Engagement Components — No LLM

| Component | Notes |
|------------|-------|
| **engagementDigestService** | Rule-based daily digest (counts, recommended threads) |
| **engagementInsightService** | Rule-based buyer intent, conversation clusters, opportunity signals |
| **replyIntelligenceService** | Stores/retrieves reply patterns; no generation |
| **responsePolicyEngine** | Template matching; no LLM |
| **responseSafetyGuard** | Intent/sentiment checks; no LLM |

---

### B.8 Engagement Token Summary (Per Typical Day)

| Activity | LLM Calls | Est. Input | Est. Output | Total |
|----------|-----------|------------|-------------|-------|
| 20 AI-assisted responses | 20 | 16–44K | 2–8K | 18–52K |
| 10 thread memory rebuilds | 10 | 5–15K | 1.5–4K | 6.5–19K |
| 15 thread triages | 15 | 6–15K | 1.2–3K | 7.2–18K |
| 3 insight content ideas | 3 | 1.2–2.4K | 0.45–1.2K | 1.65–3.6K |
| **Total (typical day)** | **48** | **~29–77K** | **~5–16K** | **~34–93K** |

---

## Appendix B: Engagement Pipeline — Per-Stage Token Breakdown

Detailed token consumption for social engagement: inbox, AI-assisted responses, conversation triage, memory summaries, and insight content creation.

### B.1 Engagement Flow Overview

| Flow | Trigger | LLM Calls | Notes |
|------|---------|-----------|-------|
| **AI-assisted reply** | User clicks "Suggest reply" or auto-reply eligibility | 1 (responseGeneration) | Per message |
| **Reply suggestions (OmniVyra)** | GET `/api/engagement/suggestions` | External API* | Not direct OpenAI |
| **Conversation triage** | Thread classification / inbox grouping | 1 (conversationTriage) | Per thread |
| **Conversation memory** | New messages (≥5 since last) | 1 (conversationMemorySummary) | Per thread, batched |
| **Insight → content ideas** | User clicks "Generate content ideas" on insight | 1 (generateContentIdeas) | Per insight |
| **Daily digest** | Cron / worker | **No LLM** | Rule-based aggregation |

\* OmniVyra (`evaluateCommunityAiEngagement`) is an external API; tokens consumed there, not in our aiGateway.

---

### B.2 AI-Assisted Per-Response (Response Generation)

| Step | Service / API | Operation | Input Tokens (Est.) | Output Tokens (Est.) | Per Response |
|------|---------------|-----------|---------------------|----------------------|--------------|
| Policy match | `responseOrchestrator` | No LLM | — | — | Template lookup |
| **Generate reply** | `responseGenerationService.generateResponse` | aiGateway `responseGeneration` | 800–2,000 | 100–400 | 1 call |
| Thread memory (used) | `getThreadMemory` | No LLM | — | — | Read from DB |
| Execute / suggest | — | No LLM | — | — | — |

**Input includes:** template structure, brand voice, platform rules, strategies, reply intelligence, opportunities, conversation context, original message.

| Scenario | Input Est. | Output Est. | Total per Reply |
|----------|------------|-------------|-----------------|
| Short thread, simple template | 800–1,200 | 100–250 | ~900–1,450 |
| Long thread, rich context | 1,500–2,000 | 250–400 | ~1,750–2,400 |

**APIs:** `POST /api/response/generate`, `responseOrchestrator.orchestrateResponse` → `generateResponse`.

---

### B.3 Reply Suggestions (OmniVyra vs Fallback)

| Path | LLM? | Service | Input | Output | When |
|------|------|---------|-------|--------|------|
| **OmniVyra enabled** | External API | `engagementAiAssistantService` → `evaluateCommunityAiEngagement` | — | — | External OmniVyra tokens |
| **OmniVyra disabled** | No | Static fallbacks | 0 | 0 | 4 canned reply variants |

**Note:** `engagementAiAssistantService.generateReplySuggestions` does NOT use our aiGateway when OmniVyra is on; it calls OmniVyra API. When off, returns static text.

---

### B.4 Conversation Triage (Thread Classification)

| Step | Service | Operation | Input Tokens (Est.) | Output Tokens (Est.) | When |
|------|---------|-----------|---------------------|----------------------|------|
| Load context | `conversationTriageService.loadThreadContext` | No LLM | — | — | Messages, memory, leads, opportunities |
| **Classify thread** | `classifyThread` | aiGateway `conversationTriage` | 400–1,000 | 80–200 | Per thread on triage |

**Categories:** question_request, recommendation_request, competitor_complaint, problem_discussion, product_comparison, general_comment.

| Thread Length | Input Est. | Output Est. |
|---------------|------------|-------------|
| 3–5 messages | 400–600 | 80–120 |
| 8–10 messages | 700–1,000 | 120–200 |

---

### B.5 Conversation Memory Summary

| Step | Service | Operation | Input Tokens (Est.) | Output Tokens (Est.) | When |
|------|---------|-----------|---------------------|----------------------|------|
| Check rebuild | `shouldSkipRebuild`, `isMessageDistanceReached` | No LLM | — | — | Message distance ≥ 5 |
| **Generate summary** | `generateSummary` | aiGateway `conversationMemorySummary` | 500–1,500 | 150–400 | Per thread when stale |

**Up to 10 messages** (CONTENT_TRUNCATE=300 chars each) → single LLM call.

| Messages | Input Est. | Output Est. |
|----------|------------|-------------|
| 5–7 | 500–800 | 150–250 |
| 8–10 | 900–1,500 | 250–400 |

---

### B.6 Creating Insights → Content Ideas

| Step | Service / API | Operation | Input Tokens (Est.) | Output Tokens (Est.) | When |
|------|---------------|-----------|---------------------|----------------------|------|
| User selects insight | `pages/api/insight/content-ideas.ts` | — | — | — | On "Generate content ideas" |
| **Generate ideas** | `insightContentService.generateContentIdeas` | aiGateway `generateContentIdeas` | 400–800 | 150–400 | 1 per insight |

**Input:** title, summary, recommended_action, insight_type.  
**Output:** 4–6 content ideas (post, article, video, thread) with title, format, summary.

---

### B.7 Engagement Services That Do NOT Use LLM

| Service | Purpose | Notes |
|---------|---------|-------|
| `engagementDigestService` | Daily digest (new threads, high priority, leads, opportunities) | Rule-based aggregation |
| `engagementInsightService` | Buyer intent, conversation clusters, opportunity signals | Keyword / rule-based |
| `responsePolicyEngine` | Match template by intent, sentiment | Rule-based |
| `responseSafetyGuard` | Check requires_human_review | Rule-based |
| `engagementAiAssistantService` (OmniVyra off) | Reply suggestions | Static fallbacks |

---

### B.8 Engagement Token Summary (Per Thread / Per Day)

| Action | LLM Calls | Input Range | Output Range | Total per Action |
|--------|-----------|-------------|--------------|------------------|
| AI-assisted reply | 1 | 800–2,000 | 100–400 | ~900–2,400 |
| Conversation triage | 1 | 400–1,000 | 80–200 | ~480–1,200 |
| Conversation memory (rebuild) | 1 | 500–1,500 | 150–400 | ~650–1,900 |
| Insight → content ideas | 1 | 400–800 | 150–400 | ~550–1,200 |
| Chat moderation (if used) | 1 | 200–400 | 30–80 | ~230–480 |

**Example: 10 threads/day, 5 with AI reply, 3 triaged, 2 memory rebuilds, 1 insight:**

| Action | Calls | Est. Input | Est. Output |
|--------|-------|------------|-------------|
| AI reply | 5 | 4–10K | 0.5–2K |
| Triage | 3 | 1.2–3K | 0.24–0.6K |
| Memory | 2 | 1–3K | 0.3–0.8K |
| Content ideas | 1 | 0.4–0.8K | 0.15–0.4K |
| **Daily total** | **11** | **~6.6–17.8K** | **~1.2–3.8K** |

---

## Appendix B: Engagement Pipeline — Per-Activity Token Breakdown

Detailed token consumption for social engagement, inbox, insights creation, AI-assisted responses, conversation triage, memory, and related activities.

### B.1 Engagement LLM vs Non-LLM

| Activity | LLM? | Notes |
|----------|------|-------|
| **Engagement daily digest** | No | `engagementDigestService` — rule-based aggregation (counts, priorities) |
| **Engagement insight detection** | No | `engagementInsightService` — keyword-based (buyer intent, clusters, opportunities) |
| **Reply suggestions (OmniVyra)** | External | `evaluateCommunityAiEngagement` — OmniVyra API (tokens counted externally) |
| **Response generation (policy)** | Yes | `responseGenerationService` → aiGateway |
| **Conversation memory** | Yes | `conversationMemoryService` → aiGateway |
| **Conversation triage** | Yes | `conversationTriageService` → aiGateway |
| **Insight content ideas** | Yes | `insightContentService` → aiGateway |

---

### B.2 AI-Assisted Per Response (Policy-Based Reply)

**Flow:** `POST /api/response/generate` or auto-reply → `responseOrchestrator.orchestrateResponse` → `responseGenerationService.generateResponse`

| Step | Service | LLM Call | Input Tokens (Est.) | Output Tokens (Est.) | Trigger |
|------|---------|----------|---------------------|----------------------|---------|
| Resolve policy | `responsePolicyEngine` | No | — | — | Template selection |
| Get thread memory | `conversationMemoryService.getThreadMemory` | No | — | — | DB read |
| Generate reply | `responseGenerationService.generateResponse` | Yes | 800–2,000 | 100–400 | Per "suggest reply" / auto-reply |
| Format for platform | `formatForPlatform` | No | — | — | Deterministic |

**Context in prompt:** conversation summary, template structure, platform rules, strategy guidance, reply intelligence, active opportunities, brand voice.

| Item | Input (Est.) | Output (Est.) |
|------|--------------|---------------|
| Per response generation | 800–2,000 | 100–400 |

---

### B.3 Reply Suggestions (OmniVyra Path)

**Flow:** `GET /api/engagement/suggestions` or AIEngagementAssistant → `engagementAiAssistantService.generateReplySuggestions`

| Step | LLM? | Notes |
|------|------|-------|
| OmniVyra enabled | External API | `evaluateCommunityAiEngagement` → OmniVyra; tokens not in platform ledger |
| OmniVyra disabled | No | Returns static fallback replies |

**No direct OpenAI** — OmniVyra consumes tokens on its side. When disabled, fallback is static (no LLM).

---

### B.4 Creating Insights → Content Ideas

**Flow:** Strategic insight → `insightContentService.generateContentIdeas` → content ideas (title, format, summary)

| Step | Service | LLM Call | Input Tokens (Est.) | Output Tokens (Est.) | Trigger |
|------|---------|----------|---------------------|----------------------|---------|
| Generate content ideas | `insightContentService` | Yes | 400–800 | 150–400 | Per insight "Generate content ideas" |
| **Per insight** | | 1 call | 400–800 | 150–400 | On-demand |

**API:** `POST /api/insight/content-ideas` — receives `{ title, summary, insight_type, recommended_action, supporting_signals }`.

---

### B.5 Conversation Memory Summary

**Flow:** Engagement worker / message insert → `conversationMemoryService.updateThreadMemory` → `generateSummary`

| Step | Service | LLM Call | Input Tokens (Est.) | Output Tokens (Est.) | Trigger |
|------|---------|----------|---------------------|----------------------|---------|
| Summarize thread | `conversationMemoryService` | Yes | 500–1,500 | 150–400 | When message distance ≥ 5, latest ≠ last_processed |
| **Per thread update** | | 1 call | 500–1,500 | 150–400 | Batched by worker |

**Frequency:** Fire-and-forget when new messages inserted; deterministic skip when memory already current.

---

### B.6 Conversation Triage (Classification)

**Flow:** `conversationTriageService.classifyThread` — classifies thread for inbox grouping/priority

| Step | Service | LLM Call | Input Tokens (Est.) | Output Tokens (Est.) | Trigger |
|------|---------|----------|---------------------|----------------------|---------|
| Classify thread | `conversationTriageService` | Yes | 400–1,000 | 80–200 | Per thread triage (on demand or batch) |
| **Per thread** | | 1 call | 400–1,000 | 80–200 | When triage runs |

**Output:** `classification_category`, `classification_confidence`, `sentiment`, `triage_priority`.

---

### B.7 Engagement Token Summary (Per Typical Day)

| Activity | Calls/Day (Est.) | Input Range | Output Range | Total (Est.) |
|----------|------------------|-------------|--------------|--------------|
| AI-assisted response (suggest / auto) | 10–50 | 800–2K each | 100–400 each | 9K–120K |
| Conversation memory (new threads) | 5–30 | 500–1.5K each | 150–400 each | 3.25K–57K |
| Conversation triage | 5–30 | 400–1K each | 80–200 each | 2.4K–36K |
| Insight content ideas | 0–5 | 400–800 each | 150–400 each | 0–6K |
| Chat moderation (if engagement chat) | 5–20 | 200–400 each | 30–80 each | 1.15K–9.6K |
| **Typical day (moderate use)** | | | | **~15–230K** |

---

### B.8 Engagement Flow: Inbox → Reply

| Step | LLM? | Operation | Input (Est.) | Output (Est.) |
|------|------|-----------|--------------|---------------|
| 1. Thread loads | Maybe | Triage (if needed) | 400–1K | 80–200 |
| 2. Memory check | No | `getThreadMemory` | — | — |
| 3. User clicks "Suggest reply" | Yes | `generateResponse` | 800–2K | 100–400 |
| 4. User sends (chat) | Yes | `moderateChatMessage` | 200–400 | 30–80 |
| 5. Auto-reply (if eligible) | Yes | Same as 3 | 800–2K | 100–400 |

---

*Ranges are indicative; measure actual usage via `usage_events` / `logUsageEvent` for production planning.*

---

## Appendix B: Engagement Pipeline — Per-Stage Token Breakdown

Detailed token consumption for social engagement: AI-assisted responses, insights, conversation triage, memory summaries, reply suggestions, and related flows.

### B.1 Engagement LLM Flow Overview

| Activity | Service / API | LLM? | Input (Est.) | Output (Est.) | Trigger |
|----------|---------------|------|--------------|---------------|---------|
| **AI-assisted response** | `responseGenerationService.generateResponse` | Yes | 800–2,000 | 100–400 | Per suggested reply (Suggestion panel, auto-reply) |
| **Reply suggestions** (OmniVyra) | `engagementAiAssistantService` → `evaluateCommunityAiEngagement` | External API | — | — | Per "Get suggestions" click (OmniVyra, not direct OpenAI) |
| **Conversation memory summary** | `conversationMemoryService.updateThreadMemory` | Yes | 500–1,500 | 150–400 | Per thread when 5+ new messages since last summary |
| **Conversation triage** | `conversationTriageService.classifyThread` | Yes | 400–1,000 | 80–200 | Per thread classification (inbox grouping) |
| **Creating insights (content ideas)** | `insightContentService.generateContentIdeas` | Yes | 400–800 | 150–400 | Per strategic insight → "Generate content ideas" |
| **Engagement digest** | `engagementDigestService.generateDailyDigest` | **No** | — | — | Rule-based aggregation |
| **Engagement insight detection** | `engagementInsightService.detectBuyerIntent`, etc. | **No** | — | — | Rule-based (keywords, clustering) |

### B.2 AI-Assisted Per-Response Flow

| Step | Operation | Input (Est.) | Output (Est.) | When |
|------|-----------|--------------|---------------|------|
| 1 | Resolve response policy | — | — | `responsePolicyEngine` (rule-based, no LLM) |
| 2 | Get thread memory (if any) | — | — | `getThreadMemory` (DB read; memory built by B.3) |
| 3 | **Generate reply text** | 800–2,000 | 100–400 | `responseGenerationService.generateResponse` |

**Context included in prompt:** Template structure, platform rules, brand voice, conversation context, classification category, sentiment, strategy guidance, reply intelligence, opportunities.

**API entry:** `POST /api/response/generate` (or via `orchestrateResponse` → `generateResponse`).

### B.3 Conversation Memory Summary

| Step | Operation | Input (Est.) | Output (Est.) | When |
|------|-----------|--------------|---------------|------|
| Fetch last 10 messages | — | — | — | Per thread |
| **Generate summary** | 500–1,500 | 150–400 | `runCompletionWithOperation` (`conversationMemorySummary`) |

**Trigger:** `updateThreadMemory` — only when `latest_message_id != last_processed` and message distance ≥ 5. Stale threshold: 24h.

### B.4 Conversation Triage (Thread Classification)

| Step | Operation | Input (Est.) | Output (Est.) | When |
|------|-----------|--------------|---------------|------|
| Load thread context (messages, memory, leads, opportunities) | — | — | — | Per thread |
| **Classify thread** | 400–1,000 | 80–200 | `runCompletionWithOperation` (`conversationTriage`) |

**Output:** `classification_category`, `classification_confidence`, `sentiment`, `triage_priority`.

### B.5 Creating Insights (Content Ideas from Strategic Insight)

| Step | Operation | Input (Est.) | Output (Est.) | When |
|------|-----------|--------------|---------------|------|
| **Generate 4–6 content ideas** | 400–800 | 150–400 | `insightContentService.generateContentIdeas` |

**API:** `GET /api/insight/content-ideas?title=...&summary=...` or equivalent.

**Output:** `ContentIdea[]` with `title`, `format` (post/article/video/thread), `summary`.

### B.6 Reply Suggestions (OmniVyra vs Direct OpenAI)

| Path | LLM Source | Input (Est.) | Output (Est.) | When |
|------|------------|--------------|---------------|------|
| **OmniVyra enabled** | External OmniVyra API | — | — | `evaluateCommunityAiEngagement` (tokens outside our meter) |
| **OmniVyra disabled** | None | 0 | 0 | Returns static fallback suggestions (no LLM) |

**Note:** `engagementAiAssistantService.generateReplySuggestions` uses OmniVyra when enabled; does **not** use aiGateway. Token consumption is on OmniVyra side.

**Response generation (template-based):** Uses `responseGenerationService` (OpenAI via aiGateway) — different path from reply suggestions.

### B.7 Engagement Token Summary (Per Response Session)

| Activity | Calls | Input Range | Output Range |
|----------|-------|-------------|--------------|
| **1 AI-assisted response** | 1 | 800–2,000 | 100–400 |
| **Conversation memory (first summary)** | 1 | 500–1,500 | 150–400 |
| **Triage (per thread)** | 1 | 400–1,000 | 80–200 |
| **Content ideas from insight** | 1 | 400–800 | 150–400 |

**Example: User opens thread, clicks "Suggest reply":**
- 1 response generation call: ~800–2,000 in / 100–400 out
- (If memory stale: +1 summary call)
- (If triage not yet done: +1 triage call)

### B.8 Services That Do NOT Use LLM

| Service | Notes |
|---------|-------|
| `engagementDigestService` | Rule-based aggregation (counts, sorts) |
| `engagementInsightService` | Rule-based (keywords, topic clustering) |
| `responsePolicyEngine` | Rule matching for templates |
| `responseOrchestrator` | Orchestrates; LLM only in `generateResponse` |
| `refineLanguageOutput` | Rule-based (no LLM) |

---

## Appendix B: Engagement Pipeline — Per-Stage Token Breakdown

Detailed token consumption for engagement inbox flows: creating insights, AI-assisted per-response, conversation memory, triage, digest, and OmniVyra (external).

### B.1 Engagement Flow Overview

| Flow | Trigger | LLM Path | Notes |
|------|---------|----------|-------|
| **AI-assisted reply** | User clicks "Suggest reply" or auto-reply runs | `responseOrchestrator` → `generateResponse` | 1 call per reply |
| **Reply suggestions (OmniVyra)** | AISuggestionPanel / engagement UI | `evaluateCommunityAiEngagement` (external API) | Consumes OmniVyra tokens, not OpenAI |
| **Conversation memory** | New messages in thread (worker) | `conversationMemoryService.updateThreadMemory` | 1 call per rebuild (when ≥5 new messages) |
| **Conversation triage** | Thread classification for inbox | `conversationTriageService.classifyThread` | 1 call per thread |
| **Insight content ideas** | User requests ideas from insight | `insightContentService.generateContentIdeas` | 1 call per insight |

### B.2 AI-Assisted Per-Response (Policy Engine Path)

| Step | Service | Operation | Input Tokens (Est.) | Output Tokens (Est.) | When |
|------|---------|-----------|---------------------|----------------------|------|
| Policy resolution | `responsePolicyEngine` | No LLM | 0 | 0 | Rule-based |
| Thread memory lookup | `conversationMemoryService.getThreadMemory` | No LLM | 0 | 0 | Reads DB |
| **Response generation** | `responseGenerationService.generateResponse` | aiGateway `responseGeneration` | 800–2,000 | 100–400 | Per reply |
| Platform formatting | `platformResponseFormatter` | No LLM | 0 | 0 | Rule-based |

**API entry:** `POST /api/response/generate` or `orchestrateResponse` (auto-reply)

| Context Included | Typical Input | Typical Output |
|------------------|---------------|----------------|
| Original message (≤2000 chars) | 300–600 | 100–300 |
| Conversation summary (if thread) | +200–400 | — |
| Strategy guidance (top 3) | +150–300 | — |
| Reply intelligence (top 10) | +200–500 | — |
| Opportunities (top 5) | +100–200 | — |
| Brand voice + template | +100–200 | — |
| **Total per response** | **800–2,000** | **100–400** |

### B.3 Reply Suggestions (Engagement AI Assistant)

| Path | LLM? | Notes |
|------|------|-------|
| **OmniVyra enabled** | External (OmniVyra API) | `evaluateCommunityAiEngagement` — tokens on OmniVyra side |
| **OmniVyra disabled** | No | Returns static fallback replies |

**Service:** `engagementAiAssistantService.generateReplySuggestions`  
**API:** `GET /api/engagement/suggestions` (or inline in AISuggestionPanel)

### B.4 Conversation Memory (Thread Summary)

| Step | Service | Operation | Input Tokens (Est.) | Output Tokens (Est.) | When |
|------|---------|-----------|---------------------|----------------------|------|
| **Generate summary** | `conversationMemoryService.generateSummary` | aiGateway `conversationMemorySummary` | 500–1,500 | 150–400 | Per thread rebuild |

**Trigger:** `conversationMemoryWorker` when `message_distance >= 5` and `latest != last_processed`.  
**Input:** Up to 10 messages × 300 chars each ≈ 500–1,500 tokens.  
**Output:** 3–5 sentence summary.

### B.5 Conversation Triage (Thread Classification)

| Step | Service | Operation | Input Tokens (Est.) | Output Tokens (Est.) | When |
|------|---------|-----------|---------------------|----------------------|------|
| **Classify thread** | `conversationTriageService.classifyThread` | aiGateway `conversationTriage` | 400–1,000 | 80–200 | Per thread (inbox load, digest) |

**Input:** Messages (up to 10 × 300 chars), memory summary, lead signals, opportunities.  
**Output:** `classification_category`, `sentiment`, `triage_priority`, `classification_confidence`.

### B.6 Creating Insights / Content Ideas

| Step | Service | Operation | Input Tokens (Est.) | Output Tokens (Est.) | When |
|------|---------|-----------|---------------------|----------------------|------|
| **Generate content ideas** | `insightContentService.generateContentIdeas` | aiGateway `generateContentIdeas` | 400–800 | 150–400 | Per insight card "Generate ideas" |

**API:** `POST /api/insight/content-ideas`  
**Input:** Insight title, summary, recommended_action, insight_type.  
**Output:** 4–6 content ideas (title, format, summary).

### B.7 Engagement Digest

| Step | LLM? | Notes |
|------|------|-------|
| **generateDailyDigest** | No | Rule-based aggregation (counts, sort, recommend) |

**Service:** `engagementDigestService` — no LLM. Runs via `engagementDigestWorker` (cron).

### B.8 Engagement Insight Service (Buyer Intent, Clusters)

| Step | LLM? | Notes |
|------|------|-------|
| **detectBuyerIntent** | No | Keyword-based |
| **detectConversationClusters** | No | Keyword/topic grouping |
| **detectOpportunitySignals** | No | Rule-based |

**Service:** `engagementInsightService` — no LLM. All detection is rule-based.

### B.9 Engagement Conversation Intelligence (OmniVyra)

| Step | LLM? | Notes |
|------|------|-------|
| **evaluateCommunityAiEngagement** | External (OmniVyra) | Deep analysis, suggested_actions — tokens on OmniVyra |

Used by `engagementConversationIntelligenceService` and `communityAiOmnivyraService`.

### B.10 Token Summary: Per-Response Flow

| Activity | LLM Calls | Input Range | Output Range | Total (Est.) |
|----------|-----------|-------------|--------------|--------------|
| Suggest reply (policy path) | 1 | 800–2,000 | 100–400 | 900–2,400 |
| Conversation memory rebuild | 1 | 500–1,500 | 150–400 | 650–1,900 |
| Thread triage | 1 | 400–1,000 | 80–200 | 480–1,200 |
| Insight content ideas | 1 | 400–800 | 150–400 | 550–1,200 |

### B.11 Daily Engagement Token Estimate (Active Inbox)

| Activity | Per Day (Est.) | Calls | Input Total | Output Total |
|----------|----------------|-------|-------------|--------------|
| AI-assisted replies | 5–20 | 5–20 | 4–40K | 0.5–8K |
| Memory summaries | 3–10 | 3–10 | 1.5–15K | 0.5–4K |
| Thread triage | 10–50 | 10–50 | 4–50K | 0.8–10K |
| Insight content ideas | 0–5 | 0–5 | 0–4K | 0–2K |
| **Total per org/day** | | | **~10–109K** | **~2–24K** |

---

## Appendix B: Engagement Pipeline — Per-Activity Token Breakdown

Detailed token consumption for engagement inbox: AI-assisted per-response, insights creation, conversation triage, memory summaries, etc.

### B.1 Engagement Flow Overview

| Activity | LLM? | Service / API | Input (Est.) | Output (Est.) | When |
|----------|------|---------------|--------------|---------------|------|
| **AI-assisted reply (per response)** | Yes | `responseGenerationService.generateResponse` | 800–2,000 | 100–400 | Per "suggest reply" or auto-reply |
| **Reply suggestions (AI panel)** | External* | `engagementAiAssistantService` → OmniVyra | — | — | Per message when OmniVyra enabled |
| **Conversation triage** | Yes | `conversationTriageService.classifyThread` | 400–1,000 | 80–200 | Per thread classification |
| **Conversation memory summary** | Yes | `conversationMemoryService.generateSummary` | 500–1,500 | 150–400 | Per thread when messages accumulate |
| **Insight → content ideas** | Yes | `insightContentService.generateContentIdeas` | 400–800 | 150–400 | Per insight "generate content ideas" |
| **Engagement digest** | No | `engagementDigestService` | — | — | Rule-based aggregation |
| **Engagement insight (buyer/clusters)** | No | `engagementInsightService` | — | — | Rule-based keyword matching |

\* **OmniVyra** (`evaluateCommunityAiEngagement`) is an external API; tokens consumed on OmniVyra side, not our OpenAI.

### B.2 AI-Assisted Per Response (Response Generation)

**Flow:** `responseOrchestrator.orchestrateResponse` → `generateResponse` → `runCompletionWithOperation` (operation: `responseGeneration`)

| Step | Input Tokens | Output Tokens | Trigger |
|------|--------------|---------------|---------|
| Policy resolution | 0 | 0 | DB lookup |
| Thread memory (if used) | 0 | 0 | From `conversationMemoryService` (cached) |
| **LLM reply generation** | 800–2,000 | 100–400 | Template + original message + brand voice + strategies + reply intelligence + opportunities |

**Prompt includes:** brand context, platform rules, conversation summary (from memory), classification category, top reply strategies, high-performing reply styles, active opportunities.

**Per-response total:** ~900–2,400 tokens (in + out).

### B.3 Reply Suggestions (AI Suggestion Panel)

| Path | LLM? | Notes |
|------|------|-------|
| **OmniVyra disabled** | No | Returns static fallback replies |
| **OmniVyra enabled** | External | `evaluateCommunityAiEngagement` → OmniVyra API; tokens on OmniVyra |

**API:** `GET /api/engagement/suggestions` or via `AISuggestionPanel` / `AIEngagementAssistant`.

### B.4 Conversation Triage (Thread Classification)

**Service:** `conversationTriageService.classifyThread`

| Input | Output | When |
|-------|--------|------|
| 400–1,000 | 80–200 | Per thread when triage runs |
| Messages (up to 10, ~300 chars each) + memory + lead signals + opportunities | JSON: category, confidence, sentiment, triage_priority | On new thread, refresh, or worker |

**Categories:** question_request, recommendation_request, competitor_complaint, problem_discussion, product_comparison, general_comment.

### B.5 Conversation Memory Summary

**Service:** `conversationMemoryService.updateThreadMemory` → `generateSummary`

| Input | Output | When |
|-------|--------|------|
| 500–1,500 | 150–400 | When message distance ≥ 5 since last summary |
| Up to 10 messages × 300 chars | 3–5 sentence summary | Fire-and-forget; used by `generateResponse` for context |

**Trigger:** Worker (`conversationMemoryWorker`) or on thread update. Skipped if `last_processed_message_id` matches.

### B.6 Creating Insights → Content Ideas

**Service:** `insightContentService.generateContentIdeas`  
**API:** `pages/api/insight/content-ideas.ts`

| Input | Output | When |
|-------|--------|------|
| 400–800 | 150–400 | Per insight when user requests "generate content ideas" |
| Title, summary, recommended_action, insight_type | JSON: 4–6 content ideas (title, format, summary) | On insight card "Generate content" |

### B.7 Engagement Activities Without LLM

| Activity | Notes |
|----------|-------|
| **Daily digest** | `engagementDigestService` — DB aggregation only |
| **Buyer intent / clusters** | `engagementInsightService` — keyword-based |
| **Response policy / template** | `responsePolicyEngine` — rule-based template matching |

### B.8 Per-Inbox-Day Token Estimate (Active Org)

| Activity | Calls/Day (Est.) | Input | Output | Total |
|----------|------------------|-------|--------|-------|
| Conversation triage | 5–50 | 2–50K | 0.4–10K | 2.4–60K |
| Conversation memory | 2–20 | 1–30K | 0.3–8K | 1.3–38K |
| AI-assisted replies | 2–30 | 1.6–60K | 0.2–12K | 1.8–72K |
| Insight content ideas | 0–5 | 0–4K | 0–2K | 0–6K |
| **Total per active org/day** | | | | **~5–175K tokens** |

---

## Appendix B: Engagement Pipeline — Per-Stage Token Breakdown

Detailed token consumption for engagement: AI-assisted responses, insights, conversation triage, memory summary, daily digest, and related flows.

### B.1 Engagement LLM Flow Overview

| Activity | LLM? | Service / API | Input (Est.) | Output (Est.) | Trigger |
|----------|------|---------------|--------------|---------------|---------|
| **AI-assisted reply (per response)** | Yes | `responseGenerationService.generateResponse` | 800–2,000 | 100–400 | Per suggested reply |
| **Reply suggestions (OmniVyra)** | External | `evaluateCommunityAiEngagement` (OmniVyra API) | N/A* | N/A* | Per "Suggest reply" |
| **Creating insights (content ideas)** | Yes | `insightContentService.generateContentIdeas` | 400–800 | 150–400 | Per strategic insight |
| **Conversation triage** | Yes | `conversationTriageService.classifyThread` | 400–1,000 | 80–200 | Per thread classification |
| **Conversation memory summary** | Yes | `conversationMemoryService.generateSummary` | 500–1,500 | 150–400 | Per thread (every 5+ new msgs) |
| **Daily digest** | **No** | `engagementDigestService` | — | — | Rule-based aggregation |
| **Engagement insights (buyer/clusters)** | **No** | `engagementInsightService` | — | — | Rule-based, keyword matching |

\* OmniVyra is an external API; tokens consumed by OmniVyra service, not platform OpenAI.

---

### B.2 AI-Assisted Per Response

**Flow:** `pages/api/response/generate` or `autoReplyService` → `responseOrchestrator.orchestrateResponse` → `responseGenerationService.generateResponse` → `runCompletionWithOperation` (aiGateway `responseGeneration`)

| Step | Service | Input Tokens | Output Tokens | Notes |
|------|---------|--------------|---------------|-------|
| Resolve policy | `resolveResponsePolicy` | 0 | 0 | DB lookup |
| Get thread memory | `conversationMemoryService.getThreadMemory` | 0 | 0 | DB lookup (no LLM) |
| Generate reply | `responseGenerationService.generateResponse` | 800–2,000 | 100–400 | Template + context + strategies + opportunities |

**Context included in prompt:**
- Conversation summary (from `getThreadMemory`)
- Classification category + sentiment
- Strategy guidance (top 3 for context)
- Reply intelligence (top 10 styles)
- Active opportunities (top 5)
- Brand voice, platform rules, template structure

**Per response:** ~1,000–2,500 total tokens (in + out)

---

### B.3 Creating Insights (Content Ideas)

**Flow:** `pages/api/insight/content-ideas` → `insightContentService.generateContentIdeas` → aiGateway `generateContentIdeas`

| Step | Input | Output | When |
|------|-------|--------|------|
| Content ideas from insight | 400–800 | 150–400 | Per strategic insight when user requests "Generate content ideas" |

**Input:** Insight title, summary, recommended_action, insight_type, supporting_signals  
**Output:** 4–6 content ideas (title, format, summary) — post, article, video, thread

---

### B.4 Conversation Triage

**Flow:** `conversationTriageService.classifyThread` → aiGateway `conversationTriage`

| Step | Input | Output | When |
|------|-------|--------|------|
| Thread classification | 400–1,000 | 80–200 | Per thread for inbox grouping / prioritization |

**Context:** Messages (last 10, 300 chars each), conversation summary, lead signals, opportunities  
**Output:** classification_category, classification_confidence, sentiment, triage_priority (1–10)

---

### B.5 Conversation Memory Summary

**Flow:** `conversationMemoryService.updateThreadMemory` → `generateSummary` → aiGateway `conversationMemorySummary`

| Step | Input | Output | When |
|------|-------|--------|------|
| Summarize thread | 500–1,500 | 150–400 | When 5+ new messages since last summary |

**Trigger:** Worker / queue when `message_distance >= 5` or stale (>24h). Skips if `latest == last_processed`.

---

### B.6 Per-Response Path (Full Flow)

| Path | LLM Calls | Est. Input | Est. Output | Total |
|------|-----------|------------|-------------|-------|
| First reply in thread (no memory) | 1 (response only) | 800–2,000 | 100–400 | 900–2,400 |
| Reply in thread (memory present) | 1 (response) | 800–2,000 | 100–400 | 900–2,400 |
| New thread + triage + first reply | 2 (triage + response) | 1,200–3,000 | 180–600 | 1,380–3,600 |
| Thread with 5+ new msgs (memory rebuild) | 2 (memory + response) | 1,300–3,500 | 250–800 | 1,550–4,300 |

---

### B.7 What Does NOT Use LLM (Engagement)

| Service / Activity | Notes |
|--------------------|-------|
| `engagementDigestService.generateDailyDigest` | Rule-based; aggregates counts, sorts by triage |
| `engagementInsightService.detectBuyerIntent` | Keyword-based (price, demo, trial, etc.) |
| `engagementInsightService.detectConversationClusters` | Topic buckets by keyword |
| `engagementInsightService.detectOpportunitySignals` | Rule-based relevance |
| `responsePolicyEngine` / `resolveResponsePolicy` | DB lookup, no LLM |
| `engagementAiAssistantService` (when OmniVyra disabled) | Returns static fallback replies |

---

### B.8 Engagement Token Summary (Daily, High Activity)

| Activity | Per Day (Est.) | Calls | Input Range | Output Range |
|----------|----------------|-------|-------------|--------------|
| AI-assisted replies | 20 | 20 | 16–40K | 2–8K |
| Conversation triage | 10 new threads | 10 | 4–10K | 0.8–2K |
| Conversation memory | 5 threads | 5 | 2.5–7.5K | 0.75–2K |
| Insight content ideas | 3 | 3 | 1.2–2.4K | 0.45–1.2K |
| **Daily total (high activity)** | | **38** | **~24–60K** | **~4–13K** |

---

## Appendix B: Engagement Pipeline — Per-Activity Token Breakdown

Detailed token consumption for social engagement: AI-assisted per response, creating insights, conversation triage, memory summary, reply suggestions, and related flows.

### B.1 Engagement LLM Overview

| Operation | Service / API | aiGateway Operation | Input Tokens (Est.) | Output Tokens (Est.) | Trigger |
|-----------|---------------|---------------------|---------------------|----------------------|---------|
| **AI-assisted response** | `responseGenerationService` | `responseGeneration` | 800–2,000 | 100–400 | Per suggested reply / auto-reply |
| **Conversation memory** | `conversationMemoryService` | `conversationMemorySummary` | 500–1,500 | 150–400 | Per thread summary rebuild |
| **Conversation triage** | `conversationTriageService` | `conversationTriage` | 400–1,000 | 80–200 | Per thread classification |
| **Insight content ideas** | `insightContentService` | `generateContentIdeas` | 400–800 | 150–400 | Per strategic insight → content ideas |
| **Chat moderation** | aiGateway | `chatModeration` | 200–400 | 30–80 | Per chat message (if used in engagement context) |

### B.2 AI-Assisted Per Response Flow

When a user requests "suggest reply" or auto-reply runs:

```
POST /api/response/generate  or  orchestrateResponse (auto-reply)
  └─ responseOrchestrator.orchestrateResponse()
       └─ resolveResponsePolicy() [no LLM]
       └─ generateResponse()  ← 1 LLM call (responseGenerationService)
```

**Per response:**
- **Input:** Template structure + conversation context (from `getThreadMemory`) + original message + brand voice + strategy guidance + reply intelligence + opportunities. Typically 800–2,000 tokens.
- **Output:** Single reply text. 100–400 tokens.

**Conversation context:** If `getThreadMemory` returns a summary, that summary was built by `conversationMemoryService.updateThreadMemory` — a separate LLM call (see B.4). No extra LLM per response for context lookup.

### B.3 Creating Insights (Content Ideas from Insight)

When user generates content ideas from a strategic insight (e.g. Engagement dashboard insight panel):

```
pages/api/insight/content-ideas.ts
  └─ insightContentService.generateContentIdeas(insight)
       └─ runCompletionWithOperation, operation: 'generateContentIdeas'
```

**Per insight:**
- **Input:** Insight title, summary, recommended action, insight type. 400–800 tokens.
- **Output:** JSON array of 4–6 content ideas (title, format, summary). 150–400 tokens.

**Note:** `engagementInsightService` (buyer intent, clusters, opportunity signals) is **rule-based** — no LLM.

### B.4 Conversation Memory Summary

Triggered when a thread gets new messages and rebuild threshold is met (e.g. 5+ new messages since last summary):

```
conversationMemoryWorker / updateThreadMemory
  └─ conversationMemoryService.generateSummary(messages)
       └─ runCompletionWithOperation, operation: 'conversationMemorySummary'
```

**Per rebuild:**
- **Input:** Up to 10 messages, ~300 chars each. 500–1,500 tokens.
- **Output:** 3–5 sentence summary. 150–400 tokens.

**Frequency:** Per thread, only when `message_distance >= 5` and `latest != last_processed`; not on every message.

### B.5 Conversation Triage (Thread Classification)

Used for inbox grouping and prioritization:

```
conversationTriageService.classifyThread(threadId, organizationId)
  └─ runCompletionWithOperation, operation: 'conversationTriage'
```

**Per thread classification:**
- **Input:** Recent messages, conversation summary, lead signals, opportunities. 400–1,000 tokens.
- **Output:** JSON `{ classification_category, classification_confidence, sentiment, triage_priority }`. 80–200 tokens.

**Categories:** question_request, recommendation_request, competitor_complaint, problem_discussion, product_comparison, general_comment.

### B.6 OmniVyra (Reply Suggestions — External)

`engagementAiAssistantService.generateReplySuggestions` uses **OmniVyra external API** (`evaluateCommunityAiEngagement`) when enabled. Tokens are consumed by OmniVyra, not our OpenAI gateway — not in our usage_events. If OmniVyra is disabled, fallback is static templates (no LLM).

### B.7 Engagement Digest

`engagementDigestService.generateDailyDigest` — **no LLM**. Rule-based aggregation (thread counts, lead signals, opportunities, triage priority).

### B.8 Engagement Token Summary (Per Inbox Session)

| Activity | LLM Calls | Input Range | Output Range | Notes |
|----------|-----------|-------------|--------------|-------|
| AI-assisted reply (1 message) | 1 | 800–2,000 | 100–400 | Via responseOrchestrator |
| Conversation memory (1 rebuild) | 1 | 500–1,500 | 150–400 | Per thread when threshold hit |
| Conversation triage (1 thread) | 1 | 400–1,000 | 80–200 | Per thread classification |
| Insight → content ideas (1 insight) | 1 | 400–800 | 150–400 | Via insight/content-ideas API |
| **10 threads, 5 replies suggested, 3 triaged, 2 memory rebuilds** | **~12** | **~5K–12K** | **~1.5K–4K** | Typical session |

---

*Ranges are indicative; measure actual usage via `usage_events` / `logUsageEvent` for production planning.*

---

## Appendix B: Engagement Pipeline — Per-Activity Token Breakdown

Detailed token consumption for social engagement / inbox: creating insights, AI-assisted replies per message, triage, conversation memory, reply suggestions, and related flows.

### B.1 Engagement Flow Overview

| Activity | LLM? | Service / API | Input (Est.) | Output (Est.) | Trigger |
|----------|------|---------------|--------------|---------------|---------|
| **AI-assisted response** | Yes | `responseGenerationService.generateResponse` | 800–2,000 | 100–400 | Per "Suggest reply" or auto-reply |
| **Conversation memory** | Yes | `conversationMemoryService.updateThreadMemory` | 500–1,500 | 150–400 | Per thread (when 5+ new messages) |
| **Conversation triage** | Yes | `conversationTriageService.classifyThread` | 400–1,000 | 80–200 | Per thread classification |
| **Creating insights (content ideas)** | Yes | `insightContentService.generateContentIdeas` | 400–800 | 150–400 | On "Generate content ideas" from insight |
| **Reply suggestions** | External* | `engagementAiAssistantService` → OmniVyra | N/A (external) | N/A | Per message when OmniVyra enabled |
| **Daily digest** | No | `engagementDigestService` | — | — | Rule-based aggregation |
| **Engagement insight (buyer/clusters)** | No | `engagementInsightService` | — | — | Rule-based keyword/cluster detection |

\* Reply suggestions use OmniVyra external API (`evaluateCommunityAiEngagement`); tokens consumed by OmniVyra, not platform OpenAI.

---

### B.2 AI-Assisted Per Response

Triggered when user clicks "Suggest reply" or when auto-reply runs (via `responseOrchestrator` → `generateResponse`).

| Step | Operation | Input Tokens | Output Tokens | Notes |
|------|-----------|--------------|---------------|-------|
| Resolve policy | `resolveResponsePolicy` | 0 | 0 | No LLM |
| Get thread memory | `getThreadMemory` | 0 | 0 | Read from DB (may have been LLM-generated earlier) |
| Generate reply | `responseGenerationService.generateResponse` | 800–2,000 | 100–400 | 1 LLM call per reply |

**Prompt includes:** template structure, platform rules, brand voice, conversation context (from memory), strategy guidance, reply intelligence, active opportunities.

| Context Size | Input Range | Output Range |
|--------------|-------------|--------------|
| Short thread, minimal context | 800–1,200 | 100–250 |
| Long thread, strategies + opportunities | 1,500–2,000 | 250–400 |

---

### B.3 Creating Insights (Content Ideas)

Triggered from insight cards (e.g. Content Insights panel) when user requests content ideas from a strategic insight.

| Step | Operation | Input Tokens | Output Tokens | Notes |
|------|-----------|--------------|---------------|-------|
| Generate content ideas | `insightContentService.generateContentIdeas` | 400–800 | 150–400 | 4–6 ideas in JSON |

**Input:** insight title, summary, recommended_action, insight_type.  
**Output:** `content_ideas[]` with title, format (post/article/video/thread), summary.

| Insight Length | Input | Output |
|----------------|-------|--------|
| Short | 400–550 | 150–250 |
| Long (with signals) | 600–800 | 250–400 |

---

### B.4 Conversation Memory Summary

Triggered by worker when thread has 5+ new messages since last summary; provides context for response generation.

| Step | Operation | Input Tokens | Output Tokens | Notes |
|------|-----------|--------------|---------------|-------|
| Generate summary | `conversationMemoryService.generateSummary` | 500–1,500 | 150–400 | 1 call per rebuild |

**Input:** Up to 10 messages (300 chars each) = ~3K chars.  
**Output:** 3–5 sentence summary.

| Message Count | Input Est. | Output Est. |
|---------------|------------|-------------|
| 5 messages | 500–800 | 150–250 |
| 10 messages | 1,000–1,500 | 250–400 |

---

### B.5 Conversation Triage

Triggered when thread needs classification for inbox grouping/prioritization.

| Step | Operation | Input Tokens | Output Tokens | Notes |
|------|-----------|--------------|---------------|-------|
| Classify thread | `conversationTriageService.classifyThread` | 400–1,000 | 80–200 | 1 call per thread |

**Input:** Messages, conversation summary, lead signals, opportunities.  
**Output:** JSON with classification_category, classification_confidence, sentiment, triage_priority.

| Thread Length | Input | Output |
|---------------|-------|--------|
| Short (few messages) | 400–600 | 80–120 |
| Long (10 messages + memory) | 700–1,000 | 120–200 |

---

### B.6 Reply Suggestions (OmniVyra Path)

When OmniVyra is enabled, `engagementAiAssistantService.generateReplySuggestions` calls `evaluateCommunityAiEngagement` (external OmniVyra API). No platform OpenAI tokens; cost is on OmniVyra side.

When OmniVyra is disabled: returns static template replies; **no LLM**.

---

### B.7 Engagement Activities Without LLM

| Activity | Service | Notes |
|----------|---------|-------|
| Daily digest | `engagementDigestService.generateDailyDigest` | Aggregates counts, sorts threads; no AI |
| Buyer intent detection | `engagementInsightService.detectBuyerIntent` | Keyword-based |
| Conversation clusters | `engagementInsightService.detectConversationClusters` | Topic keyword grouping |
| Opportunity signals | `engagementInsightService.detectOpportunitySignals` | Rule-based |
| Response policy resolution | `responsePolicyEngine` | Template matching |

---

### B.8 Engagement Token Summary (Per Day Example)

| Activity | Per Day (Est.) | Calls | Input Range | Output Range |
|----------|----------------|-------|-------------|--------------|
| AI-assisted responses | 10–50 replies | 10–50 | 8–100K | 1–20K |
| Conversation memory | 5–20 thread updates | 5–20 | 2.5–30K | 0.75–8K |
| Conversation triage | 10–50 threads | 10–50 | 4–50K | 0.8–10K |
| Insight content ideas | 1–5 requests | 1–5 | 0.4–4K | 0.15–2K |
| **Total (busy org)** | | **~26–125** | **~15–184K** | **~2.7–40K** |

---

## Appendix B: Engagement Pipeline — Per-Stage Token Breakdown

Detailed token consumption for social engagement: AI-assisted per-response, conversation triage, memory summary, creating insights, reply suggestions, and digest. OmniVyra (external API) is noted separately.

### B.1 Engagement Flow Overview

| Step | LLM Source | Operation | Input (Est.) | Output (Est.) | When |
|------|-------------|-----------|--------------|---------------|------|
| **1. Thread triage** | aiGateway | `conversationTriageService.classifyThread` | 400–1,000 | 80–200 | Per thread classification (inbox grouping) |
| **2. Conversation memory** | aiGateway | `conversationMemoryService.updateThreadMemory` | 500–1,500 | 150–400 | Per thread when message distance ≥ 5 |
| **3. AI-assisted response** | aiGateway | `responseGenerationService.generateResponse` | 800–2,000 | 100–400 | Per "Suggest reply" / auto-reply |
| **4. Reply suggestions** | OmniVyra (external) | `evaluateCommunityAiEngagement` | N/A | N/A | Per message when OmniVyra enabled |
| **5. Insight content ideas** | aiGateway | `insightContentService.generateContentIdeas` | 400–800 | 150–400 | Per insight "Generate content ideas" |
| **6. Chat moderation** | aiGateway | `moderateChatMessage` | 200–400 | 30–80 | Per chat message (campaign planner, etc.) |

**No LLM:** `engagementDigestService` (rule-based aggregation), `engagementInsightService` (rule-based buyer/cluster detection).

---

### B.2 AI-Assisted Per Response

| Sub-step | Service | Input Tokens | Output Tokens | Notes |
|----------|---------|--------------|---------------|-------|
| Resolve policy | `responsePolicyEngine` | 0 | 0 | Rule-based template selection |
| Fetch thread memory | `getThreadMemory` | 0 | 0 | DB read (summary from prior LLM) |
| Fetch strategies, intelligence, opportunities | Various | 0 | 0 | DB reads |
| **Generate reply** | `responseGenerationService.generateResponse` | 800–2,000 | 100–400 | 1 LLM call per response |

**Flow:** `responseOrchestrator.orchestrateResponse` → `generateResponse` → aiGateway `responseGeneration`

**Context built into prompt:** brand voice, platform rules, template structure, conversation summary, high-performing styles, active opportunities, strategy guidance.

**Per response:** 1 LLM call ≈ 800–2K in, 100–400 out.

---

### B.3 Creating Insights (Insight Content Ideas)

| Step | Service | Input Tokens | Output Tokens | When |
|------|---------|--------------|---------------|------|
| **Generate content ideas** | `insightContentService.generateContentIdeas` | 400–800 | 150–400 | User clicks "Generate content ideas" on an insight |

**Input:** Strategic insight (title, summary, recommended_action, insight_type).  
**Output:** 4–6 content ideas with title, format (post/article/video/thread), summary.

**Per insight:** 1 call ≈ 400–800 in, 150–400 out.

---

### B.4 Conversation Triage (Thread Classification)

| Step | Service | Input Tokens | Output Tokens | When |
|------|---------|--------------|---------------|------|
| **Classify thread** | `conversationTriageService.classifyThread` | 400–1,000 | 80–200 | Per thread when triage needed |

**Input:** Recent messages (up to 10), conversation summary, lead signals, opportunities.  
**Output:** classification_category, classification_confidence, sentiment, triage_priority.

**Per thread:** 1 call ≈ 400–1K in, 80–200 out.

---

### B.5 Conversation Memory Summary

| Step | Service | Input Tokens | Output Tokens | When |
|------|---------|--------------|---------------|------|
| **Summarize conversation** | `conversationMemoryService.generateSummary` | 500–1,500 | 150–400 | When message distance ≥ 5 from last processed |

**Input:** Last 10 messages (truncated to 300 chars each).  
**Output:** 3–5 sentence summary.

**Per rebuild:** 1 call ≈ 500–1.5K in, 150–400 out. Rebuild throttled by `shouldSkipRebuild`.

---

### B.6 Reply Suggestions (OmniVyra vs Fallback)

| Path | LLM? | Notes |
|------|------|-------|
| **OmniVyra enabled** | External (OmniVyra API) | `evaluateCommunityAiEngagement` → OmniVyra service; tokens not in our ledger |
| **OmniVyra disabled** | No | Returns hardcoded fallback suggestions |

**Flow:** `engagementAiAssistantService.generateReplySuggestions` → `evaluateCommunityAiEngagement` (when OmniVyra enabled).

---

### B.7 Engagement Digest

| Step | LLM? | Notes |
|------|------|-------|
| **Daily digest** | No | `engagementDigestService.generateDailyDigest` — rule-based counts and sort |

---

### B.8 Engagement Insight Service (Buyer Intent, Clusters)

| Step | LLM? | Notes |
|------|------|-------|
| **detectBuyerIntent** | No | Keyword-based |
| **detectConversationClusters** | No | Topic keyword grouping |
| **detectOpportunitySignals** | No | Rule-based |
| **storeInsightAsOpportunity** | No | DB write |

---

### B.9 Engagement Conversation Intelligence (OmniVyra)

| Step | LLM? | Notes |
|------|------|-------|
| **evaluateCommunityAiEngagement** | External | OmniVyra API; used for conversation-level analysis |

---

### B.10 Token Summary: Engagement Per Day (Example)

| Activity | Calls | Input Range | Output Range |
|----------|-------|-------------|--------------|
| Triage 20 threads | 20 | 8–20K | 1.6–4K |
| Memory rebuild 10 threads | 10 | 5–15K | 1.5–4K |
| 15 AI-assisted replies | 15 | 12–30K | 1.5–6K |
| 5 insight content-ideas | 5 | 2–4K | 0.75–2K |
| **Total (OpenAI)** | **50** | **~27–69K** | **~5.35–16K** |

*OmniVyra usage is tracked separately by the OmniVyra service.*

---

## Appendix B: Engagement Pipeline — Per-Stage Token Breakdown

Detailed token consumption for Social Engagement & Inbox: creating insights, AI-assisted responses per message, conversation triage, memory, digest, etc.

### B.1 Engagement Flow Overview

| Stage / Activity | LLM Used? | Service / API | Input Tokens (Est.) | Output Tokens (Est.) | Trigger |
|------------------|-----------|---------------|---------------------|----------------------|---------|
| **AI-assisted response (per reply)** | Yes | `responseGenerationService` via `responseOrchestrator` | 800–2,000 | 100–400 | Per "Generate reply" / auto-reply |
| **Conversation memory summary** | Yes | `conversationMemoryService` | 500–1,500 | 150–400 | Per thread when 5+ new messages |
| **Conversation triage** | Yes | `conversationTriageService` | 400–1,000 | 80–200 | Per thread classification |
| **Creating insights → content ideas** | Yes | `insightContentService` | 400–800 | 150–400 | On "Generate content ideas" from insight |
| **Reply suggestions (OmniVyra)** | External | `engagementAiAssistantService` → OmniVyra API | N/A | N/A | When OmniVyra enabled; tokens on OmniVyra side |
| **Engagement digest** | No | `engagementDigestService` | — | — | Rule-based aggregation |
| **Engagement insight detection** | No | `engagementInsightService` | — | — | Rule-based (buyer keywords, clusters) |

---

### B.2 AI-Assisted Per Response

**Path:** User clicks "Generate reply" or auto-reply triggers → `responseOrchestrator` → `generateResponse` → aiGateway `responseGeneration`

| Step | Service | Input Tokens | Output Tokens | Notes |
|------|---------|--------------|---------------|-------|
| Resolve policy | `responsePolicyEngine` | 0 | 0 | No LLM |
| Get thread memory | `conversationMemoryService.getThreadMemory` | 0 | 0 | DB read |
| Generate reply | `responseGenerationService.generateResponse` | 800–2,000 | 100–400 | Template + brand voice + strategies + reply intelligence + opportunities |

**Per-response prompt includes:** Template structure, platform rules, conversation context (from memory), classification category, sentiment, strategy guidance, high-performing reply styles, active opportunities, brand voice.

**API:** `POST /api/response/generate` or `POST /api/engagement/reply` → `orchestrateResponse` → `generateResponse`

---

### B.3 Creating Insights → Content Ideas

**Path:** Strategic insight → "Generate content ideas" → `insightContentService.generateContentIdeas`

| Step | Service | Input Tokens | Output Tokens | Trigger |
|------|---------|--------------|---------------|---------|
| Content ideas from insight | `insightContentService` | 400–800 | 150–400 | Per insight (4–6 ideas: post, article, video, thread) |

**API:** `POST /api/insight/content-ideas` with `{ title, summary, insight_type, recommended_action, supporting_signals }`

**Note:** `engagementInsightService` (detectBuyerIntent, detectConversationClusters, detectOpportunitySignals) is **rule-based** — no LLM.

---

### B.4 Conversation Memory Summary

**Path:** Worker / async when new messages arrive → `conversationMemoryService.updateThreadMemory` → `generateSummary`

| Step | Service | Input Tokens | Output Tokens | Trigger |
|------|---------|--------------|---------------|---------|
| Summarize last 10 messages | `conversationMemoryService.generateSummary` | 500–1,500 | 150–400 | When message distance ≥ 5 since last rebuild |

**Content:** Last 10 messages (truncated 300 chars each), system prompt for 3–5 sentence summary.

**Note:** Rebuild skipped when `last_processed_message_id` matches latest; rebuild only when distance threshold reached or stale (24h).

---

### B.5 Conversation Triage

**Path:** Thread classification for inbox grouping → `conversationTriageService.classifyThread`

| Step | Service | Input Tokens | Output Tokens | Trigger |
|------|---------|--------------|---------------|---------|
| Classify thread | `conversationTriageService` | 400–1,000 | 80–200 | Per thread when triage requested |

**Categories:** question_request, recommendation_request, competitor_complaint, problem_discussion, product_comparison, general_comment.  
**Output:** classification_category, classification_confidence, sentiment, triage_priority (1–10).

---

### B.6 Reply Suggestions (OmniVyra Path)

**Path:** `engagementAiAssistantService.generateReplySuggestions` → `evaluateCommunityAiEngagement` (OmniVyra external API)

| Step | LLM? | Notes |
|------|------|-------|
| Reply suggestions | **External (OmniVyra)** | Tokens consumed by OmniVyra service, not platform OpenAI |
| Fallback (OmniVyra off) | No | Returns static template replies |

**API:** `GET /api/engagement/suggestions?message_id=...`  
**Trigger:** User opens AI suggestion panel for a message.

---

### B.7 Engagement Digest

**Path:** `engagementDigestService.generateDailyDigest`

| Step | LLM? | Notes |
|------|------|-------|
| Daily digest | **No** | Rule-based: counts threads, leads, opportunities, sorts by triage_priority |

**Trigger:** Cron worker, `GET /api/engagement/digest`

---

### B.8 Chat Moderation (Pre-Send)

**Path:** `moderateChatMessage` (aiGateway) — used by `GlobalChatPolicy` before campaign/chat messages

| Step | Input Tokens | Output Tokens | Trigger |
|------|--------------|---------------|---------|
| Moderation | 200–400 | 30–80 | Per user message (campaign planner chat, etc.) |

---

### B.9 Engagement Token Summary (Per Day Est.)

| Activity | Calls/Day (Est.) | Input Range | Output Range | Total Tokens (Est.) |
|----------|------------------|-------------|--------------|---------------------|
| AI-assisted responses | 5–50 | 4K–100K | 0.5K–20K | 4.5K–120K |
| Conversation memory | 1–20 | 0.5K–30K | 0.15K–8K | 0.65K–38K |
| Conversation triage | 1–30 | 0.4K–30K | 0.08K–6K | 0.48K–36K |
| Insight content ideas | 0–10 | 0–8K | 0–4K | 0–12K |
| Chat moderation | 2–20 | 0.4K–8K | 0.06K–1.6K | 0.46K–9.6K |

**Heavy engagement day (50 replies + 20 triage + 10 memory + 5 insights):** ~50K–100K input, ~15K–35K output ≈ **65K–135K tokens**

---

## Appendix B: Engagement Pipeline — Per-Stage Token Breakdown

Detailed token consumption for engagement/inbox flows: AI-assisted per-response, conversation memory, triage, insights, reply suggestions, and digest.

### B.1 Engagement Flow Overview

| Flow | LLM Path | Trigger |
|------|----------|---------|
| **AI-assisted reply (per message)** | Response generation | User clicks "Suggest reply" or auto-reply runs |
| **Reply suggestions (OmniVyra)** | External OmniVyra API | User opens AI suggestion panel; not logged to `usage_events` |
| **Conversation memory** | aiGateway `conversationMemorySummary` | Thread summary rebuild (message distance ≥ 5) |
| **Conversation triage** | aiGateway `conversationTriage` | Thread classification for inbox grouping |
| **Insight → content ideas** | aiGateway `generateContentIdeas` | User clicks "Generate content ideas" from strategic insight |
| **Daily digest** | No LLM | Rule-based aggregation of threads, leads, opportunities |

### B.2 AI-Assisted Per Response

| Step | Service | Operation | Input Tokens (Est.) | Output Tokens (Est.) | When |
|------|---------|-----------|---------------------|----------------------|------|
| 1 | `responseOrchestrator` | Resolve policy, safety check | 0 | 0 | No LLM (DB + rules) |
| 2 | `responseGenerationService` | `generateResponse` | 800–2,000 | 100–400 | Per reply generation |
| 3 | `conversationMemoryService` | `getThreadMemory` | 0 | 0 | Uses cached summary (no LLM) |

**Context in prompt:** Brand voice, platform rules, template structure, conversation summary (from memory), strategy guidance, reply intelligence, opportunities. System prompt ~400–800 tokens; user prompt ~400–1,200 tokens depending on thread context.

| API / Entry | Operation | Input (Est.) | Output (Est.) |
|------------|-----------|--------------|---------------|
| `POST /api/response/generate` | `orchestrateResponse` → `generateResponse` | 800–2,000 | 100–400 |
| `attemptAutoReply` (worker) | Same path | 800–2,000 | 100–400 |

### B.3 Reply Suggestions (AI Suggestion Panel)

| Step | Service | LLM? | Notes |
|------|---------|------|-------|
| `engagementAiAssistantService.generateReplySuggestions` | OmniVyra `evaluateCommunityAiEngagement` | External API | Tokens consumed by OmniVyra service, not OpenAI; not in `usage_events` |
| Fallback (OmniVyra disabled) | No | Static template replies | No LLM |

**OmniVyra path:** `engagementAiAssistantService` → `omnivyraClientV1.evaluateCommunityAiEngagement()` → external OmniVyra API. Token usage is external; not tracked in this inventory.

### B.4 Conversation Memory Summary

| Step | Service | Operation | Input Tokens (Est.) | Output Tokens (Est.) | Trigger |
|------|---------|-----------|---------------------|----------------------|---------|
| Rebuild summary | `conversationMemoryService` | `generateSummary` via aiGateway `conversationMemorySummary` | 500–1,500 | 150–400 | When `latest_message_id` differs from `last_processed` AND message distance ≥ 5 |
| Skip rebuild | — | — | 0 | 0 | When memory already current or distance < 5 |

**Per thread:** Up to 10 messages × ~300 chars → ~500–1,200 input tokens. Output: 3–5 sentence summary.

### B.5 Conversation Triage (Thread Classification)

| Step | Service | Operation | Input Tokens (Est.) | Output Tokens (Est.) | Trigger |
|------|---------|-----------|---------------------|----------------------|---------|
| Classify thread | `conversationTriageService` | `classifyThread` via aiGateway `conversationTriage` | 400–1,000 | 80–200 | Per thread when triage/classification is requested |
| Load context | — | `loadThreadContext` | 0 | 0 | DB only (messages, memory, lead signals, opportunities) |

**Output:** `classification_category`, `classification_confidence`, `sentiment`, `triage_priority`.

### B.6 Creating Insights → Content Ideas

| Step | Service | Operation | Input Tokens (Est.) | Output Tokens (Est.) | Trigger |
|------|---------|-----------|---------------------|----------------------|---------|
| Generate content ideas | `insightContentService` | `generateContentIdeas` via aiGateway `generateContentIdeas` | 400–800 | 150–400 | User selects insight, clicks "Generate content ideas" |
| API | `pages/api/insight/content-ideas.ts` | — | — | — | POST with insight title, summary, type, recommended_action |

**Output:** 4–6 content ideas (title, format, summary). Format: post, article, video, thread.

### B.7 Services That Do NOT Use LLM

| Service | Purpose | Why No LLM |
|---------|---------|------------|
| `engagementDigestService` | Daily digest (new threads, high priority, leads, opportunities) | Rule-based aggregation from DB |
| `engagementInsightService` | Buyer intent, conversation clusters, opportunity signals | Keyword-based (`BUYER_KEYWORDS`) and rule clustering |
| `responseSafetyGuard` / `checkResponseSafety` | Safety check before auto-reply | Rule-based intent/sentiment checks |

### B.8 Engagement Token Summary (Typical Day)

| Activity | Per Event | Est. Input | Est. Output | Events/Day (Example) | Daily Input | Daily Output |
|----------|-----------|------------|-------------|----------------------|-------------|--------------|
| AI-assisted reply | 1 | 800–2,000 | 100–400 | 20–50 | 16–100K | 2–20K |
| Conversation memory rebuild | 1 | 500–1,500 | 150–400 | 5–20 | 2.5–30K | 0.75–8K |
| Conversation triage | 1 | 400–1,000 | 80–200 | 10–30 | 4–30K | 0.8–6K |
| Insight content ideas | 1 | 400–800 | 150–400 | 2–5 | 0.8–4K | 0.3–2K |
| **Daily total (example)** | | | | | **~23–164K** | **~4–36K** |

---

*Ranges are indicative; measure actual usage via `usage_events` / `logUsageEvent` for production planning.*

---

## Appendix B: Engagement Pipeline — Per-Activity Token Breakdown

Detailed token consumption for social engagement, inbox, insights creation, AI-assisted responses, conversation triage, memory, and related activities.

### B.1 Engagement Flow Overview

| Activity | LLM Path | Trigger | Input (Est.) | Output (Est.) |
|----------|----------|---------|--------------|---------------|
| **AI-assisted response (per message)** | `responseOrchestrator` → `responseGenerationService.generateResponse` | User clicks "Generate reply" or auto-reply | 800–2,000 | 100–400 |
| **Reply suggestions (AI panel)** | `engagementAiAssistantService` → OmniVyra* | User opens suggestion panel | External API | External API |
| **Conversation memory** | `conversationMemoryService.updateThreadMemory` | New messages; distance ≥ 5 from last | 500–1,500 | 150–400 |
| **Conversation triage** | `conversationTriageService.classifyThread` | Thread classification for inbox | 400–1,000 | 80–200 |
| **Creating insights (content ideas)** | `insightContentService.generateContentIdeas` | User generates content ideas from insight | 400–800 | 150–400 |

\* **OmniVyra** (`evaluateCommunityAiEngagement`) is an **external API** — tokens consumed by OmniVyra service, not direct OpenAI. When OmniVyra disabled, fallback is static replies (no LLM).

### B.2 AI-Assisted Per Response (Response Generation)

**Trigger:** `/api/response/generate` or `responseOrchestrator` (auto-reply, reply composer).

| Step | Service | LLM? | Input (Est.) | Output (Est.) |
|------|---------|------|--------------|---------------|
| Resolve response policy | `responsePolicyEngine` | No | — | — |
| Get thread memory | `conversationMemoryService.getThreadMemory` | No | — | Reads DB |
| Generate reply text | `responseGenerationService.generateResponse` | **Yes** | 800–2,000 | 100–400 |

**Context included in prompt:** Template structure, brand voice, platform rules, conversation summary, classification (intent/sentiment), strategy guidance, reply intelligence, active opportunities.

| Component | Typical Size |
|-----------|--------------|
| System prompt (brand, tone, platform, rules) | 300–600 tokens |
| Conversation context (from memory) | 100–400 tokens |
| Original message | 50–500 tokens |
| Template structure | 100–300 tokens |
| Strategy/intelligence/opportunities | 200–600 tokens |
| **Total input** | **800–2,000** |
| **Output** | **100–400** (reply text) |

### B.3 Reply Suggestions (AI Suggestion Panel)

| Path | LLM? | Notes |
|------|------|-------|
| **OmniVyra enabled** | External | `evaluateCommunityAiEngagement` → OmniVyra API; tokens not in our ledger |
| **OmniVyra disabled** | No | Static fallback replies (no LLM) |

### B.4 Conversation Memory (Thread Summary)

**Trigger:** `conversationMemoryWorker` when message distance ≥ 5 from last processed.

| Step | Service | Input (Est.) | Output (Est.) |
|------|---------|--------------|---------------|
| Generate summary | `conversationMemoryService.generateSummary` | 500–1,500 | 150–400 |

**Context:** Up to 10 recent messages, each truncated to 300 chars. Summary used by `responseGenerationService` for conversation context.

### B.5 Conversation Triage (Thread Classification)

**Trigger:** When thread needs classification (inbox grouping, priority).

| Step | Service | Input (Est.) | Output (Est.) |
|------|---------|--------------|---------------|
| Classify thread | `conversationTriageService.classifyThread` | 400–1,000 | 80–200 |

**Context:** Messages, conversation summary, lead signals, opportunities. Output: `classification_category`, `sentiment`, `triage_priority`.

### B.6 Creating Insights (Content Ideas from Insight)

**Trigger:** `/api/insight/content-ideas` or Content Insights panel "Generate content ideas."

| Step | Service | Input (Est.) | Output (Est.) |
|------|---------|--------------|---------------|
| Generate content ideas | `insightContentService.generateContentIdeas` | 400–800 | 150–400 |

**Context:** Insight title, summary, recommended_action, insight_type. Output: 4–6 content ideas (title, format, summary).

### B.7 Engagement Digest

| Step | LLM? | Notes |
|------|------|-------|
| `engagementDigestService.generateDailyDigest` | **No** | Rule-based aggregation (counts, sorting) |

### B.8 Engagement Insight Service (Buyer Intent, Clusters)

| Step | LLM? | Notes |
|------|------|-------|
| `engagementInsightService.detectBuyerIntent` | **No** | Keyword-based |
| `engagementInsightService.detectConversationClusters` | **No** | Rule-based topic grouping |
| `engagementInsightService.detectOpportunitySignals` | **No** | Rule-based |
| `engagementInsightService.storeInsightAsOpportunity` | **No** | DB only |

### B.9 Engagement Conversation Intelligence (OmniVyra)

| Step | LLM? | Notes |
|------|------|-------|
| `engagementConversationIntelligenceService` → `evaluateCommunityAiEngagement` | External | OmniVyra API; not in our token ledger |
| `communityAiOmnivyraService.evaluateEngagement` | External | Same |

### B.10 Per-Engagement-Session Token Estimate

| Activity | Per Event | Est. Input | Est. Output |
|----------|-----------|------------|-------------|
| AI-assisted response | 1 per reply generation | 800–2,000 | 100–400 |
| Conversation memory | 1 per thread when distance ≥ 5 msgs | 500–1,500 | 150–400 |
| Conversation triage | 1 per thread classification | 400–1,000 | 80–200 |
| Content ideas from insight | 1 per "Generate content ideas" | 400–800 | 150–400 |

**Example: 10 replies + 2 triage + 1 memory + 1 content ideas:**
- Response gen: 10 × (1.2K in, 250 out) ≈ 12K in, 2.5K out
- Triage: 2 × (700 in, 140 out) ≈ 1.4K in, 280 out
- Memory: 1 × (1K in, 275 out) ≈ 1K in, 275 out
- Content ideas: 1 × (600 in, 275 out) ≈ 600 in, 275 out
- **Total:** ~15K in, ~3.3K out

---

## Appendix B: Engagement Pipeline — Per-Stage Token Breakdown

Detailed token consumption for social engagement: inbox triage, AI-assisted reply generation, conversation memory, creating insights, content ideas, and related flows.

### B.1 Engagement LLM Entry Points

| Operation | File / API | Gateway | Input Tokens (Est.) | Output Tokens (Est.) | Trigger |
|-----------|------------|---------|---------------------|----------------------|---------|
| **Response generation** | `responseGenerationService.ts` | aiGateway `responseGeneration` | 800–2,000 | 100–400 | Per suggested reply (manual or auto) |
| **Conversation memory summary** | `conversationMemoryService.ts` | aiGateway `conversationMemorySummary` | 500–1,500 | 150–400 | Per thread summary update (every 5+ messages) |
| **Conversation triage** | `conversationTriageService.ts` | aiGateway `conversationTriage` | 400–1,000 | 80–200 | Per thread classification |
| **Insight content ideas** | `insightContentService.ts` | aiGateway `generateContentIdeas` | 400–800 | 150–400 | Per insight "generate content ideas" |
| **Chat moderation** | `GlobalChatPolicy` / aiGateway | aiGateway `chatModeration` | 200–400 | 30–80 | Per chat message (if enabled) |

### B.2 AI-Assisted Per Response (Response Generation Flow)

**Path:** User views thread → clicks "Generate reply" or Auto Reply → `responseOrchestrator` → `generateResponse` → 1 LLM call.

| Step | Service | LLM? | Input (Est.) | Output (Est.) |
|------|---------|------|--------------|---------------|
| Resolve response policy | `resolveResponsePolicy` | No | — | — |
| Get thread memory | `conversationMemoryService.getThreadMemory` | No | — | Cached summary |
| Generate reply | `responseGenerationService.generateResponse` | Yes | 800–2,000 | 100–400 |

**Prompt includes:** Template structure, brand voice, platform rules, conversation context (from memory), classification category, sentiment, strategy guidance, reply intelligence, active opportunities.

**API:** `POST /api/response/generate` or `POST /api/engagement/reply` → `orchestrateResponse` → `generateResponse`.

### B.3 Per-Response Token Breakdown

| Component | Input Tokens | Output Tokens | Notes |
|-----------|--------------|---------------|-------|
| System prompt (template, platform, tone) | 300–600 | — | Fixed-ish |
| Conversation context (memory) | 50–300 | — | From `engagement_thread_memory` |
| Strategy guidance | 0–200 | — | Top 3 strategies |
| Reply intelligence | 0–300 | — | Top 10 high-performing styles |
| Opportunities context | 0–200 | — | Active opportunities |
| User prompt (original message, template vars) | 200–800 | — | Message + template structure |
| **Output** | | 100–400 | Plain reply text |

### B.4 Creating Insights (Content Ideas from Insight)

**Path:** User has strategic insight → clicks "Generate content ideas" → `insightContentService.generateContentIdeas` → 1 LLM call.

| Step | Service | LLM? | Input (Est.) | Output (Est.) |
|------|---------|------|--------------|---------------|
| Generate 4–6 content ideas | `insightContentService.generateContentIdeas` | Yes | 400–800 | 150–400 |

**API:** `POST /api/insight/content-ideas` with `{ title, summary, insight_type, recommended_action, supporting_signals }`.

### B.5 Conversation Memory (Thread Summary)

**Trigger:** Background worker or on-demand when new messages added; rebuild when `message_distance >= 5` from last processed.

| Step | Service | LLM? | Input (Est.) | Output (Est.) |
|------|---------|------|--------------|---------------|
| Summarize last 10 messages | `conversationMemoryService.generateSummary` | Yes | 500–1,500 | 150–400 |

**Used by:** Response generation (conversation context), triage (optional). No LLM when reading cached memory.

### B.6 Conversation Triage (Thread Classification)

**Trigger:** When thread needs classification (e.g. new thread, re-triage).

| Step | Service | LLM? | Input (Est.) | Output (Est.) |
|------|---------|------|--------------|---------------|
| Classify thread | `conversationTriageService.classifyThread` | Yes | 400–1,000 | 80–200 |

**Output:** `classification_category`, `classification_confidence`, `sentiment`, `triage_priority`.

### B.7 What Does NOT Use LLM (Engagement)

| Component | Notes |
|-----------|-------|
| **Engagement digest** | `engagementDigestService.generateDailyDigest` — rule-based aggregation (counts, sorting) |
| **Engagement insight service** | `engagementInsightService` — `detectBuyerIntent`, `detectConversationClusters`, `detectOpportunitySignals` — keyword/rule-based |
| **OmniVyra reply suggestions** | `engagementAiAssistantService.generateReplySuggestions` → `evaluateCommunityAiEngagement` — **external OmniVyra API** (tokens consumed by OmniVyra, not our OpenAI) |
| **Reply intelligence aggregation** | Learning from past replies — no LLM at aggregation time |

### B.8 Engagement Token Summary (Per Day, Example)

| Activity | Calls/Day (Est.) | Input Range | Output Range |
|----------|-------------------|-------------|--------------|
| Response generation (10 replies) | 10 | 8–20K | 1–4K |
| Conversation memory (5 threads updated) | 5 | 2.5–7.5K | 0.75–2K |
| Conversation triage (20 threads) | 20 | 8–20K | 1.6–4K |
| Insight content ideas (2 insights) | 2 | 0.8–1.6K | 0.3–0.8K |
| Chat moderation (50 messages) | 50 | 10–20K | 1.5–4K |
| **Total (heavy engagement day)** | **87** | **~30–70K** | **~5–15K** |

### B.9 End-to-End: One AI-Assisted Reply

| Step | LLM? | Input | Output |
|------|------|-------|--------|
| Thread memory (if stale) | Maybe | 500–1,500 | 150–400 |
| Triage (if not classified) | Maybe | 400–1,000 | 80–200 |
| Response generation | Yes | 800–2,000 | 100–400 |
| **Total per reply (worst case)** | | **1.7–4.5K** | **330–1K** |

---

## Appendix B: Engagement Pipeline — Stage-by-Stage Token Breakdown

Detailed token consumption for engagement/inbox: creating insights, AI-assisted reply suggestions, triage, conversation memory, content ideas, and per-response generation.

### B.1 Engagement LLM Consumers Overview

| Operation | Service / API | Gateway | Input (Est.) | Output (Est.) | Trigger |
|-----------|---------------|---------|--------------|---------------|---------|
| **AI-assisted per response** | `responseGenerationService` | aiGateway `responseGeneration` | 800–2,000 | 100–400 | Per "Generate Reply" or auto-reply |
| **Conversation memory** | `conversationMemoryService` | aiGateway `conversationMemorySummary` | 500–1,500 | 150–400 | Per thread summary update (every 5+ msgs) |
| **Conversation triage** | `conversationTriageService` | aiGateway `conversationTriage` | 400–1,000 | 80–200 | Per thread classification |
| **Creating insights (content ideas)** | `insightContentService` | aiGateway `generateContentIdeas` | 400–800 | 150–400 | Per strategic insight → content ideas |
| **Reply suggestions (OmniVyra)** | `engagementAiAssistantService` | OmniVyra external API | External | External | Per message when OmniVyra enabled |
| **Chat moderation** | aiGateway / `GlobalChatPolicy` | aiGateway `chatModeration` | 200–400 | 30–80 | Per chat message (campaign planner) |

### B.2 AI-Assisted Per Response

**Flow:** `/api/response/generate` or `orchestrateResponse` → `generateResponse` (responseGenerationService)

| Step | LLM? | Input (Est.) | Output (Est.) | Notes |
|------|------|--------------|---------------|-------|
| Resolve policy | No | — | — | response_rules, templates (DB) |
| Get thread memory | No (fetch) | — | — | Cached conversation summary |
| Generate reply | **Yes** | 800–2,000 | 100–400 | Template + brand voice + strategies + opportunities + context |
| Format for platform | No | — | — | Deterministic |

**Context in prompt:** Brand voice, platform rules, tone, emoji policy, template structure, conversation context (from memory), strategy guidance (high-performing), reply intelligence (styles), active opportunities.

**Per response:** 1 LLM call — ~800–2,000 in, ~100–400 out.

### B.3 Creating Insights (Content Ideas from Strategic Insights)

**Flow:** `/api/insight/content-ideas` → `insightContentService.generateContentIdeas`

| Step | LLM? | Input (Est.) | Output (Est.) | Notes |
|------|------|--------------|---------------|-------|
| Generate 4–6 content ideas | **Yes** | 400–800 | 150–400 | Title, format (post/article/video/thread), summary |
| JSON parse | No | — | — | — |

**Input:** Insight title, summary, recommended_action, insight_type, supporting_signals.  
**Output:** Array of `{ title, format, summary }`.

**Per insight:** 1 LLM call — ~400–800 in, ~150–400 out.

### B.4 Conversation Memory (Thread Summary)

**Flow:** `conversationMemoryWorker` or on message insert → `conversationMemoryService.updateThreadMemory` → `generateSummary`

| Step | LLM? | Input (Est.) | Output (Est.) | Notes |
|------|------|--------------|---------------|-------|
| Fetch messages | No | — | — | Up to 10 messages |
| Generate summary | **Yes** | 500–1,500 | 150–400 | 3–5 sentences, topic + intent + prior answers |
| Upsert to DB | No | — | — | engagement_thread_memory |

**Trigger:** When latest != last_processed and message distance ≥ 5. Not per message.

**Per rebuild:** 1 LLM call — ~500–1,500 in, ~150–400 out.

### B.5 Conversation Triage (Thread Classification)

**Flow:** On thread open or background worker → `conversationTriageService.classifyThread`

| Step | LLM? | Input (Est.) | Output (Est.) | Notes |
|------|------|--------------|---------------|-------|
| Load context | No | — | — | Messages, memory, lead signals, opportunities |
| Classify | **Yes** | 400–1,000 | 80–200 | category, confidence, sentiment, triage_priority |
| Persist | No | — | — | engagement_thread_classification |

**Categories:** question_request, recommendation_request, competitor_complaint, problem_discussion, product_comparison, general_comment.

**Per thread (on triage):** 1 LLM call — ~400–1,000 in, ~80–200 out.

### B.6 Reply Suggestions (AI Suggestion Panel)

**Flow:** `/api/engagement/suggestions` → `engagementAiAssistantService.generateReplySuggestions`

| Path | LLM? | Notes |
|------|------|-------|
| **OmniVyra disabled** | No | Returns static fallback (4 canned replies) |
| **OmniVyra enabled** | External | `evaluateCommunityAiEngagement` → OmniVyra API (not OpenAI) |

**Note:** OmniVyra is an external AI service. Tokens are consumed by OmniVyra, not logged to our `usage_events`. When OmniVyra is off, no LLM is used.

### B.7 Engagement Digest

**Flow:** `engagementDigestWorker` → `engagementDigestService.generateDailyDigest`

| Step | LLM? | Notes |
|------|------|-------|
| Aggregate counts | No | DB queries only |
| Sort & recommend | No | Rule-based |

**No LLM** — Engagement digest is rule-based aggregation.

### B.8 Engagement Insight Service (Buyer Intent, Clusters, Opportunities)

**Flow:** `engagementInsightService.detectBuyerIntent`, `detectConversationClusters`, `detectOpportunitySignals`, `storeInsightAsOpportunity`

| Step | LLM? | Notes |
|------|------|-------|
| Keyword matching | No | BUYER_KEYWORDS, topic heuristics |
| Cluster by topic | No | Rule-based |
| Store opportunity | No | DB insert |

**No LLM** — engagementInsightService is rule-based (keyword + heuristics).

### B.9 Engagement Token Summary (Per Day Example)

| Activity | LLM Calls | Input (Est.) | Output (Est.) |
|----------|-----------|--------------|---------------|
| 20 AI-assisted replies | 20 | 16–40K | 2–8K |
| 5 new thread triages | 5 | 2–5K | 0.4–1K |
| 3 thread memory summaries | 3 | 1.5–4.5K | 0.45–1.2K |
| 2 insight → content ideas | 2 | 0.8–1.6K | 0.3–0.8K |
| **Total (internal LLM)** | **30** | **~20–51K** | **~3–11K** |

**OmniVyra path:** If enabled, additional tokens consumed by external OmniVyra API (not in `usage_events`).

---

## Appendix B: Engagement Pipeline — Per-Stage Token Breakdown

Detailed token consumption for social engagement: inbox triage, AI-assisted reply generation, conversation memory, creating insights from engagement, etc.

### B.1 Engagement LLM Flow Overview

| Step | Service / API | LLM Used? | Input (Est.) | Output (Est.) | Trigger |
|------|---------------|-----------|--------------|---------------|---------|
| **Thread triage** | `conversationTriageService.classifyThread` | Yes | 400–1,000 | 80–200 | Per thread (on classification request) |
| **Conversation summary** | `conversationMemoryService.updateThreadMemory` | Yes | 500–1,500 | 150–400 | Per thread when ≥5 new messages |
| **AI-assisted reply** | `responseGenerationService.generateResponse` | Yes | 800–2,000 | 100–400 | Per "Generate Reply" / auto-reply |
| **Reply suggestions (OmniVyra)** | `engagementAiAssistantService.generateReplySuggestions` | External* | — | — | Per suggestion panel open |
| **Insight → content ideas** | `insightContentService.generateContentIdeas` | Yes | 400–800 | 150–400 | Per insight when "Generate content ideas" |
| **Daily digest** | `engagementDigestService.generateDailyDigest` | **No** | — | — | Rule-based aggregation |
| **Engagement insight detection** | `engagementInsightService` | **No** | — | — | Rule-based (keywords, clusters) |

\* OmniVyra (`evaluateCommunityAiEngagement`) is an external API; tokens consumed outside this platform.

---

### B.2 AI-Assisted Per Response

When user clicks "Generate Reply" or auto-reply executes:

```
responseOrchestrator.orchestrateResponse()
  └─ resolveResponsePolicy()           ← No LLM (DB + rules)
  └─ generateResponse()                ← 1 LLM call
       └─ getThreadMemory()            ← No LLM (reads stored summary)
       └─ runCompletionWithOperation(operation: 'responseGeneration')
```

| Operation | File | Input Tokens | Output Tokens | Notes |
|-----------|------|--------------|---------------|-------|
| **Response generation** | `responseGenerationService.generateResponse` | 800–2,000 | 100–400 | Template + thread context + strategies + opportunities |
| **Conversation context** | `getThreadMemory` | 0 | 0 | Reads existing summary (no LLM) |

**Per reply:** 1 LLM call → ~800–2K in, ~100–400 out.

---

### B.3 Conversation Memory Summary

- **Service:** `conversationMemoryService.updateThreadMemory`
- **Trigger:** Worker when `message_distance >= 5` or `latest != last_processed`
- **Model:** gpt-4o-mini via `runCompletionWithOperation` (operation: `conversationMemorySummary`)

| Item | Input (Est.) | Output (Est.) | Frequency |
|------|--------------|---------------|-----------|
| Per thread summary | 500–1,500 | 150–400 | Every 5+ new messages or 24h stale |

---

### B.4 Conversation Triage (Inbox Classification)

- **Service:** `conversationTriageService.classifyThread`
- **Trigger:** When thread needs classification (inbox grouping, prioritization)

| Item | Input (Est.) | Output (Est.) | Per |
|------|--------------|---------------|-----|
| Thread classification | 400–1,000 | 80–200 | 1 thread |

Context includes: messages, conversation summary, lead signals, opportunities.

---

### B.5 Creating Insights → Content Ideas

- **Service:** `insightContentService.generateContentIdeas`
- **API:** `pages/api/insight/content-ideas.ts`
- **Trigger:** User clicks "Generate content ideas" from strategic insight

| Item | Input (Est.) | Output (Est.) | Per |
|------|--------------|---------------|-----|
| Content ideas (4–6) | 400–800 | 150–400 | 1 insight |

**Note:** `engagementInsightService` (buyer intent, clusters, opportunities) is **rule-based** — no LLM.

---

### B.6 Reply Suggestions (AI Engagement Assistant)

- **Service:** `engagementAiAssistantService.generateReplySuggestions`
- **API:** `GET /api/engagement/suggestions`
- **When OmniVyra disabled:** Returns static fallbacks — **no LLM**
- **When OmniVyra enabled:** Calls `evaluateCommunityAiEngagement` (external OmniVyra API) — tokens consumed by OmniVyra, not platform OpenAI

---

### B.7 Engagement Digest

- **Service:** `engagementDigestService.generateDailyDigest`
- **Trigger:** Scheduled worker (daily)
- **LLM:** **None** — rule-based counts and ranking

---

### B.8 End-to-End: Per Inbox Reply Flow

| Step | LLM? | Input | Output |
|------|------|-------|--------|
| Thread triage (if needed) | Yes | 400–1,000 | 80–200 |
| Conversation memory (if needed) | Yes | 500–1,500 | 150–400 |
| Response generation | Yes | 800–2,000 | 100–400 |
| **Per reply total** | **1–3 calls** | **1.7–4.5K** | **330–1K** |

Typical: 1 call (response generation). Triage and memory may run separately/asynchronously.

---

### B.9 Engagement Token Summary (Daily, High Activity Org)

| Activity | Calls/Day | Est. Input | Est. Output |
|----------|-----------|------------|-------------|
| Thread triage (50 threads) | 50 | 20–50K | 4–10K |
| Conversation memory (20 threads) | 20 | 10–30K | 3–8K |
| AI-assisted replies (30) | 30 | 24–60K | 3–12K |
| Insight content ideas (5) | 5 | 2–4K | 0.75–2K |
| **Daily total** | **~105** | **~56–144K** | **~11–32K** |

---

## Appendix B: Engagement Pipeline — Per-Activity Token Breakdown

Detailed token consumption for engagement/inbox: AI-assisted responses, insights, conversation triage, memory, reply suggestions, digest, etc.

### B.1 Engagement Flow Overview

| Activity | LLM Used? | Service / API | When |
|----------|-----------|---------------|------|
| **AI-assisted reply (per message)** | Yes | `responseGenerationService` | User clicks "Generate reply" or auto-reply |
| **Reply suggestions (AI panel)** | External* | OmniVyra `evaluateCommunityAiEngagement` | "Suggest replies" in inbox |
| **Conversation memory** | Yes | `conversationMemoryService` | Thread update (every 5+ messages) |
| **Conversation triage** | Yes | `conversationTriageService` | Thread classification for inbox |
| **Creating insights (content ideas)** | Yes | `insightContentService` | "Generate content ideas" from insight |
| **Daily digest** | No | `engagementDigestService` | Rule-based aggregation |
| **Buyer intent / clusters** | No | `engagementInsightService` | Rule-based keyword detection |

\* OmniVyra is an external API; tokens consumed there, not in our aiGateway.

---

### B.2 AI-Assisted Per Response (Response Generation)

**Path:** `pages/api/response/generate` or `pages/api/engagement/reply` → `responseOrchestrator.orchestrateResponse` → `responseGenerationService.generateResponse`

| Step | Operation | Input Tokens (Est.) | Output Tokens (Est.) | Per Response |
|------|-----------|---------------------|----------------------|--------------|
| Policy resolution | No LLM | — | — | — |
| **Generate reply** | `runCompletionWithOperation` (`responseGeneration`) | 800–2,000 | 100–400 | 1 call |

**Prompt context includes:** thread memory (from `getThreadMemory`), template structure, brand voice, platform rules, reply intelligence, strategies, opportunities.

| Component | Contribution to Input |
|-----------|----------------------|
| System prompt (brand, tone, platform, template) | 400–800 |
| Thread memory summary | 0–300 |
| Original message | 100–500 |
| Template structure | 100–400 |
| Strategy/opportunity guidance | 0–300 |

---

### B.3 Reply Suggestions (OmniVyra Path)

**Path:** `pages/api/engagement/suggestions` → `engagementAiAssistantService.generateReplySuggestions` → `evaluateCommunityAiEngagement` (OmniVyra)

| When OmniVyra | LLM? | Notes |
|---------------|------|-------|
| Enabled | External (OmniVyra) | Tokens consumed by OmniVyra service; not logged in our usage_events |
| Disabled | No | Returns static fallback suggestions |

**Note:** When OmniVyra is disabled, no LLM is used; predefined tone variants are returned.

---

### B.4 Conversation Memory (Thread Summary)

**Path:** `conversationMemoryWorker` or on thread update → `conversationMemoryService.updateThreadMemory` → `generateSummary`

| Step | Operation | Input Tokens (Est.) | Output Tokens (Est.) | When |
|------|-----------|---------------------|----------------------|------|
| **Summarize conversation** | `runCompletionWithOperation` (`conversationMemorySummary`) | 500–1,500 | 150–400 | Every 5+ new messages; skip if already current |

Prompt: up to 10 messages × ~300 chars each + system instruction.

---

### B.5 Conversation Triage (Inbox Classification)

**Path:** Thread classification for inbox grouping/prioritization → `conversationTriageService.classifyThread`

| Step | Operation | Input Tokens (Est.) | Output Tokens (Est.) | When |
|------|-----------|---------------------|----------------------|------|
| **Classify thread** | `runCompletionWithOperation` (`conversationTriage`) | 400–1,000 | 80–200 | Per thread (on triage run or when thread opens) |

Context: messages, memory summary, lead signals, opportunities. Output: `classification_category`, `sentiment`, `triage_priority`.

---

### B.6 Creating Insights (Content Ideas from Strategic Insight)

**Path:** `pages/api/insight/content-ideas` → `insightContentService.generateContentIdeas`

| Step | Operation | Input Tokens (Est.) | Output Tokens (Est.) | When |
|------|-----------|---------------------|----------------------|------|
| **Generate content ideas** | `runCompletionWithOperation` (`generateContentIdeas`) | 400–800 | 150–400 | User clicks "Generate content ideas" from an insight |

Input: insight title, summary, recommended_action, insight_type. Output: 4–6 content ideas (post, article, video, thread).

---

### B.7 Services That Do NOT Use LLM

| Service | Purpose | Notes |
|---------|---------|-------|
| `engagementDigestService` | Daily digest (new threads, leads, opportunities) | Rule-based aggregation |
| `engagementInsightService` | Buyer intent, clusters, opportunity signals | Keyword/rule-based |
| `responseOrchestrator` (policy) | Resolve response policy | DB lookup only |

---

### B.8 Per-Inbox Session Token Estimate

| User Action | LLM Calls | Est. Input | Est. Output | Total Tokens |
|-------------|-----------|------------|-------------|---------------|
| Open thread (triage) | 1 | 400–1,000 | 80–200 | 480–1,200 |
| Generate 1 reply | 1 | 800–2,000 | 100–400 | 900–2,400 |
| Get content ideas (1 insight) | 1 | 400–800 | 150–400 | 550–1,200 |
| Thread memory update (background) | 1 | 500–1,500 | 150–400 | 650–1,900 |

**Example: 10 threads triaged + 5 replies generated + 2 content-idea requests:**
- Triage: 10 × 800 = 8K in, 10 × 150 = 1.5K out
- Replies: 5 × 1.2K = 6K in, 5 × 250 = 1.25K out
- Content ideas: 2 × 600 = 1.2K in, 2 × 275 = 550 out
- Memory: ~5 background updates × 1K = 5K in, 5 × 275 = 1.4K out  
**Rough total: ~20K in, ~4.7K out ≈ 25K tokens**

---

## Appendix B: Engagement Pipeline — Per-Activity Token Breakdown

Detailed token consumption for engagement flows: creating insights, AI-assisted response per message, conversation triage, memory, digest, reply suggestions, etc.

### B.1 Engagement Flow Overview

| Activity | LLM? | Service | Input (Est.) | Output (Est.) | Trigger |
|----------|------|---------|--------------|---------------|---------|
| **AI-assisted response** | Yes | `responseGenerationService` | 800–2,000 | 100–400 | Per "Suggest Reply" or auto-reply |
| **Reply suggestions** (OmniVyra) | External | `engagementAiAssistantService` → OmniVyra API | N/A | N/A | Per thread when OmniVyra enabled |
| **Conversation memory summary** | Yes | `conversationMemoryService` | 500–1,500 | 150–400 | Per thread when message distance ≥ 5 |
| **Conversation triage** | Yes | `conversationTriageService` | 400–1,000 | 80–200 | Per thread classification |
| **Creating insights (content ideas)** | Yes | `insightContentService` | 400–800 | 150–400 | Per insight "Generate content ideas" |
| **Daily digest** | No | `engagementDigestService` | — | — | Rule-based aggregation |
| **Engagement insight detection** | No | `engagementInsightService` | — | — | Rule-based (keywords, clusters) |

### B.2 AI-Assisted Per-Response (Response Generation)

Triggered by: `/api/response/generate`, `responseOrchestrator.orchestrateResponse`, `autoReplyService.attemptAutoReply`.

| Step | Operation | Input Tokens | Output Tokens | Notes |
|------|-----------|--------------|---------------|-------|
| Policy resolution | `resolveResponsePolicy` | 0 | 0 | Rule-based (templates) |
| Thread memory | `getThreadMemory` | 0 | 0 | Reads prior summary (no LLM) |
| **Response generation** | `responseGenerationService.generateResponse` | 800–2,000 | 100–400 | 1 LLM call per reply |

**Prompt includes:** template structure, platform rules, conversation context (from memory), strategies, reply intelligence, opportunities, brand voice.

**Per-response estimate:** ~1,200 in / ~250 out (typical).

### B.3 Reply Suggestions (AISuggestionPanel / AI Engagement Assistant)

| Path | LLM? | Notes |
|------|------|-------|
| **OmniVyra disabled** | No | Returns static fallback suggestions |
| **OmniVyra enabled** | External | `evaluateCommunityAiEngagement` → OmniVyra API (external service; tokens consumed by OmniVyra, not our OpenAI) |

**API:** `GET /api/engagement/suggestions` → `engagementAiAssistantService.generateReplySuggestions`.

### B.4 Creating Insights (Content Ideas from Strategic Insight)

| Step | Service | Input Tokens | Output Tokens | Trigger |
|------|---------|--------------|---------------|---------|
| **Generate content ideas** | `insightContentService.generateContentIdeas` | 400–800 | 150–400 | `POST /api/insight/content-ideas` when user requests ideas from insight |

**Input:** Insight title, summary, recommended_action, insight_type.  
**Output:** 4–6 content ideas (title, format, summary) as JSON.

### B.5 Conversation Triage (Thread Classification)

| Step | Service | Input Tokens | Output Tokens | Trigger |
|------|---------|--------------|---------------|---------|
| **Classify thread** | `conversationTriageService.classifyThread` | 400–1,000 | 80–200 | When triage/classification runs (inbox grouping, prioritization) |

**Input:** Messages (last 10), conversation summary, lead signals, opportunities.  
**Output:** `classification_category`, `classification_confidence`, `sentiment`, `triage_priority`.

### B.6 Conversation Memory Summary

| Step | Service | Input Tokens | Output Tokens | Trigger |
|------|---------|--------------|---------------|---------|
| **Generate summary** | `conversationMemoryService.updateThreadMemory` → `generateSummary` | 500–1,500 | 150–400 | When message distance ≥ 5 from last processed |

**Input:** Last 10 messages (truncated to 300 chars each).  
**Output:** 3–5 sentence summary.  
**Throttling:** Skips rebuild if `latest_message_id == last_processed` or distance < 5.

### B.7 Engagement Digest (No LLM)

| Step | LLM? | Notes |
|------|------|-------|
| `engagementDigestService.generateDailyDigest` | No | Rule-based: counts threads, leads, opportunities; sorts by triage_priority |

### B.8 Engagement Insight Detection (No LLM)

| Step | LLM? | Notes |
|------|------|-------|
| `engagementInsightService.detectBuyerIntent` | No | Keyword matching (price, demo, trial, etc.) |
| `engagementInsightService.detectConversationClusters` | No | Topic clustering by keywords |
| `engagementInsightService.detectOpportunitySignals` | No | Rule-based relevance |

### B.9 Engagement Conversation Intelligence (OmniVyra)

| Step | LLM? | Notes |
|------|------|-------|
| `engagementConversationIntelligenceService` | External | Uses `evaluateCommunityAiEngagement` (OmniVyra); tokens not in our OpenAI ledger |

### B.10 Per-Inbox Session Token Estimate (Typical)

| Activity | Calls | Input | Output |
|----------|-------|-------|--------|
| View thread, request suggestion | 1 (response gen) | 800–2,000 | 100–400 |
| Triage 10 threads | 10 | 4–10K | 0.8–2K |
| Memory update (5 threads) | 5 | 2.5–7.5K | 0.75–2K |
| Content ideas from 1 insight | 1 | 400–800 | 150–400 |
| **Heavy session (20 replies + triage)** | **~25** | **~25–40K** | **~6–12K** |

---

## Appendix B: Engagement Pipeline — Per-Activity Token Breakdown

Detailed token consumption for engagement/inbox flows: creating insights, AI-assisted per-response, conversation triage, memory summary, daily digest, and OmniVyra paths.

### B.1 AI-Assisted Per-Response (Response Generation)

| Step | Service / API | Operation | Input Tokens (Est.) | Output Tokens (Est.) | Trigger |
|------|---------------|-----------|---------------------|----------------------|---------|
| **Generate reply** | `responseGenerationService.generateResponse` | aiGateway `responseGeneration` | 800–2,000 | 100–400 | Per "Suggest Reply" / auto-reply |
| **Upstream: thread memory** | `conversationMemoryService.getThreadMemory` | No LLM | — | — | Reads cached summary (see B.4 for when it’s built) |
| **Policy resolution** | `responsePolicyEngine` | No LLM | — | — | Rule-based |
| **Orchestration** | `responseOrchestrator.orchestrateResponse` | Calls `generateResponse` | — | — | Per message needing AI reply |

**Flow:** `POST /api/response/generate` → `orchestrateResponse` → `generateResponse`. Context includes: template structure, brand voice, thread memory, strategies, reply intelligence, opportunities. One LLM call per response suggestion.

| Context Additions | Approx. Input Size |
|-------------------|--------------------|
| Template structure | 100–400 |
| Thread memory summary | 0–500 |
| Strategies (top 3) | 100–300 |
| Reply intelligence (top 10) | 200–600 |
| Opportunities (top 5) | 100–300 |
| Original message | 50–500 |
| **Total per response** | **800–2,000 in, 100–400 out** |

---

### B.2 Reply Suggestions (OmniVyra vs Fallback)

| Path | Service | LLM? | Input (Est.) | Output (Est.) | Trigger |
|------|---------|------|--------------|---------------|---------|
| **OmniVyra enabled** | `engagementAiAssistantService.generateReplySuggestions` → `omnivyraClientV1.evaluateCommunityAiEngagement` | External OmniVyra API* | — | — | Per "Suggestions" request |
| **OmniVyra disabled** | Same service | **No LLM** | — | — | Returns static fallback suggestions |

\* OmniVyra uses its own LLM; tokens are not in our `usage_events`. For internal OpenAI only: **0 tokens** when OmniVyra is used.

---

### B.3 Creating Insights (Content Ideas from Insight)

| Step | Service / API | Operation | Input Tokens (Est.) | Output Tokens (Est.) | Trigger |
|------|---------------|-----------|---------------------|----------------------|---------|
| **Generate content ideas** | `insightContentService.generateContentIdeas` | aiGateway `generateContentIdeas` | 400–800 | 150–400 | Per insight → "Generate content ideas" |
| **Input** | Insight title, summary, recommended_action | — | 300–600 | — | Strategic insight card |
| **Output** | 4–6 content ideas (title, format, summary) | JSON | — | 150–400 | post/article/video/thread |

**Flow:** `POST /api/insight/content-ideas` → `generateContentIdeas(insight)`. One LLM call per insight.

---

### B.4 Conversation Memory Summary

| Step | Service | Operation | Input Tokens (Est.) | Output Tokens (Est.) | Trigger |
|------|---------|-----------|---------------------|----------------------|---------|
| **Summarize conversation** | `conversationMemoryService.updateThreadMemory` → `generateSummary` | aiGateway `conversationMemorySummary` | 500–1,500 | 150–400 | Per thread when message distance ≥ 5 and memory stale |

**Flow:** Worker or fire-and-forget on new messages. Fetches last 10 messages (truncated to 300 chars each), builds prompt, one LLM call. Summary stored in `engagement_thread_memory` and reused by response generation.

| Scenario | Input | Output |
|----------|-------|--------|
| Short thread (3–5 msgs) | 500–800 | 150–250 |
| Longer thread (8–10 msgs) | 1,000–1,500 | 250–400 |

---

### B.5 Conversation Triage (Thread Classification)

| Step | Service | Operation | Input Tokens (Est.) | Output Tokens (Est.) | Trigger |
|------|---------|-----------|---------------------|----------------------|---------|
| **Classify thread** | `conversationTriageService.classifyThread` | aiGateway `conversationTriage` | 400–1,000 | 80–200 | Per thread needing classification |

**Flow:** Loads last 10 messages, conversation memory, lead signals, opportunities. One LLM call returns: `classification_category`, `classification_confidence`, `sentiment`, `triage_priority`.

---

### B.6 Engagement Digest

| Step | Service | LLM? | Notes |
|------|---------|------|-------|
| **Generate daily digest** | `engagementDigestService.generateDailyDigest` | **No** | Rule-based: counts threads, leads, opportunities, sorts by triage_priority |

**Tokens: 0** — No LLM calls.

---

### B.7 Engagement Insight Service (Buyer Intent, Clusters, Opportunities)

| Step | Service | LLM? | Notes |
|------|---------|------|-------|
| **detectBuyerIntent** | `engagementInsightService` | **No** | Keyword-based |
| **detectConversationClusters** | `engagementInsightService` | **No** | Rule-based topic grouping |
| **detectOpportunitySignals** | `engagementInsightService` | **No** | Rule-based |
| **storeInsightAsOpportunity** | `engagementInsightService` | **No** | DB insert |

**Tokens: 0** — All rule-based.

---

### B.8 Engagement Conversation Intelligence / OmniVyra

| Step | Service | LLM? | Notes |
|------|---------|------|-------|
| **evaluateCommunityAiEngagement** | `omnivyraClientV1` | External OmniVyra* | Sends thread + target message to OmniVyra API |
| **evaluateEngagement** | `communityAiOmnivyraService` | External OmniVyra* | Wraps evaluateCommunityAiEngagement |
| **engagementConversationIntelligenceService** | Same | External OmniVyra* | Calls evaluateCommunityAiEngagement |

\* External API; tokens not in our `usage_events`. For internal OpenAI: **0 tokens**.

---

### B.9 Chat Moderation (Pre-Send)

| Step | Service | Operation | Input Tokens (Est.) | Output Tokens (Est.) | Trigger |
|------|---------|-----------|---------------------|----------------------|---------|
| **Moderate message** | `GlobalChatPolicy` → aiGateway `moderateChatMessage` | aiGateway `chatModeration` | 200–400 | 30–80 | Per user chat message before send |

---

### B.10 Engagement Token Summary (Per Typical Session)

| Activity | LLM Calls | Input Range | Output Range | Total per Activity |
|----------|------------|-------------|--------------|---------------------|
| Suggest reply (1 message) | 1 | 800–2,000 | 100–400 | 900–2,400 |
| Conversation memory (1 thread rebuild) | 1 | 500–1,500 | 150–400 | 650–1,900 |
| Conversation triage (1 thread) | 1 | 400–1,000 | 80–200 | 480–1,200 |
| Insight content ideas (1 insight) | 1 | 400–800 | 150–400 | 550–1,200 |
| Chat moderation (1 message) | 1 | 200–400 | 30–80 | 230–480 |

**Example: 10 replies + 5 triage + 2 insight ideas + 3 chat messages:**
- Response gen: 10 × 1.5K ≈ 15K in, 2.5K out  
- Triage: 5 × 700 ≈ 3.5K in, 700 out  
- Content ideas: 2 × 600 ≈ 1.2K in, 550 out  
- Moderation: 3 × 300 ≈ 900 in, 165 out  
- **Total: ~20.6K in, ~3.9K out ≈ 24.5K tokens**

---

## Appendix B: Engagement Pipeline — Per-Activity Token Breakdown

Detailed token consumption for engagement/inbox flows: AI-assisted per-response, conversation memory, triage, insights, reply suggestions. Excludes OmniVyra (external API; tokens consumed on OmniVyra side).

### B.1 AI-Assisted Per Response (Response Generation)

| Step | Service / API | LLM? | Input Tokens (Est.) | Output Tokens (Est.) | Trigger |
|------|---------------|------|---------------------|----------------------|---------|
| Policy lookup | `resolveResponsePolicy` | No | — | — | DB only |
| **Generate reply** | `responseGenerationService.generateResponse` | Yes | 800–2,000 | 100–400 | Per "Suggest Reply" or auto-reply |
| Format for platform | `formatForPlatform` | No | — | — | Rule-based |

**Flow:** `responseOrchestrator.orchestrateResponse` → `generateResponse` → aiGateway `responseGeneration`.

**Context included:** Template structure, brand voice, conversation summary (from memory), strategies, reply intelligence, opportunities. Prompt size varies with thread context.

| Per Response | Input Range | Output Range |
|--------------|-------------|--------------|
| Minimal (short thread) | 800–1,200 | 100–200 |
| Full (long thread + strategies + opportunities) | 1,500–2,000 | 200–400 |

---

### B.2 Reply Suggestions (AI Suggestion Panel)

| Path | Service | LLM? | Input (Est.) | Output (Est.) | Notes |
|------|---------|------|--------------|---------------|-------|
| **OmniVyra disabled** | `engagementAiAssistantService` | No | 0 | 0 | Returns static fallbacks |
| **OmniVyra enabled** | `evaluateCommunityAiEngagement` | External | N/A | N/A | OmniVyra API — tokens on their side |

**Note:** `generateReplySuggestions` uses OmniVyra external API when enabled. No direct OpenAI tokens in this path. Alternative path: response generation (B.1) uses OpenAI.

---

### B.3 Conversation Memory Summary

| Step | Service | LLM? | Input Tokens (Est.) | Output Tokens (Est.) | Trigger |
|------|---------|------|---------------------|----------------------|---------|
| **Generate summary** | `conversationMemoryService.generateSummary` | Yes | 500–1,500 | 150–400 | Per thread when message distance ≥ 5 (fire-and-forget worker) |

**When:** `conversationMemoryWorker` runs; calls `updateThreadMemory`. Skips if `last_processed_message_id` matches latest or message distance &lt; 5.

| Thread Length | Input (Est.) | Output (Est.) |
|---------------|--------------|---------------|
| 3–5 messages | 400–800 | 100–250 |
| 6–10 messages | 800–1,500 | 200–400 |

---

### B.4 Conversation Triage (Thread Classification)

| Step | Service | LLM? | Input Tokens (Est.) | Output Tokens (Est.) | Trigger |
|------|---------|------|---------------------|----------------------|---------|
| **Classify thread** | `conversationTriageService.classifyThread` | Yes | 400–1,000 | 80–200 | Per thread classification (inbox grouping/prioritization) |

**Context:** Messages (up to 10), conversation summary, lead signals, opportunities. Output: `classification_category`, `classification_confidence`, `sentiment`, `triage_priority`.

| Thread Size | Input (Est.) | Output (Est.) |
|-------------|--------------|---------------|
| Short (2–4 msgs) | 400–600 | 80–120 |
| Long (6–10 msgs) | 700–1,000 | 120–200 |

---

### B.5 Creating Insights → Content Ideas

| Step | Service / API | LLM? | Input Tokens (Est.) | Output Tokens (Est.) | Trigger |
|------|---------------|------|---------------------|----------------------|---------|
| **Generate content ideas** | `insightContentService.generateContentIdeas` | Yes | 400–800 | 150–400 | On "Generate content ideas" from insight |

**Flow:** User selects insight → `pages/api/insight/content-ideas.ts` → `generateContentIdeas(insight)`.

**Output:** 4–6 content ideas (title, format, summary) as JSON.

| Per Insight | Input (Est.) | Output (Est.) |
|-------------|--------------|---------------|
| 1 call | 400–800 | 150–400 |

---

### B.6 Engagement Digest (Daily Digest)

| Step | Service | LLM? | Notes |
|------|---------|------|-------|
| **Generate daily digest** | `engagementDigestService.generateDailyDigest` | **No** | Rule-based aggregation (counts, sorting) |

**No LLM** — uses DB queries and deterministic ranking.

---

### B.7 Engagement Insight Detection (Buyer Intent, Clusters, Opportunities)

| Step | Service | LLM? | Notes |
|------|---------|------|-------|
| `detectBuyerIntent` | `engagementInsightService` | **No** | Keyword-based |
| `detectConversationClusters` | `engagementInsightService` | **No** | Rule-based topic grouping |
| `detectOpportunitySignals` | `engagementInsightService` | **No** | Rule-based |

**No LLM** — `engagementInsightService` is rule-based.

---

### B.8 Engagement Flow Summary: Per-Response Path

When a user requests an AI-assisted reply for a single message:

| Step | LLM? | Input (Est.) | Output (Est.) |
|------|------|--------------|---------------| 
| Get conversation memory (if needed) | Maybe* | 500–1,500 | 150–400 |
| Generate response | Yes | 800–2,000 | 100–400 |
| **Total per reply request** | | **1,300–3,500** | **250–800** |

\* Memory is fetched from DB; LLM is only used when the worker rebuilds it (message distance ≥ 5). For a given reply, memory is typically already cached.

---

### B.9 Engagement Token Summary (Daily Active Inbox)

| Activity | Frequency | LLM Calls | Input (Est.) | Output (Est.) |
|----------|-----------|-----------|--------------|---------------|
| Response generation (per reply) | Per user "Suggest" | 1 | 800–2,000 | 100–400 |
| Conversation memory (rebuild) | Per thread, when distance ≥ 5 | 1 | 500–1,500 | 150–400 |
| Conversation triage | Per new/updated thread | 1 | 400–1,000 | 80–200 |
| Content ideas from insight | Per insight click | 1 | 400–800 | 150–400 |
| Chat moderation | Per chat message (Campaign Planner) | 1 | 200–400 | 30–80 |

**Example (10 replies/day, 3 memory rebuilds, 5 triages, 2 content-idea requests):**  
~10 × 1.4K + 3 × 1K + 5 × 0.7K + 2 × 0.6K ≈ **22K input, ~5K output** per org per day.

---

## Appendix B: Engagement Pipeline — Per-Activity Token Breakdown

Detailed token consumption for social engagement: inbox triage, conversation memory, AI-assisted replies (per response), creating insights, content ideas, and related flows. OmniVyra (external) is noted separately.

### B.1 Engagement Flow Overview

| Activity | LLM Source | Gateway / Path | Input (Est.) | Output (Est.) | Trigger |
|----------|------------|----------------|--------------|---------------|---------|
| **Per response (AI-assisted)** | OpenAI | aiGateway `responseGeneration` | 800–2,000 | 100–400 | Each "suggest reply" / auto-reply |
| **Conversation memory** | OpenAI | aiGateway `conversationMemorySummary` | 500–1,500 | 150–400 | Per thread when messages accumulate |
| **Conversation triage** | OpenAI | aiGateway `conversationTriage` | 400–1,000 | 80–200 | Per thread classification |
| **Creating insights (content ideas)** | OpenAI | aiGateway `generateContentIdeas` | 400–800 | 150–400 | Per insight "generate content ideas" |
| **Reply suggestions (OmniVyra)** | External API | `evaluateCommunityAiEngagement` | N/A | N/A | Per "get suggestions" when OmniVyra enabled |

### B.2 AI-Assisted Per Response

**Service:** `responseGenerationService.generateResponse`  
**API:** `POST /api/response/generate` or via `responseOrchestrator.orchestrateResponse`  
**Trigger:** User clicks "Suggest reply" on a message, or auto-reply flow.

| Step | Operation | Input Tokens | Output Tokens | Notes |
|------|-----------|--------------|---------------|-------|
| Load thread memory | `getThreadMemory` | 0 | 0 | Cached summary, no LLM |
| Build prompt | — | — | — | Template + brand voice + strategies + intelligence |
| **Generate reply** | `runCompletionWithOperation` (`responseGeneration`) | 800–2,000 | 100–400 | 1 call per reply request |

**Prompt includes:** brand voice, platform rules, conversation context (from memory), adaptive strategy guidance, high-performing reply styles, active opportunities, template structure.

| Scenario | Input Range | Output Range |
|----------|-------------|--------------|
| Short thread, minimal context | 800–1,200 | 100–250 |
| Long thread, rich context | 1,200–2,000 | 200–400 |

### B.3 Conversation Memory Summary

**Service:** `conversationMemoryService.updateThreadMemory` → `generateSummary`  
**Trigger:** Worker processes queue when new messages arrive; rebuilds only when message distance ≥ 5 or stale.

| Step | Operation | Input Tokens | Output Tokens | Per |
|------|-----------|--------------|---------------|-----|
| **Summarize conversation** | `runCompletionWithOperation` (`conversationMemorySummary`) | 500–1,500 | 150–400 | Per thread rebuild |

**Input:** Up to 10 messages × 300 chars each ≈ 500–1,500 tokens.  
**Output:** 3–5 sentence summary.

### B.4 Conversation Triage (Inbox Classification)

**Service:** `conversationTriageService.classifyThread`  
**Trigger:** When thread needs classification (inbox grouping, prioritization).

| Step | Operation | Input Tokens | Output Tokens | Per |
|------|-----------|--------------|---------------|-----|
| Load context | messages + memory + lead signals + opportunities | — | — | — |
| **Classify thread** | `runCompletionWithOperation` (`conversationTriage`) | 400–1,000 | 80–200 | 1 per thread |

**Output:** JSON with `classification_category`, `classification_confidence`, `sentiment`, `triage_priority`.

### B.5 Creating Insights — Content Ideas from Insight

**Service:** `insightContentService.generateContentIdeas`  
**API:** `POST /api/insight/content-ideas`  
**Trigger:** User selects a strategic insight and requests content ideas.

| Step | Operation | Input Tokens | Output Tokens | Per |
|------|-----------|--------------|---------------|-----|
| **Generate content ideas** | `runCompletionWithOperation` (`generateContentIdeas`) | 400–800 | 150–400 | 1 per insight |

**Input:** Insight title, summary, recommended_action, insight_type.  
**Output:** 4–6 content ideas (title, format, summary).

### B.6 What Does NOT Use LLM (Engagement)

| Component | Notes |
|-----------|-------|
| **Engagement digest** | `engagementDigestService.generateDailyDigest` — rule-based aggregation (counts, sorts) |
| **Engagement insight detection** | `engagementInsightService` — `detectBuyerIntent`, `detectConversationClusters`, `detectOpportunitySignals` — keyword / rule-based |
| **Reply suggestions (fallback)** | `engagementAiAssistantService` — when OmniVyra disabled, returns static templates |

### B.7 OmniVyra (External)

| Service | Path | LLM? | Notes |
|---------|------|------|-------|
| `evaluateCommunityAiEngagement` | `omnivyraClientV1` | External | OmniVyra API consumes its own tokens; not tracked in `usage_events` |
| `engagementAiAssistantService.generateReplySuggestions` | Calls OmniVyra when enabled | External | Suggested replies from external service |
| `communityAiOmnivyraService.evaluateEngagement` | Calls OmniVyra | External | Community AI analysis |
| `engagementConversationIntelligenceService` | Calls OmniVyra | External | Conversation intelligence |

**Note:** OmniVyra is a separate service; token consumption is outside this platform's usage ledger.

### B.8 Engagement Token Summary (Typical Day)

| Activity | Calls/Day (Est.) | Input Total | Output Total |
|----------|------------------|-------------|--------------|
| AI-assisted replies | 20–50 | 16–100K | 2–20K |
| Conversation memory (rebuilds) | 5–20 | 2.5–30K | 0.75–8K |
| Conversation triage | 10–30 | 4–30K | 0.8–6K |
| Content ideas from insight | 2–10 | 0.8–8K | 0.3–4K |
| **Total (OpenAI only)** | **~37–110** | **~24–168K** | **~4–38K** |

### B.9 Flow: Inbox Open → Suggest Reply → Send

| Step | LLM? | Operation | Tokens |
|------|------|-----------|--------|
| 1. Triage thread (if not cached) | Yes | `classifyThread` | 400–1K in, 80–200 out |
| 2. Memory summary (if stale) | Yes | `updateThreadMemory` | 500–1.5K in, 150–400 out |
| 3. User clicks "Suggest reply" | Yes | `generateResponse` | 800–2K in, 100–400 out |
| **Per reply suggestion** | | **Cumulative** | **~1.7–4.5K in, 330–1K out** |

---

## Appendix B: Engagement Pipeline — Per-Activity Token Breakdown

Detailed token consumption for engagement/inbox: creating insights, AI-assisted per response, triage, conversation memory, reply suggestions, etc.

### B.1 Engagement Flow Overview

| Activity | LLM Used? | Service / API | Input Tokens | Output Tokens | Trigger |
|----------|-----------|---------------|--------------|---------------|---------|
| **AI-assisted response** (per reply) | Yes | `responseGenerationService.generateResponse` | 800–2,000 | 100–400 | User clicks "Suggest Reply" or auto-reply eligible |
| **Reply suggestions** (AISuggestionPanel) | Yes* | `engagementAiAssistantService` → OmniVyra | External API | External API | When OmniVyra enabled; else static fallback |
| **Conversation triage** | Yes | `conversationTriageService.classifyThread` | 400–1,000 | 80–200 | Per thread classification (inbox grouping) |
| **Conversation memory** | Yes | `conversationMemoryService.updateThreadMemory` | 500–1,500 | 150–400 | Every 5+ new messages, or 24h stale |
| **Creating content from insights** | Yes | `insightContentService.generateContentIdeas` | 400–800 | 150–400 | Per insight → content ideas (post/article/video/thread) |
| **Engagement digest** | No | `engagementDigestService` | — | — | Rule-based aggregation; no LLM |
| **Engagement insights** (buyer intent, clusters) | No | `engagementInsightService` | — | — | Rule-based keyword/cluster detection; no LLM |

\* OmniVyra: external API; tokens not in platform `usage_events`. When disabled, fallback templates (no LLM).

---

### B.2 AI-Assisted Per Response

**Flow:** `response/generate` API or auto-reply → `responseOrchestrator.orchestrateResponse` → `responseGenerationService.generateResponse`

| Step | LLM? | Input Tokens | Output Tokens | Notes |
|------|------|--------------|---------------|-------|
| Resolve policy (template) | No | — | — | `responsePolicyEngine`, rules only |
| Get thread memory | No | — | — | Reads `engagement_thread_memory` |
| Generate reply | Yes | 800–2,000 | 100–400 | Template + context + strategies + reply intelligence + opportunities |

**Context included:** brand voice, platform rules, conversation summary, classification, high-performing strategies, reply intelligence, active opportunities.

**Per suggested reply:** 1 LLM call → ~900–2,400 total tokens.

---

### B.3 Reply Suggestions (AISuggestionPanel / AI Engagement Assistant)

| Path | LLM? | Service | Notes |
|------|------|---------|-------|
| OmniVyra **enabled** | Yes (external) | `evaluateCommunityAiEngagement` | External OmniVyra API; tokens not in our ledger |
| OmniVyra **disabled** | No | Static fallback | 4 canned reply templates |

**API:** `GET /api/engagement/suggestions` → `engagementAiAssistantService.generateReplySuggestions`

---

### B.4 Conversation Triage (Thread Classification)

**Flow:** Worker or on-demand → `conversationTriageService.classifyThread`

| Step | Input Tokens | Output Tokens | Per |
|------|--------------|---------------|-----|
| Load thread context (messages, memory, leads, opps) | — | — | No LLM |
| Classify thread | 400–1,000 | 80–200 | 1 call |

**Output:** `classification_category`, `classification_confidence`, `sentiment`, `triage_priority`.

---

### B.5 Conversation Memory Summary

**Flow:** `conversationMemoryWorker` or `updateThreadMemory` when message distance ≥ 5 or stale 24h.

| Step | Input Tokens | Output Tokens | Per |
|------|--------------|---------------|-----|
| Fetch last 10 messages | — | — | No LLM |
| Generate summary | 500–1,500 | 150–400 | 1 call |

**Output:** 3–5 sentence conversation summary stored in `engagement_thread_memory`.

---

### B.6 Creating Insights → Content Ideas

**Flow:** Strategic insight → `insightContentService.generateContentIdeas` → 4–6 content ideas (post, article, video, thread).

| Step | Input Tokens | Output Tokens | Per |
|------|--------------|---------------|-----|
| Generate content ideas | 400–800 | 150–400 | 1 call |

**API:** `pages/api/insight/content-ideas.ts` (or equivalent) when user requests "Generate content from this insight."

---

### B.7 No-LLM Engagement Activities

| Activity | Service | Notes |
|----------|---------|-------|
| Daily digest | `engagementDigestService` | Counts threads, leads, opportunities; deterministic |
| Buyer intent detection | `engagementInsightService.detectBuyerIntent` | Keyword-based |
| Conversation clusters | `engagementInsightService.detectConversationClusters` | Topic keyword grouping |
| Opportunity signals | `engagementInsightService.detectOpportunitySignals` | Rule-based |

---

### B.8 End-to-End: Replying to 1 Message (Full AI Path)

| Step | LLM? | Input | Output | Total Tokens (Est.) |
|------|------|-------|--------|---------------------|
| Thread memory (if rebuild needed) | Yes | 500–1,500 | 150–400 | 650–1,900 |
| Triage (if first classification) | Yes | 400–1,000 | 80–200 | 480–1,200 |
| Response generation | Yes | 800–2,000 | 100–400 | 900–2,400 |
| **Per reply (cold: memory + triage + gen)** | | | | **~2,030–5,500** |
| **Per reply (warm: gen only)** | | | | **~900–2,400** |

---

### B.9 Per-Day Estimate (Active Engagement Org)

| Activity | Frequency | LLM Calls | Est. Input | Est. Output |
|----------|-----------|-----------|------------|-------------|
| Triage (new threads) | 10–50/day | 10–50 | 4–50K | 0.8–10K |
| Memory summary (threads with 5+ new msgs) | 5–20/day | 5–20 | 2.5–30K | 0.75–8K |
| AI-assisted replies | 5–30/day | 5–30 | 4–60K | 0.5–12K |
| Insight → content ideas | 0–5/day | 0–5 | 0–4K | 0–2K |
| **Total (moderate org)** | | **~20–105** | **~10.5–144K** | **~2–32K** |

---

*Ranges are indicative; measure actual usage via `usage_events` / `logUsageEvent` for production planning.*

---

## Appendix B: Engagement Pipeline — Per-Stage Token Breakdown

Detailed token consumption for the engagement/inbox flow: AI-assisted per-response, conversation triage, memory summary, creating insights, reply suggestions, and digest. OmniVyra (external) is noted separately.

### B.1 Engagement Flow Overview

| Step | LLM Source | Trigger | Notes |
|------|-------------|---------|-------|
| Thread triage / classification | aiGateway | When thread needs classification | `conversationTriage` |
| Conversation memory summary | aiGateway | When thread memory rebuild (every 5+ new messages) | `conversationMemorySummary` |
| AI-assisted response (per reply) | aiGateway | User clicks "Generate reply" or auto-reply | `responseGeneration` |
| Reply suggestions (OmniVyra path) | External OmniVyra API | OmniVyra enabled; not OpenAI | Tokens external |
| Content ideas from insight | aiGateway | User requests content ideas from strategic insight | `generateContentIdeas` |
| Daily digest | **No LLM** | Cron / worker | Rule-based aggregation |
| Engagement insights (buyer intent, clusters) | **No LLM** | Worker / signal processing | Rule-based keyword matching |

---

### B.2 AI-Assisted Per Response

| Operation | Service / API | Input Tokens (Est.) | Output Tokens (Est.) | When |
|-----------|---------------|---------------------|----------------------|------|
| **Response generation** | `responseGenerationService.generateResponse` | 800–2,000 | 100–400 | Per "Generate reply" or auto-reply |
| **Upstream:** Thread memory | `getThreadMemory` | 0 | 0 | Cache read; if miss → conversation memory rebuild |
| **Upstream:** Policy resolution | `responsePolicyEngine`, `response_rules` | 0 | 0 | No LLM |
| **Orchestration** | `responseOrchestrator.orchestrateResponse` | — | — | Calls `generateResponse` |

**Flow:** `pages/api/response/generate` or `autoReplyService.attemptAutoReply` → `orchestrateResponse` → `generateResponse`.

**Per-response prompt includes:** Template structure, brand voice, platform rules, conversation context (from memory), top strategies, reply intelligence, opportunities. System ~400–600 tokens; user ~400–1,400 (original message + template + context).

---

### B.3 Conversation Triage (Thread Classification)

| Operation | Service | Input Tokens (Est.) | Output Tokens (Est.) | When |
|-----------|---------|---------------------|----------------------|------|
| **Classify thread** | `conversationTriageService.classifyThread` | 400–1,000 | 80–200 | Per thread needing classification |

**Input:** Messages (last 10, truncated 300 chars), conversation summary (memory), lead signals, opportunities.  
**Output:** `classification_category`, `classification_confidence`, `sentiment`, `triage_priority`.

---

### B.4 Conversation Memory Summary

| Operation | Service | Input Tokens (Est.) | Output Tokens (Est.) | When |
|-----------|---------|---------------------|----------------------|------|
| **Generate summary** | `conversationMemoryService.generateSummary` | 500–1,500 | 150–400 | When memory rebuild triggered (every 5+ new messages) |

**Trigger:** `updateThreadMemory` — skips if `last_processed_message_id` unchanged; rebuilds only when message distance ≥ 5.  
**Input:** Last 10 messages, 300 chars each.  
**Output:** 3–5 sentence summary.

---

### B.5 Creating Insights (Content Ideas from Strategic Insight)

| Operation | Service / API | Input Tokens (Est.) | Output Tokens (Est.) | When |
|-----------|---------------|---------------------|----------------------|------|
| **Generate content ideas** | `insightContentService.generateContentIdeas` | 400–800 | 150–400 | User requests from insight card |

**Triggered by:** `pages/api/insight/content-ideas.ts` — when user clicks "Generate content ideas" on a strategic insight.  
**Input:** Insight title, summary, recommended_action, insight_type.  
**Output:** 4–6 content ideas (title, format, summary) as JSON.

---

### B.6 Reply Suggestions (OmniVyra vs Fallback)

| Path | Source | LLM? | Notes |
|------|--------|------|-------|
| **OmniVyra enabled** | `omnivyraClientV1.evaluateCommunityAiEngagement` | External OmniVyra API | Tokens consumed by OmniVyra service, not OpenAI |
| **OmniVyra disabled** | `engagementAiAssistantService` | **No LLM** | Returns static fallback suggestions |

`engagementAiAssistantService.generateReplySuggestions` calls OmniVyra when `isOmniVyraEnabled()`. No direct OpenAI in engagement reply suggestions — either OmniVyra (external) or static fallback.

---

### B.7 Engagement Digest

| Operation | Service | LLM? | Notes |
|-----------|---------|------|-------|
| **Generate daily digest** | `engagementDigestService.generateDailyDigest` | **No** | DB queries + sorting; no LLM |

---

### B.8 Engagement Insight Service (Buyer Intent, Clusters)

| Operation | Service | LLM? | Notes |
|-----------|---------|------|-------|
| **detectBuyerIntent** | `engagementInsightService` | **No** | Keyword matching (price, demo, trial, etc.) |
| **detectConversationClusters** | `engagementInsightService` | **No** | Topic keyword grouping |
| **detectOpportunitySignals** | `engagementInsightService` | **No** | Rule-based |
| **storeInsightAsOpportunity** | `engagementInsightService` | **No** | DB insert |

---

### B.9 Engagement Conversation Intelligence (OmniVyra)

| Operation | Service | LLM? | Notes |
|-----------|---------|------|-------|
| **evaluateCommunityAiEngagement** | `engagementConversationIntelligenceService` | External OmniVyra | Used for deeper thread analysis when OmniVyra enabled |

---

### B.10 Engagement Token Summary (per typical inbox session)

| Action | LLM Calls | Input Range | Output Range |
|--------|------------|-------------|--------------|
| Triage 5 threads | 5 | 2–5K | 0.4–1K |
| Memory rebuild 2 threads | 2 | 1–3K | 0.3–0.8K |
| Generate 3 replies | 3 | 2.4–6K | 0.3–1.2K |
| Content ideas from 1 insight | 1 | 0.4–0.8K | 0.15–0.4K |
| **Typical session total** | **~11** | **~6–15K** | **~1.2–3.4K** |

---

### B.11 Chat Moderation (Engagement Context)

| Operation | When | Input (Est.) | Output (Est.) |
|------------|------|--------------|---------------|
| **moderateChatMessage** | Before any chat message send | 200–400 | 30–80 |

Used in campaign AI Chat, GPT chat, etc. — not engagement-specific but may run in engagement context if chat is embedded in inbox.

---

## Appendix B: Engagement Pipeline — Per-Activity Token Breakdown

Detailed token consumption for social engagement: AI-assisted per-response, creating insights, conversation triage, memory, digest, reply suggestions, and OmniVyra paths.

### B.1 Engagement LLM Flow Overview

| Activity | Service / API | LLM Path | Input (Est.) | Output (Est.) | Trigger |
|----------|---------------|----------|--------------|---------------|---------|
| **AI-assisted reply (per response)** | `responseGenerationService` | aiGateway `responseGeneration` | 800–2,000 | 100–400 | Each "Generate reply" / auto-reply |
| **Reply suggestions (inbox)** | `engagementAiAssistantService` | **OmniVyra** (external API) | N/A* | N/A* | "Suggestions" button when OmniVyra enabled |
| **Conversation memory** | `conversationMemoryService` | aiGateway `conversationMemorySummary` | 500–1,500 | 150–400 | Per thread, when messages accumulate (≥5 new) |
| **Conversation triage** | `conversationTriageService` | aiGateway `conversationTriage` | 400–1,000 | 80–200 | Per thread classification (inbox grouping) |
| **Insight → content ideas** | `insightContentService` | aiGateway `generateContentIdeas` | 400–800 | 150–400 | "Generate content ideas" from insight card |
| **Engagement digest** | `engagementDigestService` | **No LLM** | — | — | Daily worker (rule-based aggregation) |
| **Engagement insights (buyer/cluster)** | `engagementInsightService` | **No LLM** | — | — | Rule-based (keywords, topic clustering) |

\* OmniVyra is an external API; token cost is incurred on OmniVyra side, not logged in `usage_events`.

### B.2 AI-Assisted Per Response

**Flow:** `pages/api/response/generate.ts` or `pages/api/engagement/reply.ts` → `responseOrchestrator.orchestrateResponse` → `responseGenerationService.generateResponse`

| Step | LLM? | Service | Input (Est.) | Output (Est.) | When |
|------|------|---------|--------------|---------------|------|
| Resolve policy (template) | No | `responsePolicyEngine` | — | — | Rule-based |
| Generate reply text | Yes | `responseGenerationService` | 800–2,000 | 100–400 | Per message when user clicks "Generate" or auto-reply |
| Thread memory (context) | Yes (if needed) | `conversationMemoryService` | 500–1,500 | 150–400 | Fetched before response; may trigger summary rebuild |

**Prompt components (response generation):**
- Brand voice, tone, platform rules
- Conversation context (from `getThreadMemory` — summarized prior messages)
- Template structure (blocks from response policy)
- Adaptive strategy guidance (from `responseStrategyIntelligenceService`)
- High-performing reply styles (from `replyIntelligenceService`)
- Active opportunities (from `engagementOpportunityService`)
- Original message (up to 2K chars)

| Scenario | Input Range | Output Range |
|----------|-------------|--------------|
| Simple reply (short thread) | 800–1,200 | 100–250 |
| Complex reply (long thread, many strategies) | 1,500–2,000 | 250–400 |

### B.3 Reply Suggestions (OmniVyra Path)

**Flow:** `GET /api/engagement/suggestions` → `engagementAiAssistantService.generateReplySuggestions` → `omnivyraClientV1.evaluateCommunityAiEngagement`

| Step | LLM? | Where | Notes |
|------|------|-------|-------|
| Reply suggestions | External | OmniVyra API | `evaluateCommunityAiEngagement` — tokens on OmniVyra |
| Fallback (OmniVyra disabled) | No | Static templates | Returns 4 static suggestions |

**Not in our OpenAI usage:** Reply suggestions use OmniVyra when enabled; no direct aiGateway/OpenAI call from our codebase.

### B.4 Creating Insights (Content Ideas from Insight)

**Flow:** `pages/api/insight/content-ideas.ts` → `insightContentService.generateContentIdeas`

| Step | Service | Input (Est.) | Output (Est.) | When |
|------|---------|--------------|---------------|------|
| Generate content ideas | `insightContentService` | 400–800 | 150–400 | User clicks "Generate content ideas" on an insight card |

**Prompt:** Strategic insight (title, summary, recommended_action, insight_type) → 4–6 content ideas (post, article, video, thread) in JSON.

| Input size | Output |
|------------|--------|
| Short insight | 400–600 in, 150–250 out |
| Long insight + signals | 600–800 in, 250–400 out |

### B.5 Conversation Memory (Thread Summary)

**Flow:** Worker `conversationMemoryWorker` or on-demand → `conversationMemoryService.updateThreadMemory` → `generateSummary`

| Step | LLM? | Service | Input (Est.) | Output (Est.) | When |
|------|------|---------|--------------|---------------|------|
| Summarize last N messages | Yes | `conversationMemoryService` | 500–1,500 | 150–400 | When message distance ≥ 5 from last processed |

**Trigger logic:** Rebuild only when `latest_message_id != last_processed_message_id` AND message distance ≥ 5. Skips if memory is current.

| Thread length | Input (10 msgs × 300 chars) | Output |
|---------------|----------------------------|--------|
| Short | ~500–800 | 150–250 |
| Long | ~1,000–1,500 | 250–400 |

### B.6 Conversation Triage (Thread Classification)

**Flow:** Worker or on-demand → `conversationTriageService.classifyThread`

| Step | LLM? | Service | Input (Est.) | Output (Est.) | When |
|------|------|---------|--------------|---------------|------|
| Classify thread | Yes | `conversationTriageService` | 400–1,000 | 80–200 | Per thread for inbox grouping/priority |

**Output:** `classification_category`, `classification_confidence`, `sentiment`, `triage_priority` (JSON).

**Context passed:** Last 10 messages (300 chars each), conversation summary, lead signals, opportunities.

### B.7 Engagement Digest

**No LLM.** `engagementDigestService.generateDailyDigest` aggregates counts from DB (new threads, high priority, leads, opportunities) and sorts by triage/priority. Rule-based only.

### B.8 Engagement Insights (Buyer Intent, Clusters, Opportunities)

**No LLM.** `engagementInsightService` uses keyword matching (`BUYER_KEYWORDS`), topic clustering, and rule-based heuristics. No aiGateway or OpenAI calls.

### B.9 Engagement Conversation Intelligence (OmniVyra)

**Flow:** `engagementConversationIntelligenceService` → `evaluateCommunityAiEngagement` (OmniVyra)

External API; tokens not in our `usage_events`. Used for deeper analysis when OmniVyra is configured.

### B.10 Per-Response Token Summary (Typical Inbox Session)

| Action | LLM Calls | Input Total | Output Total |
|--------|-----------|-------------|--------------|
| View thread (triage if new) | 0–1 | 0–1K | 0–200 |
| Get thread memory (summary) | 0–1 | 0–1.5K | 0–400 |
| Generate 1 reply | 1 | 800–2K | 100–400 |
| Generate content ideas (1 insight) | 1 | 400–800 | 150–400 |
| **Typical: 1 triage + 1 memory + 3 replies** | **5** | **2.5–6K** | **0.5–2K** |

### B.11 Engagement vs Campaign Token Comparison

| Domain | Per-Unit | Frequency | Est. Daily (10 orgs, active inbox) |
|--------|----------|-----------|-----------------------------------|
| Engagement (response gen) | 800–2K in, 100–400 out | Per reply | 50–200 replies → 40–400K in, 5–80K out |
| Engagement (memory) | 500–1.5K in, 150–400 out | Per thread rebuild | 20–50 threads → 10–75K in, 3–20K out |
| Engagement (triage) | 400–1K in, 80–200 out | Per new thread | 30–60 threads → 12–60K in, 2.4–12K out |
| Insight content ideas | 400–800 in, 150–400 out | On demand | 5–20 → 2–16K in, 0.75–8K out |
