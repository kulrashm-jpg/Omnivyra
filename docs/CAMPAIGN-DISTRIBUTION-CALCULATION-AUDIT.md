# Campaign Distribution Calculation Engine — System Audit Report

**Audit Date:** 2025-03-07  
**Scope:** Distribution calculation logic used before generating the weekly campaign plan  
**Directive:** Deterministic calculation vs AI-generated planning — verification only, no code modifications

---

## 1. User Input Capture

### Database Tables
- **`campaign_planning_inputs`**  
  Columns: `campaign_id`, `company_id`, `recommendation_snapshot` (JSONB, includes `planning_inputs`: target_audience, audience_professional_segment, communication_style, action_expectation, content_depth, topic_continuity), `available_content` (JSONB), `weekly_capacity` (JSONB), `exclusive_campaigns` (JSONB), `selected_platforms` (JSONB), `platform_content_requests` (JSONB), `planning_stage`, `is_completed`, `updated_at`.

- **Not stored:** `cross_platform_sharing` is not persisted in `campaign_planning_inputs`. It is only present in runtime `collectedPlanningContext` / `prefilledPlanning`.

### API Endpoints
- **`POST /api/campaigns/ai/plan`** (`pages/api/campaigns/ai/plan.ts`)
  - Accepts: `campaignId`, `companyId`, `mode`, `message`, `durationWeeks`, `targetDay`, `platforms`, `collectedPlanningContext`, `prefilledPlanning`, `conversationHistory`, `recommendationContext`, etc.
  - Reads `getCampaignPlanningInputs(campaignId)` and merges into `deterministicPlanningContext`.
  - Writes via `saveCampaignPlanningInputs()` for: available_content, weekly_capacity, exclusive_campaigns, platform_content_requests, selected_platforms.

### Services Reading Inputs During Campaign Planning
- **`campaignPlanningInputsService.ts`**: `getCampaignPlanningInputs()`, `saveCampaignPlanningInputs()` — reads/writes `campaign_planning_inputs`.
- **`campaignAiOrchestrator.ts`**: Uses `prefilledPlanning` (merged from DB + `collectedPlanningContext`).
- **`pages/api/campaigns/ai/plan.ts`**: Loads planning inputs, merges with conversation-derived context, passes `finalCollectedPlanningContext` to `runCampaignAiPlan()`.

### Summary — User Inputs Stored vs Runtime-Only
| Input                       | Stored in DB                           | API/Service Source                           |
|----------------------------|----------------------------------------|----------------------------------------------|
| existing content (available_content) | Yes — `campaign_planning_inputs.available_content` | `getCampaignPlanningInputs`, `collectedPlanningContext` |
| weekly creation capacity   | Yes — `campaign_planning_inputs.weekly_capacity`   | Same                                          |
| posting frequency per platform | Yes — via `platform_content_requests`              | Same                                          |
| content types per platform | Yes — `platform_content_requests`       | Same                                          |
| cross-platform sharing     | **No** — runtime only                  | `collectedPlanningContext`; default `enabled: true` when absent |

---

## 2. Pre-Planning Calculation Layer

### Existence of Deterministic Calculation
**Yes.** The system computes `total_content_required_per_week` (and related totals) before generating the weekly plan.

### Implementation

| Location | Function / Logic | Behavior |
|----------|------------------|----------|
| **`backend/services/deterministicWeeklySkeleton.ts`** | `buildDeterministicWeeklySkeleton()` | Parses `platform_content_requests`, computes `platform_postings_total` (sum across platforms), `total_weekly_content_count` (unique vs shared), `platform_allocation`, `content_type_mix`, `execution_items`. |
| **`backend/services/capacityExpectationValidator.ts`** | `computePlatformPostingTotals()`, `computeUniqueWeeklyTotal()` | `computePlatformPostingTotals()` → `requested_platform_postings_total`, `byPlatform`; `computeUniqueWeeklyTotal()` → unique pieces based on `cross_platform_sharing`. |
| **`backend/services/workloadBalancerService.ts`** | `computeUniqueTotal()` | Same unique vs sum logic for workload balancing. |

### Logic Used
- **Postings total:** Sum of `count_per_week` across all `(platform, content_type)` rows in `platform_content_requests`.
- **Unique total (sharing on):** `max(count_per_week)` per content type across platforms.
- **Unique total (sharing off):** Sum of all `count_per_week`.

### Invocation
- `buildDeterministicWeeklySkeleton()` is called in `campaignAiOrchestrator.ts` at ~line 5189, when `mode === 'generate_plan'`, `platform_content_requests` is present, and validation is not invalid (or override confirmed).

---

## 3. Unique vs Shared Content Calculation

### Does the system check this condition?
**Yes.**

### Where it exists
| File | Function / Logic | Behavior |
|------|------------------|----------|
| **`deterministicWeeklySkeleton.ts`** | `buildDeterministicWeeklySkeleton()` | Reads `isCrossPlatformSharingEnabled(cross_platform_sharing)`. If enabled: `uniqueTotalsByType[type] = Math.max(0, ...counts)`; if disabled: `counts.reduce((a,b) => a + b, 0)`. Builds `slot_platforms` per execution item so one slot can cover multiple platforms. |
| **`capacityExpectationValidator.ts`** | `computeUniqueWeeklyTotal()` (lines 168–181) | Same: sharing on → `maxByType[content_type]`; sharing off → sum of all postings. |
| **`workloadBalancerService.ts`** | `computeUniqueTotal()` (lines 84–99) | Same logic. |

### How it changes the calculation
- **Sharing on:** 1 unique piece can fill N platform slots. Demand = max per content type across platforms.
- **Sharing off:** Each platform slot needs its own piece. Demand = sum of all postings.

---

## 4. Creator Capacity Constraint

### Per-Type Creator Capacity (e.g. videos=1, carousel=2)
**Implemented in validation only.** Capacity is parsed by content type (`parseCapacityByType`) and checked per type in `validateCapacityVsExpectation()`.

### Where constraints are enforced
| File | Function | Behavior |
|------|----------|----------|
| **`capacityExpectationValidator.ts`** | `validateCapacityVsExpectation()` | Supply = `available_content[type] + (weekly_capacity[type] × campaign_weeks) − exclusive_share`. Demand per type = `demandUniqueForCampaign` (sharing-aware). Fails per type when supply < demand. |
| **`capacityFrequencyValidationGateway.ts`** | `validateCapacityAndFrequency()` | Wraps validator; when invalid + `enable_workload_balancing`, calls `balanceWorkload()` to reduce demand to fit supply. |
| **`workloadBalancerService.ts`** | `balanceWorkload()` | Reduces `platform_content_requests` by priority (video > carousel > post > article) until unique total ≤ supply. |

### Post-plan pressure balancing (does NOT cap before plan creation)
| File | Function | Behavior |
|------|----------|----------|
| **`executionPressureBalancer.ts`** | `runExecutionPressureBalancer()` | Runs **after** plan generation. When pressure > 1.1: converts creator slots to `ai_assisted` (text/post/carousel), applies format downgrades, redistributes overflow to next week. |
| **`computeTotalCapacity()`** | `executionPressureBalancer.ts` | `totalCapacity = creator + 0.6×creator (AI) + 0.4×creator (conditional)`. |

### Does the system cap creator-dependent activities before plan creation?
**Indirectly.** Validation blocks plan generation when capacity is exceeded (unless override confirmed). `balanceWorkload()` can auto-reduce demand to fit capacity.

### Does it shift workload to AI content before plan creation?
**No.** AI shift happens in `runExecutionPressureBalancer()` **after** the plan is built.

### Does it ignore the capacity constraint?
**No.** Capacity is validated before plan generation. Override is required to proceed when invalid.

---

## 5. Topic Reuse Calculation

### Does the system generate a repurposing plan before weekly plan creation?
**No.**

### Current behavior
- **`repurposeGraphEngine.ts`**: Used by `dailyContentDistributionPlanService.ts` for daily distribution. It expands a slot into derivative content (blog → post, thread, carousel; etc.) **after** the weekly plan exists.
- **`deterministicWeeklySkeleton.ts`** when sharing is on: Builds `slot_platforms` (which platforms reuse each slot) for distribution across platforms. This is **platform reuse of the same piece**, not a separate topic-level repurposing plan.
- There is no dedicated **topic reuse plan** computed before weekly plan creation.

---

## 6. Weekly Content Target Calculation

### Does the system calculate `total_topics_required_per_week`?

**Partially.** It computes:

- **`total_weekly_content_count`** (unique pieces per week) in `buildDeterministicWeeklySkeleton()`.
- **`platform_postings_total`** (total postings across platforms).
- **`requested_total`** / **`requested_platform_postings_total`** in validation.

**Not computed explicitly:** A separate `total_topics_required_per_week` (as “topic” distinct from “content piece”) is not a named output. Topics come from the AI plan; the deterministic layer computes unique content slots, not topic-level targets.

### Example scenario (LinkedIn 3, Facebook 2, Twitter 3, sharing allowed)
- Postings total: 8.
- Unique posts: `max(3, 2, 3) = 3` per week (assuming all post type).
- Logic exists in `computeUniqueWeeklyTotal()` and `buildDeterministicWeeklySkeleton()`.

---

## 7. AI vs Formula Generation

### Current approach

**Hybrid: AI generation with deterministic skeleton constraints.**

1. **Before AI call:**  
   - `buildDeterministicWeeklySkeleton()` produces `execution_items`, `platform_allocation`, `total_weekly_content_count`.  
   - `validateCapacityAndFrequency()` enforces supply vs demand and optional workload balancing.

2. **AI generation:**  
   - `generateCampaignPlan()` produces raw plan text.  
   - `parseAiPlanToWeeks()` turns it into structured weeks (themes, objectives, platform_allocation, topics_to_cover).

3. **Merging:**  
   - When `hasDeterministicPlanSkeleton` is true, skeleton `execution_items` are merged into each week. Topics from the AI plan are assigned to skeleton slots via `weightedAssignment()`.  
   - Fallback: `buildPlaceholderPlanFromSkeleton()` when parsing fails.

4. **Post-plan:**  
   - `runExecutionPressureBalancer()` adjusts execution ownership and format when pressure is high.

### Summary
- **Deterministic:** Skeleton (slot counts, platform allocation, unique vs shared), validation, and merge logic.
- **AI:** Themes, objectives, topic titles, narrative.
- Weekly plan is **AI-generated** with **deterministic constraints** (skeleton + validation). Distribution logic starts from the deterministic skeleton; AI fills topics and narrative.

---

## 8. Summary of Calculation Capabilities

### Calculations implemented
- `platform_postings_total` (sum of platform requests).
- `total_weekly_content_count` (unique pieces, sharing-aware).
- Unique vs shared: `computeUniqueWeeklyTotal` / `computeUniqueTotal` (max per type vs sum).
- Per-type capacity validation (supply vs demand per post/video/blog/story/thread).
- Workload balancing when over capacity (reduce requests by content-type priority).
- Deterministic skeleton: `execution_items`, `platform_allocation`, `content_type_mix`, `slot_platforms`.

### Calculations missing
- Explicit `total_topics_required_per_week` (topics vs pieces).
- Repurposing plan before weekly plan creation (topic → platform/formats).
- Persistent storage of `cross_platform_sharing`.
- Per-type creator capacity used to pre-allocate AI vs creator slots before plan generation (allocations happen post-plan via `executionPressureBalancer`).

### Whether AI compensates for missing calculations
- **Topics:** AI proposes topics; they are assigned to skeleton slots. No prior topic count or target; AI is used to fill slots.
- **Repurposing:** Repurpose graph runs post-plan for daily distribution; not used to compute weekly targets before plan creation.
- **Capacity vs format:** Post-plan balancer shifts creator → AI when over capacity; no pre-plan allocation of creator vs AI by format.

### Where distribution logic actually begins
- Entry: `buildDeterministicWeeklySkeleton()` (when `platform_content_requests` present and validation passes).
- Validation: `validateCapacityAndFrequency()` → `validateCapacityVsExpectation()`.
- Optional rebalance: `balanceWorkload()` inside the validation gateway.
- Flow: plan API → `runCampaignAiPlan()` → `buildDeterministicWeeklySkeleton()` → `validateCapacityAndFrequency()` → AI prompt + `generateCampaignPlan()` → `parseAiPlanToWeeks()` → merge skeleton with parsed plan → pressure balancer.
