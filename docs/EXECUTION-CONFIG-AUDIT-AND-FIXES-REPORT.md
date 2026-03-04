# Execution Config Audit & Fixes — Structured Report

**Objective:** Audit and fix (1) execution_config persistence only on Build Blueprint, (2) theme generation not storing execution_config, (3) DURATION ASSESSMENT reading campaign_duration from execution_config, (4) available_content / available_content_allocation still required and gathered, (5) no broken AI Chat logic from removed keys. No unrelated refactors.

---

## 1. Audit: Does Generate Strategic Themes Create Campaign?

### Search results

- **POST /api/campaigns:** Found in `components/recommendations/tabs/TrendCampaignsTab.tsx` at two call sites:
  - **Line 1086:** Inside `handleRun` (theme generation flow), when `trends.length > 0` after successful `/api/recommendations/generate`. Creates a campaign with name "Campaign from themes", description "Select a card and click Build Campaign Blueprint to set the strategic theme.", then calls `setGeneratedCampaignId(id)`.
  - **Line 1970:** Inside `onBuildCampaignBlueprint` (else branch), when `!generatedCampaignId` — i.e. user clicked Build Blueprint and no campaign was pre-created at theme generation. This is the “create new campaign” path for Build Blueprint.

- **setGeneratedCampaignId:** Set at line 1102 when the theme-generation POST succeeds; cleared at 1106 (on PUT success) and 1947 (after saving card to campaign).

- **generatedCampaignId:** Used at 1909 to decide between PUT source-recommendation (if set) vs POST campaigns (if not set).

### Answer

**Yes. A campaign is created at the theme generation stage.** When the user clicks “Generate Strategic Themes” and the engine returns trends, the code creates a campaign via `POST /api/campaigns` (lines 1086–1098) with body:

```ts
body: JSON.stringify({
  id: newCampaignId,
  companyId,
  name: 'Campaign from themes',
  description: 'Select a card and click Build Campaign Blueprint to set the strategic theme.',
  status: 'planning',
  current_stage: 'planning',
  build_mode: 'no_context',
}),
```

**execution_config is NOT included in that POST.** The theme-generation POST body contains only: id, companyId, name, description, status, current_stage, build_mode. No execution_config, planning_context, or source_strategic_theme.

**Conclusion:** No change required. execution_config is only sent when the user clicks “Build Campaign Blueprint” (PUT source-recommendation or POST /api/campaigns in the else branch).

---

## 2. Restrict execution_config Persistence

### Where execution_config is sent

| Location | Trigger | execution_config in body? |
|----------|--------|---------------------------|
| TrendCampaignsTab.tsx ~1090 | handleRun (Generate Strategic Themes) — POST /api/campaigns | **No** |
| TrendCampaignsTab.tsx ~1932 | onBuildCampaignBlueprint (generatedCampaignId set) — PUT source-recommendation | **Yes** (intended) |
| TrendCampaignsTab.tsx ~1970 | onBuildCampaignBlueprint (no generatedCampaignId) — POST /api/campaigns | **Yes** (intended) |

**buildStrategicPayload** (TrendCampaignsTab) adds `execution_config` to the payload sent to **/api/recommendations/generate** (theme generation API). That payload is not sent to POST /api/campaigns. The campaign creation at theme generation does not receive execution_config.

**Conclusion:** execution_config is only persisted when the user clicks “Build Campaign Blueprint” (PUT or POST as above). No fix required.

---

## 3. Fix Duration Logic

### Code changes

**File:** `backend/services/campaignAiOrchestrator.ts`

**A. Prompt-building function (durationWeeks for prompt/descriptor)**

Previously duration was taken from `input.durationWeeks` or `input.prefilledPlanning?.campaign_duration`. It did not consider `execution_config.campaign_duration`.

**Diff 1 — add durationFromExecConfig and use it in durationWeeks:**

```diff
  };

+  const durationFromExecConfig =
+    input.prefilledPlanning?.execution_config != null &&
+    typeof (input.prefilledPlanning.execution_config as Record<string, unknown>).campaign_duration === 'number'
+      ? toValidWeeks((input.prefilledPlanning.execution_config as Record<string, unknown>).campaign_duration)
+      : null;
  const durationWeeks =
    input.durationWeeks ??
+    (durationFromExecConfig ?? undefined) ??
    (typeof (input.prefilledPlanning?.campaign_duration as number) === 'number'
      ? (input.prefilledPlanning.campaign_duration as number)
      : undefined);
  const effectiveDurationWeeks = durationWeeks ?? 12;
```

**B. runCampaignAiPlan (sourcedDurationWeeks for plan execution)**

Previously: `sourcedDurationWeeks = explicitConversationDuration ?? dbDuration ?? recommendationSeed ?? toValidWeeks(input.durationWeeks)`.

**Diff 2 — prefer execution_config.campaign_duration:**

```diff
  const fromConversation = extractDurationFromConversation(input.conversationHistory ?? []);
  const dbDuration = toValidWeeks(campaignRow?.duration_weeks);
  const recommendationSeed = recommendationDurationSeed(input.recommendationContext);
  const explicitConversationDuration = toValidWeeks(fromConversation);

+  const durationFromExecConfig =
+    input.prefilledPlanning?.execution_config != null &&
+    typeof (input.prefilledPlanning.execution_config as Record<string, unknown>).campaign_duration === 'number'
+      ? toValidWeeks((input.prefilledPlanning.execution_config as Record<string, unknown>).campaign_duration)
+      : null;
+
  // duration source of truth
  const sourcedDurationWeeks =
-    explicitConversationDuration ??
+    durationFromExecConfig ??
+    explicitConversationDuration ??
    dbDuration ??
    recommendationSeed ??
    toValidWeeks(input.durationWeeks);
  const resolvedDurationWeeks = sourcedDurationWeeks ?? 12;
```

**Result:** When `prefilledPlanning.execution_config.campaign_duration` is a valid number (1–52), it is used for duration in both the prompt and plan execution. No error is thrown when a “gathered” campaign_duration is missing; the chain falls back to 12 weeks. DURATION ASSESSMENT RULE text already says “if campaign_duration is already known in ALREADY KNOWN” — and EXECUTION CONFIG is part of ALREADY KNOWN, so the model does not re-ask for duration when execution_config is present.

---

## 4. Audit available_content Fields

### Before fixes

- **GATHER_ORDER:** Did not include `available_content` or `available_content_allocation`. It started with action_expectation, topic_continuity, platforms, …
- **REQUIRED_EXECUTION_FIELDS:** Did not include `available_content`.
- **REQUIRED INFO TO GATHER** in the prompt still listed “1. available_content” and “2. available_content_allocation”, so the prompt and the gather/required logic were out of sync.

### Fixes applied

**A. GATHER_ORDER**

Added at the start (so they are gathered first):

- `available_content` — question about existing content (videos, posts, blogs) or “no”/“none”.
- `available_content_allocation` — contingent on `available_content`, for category/objective and week(s) per piece; skip when no content.

**Diff:**

```diff
 const GATHER_ORDER = [
+  {
+    key: 'available_content',
+    question:
+      'Do you have existing content (videos, posts, blogs) for this campaign? Answer "no", "none", or describe what you have.',
+  },
+  {
+    key: 'available_content_allocation',
+    question:
+      'For each existing piece, which category/objective and which week(s) should it fill? (Skip if you have no existing content.)',
+    contingentOn: 'available_content',
+  },
   {
     key: 'action_expectation',
     ...
```

**B. REQUIRED_EXECUTION_FIELDS**

Added `available_content` as the first required key. `available_content_allocation` remains conditional (contingentOn available_content) and is not in REQUIRED_EXECUTION_FIELDS.

**Diff:**

```diff
 const REQUIRED_EXECUTION_FIELDS = [
+  'available_content',
   'action_expectation',
   'topic_continuity',
   ...
 ] as const;
```

**C. Prompt line (Proceed to …)**

The rule said: after valid “no content” for available_content, “Proceed to tentative_start”. tentative_start was removed from the gather order.

**Diff:**

```diff
- Proceed to tentative_start. Do NOT re-ask.
+ Proceed to next question (platforms). Do NOT re-ask.
```

**Conclusion:** available_content is required and gathered first; available_content_allocation is gathered conditionally. Removed deterministic fields were not reintroduced.

---

## 5. Validate Required Keys Logic

- **REQUIRED_EXECUTION_FIELDS** (after fix): `available_content`, `action_expectation`, `topic_continuity`, `platforms`, `platform_content_requests`, `exclusive_campaigns`, `key_messages`.
- **GATHER_ORDER** (after fix): available_content, available_content_allocation (contingentOn), action_expectation, topic_continuity, platforms, platform_content_types, platform_content_requests, exclusive_campaigns, key_messages, success_metrics.

All keys in REQUIRED_EXECUTION_FIELDS appear in GATHER_ORDER except `available_content_allocation`, which is intentionally optional (contingent). `computeCampaignPlanningQAState` uses `requiredKeys: REQUIRED_EXECUTION_FIELDS` and `gatherOrder: GATHER_ORDER`; with available_content in both, missing-required logic will not fire incorrectly for available_content. No further changes made.

---

## 6. Confirm AI Chat Behavior

**When execution_config exists in snapshot (and is in prefilledPlanning):**

- **EXECUTION CONFIG** block is added to ALREADY KNOWN with: Target Audience, Professional Segment, Communication Style, Content Depth, Content Capacity, Campaign Duration, Tentative Start, Campaign Goal.
- **GATHER_ORDER** no longer includes target_audience, audience_professional_segment, communication_style, content_depth, content_capacity, campaign_duration, tentative_start, campaign_types.
- **REQUIRED INFO TO GATHER** lists only: available_content, available_content_allocation, platforms, platform_content_requests, exclusive_campaigns, key_messages, success_metrics.
- **CRITICAL RULES** say: “NEVER re-ask for information already in ALREADY KNOWN” and “DURATION: If campaign_duration is already known in ALREADY KNOWN, use it exactly and do not re-ask.”

So the AI will not ask about duration, audience, or communication style when execution_config is present. It will still ask: available_content, (conditionally) available_content_allocation, platforms, platform_content_requests, exclusive_campaigns, key_messages, success_metrics (and action_expectation, topic_continuity from GATHER_ORDER). This matches the intended behavior.

---

## 7. Summary of Code Changes

| File | Change |
|------|--------|
| `backend/services/campaignAiOrchestrator.ts` | (1) In prompt builder: derive `durationFromExecConfig` from `prefilledPlanning?.execution_config?.campaign_duration` via `toValidWeeks`; use it in `durationWeeks` before prefilledPlanning.campaign_duration. (2) In runCampaignAiPlan: same `durationFromExecConfig`; use it as first source in `sourcedDurationWeeks`. (3) GATHER_ORDER: prepend available_content and available_content_allocation (contingentOn: 'available_content'). (4) REQUIRED_EXECUTION_FIELDS: prepend 'available_content'. (5) Prompt: “Proceed to tentative_start” → “Proceed to next question (platforms)”. (6) PREPLANNING COMPLETE: “target_audience, campaign_types, platforms” → “e.g. platforms, key_messages”. |

**No changes to:**

- TrendCampaignsTab.tsx (theme generation POST already does not send execution_config).
- source-recommendation.ts or campaigns index.ts.
- Theme generation or weekly plan storage.

---

## 8. Final Lists (Post-Fix)

**GATHER_ORDER (order):**

1. available_content  
2. available_content_allocation (contingentOn: 'available_content')  
3. action_expectation  
4. topic_continuity  
5. platforms  
6. platform_content_types (contingentOn: 'platforms')  
7. platform_content_requests (contingentOn: 'platforms')  
8. exclusive_campaigns (contingentOn: 'platforms')  
9. key_messages  
10. success_metrics  

**REQUIRED_EXECUTION_FIELDS:**

- available_content  
- action_expectation  
- topic_continuity  
- platforms  
- platform_content_requests  
- exclusive_campaigns  
- key_messages  

---

## 9. Build Status

- **Lint:** No linter errors in `campaignAiOrchestrator.ts`.
- **Build:** Not run in this session. Existing failure in `ActiveLeadsTab.tsx` (Lucide icon) is unchanged and unrelated to these edits.

---

**End of report.**
