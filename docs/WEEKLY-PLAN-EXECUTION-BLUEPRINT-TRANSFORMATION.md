# Weekly Plan → Complete Execution Blueprint — Analysis & Transformation Strategy

**Goal:** Transform weekly planning so its output is a **complete execution blueprint**; daily planning then only generates content and never makes strategic decisions.  
**Scope:** Weekly planning schema and logic only. Daily plan logic is not redesigned.  
**No code implemented.**

---

## Task 1 — Weekly Output Structure (Exact + Classification)

The canonical weekly output is **CampaignBlueprint** (`backend/types/CampaignBlueprint.ts`) with **CampaignBlueprintWeek[]**. Below is the exact structure produced by weekly planning, with each field classified as: **Strategic intelligence** | **Distribution logic** | **Execution metadata** | **Missing**.

### CampaignBlueprint (root)

| Field | Classification | Notes |
|-------|----------------|--------|
| `campaign_id` | Execution metadata | Identifier. |
| `duration_weeks` | Distribution logic | How many weeks. |
| `weeks` | — | Array of CampaignBlueprintWeek. |

---

### CampaignBlueprintWeek (per week)

| Field | Classification | Notes |
|-------|----------------|--------|
| `week_number` | Execution metadata | 1-based week index. |
| `phase_label` | Strategic intelligence | e.g. "Audience Activation", "Conversion Ramp". |
| `primary_objective` | Strategic intelligence | Outcome-oriented statement for the week. |
| `topics_to_cover` | Strategic intelligence | 2–5 topic strings; drive content. |
| `weeklyContextCapsule` | Strategic intelligence | campaignTheme, primaryPainPoint, desiredTransformation, campaignStage, psychologicalGoal, momentum, audienceProfile, weeklyIntent, toneGuidance, successOutcome. Optional; when enriched. |
| `topics` | Strategic intelligence | WeeklyTopicWritingBrief[] (topicTitle, topicContext, whoAreWeWritingFor, desiredAction, approximateDepth, narrativeStyle, contentTypeGuidance). Optional; not guaranteed when skeleton path. |
| `platform_allocation` | Distribution logic | Record<platform, number> — posts per platform. |
| `content_type_mix` | Distribution logic | e.g. ["post", "video", "carousel"]. |
| `cta_type` | Strategic intelligence | Week-level CTA: None \| Soft CTA \| Engagement CTA \| Authority CTA \| Direct Conversion CTA. |
| `weekly_kpi_focus` | Strategic intelligence | Reach growth \| Engagement rate \| Follower growth \| Leads generated \| Bookings. |
| `platform_content_breakdown` | Distribution logic | Per-platform array of { type, count, topic?, topics?, platforms? }. Makes "platform: N" explicit per type. |
| `platform_topics` | Distribution logic | Per-platform topic overrides. |
| `execution_items` | Execution metadata + Strategic | See below. Optional; present when deterministic skeleton path. |
| `posting_execution_map` | Execution metadata | Derived from execution_items; used for resolved_postings. |
| `resolved_postings` | Execution metadata | Flat list of (platform, content_type, topic, intent, progression, etc.); feeds daily. |
| `week_extras` | Mixed | Flexible; can hold summary, objectives, deliverables_list, writer_brief, topic_focus, distribution_strategy (QUICK_LAUNCH/STAGGERED), etc. |

---

### execution_items[] (when present)

Each element matches **DeterministicExecutionItem** (`backend/services/deterministicWeeklySkeleton.ts`) plus orchestrator-added fields.

| Field | Classification | Notes |
|-------|----------------|--------|
| `content_type` | Execution metadata | video \| post \| carousel \| article \| reel \| etc. |
| `platform_options` | Distribution logic | Platforms that support this content_type (from platform_content_rules). |
| `selected_platforms` | Distribution logic | Platforms this item is posted to. |
| `count_per_week` | Distribution logic | Number of slots (pieces) per week for this type. |
| `platform_counts` | Distribution logic | Per-platform posting count. |
| `slot_platforms` | Distribution logic | Per-slot which platforms reuse this piece (repurposing). |
| `topic_slots` | Strategic + Execution | Array of slots; see below. |

---

### topic_slots[] (per execution_item)

Orchestrator merges topics and fills intent; slot shape is:

| Field | Classification | Notes |
|-------|----------------|--------|
| `topic` | Strategic intelligence | Topic string for this slot. |
| `progression_step` | Execution metadata | 1-based within item. Added by orchestrator. |
| `global_progression_index` | Execution metadata | Filled when building resolved_postings; 0 in initial merge. |
| `intent` | Strategic intelligence | objective, cta_type, target_audience, writing_angle, brief_summary, strategic_role, pain_point, outcome_promise, audience_stage, recommendation_alignment. |
| `master_content_id` | Execution metadata | Stable id for one logical piece. |

---

### Intent (inside topic_slot)

| Field | Classification | Notes |
|-------|----------------|--------|
| `objective` | Strategic intelligence | What this piece achieves. |
| `cta_type` | Strategic intelligence | Same semantics as week-level; not per-format. |
| `target_audience` | Strategic intelligence | Who we're writing for. |
| `writing_angle` | Strategic intelligence | Derived from topic+theme only (e.g. education, authority); **not** from content_type. |
| `brief_summary` | Strategic intelligence | One-line summary. |
| `strategic_role` | Strategic intelligence | e.g. Authority Building, Demand Capture. |
| `pain_point` | Strategic intelligence | Pain addressed. |
| `outcome_promise` | Strategic intelligence | What reader/viewer gains. |
| `audience_stage` | Strategic intelligence | e.g. problem_aware, solution_aware. |
| `recommendation_alignment` | Strategic intelligence | source_type, source_value, alignment_reason. |

---

### WeeklyTopicWritingBrief (when week has topics[])

| Field | Classification | Notes |
|-------|----------------|--------|
| `topicTitle` | Strategic intelligence | |
| `topicContext` | Strategic intelligence | topicGoal, audienceAngle, painPointFocus, messagingAngle, recommendedContentTypes, platformPriority, writingIntent. |
| `contentTypeGuidance` | Execution metadata | primaryFormat, maxWordTarget, platformWithHighestLimit, adaptationRequired. Only when topics[] present; not per-slot in execution_items. |

---

### Missing (should exist but don’t in weekly output)

| Missing field / concept | Classification | Where it would live |
|-------------------------|----------------|----------------------|
| **Angle per format** (topic adaptation by content_type) | Strategic intelligence | Per slot: e.g. format_angle or intent.format_angle so "video = story, carousel = list" is explicit. |
| **Execution specs per format** (video structure, carousel flow, post visual) | Execution metadata | Per execution_item or per slot: e.g. format_spec. |
| **Media intent metadata** (visual_goal, aspect_ratio, image requirement) | Execution metadata | Per slot or per execution_item. |
| **Repurposing linkage** (source_content_id / adapt_from) | Execution metadata | Per slot: e.g. source_master_content_id. |
| **Platform behavior hints** (sound-off, scroll, mobile-first) | Strategic intelligence | Week or slot level. |
| **Per-format CTA** (e.g. video vs post different CTA) | Strategic intelligence | Per slot or in intent. |
| **Content depth per slot** (short vs long, punchy vs educational) | Strategic intelligence | In intent or slot; approximateDepth/narrativeStyle only when topics[] present. |
| **distribution_strategy** on week | Distribution logic | Exists in week_extras / some code paths; not on canonical CampaignBlueprintWeek type. |

---

## Task 2 — Missing Weekly Intelligence: Where It Should Exist

For each missing piece: **existing file**, **likely schema**, **best insertion layer**.

---

### 1. Angle per format (topic adaptation)

- **What:** Same topic gets a different narrative angle per content_type (e.g. video = story, carousel = list, post = tip).
- **Existing file:** `backend/services/campaignAiOrchestrator.ts` (intent derivation in merge); `backend/services/deterministicWeeklySkeleton.ts` (DeterministicExecutionItem.topic_slots[].intent).
- **Likely schema:** Add to **slot intent** (or new slot-level field):
  - `format_angle: string | null` — e.g. "story", "list", "tip", "how-to" (derived or stored).
  - Or extend `writing_angle` to be format-aware: e.g. `writing_angle_by_format?: Record<string, string>` so existing consumers still see a single `writing_angle` (e.g. primary) and new ones see per-format.
- **Best insertion layer:** **Skeleton merge in orchestrator.** When building each topic_slot, pass `content_type` (from parent execution_item) into a new helper e.g. `deriveFormatAngle(topic, theme, content_type)` and set `intent.format_angle` (or equivalent). No change to skeleton build; only to merge step that fills intent. Alternatively, a **post-merge enrichment layer** that runs after current merge and adds format_angle per slot from (topic, content_type, theme).

---

### 2. Execution specs per format

#### 2a. Video structure hints

- **What:** Duration hint, hook, storytelling structure (e.g. problem–solution–CTA).
- **Existing file:** `backend/types/CampaignBlueprint.ts` (CampaignBlueprintWeek, execution_items); `backend/services/deterministicWeeklySkeleton.ts` (DeterministicExecutionItem).
- **Likely schema:** On **execution_item** (same for all slots of that type) or per **slot**:
  - `format_spec?: { video?: { duration_seconds?: number; hook_hint?: string; structure?: string } }`.
  - Or under `week_extras.execution_specs_by_type?: Record<string, { duration_seconds?, hook_hint?, structure? }>`.
- **Best insertion layer:** **Execution-item level:** extend DeterministicExecutionItem with optional `format_spec` (or `execution_spec`). Populated either (a) in **orchestrator merge** from content_type + theme/week, or (b) in a **post-merge enrichment** that only runs when execution_items exist and adds defaults/rules by content_type. Skeleton builder does not need to know; enrichment reads content_type and week context.

#### 2b. Carousel narrative flow

- **What:** Slide count, flow (e.g. hook → points → CTA).
- **Existing file:** Same as above.
- **Likely schema:** `format_spec?.carousel?: { slide_count?: number; narrative_flow?: string }`.
- **Best insertion layer:** Same as 2a — execution_item-level or week_extras; enrichment layer or orchestrator merge.

#### 2c. Post visual expectation

- **What:** Whether post expects image/attachment, “hero image”, “chart”, etc.
- **Existing file:** Same.
- **Likely schema:** `format_spec?.post?: { visual_expectation?: 'text_only' | 'with_image' | 'with_chart' | 'optional_visual' }`.
- **Best insertion layer:** Same — execution_item or slot; enrichment or merge.

---

### 3. Media intent metadata

- **What:** visual_goal, visual_style, aspect_ratio, text_overlay, image requirement.
- **Existing file:** `backend/services/contentGenerationPipeline.ts` (media_intent, media_search_intent at generation time); weekly types do not have it.
- **Likely schema:** Per slot or per execution_item:
  - `media_intent?: { visual_goal?: string; visual_style?: string; aspect_ratio?: string; text_overlay?: string; image_required?: boolean }`.
  - Or reuse a subset of pipeline’s media_intent shape so daily/generation can pass through.
- **Best insertion layer:** **Enrichment layer** that runs on blueprint weeks after merge (or in generate-weekly-structure when building daily input). Reads content_type and optionally topic/theme; sets defaults from a small rules table (e.g. video → 16:9, carousel → 1:1). No change to LLM or skeleton.

---

### 4. Repurposing linkage between items

- **What:** “This carousel adapts from this video” (source master_content_id).
- **Existing file:** `backend/services/campaignAiOrchestrator.ts` (merge); `backend/services/deterministicWeeklySkeleton.ts` (slot_platforms = same piece on multiple platforms; no cross-format source).
- **Likely schema:** Per **topic_slot**: `source_master_content_id?: string | null`. When set, this slot is an adaptation of that piece (e.g. carousel from video).
- **Best insertion layer:** **Enrichment layer** or optional **orchestrator step**: after slots and master_content_ids exist, a pass that identifies “same topic, different format” and sets source_master_content_id (e.g. first video slot with same topic → source for carousel slot). Skeleton and LLM unchanged; purely additive.

---

### 5. Platform behavior hints

- **What:** e.g. “sound-off”, “scroll-first”, “mobile-first” to guide content style.
- **Existing file:** `backend/types/CampaignBlueprint.ts` (week); company/campaign context in orchestrator.
- **Likely schema:** Week-level or slot-level:
  - `platform_behavior_hints?: string[]` or `consumption_context?: 'mobile_first' | 'desktop_first' | 'mixed'`.
  - Could live in week_extras or on weeklyContextCapsule.
- **Best insertion layer:** **Week level** in week_extras (e.g. `platform_behavior_hints` or `consumption_context`). Filled from company/campaign planning context if available, or from a default. Optional question in planning inputs; then injected into week when building/refining blueprint. No change to skeleton structure.

---

### Summary table (Task 2)

| Missing piece | Existing file(s) | Likely schema location | Best insertion layer |
|---------------|------------------|------------------------|----------------------|
| Angle per format | campaignAiOrchestrator, deterministicWeeklySkeleton | topic_slots[].intent.format_angle (or writing_angle_by_format) | Orchestrator merge (deriveFormatAngle) or post-merge enrichment |
| Video structure | CampaignBlueprint types, DeterministicExecutionItem | execution_items[].format_spec.video | Orchestrator merge or enrichment layer |
| Carousel narrative | Same | execution_items[].format_spec.carousel | Same |
| Post visual | Same | execution_items[].format_spec.post | Same |
| Media intent | contentGenerationPipeline (reference only) | topic_slots[].media_intent or execution_items[].media_intent | Enrichment layer (rules by content_type) |
| Repurposing linkage | campaignAiOrchestrator | topic_slots[].source_master_content_id | Enrichment pass after merge |
| Platform behavior hints | CampaignBlueprintWeek, week_extras | week_extras.platform_behavior_hints or consumption_context | Week build in orchestrator or refinement; optional planning input |

---

## Task 3 — Minimal Change Strategy

**Objectives:** Avoid rewriting the weekly planner; add missing intelligence in one place; keep backward compatibility.

### Approach: Add an “execution intelligence enrichment” layer

- **Where:** New module (e.g. `backend/services/weeklyBlueprintEnrichmentService.ts` or similar) that operates on **CampaignBlueprint.weeks** (or the same shape the orchestrator already produces).
- **When:** After the orchestrator returns `plan.weeks` (and after `fromStructuredPlan` / `saveDraftBlueprint`), **or** immediately before the blueprint is consumed by generate-weekly-structure. So: either (A) orchestrator calls enrichment before returning, or (B) getUnifiedCampaignBlueprint (or the single resolution path that feeds daily) runs enrichment when loading. Option B keeps orchestrator untouched.
- **Input:** CampaignBlueprint or weeks array (with execution_items when present).
- **Output:** Same shape with added optional fields; all existing fields unchanged.
- **Logic:**  
  - If week has execution_items: for each item and each slot, add format_angle (from content_type + topic + theme), format_spec (from content_type), media_intent (defaults by type), and optionally source_master_content_id (same-topic cross-format).  
  - If week has week_extras: add platform_behavior_hints or consumption_context from context or defaults.  
  - Pure functions or side-effect-free transforms; no LLM, no schema change to skeleton or parser.
- **Backward compatibility:** All new fields are optional. Existing consumers ignore them; daily planning and content generation can start reading them when ready.

### Before vs after data shape

**Before (current slot shape):**

```ts
// topic_slots[i] today
{
  topic: string;
  progression_step: number;
  global_progression_index: number;  // or 0 until resolved
  intent: {
    objective: string;
    cta_type: string;
    target_audience: string;
    writing_angle: string | null;
    brief_summary: string;
    strategic_role: string;
    pain_point: string;
    outcome_promise: string;
    audience_stage: string;
    recommendation_alignment: { source_type, source_value, alignment_reason };
  };
  master_content_id: string;
}
```

**After (same + optional enrichment):**

```ts
// topic_slots[i] after enrichment — all existing fields unchanged
{
  topic: string;
  progression_step: number;
  global_progression_index: number;
  intent: {
    objective: string;
    cta_type: string;
    target_audience: string;
    writing_angle: string | null;
    brief_summary: string;
    strategic_role: string;
    pain_point: string;
    outcome_promise: string;
    audience_stage: string;
    recommendation_alignment: { ... };
    format_angle?: string | null;   // NEW: e.g. "story", "list", "tip"
  };
  master_content_id: string;
  source_master_content_id?: string | null;   // NEW: repurposing link
  media_intent?: {                             // NEW: optional
    visual_goal?: string;
    visual_style?: string;
    aspect_ratio?: string;
    image_required?: boolean;
  };
}

// execution_items[j] after enrichment — existing fields unchanged
{
  content_type: string;
  platform_options: string[];
  selected_platforms: string[];
  count_per_week: number;
  platform_counts?: Record<string, number>;
  slot_platforms?: string[][];
  topic_slots: [ ... ];
  format_spec?: {                              // NEW: optional
    video?: { duration_seconds?: number; hook_hint?: string; structure?: string };
    carousel?: { slide_count?: number; narrative_flow?: string };
    post?: { visual_expectation?: string };
  };
}
```

**Week level after:**

```ts
{
  // ... all existing CampaignBlueprintWeek fields unchanged
  week_extras?: {
    ...existing,
    platform_behavior_hints?: string[];
    consumption_context?: 'mobile_first' | 'desktop_first' | 'mixed';
  };
}
```

- **Before:** No format_angle, no format_spec, no media_intent, no source_master_content_id, no platform_behavior_hints/consumption_context.
- **After:** All of these added only as optional fields; weekly planner and skeleton unchanged; daily can rely on blueprint for strategy and execution specs.

---

## Task 4 — Weekly Plan Success Test (Checklist)

**Definition:** “If this checklist is true, daily planning should not need additional decisions.”

Use this to validate that the weekly plan is a **complete execution blueprint** so daily only generates content.

---

### Theme & strategy

- [ ] **W1.** Every week has a non-empty `phase_label` and `primary_objective`.
- [ ] **W2.** Every week has `topics_to_cover` with at least one topic (or equivalent topic source).
- [ ] **W3.** Week-level `cta_type` and `weekly_kpi_focus` are set and valid.

---

### Execution items & slots (when deterministic path)

- [ ] **W4.** For each week that should have execution detail, either `execution_items` is present with at least one item, or there is an unambiguous way to derive per-slot content (e.g. from platform_content_breakdown + topics_to_cover) so daily does not invent slots.
- [ ] **W5.** Every execution_item has `content_type`, `selected_platforms`, and `count_per_week` > 0.
- [ ] **W6.** Every execution_item has `topic_slots` with length equal to `count_per_week`, and each slot has a non-empty `topic` and full `intent` (objective, cta_type, target_audience, brief_summary, strategic_role, pain_point, outcome_promise, recommendation_alignment).
- [ ] **W7.** Every slot has a stable `master_content_id` (or equivalent) so daily can reference one logical piece.

---

### Angle & format (no strategic decisions left for daily)

- [ ] **W8.** For each topic_slot, there is a **format-specific angle** (e.g. format_angle or equivalent) so daily does not decide “how to adapt this topic for video vs carousel”; weekly has decided it.
- [ ] **W9.** For each execution_item, **execution specs for that format** (video structure, carousel flow, or post visual expectation) are present or derivable from blueprint (no daily guess).

---

### Distribution & placement

- [ ] **W10.** `platform_allocation` and `content_type_mix` (or execution_items) fully define **what** is produced per week; daily does not add or remove pieces.
- [ ] **W11.** **Which day** each piece lands on is either (a) determined by weekly (e.g. via resolved_postings or day assignment in blueprint), or (b) determined by a deterministic rule (e.g. spreadEvenlyAcrossDays) that uses only blueprint + campaign start date, with no daily “strategy” choices.
- [ ] **W12.** **Which platform** each piece goes to is defined per execution_item (selected_platforms / slot_platforms) or platform_content_breakdown; daily does not choose platforms.

---

### Media & repurposing

- [ ] **W13.** For formats that require media (video, carousel, image), the blueprint includes **media intent** (or equivalent) so daily/generation knows visual expectations without deciding strategy.
- [ ] **W14.** When a piece is an adaptation of another (e.g. carousel from video), the blueprint has **repurposing linkage** (e.g. source_master_content_id) so daily does not re-decide “adapt from what.”

---

### Context for content generation

- [ ] **W15.** Each slot has enough **audience and intent** (target_audience, objective, brief_summary, pain_point, outcome_promise) that daily/content generation can produce copy without asking “who is this for?” or “what’s the goal?”
- [ ] **W16.** Week-level (or slot-level) **platform behavior hints** or consumption context are present when they should influence tone/format (e.g. mobile-first, sound-off); otherwise daily must not invent them.

---

### Consistency & completeness

- [ ] **W17.** There are no “blank” strategic fields that daily is expected to fill (e.g. empty objective or empty target_audience on a slot that is actually used).
- [ ] **W18.** Total number of daily activities (or rows) for the week is fully determined by the blueprint (execution_items + counts + platforms); daily does not add or drop pieces.

---

**Checklist summary:** If **W1–W18** are true, then theme, topics, angles, formats, platforms, distribution, media intent, and repurposing are all decided at weekly level, and daily planning can limit itself to **generating content** (and optionally assigning exact time within a day) **without making strategic decisions.**

---

**End of document.**
