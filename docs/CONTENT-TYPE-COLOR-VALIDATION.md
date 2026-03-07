# Content Type & Color Validation Analysis

This document summarizes the validation analysis performed after the Weekly → Daily → Activity → Calendar pipeline audit. It provides a complete content type inventory, execution classification, color collision report, and recommendations.

---

## 1. Complete Content Type List

Deduplicated list of every **content_type** value found across the codebase (backend, pages, components, utils, database, lib):

| content_type   | Source(s) |
|---------------|------------|
| post          | DB CHECK (linkedin, facebook), DailyPlanningInterface, platform-guidelines, tests, activity-workspace, unifiedExecutionAdapter default |
| article       | DB CHECK (linkedin), platform-guidelines, formatLineForContentType, getActivityColorClasses, executionModeInference, campaign-learnings |
| blog          | platformRulesService, formatLineForContentType, getActivityColorClasses, executionModeInference |
| video         | DB CHECK (linkedin, twitter, instagram, youtube, facebook), platform-guidelines, executionModeInference, tests, calendar-view |
| carousel      | formatLineForContentType, getActivityColorClasses, executionModeInference (CONDITIONAL_AI) |
| image         | platformRulesService (instagram), getActivityColorClasses, formatLineForContentType, campaign-learnings |
| photo         | getActivityColorClasses, formatLineForContentType (treated like image) |
| story         | DB CHECK (instagram, facebook), platform-guidelines, getActivityColorClasses, executionModeInference |
| thread        | DB CHECK (twitter), platform-guidelines, formatLineForContentType, getActivityColorClasses, executionModeInference, tests |
| reel          | DB CHECK (instagram), platform-guidelines, executionModeInference, tests |
| short         | DB CHECK (youtube), platform-guidelines, executionModeInference, tests |
| igtv          | DB CHECK (instagram), platform-guidelines |
| feed_post     | DB CHECK (instagram), DailyPlanningInterface, calendar-view, platform-guidelines |
| tweet         | DB CHECK (twitter), platform-guidelines, executionModeInference, calendar-view |
| audio_event   | DB CHECK (linkedin) |
| live          | DB CHECK (youtube), DailyPlanningInterface (tiktok), platform-guidelines |
| event         | DB CHECK (facebook), DailyPlanningInterface |
| audio         | platformRulesService (podcast), platform-guidelines (linkedin), executionModeInference, comprehensive-schema |
| text          | platformRulesService (linkedin, x), executionModeInference (AI_AUTOMATED), tests |
| podcast       | executionModeInference (CREATOR_REQUIRED), formatLineForContentType |
| song          | executionModeInference (CREATOR_REQUIRED), formatLineForContentType |
| newsletter    | formatLineForContentType (WORD_BASED_TYPES) |
| whitepaper    | formatLineForContentType (WORD_BASED_TYPES) |
| webinar       | formatLineForContentType |
| slides        | executionModeInference (CONDITIONAL_AI), formatLineForContentType |
| slide         | executionModeInference |
| slideware     | executionModeInference |
| infographic   | executionModeInference (CONDITIONAL_AI) |
| deck          | executionModeInference (CONDITIONAL_AI) |
| presentation  | executionModeInference (CONDITIONAL_AI) |
| space         | formatLineForContentType (Space · Platform: twitter) |

**Deduplicated canonical list (normalized lowercase):**

- post  
- blog  
- article  
- video  
- carousel  
- image  
- photo  
- story  
- thread  
- reel  
- short  
- igtv  
- feed_post  
- tweet  
- audio_event  
- live  
- event  
- audio  
- text  
- podcast  
- song  
- newsletter  
- whitepaper  
- webinar  
- slides  
- slide  
- slideware  
- infographic  
- deck  
- presentation  
- space  

---

## 2. Execution Classification Table

Based on **`backend/services/executionModeInference.ts`** (CREATOR_TYPES, CONDITIONAL_TYPES, AI_AUTOMATED_TYPES) and fallback `includes()` logic. Unknown types default to `AI_AUTOMATED`.

| content_type   | default_execution_mode | reasoning |
|----------------|------------------------|-----------|
| post           | AI_AUTOMATED           | Text; AI can generate copy. |
| blog           | AI_AUTOMATED           | Long-form text. |
| article        | AI_AUTOMATED           | Long-form text. |
| thread         | AI_AUTOMATED           | Multi-tweet text. |
| story          | AI_AUTOMATED           | In inference: text-like; UI often treats as visual—see note below. |
| tweet          | AI_AUTOMATED           | Short text. |
| text           | AI_AUTOMATED           | Explicit in AI_AUTOMATED_TYPES. |
| newsletter     | AI_AUTOMATED           | Word-based in formatLine; not in CREATOR/CONDITIONAL → default. |
| whitepaper     | AI_AUTOMATED           | Word-based; default. |
| video          | CREATOR_REQUIRED       | CREATOR_TYPES; needs media. |
| reel           | CREATOR_REQUIRED       | CREATOR_TYPES. |
| short          | CREATOR_REQUIRED       | CREATOR_TYPES. |
| audio          | CREATOR_REQUIRED       | CREATOR_TYPES. |
| podcast        | CREATOR_REQUIRED       | CREATOR_TYPES. |
| song           | CREATOR_REQUIRED       | CREATOR_TYPES. |
| igtv           | CREATOR_REQUIRED       | video-like; inferred via includes. |
| live           | CREATOR_REQUIRED       | video/streaming; inferred. |
| image          | CONDITIONAL_AI or unclassified | Not in executionModeInference sets; falls through. In platform rules as “image”; could be CONDITIONAL (template) or CREATOR. |
| photo          | (same as image)        | Treated like image in formatLine/getActivityColorClasses. |
| carousel       | CONDITIONAL_AI         | CONDITIONAL_TYPES; template can unlock AI. |
| slides         | CONDITIONAL_AI         | CONDITIONAL_TYPES. |
| slide / slideware / deck / presentation | CONDITIONAL_AI | CONDITIONAL_TYPES. |
| infographic    | CONDITIONAL_AI         | CONDITIONAL_TYPES. |
| feed_post      | CONDITIONAL_AI or CREATOR | Often image/video; not in inference sets → default AI_AUTOMATED unless we extend. |
| tweet          | AI_AUTOMATED           | In AI_AUTOMATED_TYPES. |
| event          | CONDITIONAL_AI         | Ambiguous; default. |
| audio_event    | CREATOR_REQUIRED       | audio-like. |
| space          | AI_AUTOMATED           | Text/live audio; default. |
| webinar        | CONDITIONAL_AI         | Ambiguous; default. |

**Note:** `story` is classified as AI_AUTOMATED in code (text-like) but in DB/UI is often Instagram/Facebook story (visual). Consider splitting or clarifying.

---

## 3. Color Collision Report

Same color used for **two different meanings**:

| color   | meaning_1              | meaning_2              | file locations |
|--------|-------------------------|-------------------------|------------------|
| amber  | CREATOR_REQUIRED (execution mode) | story/thread (content type) | `utils/getExecutionModeColorClasses.ts` (CREATOR_REQUIRED) vs `pages/campaign-details/[id].tsx` getActivityColorClasses (story, thread) |
| amber  | Execution pressure MEDIUM        | (same as above)        | `utils/getExecutionIntelligence.ts` (pressure MEDIUM) vs campaign-details (content type) |
| amber  | Approval status: pending / request_changes | (same as above)        | `components/activity-board/ActivityCard.tsx` APPROVAL_PILL_CLASSES |
| emerald/green | AI pressure LOW / readiness “ready” | Content type default (post) | `utils/getExecutionIntelligence.ts` (pressure LOW), calendar readiness, ActivityCard approval “approved” vs `pages/campaign-details/[id].tsx` getActivityColorClasses (default) |
| red    | Execution pressure HIGH | Content type: video/reel/short | `utils/getExecutionIntelligence.ts` (pressure HIGH) vs `pages/campaign-details/[id].tsx` getActivityColorClasses (video) |

**Summary:** Amber is overloaded (execution mode, content type, pressure, approval). Emerald/green and red are shared between status/readiness and content-type fallback. No collision for indigo, violet, sky, fuchsia, blue.

---

## 4. Unified Color System Proposal

Single rule system to avoid collisions and keep semantics clear:

**Execution mode (border only)**  
Use one accent per mode; badge/background reserved for content type and status.

| Execution mode   | Border color | Tailwind (border) |
|------------------|-------------|--------------------|
| AI_AUTOMATED     | Indigo      | border-l-indigo-400 |
| CREATOR_REQUIRED | Orange      | border-l-orange-400 (distinct from amber content-type) |
| CONDITIONAL_AI   | Violet      | border-l-violet-400 |

**Content type (badge only)**  
Consistent badge colors; no reuse of execution-mode colors (avoid amber for both creator and story/thread).

| Content type (family)     | Badge color | Tailwind (badge) |
|--------------------------|-------------|-------------------|
| post, text, newsletter   | Green      | bg-emerald-100 text-emerald-700 border-emerald-200 |
| blog, article, whitepaper| Blue       | bg-blue-100 text-blue-700 border-blue-200 |
| thread, story (text)     | Amber      | bg-amber-100 text-amber-700 border-amber-200 |
| video, reel, short, igtv, live | Red    | bg-red-100 text-red-700 border-red-200 |
| carousel                  | Pink/Fuchsia | bg-fuchsia-100 text-fuchsia-700 border-fuchsia-200 |
| image, photo             | Sky        | bg-sky-100 text-sky-700 border-sky-200 |
| audio, podcast, song      | Slate      | bg-slate-100 text-slate-700 border-slate-200 |
| slides, deck, infographic, webinar | Violet (content) | bg-violet-100 text-violet-700 border-violet-200 |
| tweet, feed_post, event  | Gray       | bg-gray-100 text-gray-700 border-gray-200 |
| default / unknown        | Emerald    | bg-emerald-100 text-emerald-700 border-emerald-200 |

**Status (background only)**  
Reserved for activity/readiness/approval state.

| Status        | Background color | Tailwind |
|---------------|------------------|----------|
| Pending       | Gray             | bg-gray-50 |
| In progress   | Yellow           | bg-yellow-50 |
| Finalized     | Green            | bg-emerald-50 |
| Scheduled     | Purple           | bg-purple-50 |

Rule: **Border = execution mode, Badge = content type, Background = status.** No dual use of the same color for two of these dimensions.

---

## 5. Weekly Card Execution Mode Validation

**Where execution_mode can be undefined**

- **Topic/slot level:** Legacy or pre-enrichment data where `execution_items[].topic_slots[].execution_mode` was never set.
- **Resolved postings:** Built in `campaignAiOrchestrator.ts` with `(slot as any)?.execution_mode ?? inferExecutionMode(validated.content_type)`, so every resolved posting gets an execution_mode (either from slot or inferred).
- **Weekly card UI:** `execMode = topic?.topicExecution?.execution_mode ?? (topic as any)?.execution_mode ?? 'AI_AUTOMATED'`, so the UI **always** has a defined execution mode (default `AI_AUTOMATED`).

**Components that rely on fallback logic**

- **`pages/campaign-details/[id].tsx`** (weekly topic cards):  
  `cardClass = modeColors ? modeColors.card : getActivityColorClasses(topic?.topicExecution?.contentType).card`.  
  Because `execMode` is defaulted to `'AI_AUTOMATED'`, `getExecutionIntelligence(execMode)` always returns non-null `colorClasses`, so `modeColors` is always set. The **content-type fallback is effectively dead**: it would only run if execution-mode colors were null for the defaulted mode, which they are not.

**How often execution_mode is missing**

- **At display time:** Never in the weekly card (default hides missing).
- **At data source:** Only for legacy or malformed slots before they are run through resolution; after `attachResolvedPostingsToWeeks` / enrichment, every item has execution_mode.

**Conclusion:** Weekly cards always show execution-mode colors (with default AI_AUTOMATED). Content-type colors in `getActivityColorClasses` are not currently used for weekly topic cards; they would only matter if we stopped defaulting or showed content-type instead of execution mode.

---

## 6. Future Content Type Risk Analysis

If we add new content types (e.g. **podcast**, **newsletter**, **whitepaper**, **infographic**, **case_study**):

| Risk | What happens today | Mitigation |
|------|--------------------|------------|
| **Break** | Unlikely. Most code uses `content_type` as string; no strict enum. DB CHECK constraints may reject values not in the platform list. | Add new types to DB CHECK where applicable; keep backend/UI string-based or migrate to shared taxonomy. |
| **Default to "post"** | Yes. `unifiedExecutionAdapter` and many APIs use `normalizeContentType` or `content_type ?? 'post'`. New types are preserved if passed through; if missing, they become `'post'`. | Central taxonomy with a single default (e.g. `'post'`) and explicit list of known types. |
| **Lose color** | Yes. `getActivityColorClasses` only handles: video/reel/short, image/photo, carousel, blog/article, story/thread, and default. New types (podcast, newsletter, whitepaper, infographic, case_study) get the **default emerald** and are not distinguished. | Use a central taxonomy that assigns a badge color (or family) to every known type; unknown → default. |
| **Lose execution classification** | Partially. `executionModeInference` uses Sets and `includes()`; podcast/song are CREATOR, newsletter/whitepaper fall through to AI_AUTOMATED, infographic is CONDITIONAL_AI. **case_study** is unknown → AI_AUTOMATED. So classification is preserved for types that match existing rules; new shapes may misclassify. | Add new types to the appropriate Set (or to a central taxonomy with execution_mode) and add tests. |

**Summary:** New types do not break the app but can default to post, share the default color, and get a generic execution mode unless we add them to a single taxonomy (and optionally DB CHECKs).

---

## 7. Proposed Central Taxonomy File

**File:** `utils/contentTaxonomy.ts`

**Goals:** Single source of truth for content type → execution mode and badge color; safe for unknown types; no color/meaning collision with execution mode or status.

**Recommended structure:**

```ts
// utils/contentTaxonomy.ts

export type ExecutionMode = 'AI_AUTOMATED' | 'CREATOR_REQUIRED' | 'CONDITIONAL_AI';

export interface ContentTypeMeta {
  /** Default execution mode when not overridden at slot level */
  execution: ExecutionMode;
  /** Badge color family (Tailwind base name, no shade) */
  badgeColor: 'emerald' | 'blue' | 'amber' | 'red' | 'fuchsia' | 'sky' | 'slate' | 'violet' | 'gray';
  /** Optional display label */
  label?: string;
}

/** Normalize for lookup: lowercase, trim, replace separators */
function normalizeKey(raw: string): string {
  return String(raw ?? '').trim().toLowerCase().replace(/[\s_\-]+/g, '');
}

export const CONTENT_TAXONOMY: Record<string, ContentTypeMeta> = {
  post:       { execution: 'AI_AUTOMATED',  badgeColor: 'emerald', label: 'Post' },
  text:       { execution: 'AI_AUTOMATED',  badgeColor: 'emerald', label: 'Text' },
  blog:       { execution: 'AI_AUTOMATED',  badgeColor: 'blue',    label: 'Blog' },
  article:    { execution: 'AI_AUTOMATED',  badgeColor: 'blue',    label: 'Article' },
  newsletter: { execution: 'AI_AUTOMATED',  badgeColor: 'emerald', label: 'Newsletter' },
  whitepaper: { execution: 'AI_AUTOMATED',  badgeColor: 'blue',   label: 'Whitepaper' },
  thread:     { execution: 'AI_AUTOMATED',  badgeColor: 'amber',   label: 'Thread' },
  story:      { execution: 'AI_AUTOMATED',  badgeColor: 'amber',   label: 'Story' },
  tweet:      { execution: 'AI_AUTOMATED',  badgeColor: 'gray',    label: 'Tweet' },
  space:      { execution: 'AI_AUTOMATED',  badgeColor: 'gray',    label: 'Space' },

  video:      { execution: 'CREATOR_REQUIRED', badgeColor: 'red',    label: 'Video' },
  reel:       { execution: 'CREATOR_REQUIRED', badgeColor: 'red',    label: 'Reel' },
  short:      { execution: 'CREATOR_REQUIRED', badgeColor: 'red',   label: 'Short' },
  igtv:       { execution: 'CREATOR_REQUIRED', badgeColor: 'red',   label: 'IGTV' },
  live:       { execution: 'CREATOR_REQUIRED', badgeColor: 'red',   label: 'Live' },
  audio:      { execution: 'CREATOR_REQUIRED', badgeColor: 'slate', label: 'Audio' },
  podcast:    { execution: 'CREATOR_REQUIRED', badgeColor: 'slate', label: 'Podcast' },
  song:       { execution: 'CREATOR_REQUIRED', badgeColor: 'slate', label: 'Song' },
  audio_event:{ execution: 'CREATOR_REQUIRED', badgeColor: 'slate', label: 'Audio Event' },

  carousel:   { execution: 'CONDITIONAL_AI', badgeColor: 'fuchsia', label: 'Carousel' },
  image:      { execution: 'CONDITIONAL_AI', badgeColor: 'sky',    label: 'Image' },
  photo:      { execution: 'CONDITIONAL_AI', badgeColor: 'sky',    label: 'Photo' },
  slides:     { execution: 'CONDITIONAL_AI', badgeColor: 'violet', label: 'Slides' },
  slide:      { execution: 'CONDITIONAL_AI', badgeColor: 'violet', label: 'Slide' },
  slideware:  { execution: 'CONDITIONAL_AI', badgeColor: 'violet', label: 'Slideware' },
  infographic:{ execution: 'CONDITIONAL_AI', badgeColor: 'violet', label: 'Infographic' },
  deck:       { execution: 'CONDITIONAL_AI', badgeColor: 'violet', label: 'Deck' },
  presentation:{ execution: 'CONDITIONAL_AI', badgeColor: 'violet', label: 'Presentation' },
  webinar:    { execution: 'CONDITIONAL_AI', badgeColor: 'violet', label: 'Webinar' },

  feed_post:  { execution: 'CONDITIONAL_AI', badgeColor: 'gray',   label: 'Feed Post' },
  event:      { execution: 'CONDITIONAL_AI', badgeColor: 'gray',   label: 'Event' },
  case_study: { execution: 'AI_AUTOMATED',  badgeColor: 'blue',   label: 'Case Study' },
};

const BADGE_CLASSES: Record<string, { badge: string; card?: string }> = {
  emerald: { badge: 'bg-emerald-100 text-emerald-700 border-emerald-200' },
  blue:    { badge: 'bg-blue-100 text-blue-700 border-blue-200' },
  amber:   { badge: 'bg-amber-100 text-amber-700 border-amber-200' },
  red:     { badge: 'bg-red-100 text-red-700 border-red-200' },
  fuchsia: { badge: 'bg-fuchsia-100 text-fuchsia-700 border-fuchsia-200' },
  sky:     { badge: 'bg-sky-100 text-sky-700 border-sky-200' },
  slate:   { badge: 'bg-slate-100 text-slate-700 border-slate-200' },
  violet:  { badge: 'bg-violet-100 text-violet-700 border-violet-200' },
  gray:    { badge: 'bg-gray-100 text-gray-700 border-gray-200' },
};

export function getContentTypeMeta(contentType: string | undefined | null): ContentTypeMeta {
  const key = normalizeKey(contentType ?? '');
  if (!key) return { execution: 'AI_AUTOMATED', badgeColor: 'emerald', label: 'Post' };
  const exact = CONTENT_TAXONOMY[key];
  if (exact) return exact;
  for (const [k, meta] of Object.entries(CONTENT_TAXONOMY)) {
    if (key.includes(k) || k.includes(key)) return meta;
  }
  return { execution: 'AI_AUTOMATED', badgeColor: 'emerald', label: key || 'Post' };
}

export function getContentTypeBadgeClasses(contentType: string | undefined | null): string {
  const meta = getContentTypeMeta(contentType);
  return BADGE_CLASSES[meta.badgeColor]?.badge ?? BADGE_CLASSES.emerald.badge;
}
```

**Usage:**

- **Execution mode:** Keep using `execution_mode` from the slot/resolved posting when present; when absent, use `getContentTypeMeta(item.content_type).execution` so inference is consistent with the taxonomy.
- **Badge color:** Use `getContentTypeBadgeClasses(content_type)` for content-type badges only; keep execution-mode colors for **borders** (and optional execution badge) from existing `getExecutionModeColorClasses` / `getExecutionIntelligence`.
- **New types:** Add one line to `CONTENT_TAXONOMY`; badge and default execution are then supported everywhere that uses this file.

This gives a single, extensible place for content types and avoids color collisions by separating execution (border), content type (badge), and status (background).
