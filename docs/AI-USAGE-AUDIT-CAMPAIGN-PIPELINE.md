# AI Usage Audit: Campaign Generation Pipeline

**Objective:** Audit AI usage across the campaign generation pipeline and propose refinements to reduce token consumption, improve latency, and remove redundant calls without reducing output quality.

---

## 1. All AI Entry Points

### 1.1 Via aiGateway (Central Hub)

| Operation | File | Function / Call Site | Prompt Est. | Output Est. | Frequency per Campaign |
|-----------|------|----------------------|-------------|-------------|------------------------|
| **generateCampaignPlan** | `campaignAiOrchestrator.ts` | `runWithContext()` → `buildPromptContext()` | 8–15K tokens | 2–6K tokens | 1–3 (plan + repair + regeneration) |
| **generateCampaignPlan** | `contentGenerationPipeline.ts` | `generateMasterContentFromIntent()` | ~500 tokens | ~300 tokens | Per daily item (e.g. 5–7/week) |
| **generateCampaignPlan** | `contentGenerationPipeline.ts` | `generatePlatformVariantFromMaster()` → `requestVariant()` | ~600 tokens | ~200 tokens | 1–2 per platform per item |
| **generateCampaignPlan** | `contentGenerationPipeline.ts` | `optimizeDiscoverabilityForPlatform()` | ~400 tokens | ~150 tokens | 1 per platform (if DISCOVERABILITY_OPTIMIZER_AI=true) |
| **generateCampaignPlan** | `pages/api/activity-workspace/content.ts` | refine_variant, improve_variant actions | ~600 tokens | ~200 tokens | On-demand user actions |
| **generateDailyDistributionPlan** | `dailyContentDistributionPlanService.ts` | `generateDailyDistributionPlan()` | 3–5K tokens | ~800 tokens | Per week (e.g. 12 for 12-week) |
| **generateRecommendation** | `pages/api/recommendations/generate.ts` | opportunity analysis | ~1K tokens | ~200 tokens | 1 when manual opportunity |
| **generateRecommendation** | `pages/api/recommendations/group-preview.ts` | group preview | ~1.5K tokens | ~500 tokens | On-demand |
| **generateRecommendation** | `pages/api/recommendations/detected-opportunities.ts` | detected opportunity analysis | ~1.5K tokens | ~500 tokens | On-demand |
| **optimizeWeek** | `campaignOptimizationService.ts` | `optimizeWeekPlan()` | ~2K tokens | ~800 tokens | On-demand |
| **suggestDuration** | aiGateway | `suggestDurationForOpportunity`, `suggestDurationFromQuestionnaire` | ~800 tokens | ~150 tokens | 1–2 per opportunity/questionnaire |
| **generatePrePlanningExplanation** | aiGateway | pre-planning summary | ~200 tokens | ~100 tokens | 1 per pre-planning eval |
| **moderateChatMessage** | aiGateway | chat moderation | ~300 tokens | ~50 tokens | Per user message |

**Note:** Strategic theme generation (`strategicThemeEngine`) uses **no LLM** — template-based from signal clusters.

### 1.2 Direct OpenAI (Bypass aiGateway)

| File | Function | Prompt Est. | Output Est. | Frequency |
|------|----------|-------------|-------------|-----------|
| `contentGenerationService.ts` | `generateContentForDay()` | 2–4K tokens | ~500 tokens | Per day/platform (legacy path) |
| `contentGenerationService.ts` | `regenerateContent()` | ~800 tokens | ~400 tokens | On overlap detection / user request |
| `campaignPlanParser.ts` | `parseAiPlanToWeeks()` | ~3K tokens | ~1.5K tokens | 1 per plan parse |
| `campaignPlanParser.ts` | `parseAiRefinedDay()` | ~500 tokens | ~200 tokens | On refine_day mode |
| `campaignPlanParser.ts` | `parseAiPlatformCustomization()` | ~400 tokens | ~100 tokens | On platform_customize mode |
| `companyProfileService.ts` | `refineProblemTransformationAnswers()` | ~1K tokens | ~400 tokens | Per profile Q&A refinement |
| `companyProfileService.ts` | Other profile LLM calls | ~1–2K tokens | ~300 tokens | Various |
| `campaignRecommendationExtensionService.ts` | LLM call | ~800 tokens | ~300 tokens | On extension use |

### 1.3 Campaign Flow Summary (BOLT + Content Generation)

**Per 12-week campaign run:**
- ai/plan: 1–3 calls (generateCampaignPlan)
- parseAiPlanToWeeks: 1 call
- generate-weekly-structure: 12 calls (generateDailyDistributionPlan, one per week)
- Content generation (when triggered): ~5 items/week × 12 weeks = 60 master + 60–180 platform variants + optional discoverability

**Rough token estimate per full campaign:**
- Plan: 15K + 6K ≈ 21K
- Parse: 3K + 1.5K ≈ 4.5K
- Daily distribution: 12 × (4K + 0.8K) ≈ 58K
- Master content: 60 × 800 ≈ 48K
- Platform variants: 120 × 800 ≈ 96K
- **Total (approx.): 228K+ tokens per campaign**

---

## 2. Redundant Context in Prompts

### 2.1 Repeated Sections

| Context | Where Repeated | Recommendation |
|---------|----------------|-----------------|
| **Company profile** | campaignAiOrchestrator, generateRecommendation, contentGenerationService | Store in system prompt or cache by `company_id`; pass reference only |
| **Execution config** | buildPromptContext (execution_config block), prefilled planning | Move to structured fields; avoid re-stringifying |
| **Strategic themes** | prefilledBlock, ALREADY KNOWN, STRATEGIC THEMES | Single structured block; compress to list |
| **Platform capacity limits** | dailyContentDistributionPlanService SYSTEM_PROMPT | Static; move to system prompt or config |
| **Content distribution instructions** | buildUserPrompt (distributionInstruction + performanceMixSuffix) | Compress to directive + structured ratios |
| **Platform strategies** | campaignAiOrchestrator userPayload | Often same per company; cache by company |
| **Recommendation context** | Full context_payload in plan prompt | Strip low-signal keys; pass only strategic_themes, execution_config, duration |

### 2.2 Optimization: Static Instructions

- Move `PLATFORM CAPACITY LIMITS`, `CONTENT-TYPE DISTRIBUTION`, `CAMPAIGN LEARNING` rules into a **shared system prompt module** or **cached prefix**.
- Use **prompt caching** (OpenAI Prompt Caching or similar) for the fixed instruction block; only user payload changes.

---

## 3. Reduce Prompt Size

### 3.1 recommendationEngineService / generateRecommendation

- **Current:** Full company profile JSON, full opportunity JSON.
- **Change:** Pass `company_id`; use cached company summary (e.g. 200 chars) instead of full profile.
- **Savings:** ~1–2K tokens per call.

### 3.2 campaignAiOrchestrator buildPromptContext

- **Current:** Large `userPayload` with `snapshot`, `recommendation_context`, `prefilled_planning`, `plan_skeleton`, `weekly_strategy_intelligence`, `strategy_bias`, etc.
- **Change:**
  - Replace narrative blocks with structured fields: `campaign_duration`, `strategic_arc_type`, `content_type_ratios`, `eligible_platforms`, `platform_capacity_limits`.
  - Compress `EXECUTION CONFIG` to key-value pairs instead of prose.
  - Limit `recommendation_context` to: `strategic_themes`, `campaign_duration_weeks`, `company_high_performing_platforms` (top 3).
- **Savings:** ~3–5K tokens per plan call.

### 3.3 dailyContentDistributionPlanService

- **Current:** ~3K token system prompt + user JSON with `distribution_instruction` (includes platform rules, performance guidance).
- **Change:**
  - Trim system prompt: remove redundant "CRITICAL" restatements; keep rules once.
  - Pass `content_type_ratios` and `eligible_platforms` as structured fields; drop long prose.
- **Savings:** ~1K tokens per week.

### 3.4 contentGenerationPipeline

- **Master content:** `contextPayload` is already structured; keep.
- **Platform variant:** `buildUserPrompt` re-sends `master_content` + `writer_content_brief` + `intent` + `discoverability_meta`. Consider: pass only `master_content` + `platform` + `max_length` + `style_hint` (one line).
- **Savings:** ~200 tokens per variant.

---

## 4. Structured Prompt Inputs

### 4.1 Recommended Structured Fields

Replace narrative blocks with:

```json
{
  "campaign_duration": 12,
  "strategic_arc_type": "full",
  "content_type_ratios": { "post": "55%", "blog": "22%", "article": "12%", "story": "11%" },
  "eligible_platforms": ["linkedin", "x", "instagram"],
  "platform_capacity_limits": { "linkedin": 1, "x": 3 },
  "strategic_themes": ["Theme A", "Theme B"],
  "high_performing_platforms": ["linkedin"],
  "week_number": 3,
  "posts_per_week": 5
}
```

### 4.2 Implementation

- Add `StructuredPlanInput` type in campaignAiOrchestrator.
- Update `buildPromptContext` to emit structured JSON for the "known config" block; instruct model to use it directly.
- In daily distribution: pass `content_type_ratios` (from `getAdjustedContentTypeRatios`) as object, not embedded in text.

---

## 5. Prompt Caching

### 5.1 Cache Keys

| Key | Reuse Scope |
|-----|-------------|
| `company:{company_id}:profile_summary` | Company summary for all company-scoped calls |
| `company:{company_id}:platform_strategies` | Platform rules (rarely change) |
| `campaign:{campaign_id}:execution_config` | Execution config during planning |
| `company:{company_id}:strategic_themes` | When themes unchanged |
| `system:distribution_planner` | Static system prompt for daily distribution |

### 5.2 Strategy

- Use **hash of static content** (e.g. system prompt + platform limits) as cache key.
- Store in Redis or similar with TTL; on hit, send only `messages[].content` = cached ID or minimal delta.
- **OpenAI Prompt Caching:** If available, mark long static system prompt as cacheable.

---

## 6. Reduce Variant Generation Tokens

### 6.1 Current Flow

- Master content → full AI rewrite per platform (`requestVariant`) → `refineLanguageOutput` → optional second AI call if content too short.

### 6.2 Optimizations

1. **Shorter master content**
   - Cap master at 400–600 chars for social posts.
   - Only use long-form master for blog/article.

2. **Deterministic adaptation first**
   - Apply `applyAlgorithmicFormatting` (platform layout, CTA placement) **before** AI.
   - Use AI only for **tone/length adaptation** when platform style differs significantly.
   - For similar platforms (e.g. Facebook/Instagram): derive one from the other via template (e.g. truncate, add hashtags) — **no AI**.

3. **Single AI call for variants**
   - One prompt: "Adapt this master to [platform1], [platform2], [platform3]. Return JSON: { platform1: string, platform2: string, platform3: string }."
   - **Savings:** 2–3 calls → 1 call per item.

4. **Avoid full regeneration for minor changes**
   - If user edits one platform variant, re-adapt only that platform from master; do not regenerate all.

---

## 7. Content Generation Pipeline Optimizations

### 7.1 Master Content

- **Shorter prompts:** Pass only essential fields: `topic`, `objective`, `tone`, `key_points` (max 5).
- **Limit output:** Instruct "Output 2–4 sentences (under 400 chars) for social; expand only if content_type is blog/article."

### 7.2 Platform Variants

- **Hierarchy:** Generate LinkedIn (canonical) first; then deterministic adaptations for X (truncate + punchy), Instagram (add hook + hashtags). Use AI only for YouTube, TikTok if needed.
- **Shared components:** Extract CTA, hook, hashtags once; reuse across variants with platform-specific formatting.

### 7.3 Discoverability

- **Default to deterministic:** `buildDeterministicDiscoverabilityMeta` already exists. Use it unless `DISCOVERABILITY_OPTIMIZER_AI=true`.
- **Batch discoverability:** If AI enabled, one call per (master_content, platform) with multiple content types in one request.

---

## 8. Batch AI Calls

### 8.1 Opportunities

| Call | Batching Strategy |
|------|-------------------|
| **Daily distribution** | One call: "Generate distribution for weeks 1–4" with week context; return `{ week_1: [], week_2: [], ... }`. Reduces 4 calls → 1. |
| **Master content** | Batch 3–5 items per request: "Generate master content for these 5 items. Return JSON array." |
| **Platform variants** | As above: one call per item for all platforms. |
| **Theme suggestions** | Not applicable (no AI for theme generation). |

### 8.2 Implementation Notes

- Batch sizes: 3–5 to balance latency vs token efficiency.
- Fallback: if batch fails, retry individually.

---

## 9. AI Call Metrics

### 9.1 Current State

- `logUsageEvent` in aiGateway records: `input_tokens`, `output_tokens`, `latency_ms`, `model_name`, `process_type`.
- `audit_logs` table receives `AI_GATEWAY_CALL` with `token_usage`, `reasoning_trace_id`.

### 9.2 Gaps

- **contentGenerationService** (direct OpenAI): No usage logging.
- **campaignPlanParser** (direct OpenAI): No usage logging.
- **companyProfileService** (direct OpenAI): No usage logging.
- **Per-campaign aggregation:** No `campaign_id` on several paths.

### 9.3 Recommendations

1. **Route all LLM calls through aiGateway** (or a thin wrapper that logs before delegating).
2. **Ensure every call logs:** `tokens_input`, `tokens_output`, `latency_ms`, `model_used`, `operation`, `campaign_id` (when applicable), `company_id`.
3. **Add dashboard/metrics** for: tokens per campaign, tokens per operation type, p95 latency.
4. **Expose in API** (e.g. `/api/campaigns/[id]/ai-usage`) for cost attribution.

---

## 10. Optimization Summary

### 10.1 Estimated Token Savings Per Campaign

| Optimization | Estimated Savings |
|--------------|-------------------|
| Compress campaign plan prompt (structured inputs) | 3–5K per plan (×1–3) = **~12K** |
| Compress daily distribution prompt | 1K × 12 = **~12K** |
| Batch daily distribution (4 weeks per call) | 12 → 3 calls; save ~9 × 4K ≈ **36K** |
| Shorter master content + single variant call per item | ~50K (master) + ~60K (variants) = **~110K** |
| Deterministic platform derivation (LinkedIn→X, FB→IG) | **~30K** (fewer variant calls) |
| Cache static system prompts | **~20K** (amortized) |
| Remove redundant context in recommendations | **~2K** per opportunity |
| **Total potential savings** | **~220K+ tokens per campaign** (~50% reduction) |

### 10.2 Estimated Latency Reduction

- **Batching daily distribution:** 12 sequential → 3 sequential: **~60–80%** faster for that stage.
- **Single variant call per item:** 2–3 × faster for content generation stage.
- **Cache hits:** Near-instant for repeated company/context.
- **Shorter prompts:** 10–20% faster per call (smaller context).

### 10.3 Recommended Architectural Changes

1. **Centralize LLM access** — All calls via aiGateway (or wrapper) for consistent logging and caching.
2. **Structured inputs** — Replace narrative blocks with `campaign_duration`, `strategic_arc_type`, `content_type_ratios`, `eligible_platforms` in plan and distribution prompts.
3. **Batch daily distribution** — Generate 4 weeks per call; parse and split server-side.
4. **Deterministic-first variants** — Algorithmic adaptation for similar platforms; AI only when necessary.
5. **Prompt cache** — Cache static system prompts and company-summary blocks by hash.
6. **Metrics dashboard** — Per-campaign and per-operation token/latency visibility.

### 10.4 Implementation Priority

| Priority | Change | Effort | Impact |
|----------|--------|--------|--------|
| P0 | Route contentGenerationService, campaignPlanParser through aiGateway | Medium | Metrics + consistency |
| P0 | Compress buildPromptContext (structured inputs) | Medium | High token savings |
| P1 | Batch daily distribution (4 weeks/call) | Medium | High latency + token savings |
| P1 | Shorter master + single variant call per item | Medium | High token savings |
| P2 | Deterministic platform derivation | Low | Moderate savings |
| P2 | Prompt caching (Redis/OpenAI) | Medium | Amortized savings |
| P3 | Batch master content generation | Medium | Moderate savings |

---

## Appendix: Files Touched

| File | Changes |
|------|---------|
| `backend/services/aiGateway.ts` | Add campaign_id to all; optional prompt cache |
| `backend/services/campaignAiOrchestrator.ts` | Structured inputs; compress buildPromptContext |
| `backend/services/dailyContentDistributionPlanService.ts` | Batch by 4 weeks; compress prompt |
| `backend/services/contentGenerationPipeline.ts` | Shorter master; single variant call; deterministic path |
| `backend/services/contentGenerationService.ts` | Route via aiGateway |
| `backend/services/campaignPlanParser.ts` | Route via aiGateway |
| `backend/services/companyProfileService.ts` | Route via aiGateway (or add logging) |
