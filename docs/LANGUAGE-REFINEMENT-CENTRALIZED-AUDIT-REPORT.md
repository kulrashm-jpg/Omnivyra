# Language Refinement Centralized Audit Report

**Date:** 2025-03-07  
**Objective:** Determine whether the platform has a centralized enforcement mechanism for language refinement  
**Scope:** Audit only — no implementation changes

---

## 1 — Language Refinement Engine Summary

### File Location

`backend/services/languageRefinementService.ts`

### Functions Exposed

| Function | Signature | Purpose |
|----------|-----------|---------|
| `refineLanguageOutput` | `(input: LanguageRefinementInput) => Promise<LanguageRefinementOutput>` | Main entry point for language refinement |

**Type Definitions:**

```typescript
type LanguageRefinementInput = {
  content: string | string[];
  card_type: 'weekly_plan' | 'daily_slot' | 'master_content' | 'platform_variant' | 'repurpose_card' | 'strategic_theme' | 'general';
  campaign_tone?: CampaignTone | string;
  platform?: string;
};

type LanguageRefinementOutput = {
  refined: string | string[];
  metadata?: { applied: boolean; method: 'rule' | 'llm' };
};
```

### Capabilities

- **Batch support:** Yes — accepts `string | string[]` for content; arrays are refined element-wise
- **Structured content:** Yes — supports multiple `card_type` values for context-aware formatting (length caps, tone rules)
- **Tone bands:** `conversational` | `educational` | `professional` | `inspirational`
- **Rule-based:** Filler removal, tone transformation, card-type formatting, punctuation normalization
- **Idempotency:** Skips already-refined content (strips `REFINEMENT_MARKER`)
- **Feature flag:** Controlled by `LANGUAGE_REFINEMENT_ENABLED` env var — when `false` or unset, returns original content unchanged

### Internal Helpers (not exported)

`normalizeText`, `removeFillerPhrases`, `applyToneProfile`, `cardTypeFormatting`, `punctuationNormalization`, `runRefinementPipeline`, `refineSingleString`

---

## 2 — Codebase Usage Map

| File | Line | Context | Usage Type |
|------|------|---------|------------|
| `backend/services/languageRefinementService.ts` | 307 | Export definition | Service definition |
| `backend/services/strategicThemeEngine.ts` | 52, 105 | Theme title generation | AI output processing |
| `backend/services/campaignAiOrchestrator.ts` | 4678, 4686, 4694 | Weekly plan theme, primary_objective, topics_to_cover | Pipeline integration |
| `backend/services/contentGenerationPipeline.ts` | 1100–1121, 1272, 1454, 1546, 1748, 1961 | Blueprint hook/key_points/cta; master content; platform variants | Pipeline integration |
| `backend/services/contentGenerationService.ts` | 118, 173 | Content schema fields (headline, caption, hook, etc.) | AI output processing |
| `backend/services/dailyContentDistributionPlanService.ts` | 517, 521 | Slot short_topic, full_topic | AI output processing |
| `backend/services/companyProfileService.ts` | 2402 | Profile fields before AI prompts | Response wrapper (input refinement) |
| `pages/api/activity-workspace/content.ts` | 97, 205 | improve_variant, refine_variant output | AI output processing |
| `backend/tests/unit/languageRefinementService.test.ts` | Multiple | Unit tests | Test only |
| `backend/tests/unit/campaignStrategyMemoryService.test.ts` | 129 | Shape test | Test only |

---

## 3 — Central Enforcement Detection

### Findings

**No central enforcement layer exists.**

- **API response builders:** None found. No shared `responseBuilder`, `apiResponse`, or `res.json` wrapper that applies refinement.
- **Express middleware:** Project uses Next.js API routes (`pages/api/*`), not Express. No middleware layer enforces refinement.
- **AI orchestration layer:** `campaignAiOrchestrator` applies refinement at specific sites (weekly plan fields) before save. It does **not** wrap all AI output.
- **Content pipeline orchestrators:** `contentGenerationPipeline` applies refinement at multiple internal points (blueprint, master, variants) — service-level integration, not a global layer.
- **Base service classes:** No shared base class that enforces refinement.
- **Response transformers:** No global transformer applied to responses before `res.status(200).json(...)`.

### Conclusion

Refinement is enforced **per caller** at each AI output site. There is no single layer through which all user-visible content is forced.

---

## 4 — Content Systems Audit

| System | Service File | Endpoint | Refinement Applied? | Location |
|--------|--------------|----------|---------------------|----------|
| **Company Profile** | `companyProfileService.ts` | `GET/POST /api/company-profile` | Input only (refineProfileForPrompts) | Profile fields refined before AI prompts; display uses raw or refined based on `languageRefine` option |
| **Strategic Theme Cards** | `strategicThemeEngine.ts` | Via `getStrategicThemesAsOpportunities`, theme-preview | Yes | `generateThemeFromTopic`, `generateThemesForCampaignWeeks` |
| **Weekly Planning System** | `campaignAiOrchestrator.ts` | `runCampaignAiPlan`, save-strategy, regenerate-blueprint | Yes | theme, primary_objective, topics_to_cover before save |
| **Weekly Activity Cards** | `get-weekly-plans.ts` | `GET /api/campaigns/get-weekly-plans` | At save time | Content refined in orchestrator before DB; read returns stored content |
| **Daily Plan Generation** | `dailyContentDistributionPlanService.ts` | Via plan resolution | Yes | slot short_topic, full_topic |
| **Activity Workspace** | `activity-workspace/content.ts` | `POST /api/activity-workspace/content` | Partial | improve_variant, refine_variant: yes; generate_master, generate_variants: via pipeline (yes); ADD_DISCOVERABILITY: no text change (hashtags only) |
| **Repurposed Content** | `contentGenerationPipeline.ts` | Via buildPlatformVariantsFromMaster | Yes | All platform variants refined |
| **Content Blueprint** | `contentGenerationPipeline.ts` | Via pipeline hooks | Yes | hook, key_points, cta |
| **Content Generation (generate-day)** | `contentGenerationService.ts` | `POST /api/content/generate-day` | Yes | headline, caption, hook, cta, etc. |
| **Company Intelligence Dashboard** | `companyIntelligenceDashboardService.ts` | `GET /api/company/intelligence/signals` | No | topic, matched_topics, matched_competitors, matched_regions returned unrefined |
| **Theme Preview** | `themePreviewService.ts` | `GET /api/intelligence/theme-preview` | No | theme_title, theme_description, opportunity_title, opportunity_description from DB — refined at creation, read as stored |
| **AI generate-content** | `pages/api/ai/generate-content.ts` | `POST /api/ai/generate-content` | No | Demo/template content; not routed through refinement |
| **AI weekly-amendment** | `pages/api/ai/weekly-amendment.ts` | `POST /api/ai/weekly-amendment` | No | AI amendment returned directly |
| **Bolt Schedule Content** | `boltContentGenerationForSchedule.ts` | Via Bolt pipeline | Yes | Uses generateMasterContentFromIntent + buildPlatformVariantsFromMaster (both refine) |

---

## 5 — Refinement Bypass Risks

| File | Risk Type | Reason |
|------|-----------|--------|
| `companyIntelligenceDashboardService.ts` | Direct DB read returned to UI | `buildDashboardSignals` returns topic, matched_topics, matched_competitors, matched_regions without refinement |
| `themePreviewService.ts` | Direct DB read returned to UI | theme_title, theme_description, opportunity_title, opportunity_description from `strategic_themes`, `campaign_opportunities` — may be refined at creation but ingestion/other sources could insert unrefined text |
| `pages/api/ai/weekly-amendment.ts` | AI output returned directly | Amendment text from Claude passed through to UI without refinement |
| `pages/api/ai/generate-content.ts` | AI/content returned directly | Content pillars, weekly plan, etc. returned without refinement (currently demo/template; may change) |
| `pages/api/campaigns/retrieve-plan.ts` | Direct DB read returned to UI | Plan content from content_plans, ai_threads, twelve_week_plan returned as stored — refined at save; legacy or manual edits may be unrefined |
| `pages/api/campaigns/weekly-refinement.ts` | Direct DB read returned | weekly_content_refinements, content_plans, daily_content_plans returned without re-refinement on read |
| `pages/api/content/list.ts` | Direct DB read returned | Content assets from contentAssetStore — stored content; refinement at write depends on content source |
| `pages/api/intelligence/competitive.ts` | Direct return | competitive_signals returned — content not checked for refinement |
| `pages/api/intelligence/summary.ts` | Direct return | summary returned — content not checked for refinement |

---

## 6 — Enforcement Model Classification

### Classification: **MODEL B — Partially Centralized**

### Rationale

- **Not MODEL A (Fully Centralized):** There is no single middleware, wrapper, or orchestrator that guarantees refinement for all user-visible content.
- **Partially Centralized:** Refinement is applied at multiple service/pipeline sites in a consistent way for:
  - AI-generated content in `contentGenerationPipeline` (blueprint, master, variants)
  - Campaign planning in `campaignAiOrchestrator`
  - Strategic themes in `strategicThemeEngine`
  - Daily distribution in `dailyContentDistributionPlanService`
  - Activity workspace improve/refine flows in `pages/api/activity-workspace/content.ts`
- **Gaps:** Several systems bypass refinement:
  - Company Intelligence Dashboard (`companyIntelligenceDashboardService`)
  - Theme preview (reads from DB; depends on creation path)
  - AI weekly-amendment API
  - AI generate-content API (when used for real AI)
  - Direct DB reads for plans, content list, etc. (stored content; refinement at write only)

### Supporting File References

- **Integrated:** `contentGenerationPipeline.ts` (lines 1100–1121, 1272, 1454, 1546, 1748, 1961), `campaignAiOrchestrator.ts` (4678–4700), `strategicThemeEngine.ts` (52, 105), `dailyContentDistributionPlanService.ts` (517–522), `activity-workspace/content.ts` (97, 205)
- **Not integrated:** `companyIntelligenceDashboardService.ts` (no import of `refineLanguageOutput`), `themePreviewService.ts`, `pages/api/ai/weekly-amendment.ts`, `pages/api/ai/generate-content.ts`

---

## 7 — Implementation Recommendation

### Current State

Refinement is **service-level** — each producer of user-visible content must explicitly call `refineLanguageOutput()`. No global enforcement exists.

### Recommended Enforcement Layer (Lowest Risk)

**Option A: API Response Interceptor (Recommended)**

- Create a small wrapper around `res.status(200).json()` that:
  - Detects responses containing known content fields (`topic`, `theme`, `generated_content`, `refined_content`, `content`, `matched_topics`, etc.)
  - Recursively refines string values in those fields before sending
- **Pros:** Single point of enforcement; backward compatible; no changes to individual services
- **Cons:** Requires field whitelist/blacklist; may add latency; must handle nested structures

**Option B: Dashboard/Intelligence Service Integration**

- Add `refineLanguageOutput` in `companyIntelligenceDashboardService.buildDashboardSignals()` for `topic`, `matched_topics`, `matched_competitors`, `matched_regions`
- Add refinement in `themePreviewService.getThemePreview()` for theme_title, theme_description, opportunity_title, opportunity_description
- **Pros:** Targeted; minimal scope
- **Cons:** Does not fix weekly-amendment, generate-content, or future endpoints

**Option C: Shared "User-Facing Response" Helper**

- Create `refineUserFacingResponse(obj, options)` that walks an object and refines known content keys
- Require all API handlers that return user-visible content to call it before `res.json()`
- **Pros:** Explicit; no magic
- **Cons:** Must update every relevant endpoint; easy to miss new ones

### Suggested Approach

1. **Short term:** Implement **Option B** for Company Intelligence Dashboard and Theme Preview to close known gaps.
2. **Medium term:** Evaluate **Option A** for a global API response interceptor if more endpoints are identified as bypass risks.
3. **Documentation:** Add a convention (e.g., in project rules) that all new AI-output or user-visible text endpoints must either call `refineLanguageOutput` or use the shared response helper.

---

*End of audit report. No implementation changes have been made.*
