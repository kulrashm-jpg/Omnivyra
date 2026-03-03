# Content-First Master Content Planning Engine — System Change Plan

**Purpose:** Safe migration path from current architecture to a CONTENT-FIRST MASTER CONTENT PLANNING ENGINE while preserving existing flows.  
**Type:** Implementation design only — no code written or refactored.  
**Prerequisite:** [WEEKLY-CONTENT-PLAN-ARCHITECTURAL-AUDIT.md](./WEEKLY-CONTENT-PLAN-ARCHITECTURAL-AUDIT.md).

---

## Target Model (Non-Negotiable)

1. One **MASTER CONTENT** entity (single piece of content).
2. One master content can **distribute to multiple platforms**.
3. **Capacity vs frequency** validation must be **unified**.
4. **Videos** are guidance-only (no storage).
5. **Creator cards** must be first-class objects.
6. **Weekly → Daily** expansion must preserve **master content identity**.

---

## 1. Runtime Execution Map (3 Flows)

### A) AI Plan Flow

| Step | Function (file) | Data shape / notes |
|------|------------------|---------------------|
| 1 | handler (pages/api/campaigns/ai/plan.ts) | POST body: campaignId, companyId, mode, message, conversationHistory, collectedPlanningContext, etc. |
| 2 | getCampaignPlanningInputs (backend/services/campaignPlanningInputsService.ts) | Loads campaign_planning_inputs → CampaignPlanningInputs |
| 3 | Build deterministicPlanningContext (plan.ts) | From planningInputs: target_audience, weekly_capacity → content_capacity, platform_content_requests, etc. |
| 4 | runCampaignAiPlan (backend/services/campaignAiOrchestrator.ts) | Input: CampaignAiPlanInput. Resolves duration, loads campaign row, version, profile. |
| 5 | buildCampaignSnapshotWithHash, assessVirality, getPlatformStrategies, requestDecision (orchestrator) | Baseline context, Omnivyre decision. |
| 6 | runCampaignAiPlanWithPrefill (orchestrator) | Merges collectedPlanningContext + deterministicPlanningContext → prefilledPlanning. |
| 7 | **Validation:** validateCapacityVsExpectation (backend/services/capacityExpectationValidator.ts) | When mode === 'generate_plan'. Result → prefilledPlanning.validation_result. |
| 8 | **Validation:** buildDeterministicWeeklySkeleton (backend/services/deterministicWeeklySkeleton.ts) | When platform_content_requests present and validation not invalid (or override). Throws DeterministicWeeklySkeletonError if requested > capacity. |
| 9 | computeCampaignPlanningQAState (backend/chatGovernance/CampaignPlanningQAState.ts) | QA state; may block generation if required keys missing. |
| 10 | runWithContext (orchestrator) | Invokes LLM, parseAiPlanToWeeks (campaignPlanParser.ts) → structured weeks. |
| 11 | If hasDeterministicPlanSkeleton: merge execution_items into structured weeks (orchestrator) | Builds execution_items from skeleton + AI topics; assigns global_progression_index; builds resolved_postings, daily_execution_items. |
| 12 | normalizeStructuredPlanForOutput (orchestrator) | Final structured.weeks. |
| 13 | saveAiCampaignPlan (backend/db/campaignPlanStore.ts) | Persist raw to twelve_week_plan (audit row). |
| 14 | fromStructuredPlan (backend/services/campaignBlueprintAdapter.ts) | result.plan.weeks → CampaignBlueprint. |
| 15 | saveDraftBlueprint (backend/db/campaignPlanStore.ts) | Blueprint → twelve_week_plan (status draft). **Plan is persisted; not yet immutable.** |
| 16 | Return 200 with plan, validation_result, collectedPlanningContext | Client can commit later. |

**Where plan becomes immutable:** Not in this flow. Becomes effectively immutable when: (1) user commits (e.g. commit-plan, schedule-structured-plan) and status moves to committed; (2) assertBlueprintMutable (campaignBlueprintService) throws when execution_status === ACTIVE or scheduled_posts exist; (3) assertFreezeWindowNotBreached when within BLUEPRINT_FREEZE_WINDOW_HOURS of first scheduled post.

**Where daily rows are generated:** Not in this flow. Daily rows are generated later by: **generate-weekly-structure** (pages/api/campaigns/generate-weekly-structure.ts) when user requests daily plan for a week.

---

### B) Strategy Blueprint Flow

| Step | Function (file) | Data shape / notes |
|------|------------------|---------------------|
| 1 | Entry: generateRecommendations (backend/services/recommendationEngineService.ts) or generateCampaignStrategy (backend/services/campaignRecommendationService.ts) | Company + campaign context; strategy sequence or recommendation request. |
| 2 | buildCampaignBlueprint (backend/services/recommendationBlueprintService.ts) | strategySequence, durationWeeks → CampaignBlueprint (weekly_plan: WeeklyBlueprintEntry[]). No execution_items. |
| 3 | **Validation:** validateCampaignBlueprint (backend/services/recommendationBlueprintValidationService.ts) | Structural only: week count, stage/momentum progression, recommendation integrity. **No capacity check.** |
| 4 | resolveExecutionBlueprint (backend/services/blueprintExecutionResolver.ts) | campaign_blueprint_validated = corrected_blueprint. |
| 5 | Result returned to caller (e.g. recommendations/generate API or campaign recommendations API). | campaign_blueprint_validated, execution_blueprint_resolved. |
| 6a | **Persistence path A:** handler (pages/api/campaigns/recommendations.ts) | generateCampaignStrategy → weekly_plan → fromRecommendationPlan → saveCampaignBlueprintFromRecommendation (campaignPlanStore) + saveCampaignVersion. |
| 6b | **Persistence path B:** campaignOptimizationService (optimize week) | saveCampaignBlueprintFromRecommendation after optimizing. |
| 6c | **No persistence:** recommendations/generate returns result; client may call create-campaign → AI Plan Flow. | Blueprint lives only in API response until create-campaign or commit. |

**Where plan becomes immutable:** Same as system-wide: commit + execution/freeze checks (assertBlueprintMutable, freeze window).

**Where daily rows are generated:** Same as AI flow: only when **generate-weekly-structure** is called for a week (no daily rows in strategy flow itself).

---

### C) Recommendation → Campaign Flow

| Step | Function (file) | Data shape / notes |
|------|------------------|---------------------|
| 1 | handler (pages/api/recommendations/[id]/create-campaign.ts) | POST with recommendation id, optional durationWeeks. |
| 2 | Load recommendation, decision state, team opinion (create-campaign) | recommendation_snapshots, audit_logs. |
| 3 | supabase.from('campaigns').insert (create-campaign) | New campaign record. |
| 4 | supabase.from('campaign_versions').insert (create-campaign) | campaign_snapshot: { campaign, source_recommendation_id }; no weekly_plan in snapshot yet. |
| 5 | getCampaignPlanningInputs (campaignPlanningInputsService) | New campaign → usually null. |
| 6 | runCampaignAiPlan (campaignAiOrchestrator) | mode: 'generate_plan', message with recommendation context, finalCollectedPlanningContext from deterministicPlanningContext (if any planning inputs). **Same as AI Plan Flow from step 4 onward.** |
| 7 | (Same as AI Plan Flow steps 5–15) | Validation, skeleton, LLM, parse, merge execution_items if skeleton, saveDraftBlueprint. |
| 8 | Link recommendation to campaign (recommendation_snapshots update), audit log | campaign_id set on recommendation. |
| 9 | Return campaign_id, snapshot_hash, omnivyre_decision | No daily rows yet. |

**Where plan becomes immutable:** Same as AI Plan Flow.  
**Where daily rows are generated:** When user later calls **generate-weekly-structure** for a week.

---

### Summary: Where Daily Rows Are Generated (All Flows)

- **Single place:** `pages/api/campaigns/generate-weekly-structure.ts` (handler).
- **Sequence:** getUnifiedCampaignBlueprint → for week: either (A) build DailyPlanItem[] from blueprint execution_items (spread slots across days, one row per platform per slot) or (B) generateAIDailyDistribution (dailyContentDistributionPlanService) → DailyPlanItem[] → validateDailyItemAgainstPlatformRules, enrichDailyItemWithPlatformRequirements → supabase.from('daily_content_plans').insert(rows).

---

## 2. Safe Insertion Points

### A. Master Content ID

**Candidates:**

| Location | Pros | Cons |
|----------|------|------|
| deterministicWeeklySkeleton (buildDeterministicWeeklySkeleton) | Creates execution_items with topic_slots; one slot = one logical piece. | Skeleton is per-request; IDs would need to be stable when merged into blueprint. Only used when platform_content_requests present. |
| execution_items slot generation (orchestrator, merge into structured weeks) | Where slots get topic + intent; single place for deterministic path. | AI-only path has no execution_items here. |
| campaignPlanParser (parseAiPlanToWeeks) | Could attach a placeholder id per platform_content_breakdown item. | Parser is allocation-focused; “piece” is implicit in breakdown, not a first-class slot. |
| generate-weekly-structure transformation | Every daily row flows through here; could assign master_content_id when creating rows. | Weekly blueprint would not yet carry the id; would need to generate id at daily expansion and then backfill or store only at daily level. |

**Decision: Best insertion point — execution_items slot generation (orchestrator) + deterministic skeleton.**

- **Primary:** In **campaignAiOrchestrator**, when building `execution_items` from deterministic skeleton and merging into structured weeks (the block that maps baseExecutionItems → execution_items with topic_slots and intent). **Assign a stable master_content_id per slot there** (e.g. `campaignId_weekNumber_contentType_slotIndex` or UUID). That way every deterministic-path slot has an id at blueprint level.
- **Why:** (1) One place where “one piece of content” is explicit (topic_slot + platforms). (2) Blueprint then carries the id; daily expansion can pass it through to daily_content_plans. (3) AI-only path can be extended later by generating execution_items from platform_content_breakdown (with synthetic ids) in the same orchestrator or in a post-parse step.
- **Secondary:** In **deterministicWeeklySkeleton**, when building `execution_items` and `topic_slots`, add an optional `master_content_id` field per slot (or per execution item). Skeleton does not know campaignId/weekNumber; orchestrator can fill ids when merging. So: **skeleton produces slot structure; orchestrator assigns master_content_id when attaching to a week.**

**Concrete:** Add `master_content_id: string` to each element of `topic_slots` (and optionally to each `execution_items` entry as a “group” id). Create in orchestrator when merging: e.g. `master_content_id: \`${campaignId}_w${weekNumber}_${contentType}_${execIdx}_${slotIdx}\`` or UUID. Persist in blueprint. In generate-weekly-structure, when building rows from execution_items, set each row’s `content.master_content_id` (or new column) from the slot’s id.

---

### B. Unified Validation Gate

**Current fragmentation:**

- **Capacity vs expectation:** `validateCapacityVsExpectation` in capacityExpectationValidator; called only in **campaignAiOrchestrator** when mode === 'generate_plan'. Inputs: available_content, weekly_capacity, exclusive_campaigns, platform_content_requests, cross_platform_sharing.
- **Deterministic skeleton capacity:** `buildDeterministicWeeklySkeleton` in deterministicWeeklySkeleton; same inputs; throws if requested > available + capacity (unless override). Called only in orchestrator when platform_content_requests present.
- **Blueprint structural:** `validateCampaignBlueprint` in recommendationBlueprintValidationService; no capacity; used in recommendation engine and blueprintExecutionResolver.
- **Strategy / campaign recommendations path:** No capacity or frequency check before or after buildCampaignBlueprint or saveCampaignBlueprintFromRecommendation.

**Requirements for unified gate:**

- Run for **all** planning paths (AI plan, recommendation create, strategy blueprint save, commit-weekly-plan if it creates daily plans).
- Compare: **user frequency demand** (from platform_content_requests or blueprint platform_allocation), **production capacity** (weekly_capacity, available_content, exclusive_campaigns), **cross-platform sharing rules** (so “demand” is unique content count when sharing is on).

**Where orchestration should move:**

- **Single gateway function:** Implement a single function, e.g. `validateCapacityAndFrequency(input: { available_content, weekly_capacity, exclusive_campaigns, platform_content_requests, cross_platform_sharing, blueprint?: CampaignBlueprint })`, that:
  - Computes requested (unique) content count from platform_content_requests or, when provided, from blueprint.weeks[].platform_allocation / execution_items.
  - Computes supply = available_content + (weekly_capacity - exclusive_campaigns).
  - Returns { valid, deficit, suggested_adjustments, requested_by_platform } (same shape as current CapacityValidationResult for compatibility).
- **Call sites:**  
  - **AI plan:** Keep calling from orchestrator but delegate to this gateway instead of validateCapacityVsExpectation + buildDeterministicWeeklySkeleton capacity check (skeleton can still build structure; validation is one place).  
  - **Recommendation → campaign:** Before runCampaignAiPlan, load or derive planning inputs; call gateway; if invalid, return 422 or pass through with validation_result so UI can show.  
  - **Strategy blueprint:** When persisting (saveCampaignBlueprintFromRecommendation, or in recommendations API / campaignOptimizationService), load campaign_planning_inputs for that campaign; call gateway with blueprint + inputs; if invalid, either reject persist or persist with a “validation_warning” flag.  
  - **Commit-weekly-plan:** If it continues to create daily rows, call gateway with current blueprint and planning inputs before creating rows (or delegate daily creation to generate-weekly-structure and keep commit-weekly-plan as status-only).

**Best “one place” for the gate:** A **new shared module** (e.g. `backend/services/capacityFrequencyValidationGateway.ts`) that both capacityExpectationValidator and deterministicWeeklySkeleton (or only the gateway) use. Orchestrator and any API that persists a blueprint call this gateway. Deterministic skeleton then becomes a **structure builder** only; capacity enforcement is the gateway’s responsibility.

---

### C. Creator Card Model

**Needed data:** theme, objective, intent, platform requirements, marketing metadata (hashtags, summaries, creator instructions).

**Where it exists today:**

- **Weekly:** weeklyContextCapsule (theme, pain, transformation, stage, audience, intent, tone); topics / WeeklyTopicWritingBrief (topicTitle, topicContext, whoAreWeWritingFor, whatProblemAreWeAddressing, whatShouldReaderLearn, desiredAction, narrativeStyle, contentTypeGuidance).
- **Per-slot (execution_items):** intent (objective, cta_type, target_audience, brief_summary, pain_point, outcome_promise, recommendation_alignment); writer_content_brief in daily layer.
- **Platform:** platform rules (content type, character limits); enrichment in generate-weekly-structure (validateDailyItemAgainstPlatformRules, enrichDailyItemWithPlatformRequirements).
- **Marketing metadata:** Scattered in content JSON, platform_content_breakdown, hashtag suggestions on weekly/daily.

**Best location to build creator card object:**

- **After daily item is fully enriched, before or at persistence.** That is: in **generate-weekly-structure**, once we have `enriched` (validated + platform-enriched daily item) for a (slot × platform). At that point we have: theme (from week), objective and intent (from slot), platform (and thus platform requirements), and we can assemble a single **creator card** object (theme, keywords, hashtags, summary, marketing context, instructions for creator, platform-specific notes).
- **Why not weekly blueprint only:** Weekly has no platform-specific metadata or final “instructions” for a single piece.  
- **Why not daily generation start:** We need platform enrichment and intent to be resolved.  
- **Why platform enrichment layer:** enrichDailyItemWithPlatformRequirements already runs in generate-weekly-structure; adding a step that builds a `creator_card: { theme, objective, intent, platform_requirements_summary, hashtags, summary, instructions_for_creator }` from week + slot + enriched item keeps one place where all data is present.

**Conclusion:** Add creator card construction in **generate-weekly-structure**, in the loop that builds rows (after enrichDailyItemWithPlatformRequirements), and store it in the row’s `content.creator_card` (or a dedicated column if desired). Optionally also expose a **creator card** at weekly level for “week brief” (from weeklyContextCapsule + week goal) as a lighter object; the **per-activity creator card** is the first-class object for creator visibility.

---

## 3. Master Content Lifecycle (Creation → Daily Cards)

| Stage | Where | What to add / preserve |
|-------|--------|------------------------|
| **1. Creation** | Orchestrator: merge of deterministic skeleton into structured weeks; each topic_slot gets an identity. | Assign **master_content_id** per slot (or per execution_item) when building execution_items. Persist in blueprint.weeks[].execution_items[].topic_slots[].master_content_id (and/or execution_items[].master_content_id for the group). |
| **2. Blueprint storage** | saveDraftBlueprint / saveCampaignBlueprintFromRecommendation; fromStructuredPlan. | Ensure CampaignBlueprintWeek and stored weeks include execution_items and topic_slots with master_content_id. No schema change to DB table if blueprint is JSON; only shape of blueprint.weeks[].execution_items. |
| **3. Daily expansion** | generate-weekly-structure: when building DailyPlanItem[] from execution_items, each item has a slot; when creating rows per platform, each row corresponds to one slot (one master piece) × one platform. | Set **master_content_id** on each row: from slot.master_content_id. Store in daily_content_plans.content.master_content_id (or new column master_content_id). Same id for all platforms that share that piece. |
| **4. AI-only path (no execution_items)** | generate-weekly-structure: generateAIDailyDistribution returns slots; one slot = one “piece”. | Assign **synthetic master_content_id** when mapping AI slots to DailyPlanItem (e.g. campaignId_weekNumber_ai_slotIndex). Persist same id in all rows that represent the same slot (if AI returns one slot for multiple platforms, reuse id). |
| **5. Activity cards / resolve** | daily-plans API, activity-workspace resolve. | Return master_content_id in each activity; resolve can group by master_content_id for “one piece, N platforms” view. |

**End-to-end:** Master content id is **created** in the orchestrator (deterministic path) or in generate-weekly-structure (AI path), **stored** in blueprint (deterministic) and in daily_content_plans (both paths), **preserved** through to activity cards and APIs so UI can show grouping and deep links.

---

## 4. Unified Validation Architecture

- **Single gateway:** `validateCapacityAndFrequency(input)` in a dedicated module. Inputs: planning inputs (available_content, weekly_capacity, exclusive_campaigns, platform_content_requests, cross_platform_sharing) and optional blueprint (to derive demand from allocation/execution_items if no platform_content_requests).
- **Logic:** Reuse current capacityExpectationValidator logic (requested vs supply; cross_platform_sharing for unique count). Optionally accept blueprint and compute requested from blueprint when platform_content_requests is missing (e.g. strategy path).
- **Output:** Same shape as CapacityValidationResult (status, deficit, suggested_adjustments, explanation) so existing UI and override behavior still work.
- **Callers:**  
  - Orchestrator (generate_plan): call gateway; if invalid and no override, block or return 422; skeleton still built for structure when platform_content_requests present.  
  - Recommendation create-campaign: before runCampaignAiPlan, call gateway if planning inputs exist; else no gate.  
  - saveCampaignBlueprintFromRecommendation / recommendations API / campaignOptimizationService: before persist, load campaign_planning_inputs; call gateway with blueprint; optional: reject or persist with warning.  
  - commit-weekly-plan: if it creates daily rows, call gateway first or delegate to generate-weekly-structure.
- **Deterministic skeleton:** buildDeterministicWeeklySkeleton no longer throws for capacity; it only builds structure. Capacity enforcement is only in the gateway (or skeleton can call gateway and throw for backward compatibility during migration).

---

## 5. Creator Card Lifecycle

| Stage | Where | Content |
|-------|--------|---------|
| **Source data** | Blueprint week (weeklyContextCapsule, topics_to_cover, phase_label); slot (intent, topic); platform rules (enrichment). | Theme, objective, audience, pain/outcome, CTA, narrative style; platform limits and format. |
| **Build** | generate-weekly-structure: after enrichDailyItemWithPlatformRequirements, for each row. | Function `buildCreatorCard(week, slot, enrichedItem, platform)`: returns { theme, objective, intent_summary, target_audience, keywords, hashtags, summary, instructions_for_creator, platform_notes, content_type_guidance }. |
| **Store** | Same row: content.creator_card = buildCreatorCard(...). | First-class object in content JSON (or separate column). |
| **Expose** | daily-plans API, activity-workspace resolve, future “creator view” API. | Include creator_card in response; UI can render one card per activity. |
| **Weekly-level (optional)** | get-weekly-plans or blueprint week. | Derive a “week creator brief” from weeklyContextCapsule + week goal for header context. |

---

## 6. Three-Stage Migration Plan

### Stage 1 — Structural Additions (Non-Breaking)

**Goal:** Add fields and payloads without changing behavior or breaking UI/APIs.

| Change | Where | Defaults / notes |
|--------|--------|-------------------|
| Add **master_content_id** to topic_slots (and optionally execution_items) | Orchestrator: where execution_items are built from skeleton and merged into weeks. | Generate id when merging (deterministic path). Leave absent for AI-only path until Stage 2. |
| Add **master_content_id** to blueprint week shape (CampaignBlueprintWeek, stored blueprint JSON) | campaignBlueprintAdapter, campaignPlanStore (blueprint is JSON). | Optional field; existing blueprints remain valid. |
| Add **master_content_id** to daily_content_plans | content JSON; or new column. | Column: nullable. Content JSON: optional key. When present, daily-plans API returns it. |
| Add **creator_card** to daily row content | generate-weekly-structure: after enrichment, set content.creator_card = buildCreatorCard(...). | New key in content; existing clients ignore. buildCreatorCard returns object; if data missing, return minimal card (e.g. theme + topic only). |
| Add **creator_card** to activity-workspace resolve and daily-plans response | resolve.ts, daily-plans.ts. | Include when present; no change to existing fields. |
| Add **grouping / repurposing** metadata | get-weekly-plans: add optional `master_content_ids_by_week` or per-week execution_items with master_content_id. daily-plans: add `master_content_id` per plan. | Responses remain backward compatible; new keys additive. |

**Models:** CampaignBlueprintWeek (types), execution_items and topic_slots in orchestrator (runtime), daily_content_plans.content (JSON). No DB migration required for content JSON; optional migration for master_content_id column if desired.

---

### Stage 2 — Logic Alignment

**Goal:** Replace fragmented validation with unified gate; enforce content-first internally; keep current responses.

| Change | Where | Runtime impact |
|--------|--------|----------------|
| Introduce **validateCapacityAndFrequency** gateway | New module (e.g. capacityFrequencyValidationGateway.ts). | Single place for capacity + frequency logic; same inputs/outputs as current validator where possible. |
| Orchestrator: call gateway instead of (or in addition to) validateCapacityVsExpectation; skeleton no longer throws for capacity | campaignAiOrchestrator. | Behavior unchanged if gateway returns same result; override still works. Skeleton only builds structure. |
| Strategy path: before saveCampaignBlueprintFromRecommendation, load planning inputs and call gateway | pages/api/campaigns/recommendations.ts, campaignOptimizationService. | Optional: persist with warning or reject when invalid. No change to response shape of recommendations API. |
| Recommendation create-campaign: call gateway when planning inputs exist | create-campaign.ts. | Can return 422 with validation_result or pass through; client already handles validation_result. |
| Generate-weekly-structure: assign **synthetic master_content_id** for AI distribution path | generate-weekly-structure.ts. | Every daily row gets a master_content_id; AI path and deterministic path both support grouping. |
| Ensure **execution_id** (or stable id) for every activity | generate-weekly-structure: set execution_id on enriched item when not present (e.g. from master_content_id + platform). activity-workspace resolve: resolve by execution_id or master_content_id + platform. | All cards deep-linkable; no 404 for “AI-only” activities. |

**Preserve:** get-weekly-plans and daily-plans response shapes; existing UI continues to work. New fields (master_content_id, creator_card) are additive.

---

### Stage 3 — UI & API Evolution

**Goal:** Expose repurposing and creator cards; support deep linking consistently.

| Change | Where | Notes |
|--------|--------|--------|
| Expose **repurposed content grouping** | get-weekly-plans: return execution_items with master_content_id; or summary `content_pieces: { master_content_id, platforms[], topic }[]`. daily-plans: group by master_content_id in response or add `sibling_platforms` / `master_content_id`. | UI can show “same piece, N platforms” and link between them. |
| Expose **creator cards** | daily-plans API: include creator_card in each plan. activity-workspace resolve: include creator_card. Optional: GET /api/campaigns/:id/creator-cards (week or campaign scope). | Creator view can consume one shape. |
| Deep linking | activity-workspace resolve: accept execution_id or (campaignId, master_content_id, platform) and resolve to same payload. | Consistent deep links for all activities. |
| Video guidance-only | Document in API and content model; optional: content_type === 'video' → store only guidance (no binary); validate in content asset or plan service. | Product rule enforced in one place. |

---

## 7. Risks and Mitigations

| Risk | Mitigation |
|------|-------------|
| **Breaking API/UI** | Stage 1: additive only (new fields, optional). Stage 2: gateway returns same shape as current validator; keep validation_result and override behavior. Stage 3: new endpoints or optional query params; existing responses unchanged. |
| **Data migration** | master_content_id: no backfill required for old rows; null/absent means “legacy”; new flows populate. creator_card: build on read for old rows (optional) or leave null. |
| **Backward compatibility** | Blueprint JSON: optional keys; getUnifiedCampaignBlueprint and fromStructuredPlan ignore unknown keys. daily_content_plans: content is JSON; new keys ignored by old clients. |
| **Duplicate logic** | Consolidate capacity logic in one gateway; skeleton and orchestrator call it or delegate; remove duplicate checks from skeleton after gateway is trusted. |
| **AI path vs deterministic path** | Both paths produce master_content_id (orchestrator for deterministic; generate-weekly-structure for AI). Both paths get same validation gate when they persist or generate plan. Creator card built in one place (generate-weekly-structure) for both. |
| **Strategy path never had capacity check** | Add gateway call at persistence (recommendations API, saveCampaignBlueprintFromRecommendation callers); optional “soft” enforcement (warning + persist) to avoid breaking existing flows. |
| **Override bypass** | Keep override_confirmed in gateway result; document and optionally audit when override is used; no change to current product behavior. |
| **Execution_id 404 for AI-only activities** | Stage 2: generate-weekly-structure assigns execution_id (e.g. from master_content_id + platform) to every enriched item and stores in blueprint or in daily row so resolve can find by id or by (campaignId, master_content_id, platform). |

---

**End of System Change Plan.**
