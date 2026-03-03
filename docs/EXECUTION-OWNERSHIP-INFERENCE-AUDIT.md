# Execution Ownership Inference Audit (No Schema Changes)

**Goal:** Detect if we can derive `execution_mode` (AI_AUTOMATED vs CREATOR_REQUIRED) using existing fields today.

---

## 1. Rules That Can Safely Infer Creator-Dependent Content

### Rule A — Content type (creator-dependent types)

**Logic:** If `content_type` (normalized to lowercase) is in a creator-dependent set, the slot typically requires human-produced media or creation. Two existing definitions:

| Source | Location | Set |
|--------|----------|-----|
| **Content pipeline** | `backend/services/contentGenerationPipeline.ts` line 146 | `MEDIA_DEPENDENT_TYPES`: `video`, `reel`, `short`, `carousel`, `slides`, `song` |
| **Platform execution plan** | `backend/services/platformIntelligenceService.ts` line 141 | `['video', 'audio', 'podcast'].includes(contentType)` → `placeholder: true` |

**Safe inference:** Treat as creator-dependent if `content_type` is one of: **video, reel, short, carousel, slides, song, audio, podcast**. (Union of both sets.)

**Edge case:** “Carousel” can be creator-dependent (design) or partially automated (text + templates). Still safe to treat as CREATOR_REQUIRED for “needs human input” semantics.

---

### Rule B — Platform rules (media_format)

**Logic:** Platform content rules define `media_format` per (platform, content_type). If `media_format` is `video` or `image` (not `text`), the format usually requires media/creator work.

**Where it exists:** `backend/services/platformIntelligenceService.ts`: `FALLBACK_CONTENT_RULES` (e.g. lines 274–311, 329–356): each rule has `media_format: 'text' | 'video' | 'image'`.

**Safe inference:** For a given `platform` + `content_type`, if the rule’s `media_format` is `video` or `image` → treat as creator-dependent (unless media is ready). No public helper exists today; callers use `getPlatformRules(platform)` and find the matching content rule, then read `media_format`.

---

### Rule C — ai_generated flag

**Logic:** `ai_generated` indicates how the **daily slot** was produced (AI distribution path vs blueprint execution_items path), not who must execute the content.

**Where it exists:** Set when writing rows in `pages/api/campaigns/generate-weekly-structure.ts` (e.g. line 980); stored on `daily_content_plans` and in content JSON. Not yet returned by daily-plans API or mapped to calendar (see WEEKLY-TO-DAILY-INFORMATION-LOSS-ANALYSIS).

**Safe inference:** **Do not** use `ai_generated` alone to infer CREATOR_REQUIRED vs AI_AUTOMATED. Use it only as context: e.g. “slot was AI-proposed” (true) vs “slot from blueprint” (false). Execution mode should be driven by content_type + media (Rules A, B, D, E).

---

### Rule D — Placeholder / “source: placeholder” logic

**Logic:** When the system explicitly marks a slot as “placeholder” or “source: placeholder”, it means “creator must fill this.”

**Where it exists:**

| Location | What it does |
|----------|----------------|
| `backend/services/platformIntelligenceService.ts` (lines 141–146) | In `buildPlatformExecutionPlan`, sets `placeholder: true` when `contentType` is video/audio/podcast; sets `reasoning: 'Requires manual production or media generation'`. |
| `backend/services/campaignRecommendationService.ts` (lines 509–520) | `pickContentType` returns `{ content_type, source: 'placeholder' }` when platform’s preferred type is not supported by `capabilities` (e.g. `can_generate_video` false). So “placeholder” = we can’t generate this; creator required. |
| `backend/services/campaignRecommendationService.ts` (lines 523–527) | `buildPlaceholderInstruction` builds text for video/audio/image placeholders. |

**Safe inference:** If an item or plan has `placeholder === true` or `source === 'placeholder'` → **CREATOR_REQUIRED**. Today this is set only in the two flows above (platform execution plan, recommendation daily plan), not on generic daily plan rows from generate-weekly-structure.

---

### Rule E — Media requirements and status

**Logic:** If the item has `required_media === true` and `media_status === 'missing'` (or media not ready), execution is blocked until media exists → effectively creator-dependent until then.

**Where it exists:**

| Location | What it does |
|----------|----------------|
| `backend/services/contentGenerationPipeline.ts` (lines 581–594, 831, 915–926, 1330–1334) | `isMediaDependentContentType(content_type)` → sets `required_media: true`, `media_status: 'missing'` for media types; readiness uses `media_ready` and `blocking_reasons.push('missing_required_media')`. |
| `backend/services/contentGenerationPipeline.ts` (line 740–743) | `isMediaDependentContentType(content_type)` exported; uses `MEDIA_DEPENDENT_TYPES`. |
| Calendar / readiness | `pages/campaign-calendar/[id].tsx` (lines 217–221): `readiness_label === 'missing_media'` when `blocking_reasons.includes('missing_required_media')`. |

**Safe inference:** If `required_media === true` and `media_status !== 'ready'` (or missing) → **CREATOR_REQUIRED** (or “blocked until media”). If `media_status === 'ready'` → can treat as **AI_AUTOMATED** for scheduling (content ready).

---

### Rule F — execution_readiness.blocking_reasons

**Logic:** If readiness contains `'missing_required_media'`, the item is blocked on media/creator.

**Where it exists:** `contentGenerationPipeline` builds `execution_readiness` with `blocking_reasons`; calendar and daily UIs consume it.

**Safe inference:** If `execution_readiness?.blocking_reasons` includes `'missing_required_media'` → **CREATOR_REQUIRED** (until media is provided).

---

## 2. Where Those Rules Already Exist in Code

| Rule | File(s) | Function / constant | Notes |
|------|---------|---------------------|--------|
| **A (content type set)** | `contentGenerationPipeline.ts` | `MEDIA_DEPENDENT_TYPES`, `isMediaDependentContentType()` | video, reel, short, carousel, slides, song |
| **A (placeholder by type)** | `platformIntelligenceService.ts` | `buildPlatformExecutionPlan()` inline | video, audio, podcast → placeholder |
| **B (media_format)** | `platformIntelligenceService.ts` | `FALLBACK_CONTENT_RULES[platform][]` | Per-rule `media_format`; no getter exported |
| **C (ai_generated)** | `generate-weekly-structure.ts`, DB `daily_content_plans` | Row and content JSON | Not in daily-plans API response yet |
| **D (placeholder flag)** | `platformIntelligenceService.ts`, `campaignRecommendationService.ts` | `buildPlatformExecutionPlan`, `pickContentType` | `placeholder` or `source: 'placeholder'` |
| **E (required_media / media_status)** | `contentGenerationPipeline.ts` | `buildVariantOnlyMasterFallback`, `generateMasterContentFromIntent`, readiness build | Sets and reads `required_media`, `media_status` |
| **F (blocking_reasons)** | `contentGenerationPipeline.ts` | Readiness computation | `missing_required_media` in blocking_reasons |

---

## 3. Best Single Place to Compute execution_mode (Reuse by All Surfaces)

**Recommended:** Add a small **inference helper** that takes an item-like shape and returns `AI_AUTOMATED | CREATOR_REQUIRED`, and call it from wherever we need a single label (calendar, daily list, activity card, API responses).

### Why a single place

- One definition of “creator-dependent” types and media rules.
- Calendar, daily plan API, activity workspace, and any new UI can all use the same result.
- No schema change: input is existing fields (`content_type`, `platform?`, `media_status?`, `required_media?`, `execution_readiness?`, optional `placeholder` / `source`).

### Recommended module and signature

**File:** `backend/services/executionModeInference.ts` (new).

**Input (minimal):**

```ts
export type ExecutionModeInput = {
  content_type: string;
  platform?: string;
  /** From content or item; if true, treat as creator-dependent. */
  placeholder?: boolean;
  /** From recommendation/campaignRecommendationService. */
  source?: 'existing' | 'new' | 'placeholder';
  required_media?: boolean;
  media_status?: 'missing' | 'ready';
  execution_readiness?: { blocking_reasons?: string[] };
};
```

**Output:** `'AI_AUTOMATED' | 'CREATOR_REQUIRED'`.

**Logic (order of evaluation):**

1. If `placeholder === true` or `source === 'placeholder'` → **CREATOR_REQUIRED**.
2. If `execution_readiness?.blocking_reasons` includes `'missing_required_media'` → **CREATOR_REQUIRED**.
3. If `required_media === true` and `media_status !== 'ready'` → **CREATOR_REQUIRED**.
4. If `media_status === 'ready'` → **AI_AUTOMATED** (content ready).
5. If `content_type` is in unified creator-dependent set (video, reel, short, carousel, slides, song, audio, podcast) → **CREATOR_REQUIRED**.
6. (Optional) If `platform` is provided, look up rule `media_format`; if `video` or `image` → **CREATOR_REQUIRED**.
7. Else → **AI_AUTOMATED**.

**Reuse of existing code:** The helper can call or mirror `isMediaDependentContentType` from `contentGenerationPipeline` (or re-export a unified set that adds `audio`, `podcast` to match platformIntelligenceService). It should **not** depend on `ai_generated` for the CREATOR_REQUIRED vs AI_AUTOMATED decision; `ai_generated` can remain separate (e.g. for “slot source” or analytics).

### Alternative: extend contentGenerationPipeline

**Alternative:** Add `inferExecutionMode(item)` in `backend/services/contentGenerationPipeline.ts` and export it. That file already has `isMediaDependentContentType`, `required_media`, and `media_status`. We could extend `MEDIA_DEPENDENT_TYPES` to include `audio`, `podcast` and add a short function that implements the same order of checks. Then calendar, daily-plans API, and activity workspace would call this function with the item or a thin view of it.

**Trade-off:** Keeping inference in a new `executionModeInference.ts` avoids pulling in the full pipeline for read-only UI/API; putting it in the pipeline keeps all “content + media” logic in one place. Either is a valid single place; the important part is one function, one contract, reused everywhere.

---

## Summary

| Question | Answer |
|----------|--------|
| **Can we infer execution_mode today without schema changes?** | Yes, from existing `content_type`, optional `platform`, `placeholder`/`source`, `required_media`, `media_status`, and `execution_readiness.blocking_reasons`. |
| **Rules that safely imply CREATOR_REQUIRED** | (1) Creator-dependent content_type (video, reel, short, carousel, slides, song, audio, podcast). (2) `placeholder === true` or `source === 'placeholder'`. (3) `required_media === true` and `media_status !== 'ready'`. (4) `blocking_reasons` includes `'missing_required_media'`. |
| **Where those rules live** | `contentGenerationPipeline.ts` (media-dependent types, required_media, media_status, readiness); `platformIntelligenceService.ts` (placeholder by type, media_format in rules); `campaignRecommendationService.ts` (source: placeholder). |
| **Best single place to compute execution_mode** | New `backend/services/executionModeInference.ts` (or an exported function in `contentGenerationPipeline.ts`) that takes an item-like object and returns `AI_AUTOMATED` \| `CREATOR_REQUIRED` using the order above, so all surfaces (calendar, daily, activity, API) can reuse it. |

---

**End of audit.**
