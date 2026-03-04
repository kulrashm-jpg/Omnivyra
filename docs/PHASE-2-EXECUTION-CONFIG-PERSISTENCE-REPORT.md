# Phase 2 — Execution Config Persistence & AI Chat Refactor — Implementation Report

**Objective:** Persist `execution_config` when clicking "Build Campaign Blueprint," merge it into `campaign_versions.campaign_snapshot`, remove duplicated deterministic questions from AI Chat, prefill `execution_config` into AI Chat context, and prevent layout shift in the Execution Configuration section. Theme generation and weekly plan storage logic were not modified.

---

## 1. Files Modified

| File | Changes |
|------|--------|
| `components/recommendations/tabs/TrendCampaignsTab.tsx` | (1) PUT body: added `execution_config` built from state; (2) POST body (fallback create): added `execution_config`; (3) Execution Configuration: wrapped toggleable content in fixed-height container `min-h-[240px]`, collapsed summary vertically centered. |
| `pages/api/campaigns/[id]/source-recommendation.ts` | Merge `body.execution_config` into `updatedSnapshot` when present (object, not array). |
| `pages/api/campaigns/index.ts` | (1) POST handler: merge `campaignData.execution_config` into `snapshotPayload` when creating campaign; (2) GET handler (type=campaign): add `pre.execution_config = snap.execution_config` when building prefilledPlanning. |
| `backend/services/campaignAiOrchestrator.ts` | (1) Removed from GATHER_ORDER: target_audience, audience_professional_segment, communication_style, content_depth, tentative_start, campaign_types, content_capacity, campaign_duration; (2) Removed same keys from REQUIRED_EXECUTION_FIELDS; (3) Updated "REQUIRED INFO TO GATHER" prompt (removed items 1, 4, 5, 6, 7, renumbered); (4) Prefilled block: filter out `execution_config` from generic ALREADY KNOWN entries; added `executionConfigBlock` that lists Target Audience, Professional Segment, Communication Style, Content Depth, Content Capacity, Campaign Duration, Tentative Start, Campaign Goal when `prefilledPlanning.execution_config` exists; (5) `buildPrefilledPlanning`: inject `prefilled.execution_config` from `v.campaign_snapshot.execution_config`. |

---

## 2. Diff Snippets

### 2.1 PUT body change (TrendCampaignsTab.tsx)

**Location:** Inside `onBuildCampaignBlueprint`, when `generatedCampaignId` is set.

**Added before the PUT call:** Build `executionConfigPayload` from component state when all required execution fields are set; pass it in the body.

```ts
const executionConfigPayload =
  targetAudience &&
  contentDepth &&
  contentCapacity &&
  campaignDurationInput >= 4 &&
  tentativeStartDate &&
  campaignGoal &&
  communicationStyle.length > 0
    ? {
        target_audience: targetAudience,
        professional_segment: professionalSegment ?? null,
        communication_style: communicationStyle,
        content_depth: contentDepth,
        content_capacity: contentCapacity,
        campaign_duration: campaignDurationInput,
        tentative_start: tentativeStartDate.toISOString(),
        campaign_goal: campaignGoal,
      }
    : null;
```

**Body change:**

```diff
 body: JSON.stringify({
   source_recommendation_id: recId || null,
   source_strategic_theme: sourceStrategicTheme,
+  execution_config: executionConfigPayload,
 }),
```

The same `executionConfigPayload` construction and `execution_config` key were added to the **POST /api/campaigns** body in the fallback (else) branch when creating a new campaign.

---

### 2.2 Snapshot merge (source-recommendation.ts)

**Location:** After merging `source_strategic_theme` into `updatedSnapshot`, before the Supabase update.

**Added:**

```ts
const execution_config = body.execution_config;
if (execution_config != null && typeof execution_config === 'object' && !Array.isArray(execution_config)) {
  updatedSnapshot.execution_config = execution_config as Record<string, unknown>;
}
```

Only the `execution_config` key is added or replaced; the rest of the snapshot is unchanged. TypeScript: body is untyped; we guard and cast for the assignation.

---

### 2.3 POST campaign creation — snapshot (pages/api/campaigns/index.ts)

**Location:** After setting `snapshotPayload.source_strategic_theme`, before the `campaign_versions` insert.

**Added:**

```ts
const execution_config = campaignData.execution_config ?? campaignData.executionConfig;
if (execution_config != null && typeof execution_config === 'object' && !Array.isArray(execution_config)) {
  snapshotPayload.execution_config = execution_config;
}
```

---

### 2.4 GET campaign — prefilledPlanning (pages/api/campaigns/index.ts)

**Location:** Inside the block that builds `pre` from `snap`, before `if (Object.keys(pre).length > 0) prefilledPlanning = pre`.

**Added:**

- Extended `snap` type to include `execution_config?: Record<string, unknown>`.
- After setting `pre.theme_or_description`:

```ts
if (snap.execution_config != null && typeof snap.execution_config === 'object' && !Array.isArray(snap.execution_config)) {
  pre.execution_config = snap.execution_config;
}
```

So CampaignAIChat receives `prefilledPlanning.execution_config` from the campaign GET response when the snapshot has it.

---

### 2.5 GATHER_ORDER changes (campaignAiOrchestrator.ts)

**Removed entries (keys):**

- `target_audience`
- `audience_professional_segment`
- `communication_style`
- `content_depth`
- `tentative_start`
- `campaign_types`
- `content_capacity`
- `campaign_duration`

**Left in GATHER_ORDER (in order):**

- `action_expectation`
- `topic_continuity`
- `platforms`
- `platform_content_types` (contingentOn: 'platforms')
- `platform_content_requests` (contingentOn: 'platforms')
- `exclusive_campaigns` (contingentOn: 'platforms')
- `key_messages`
- `success_metrics`

---

### 2.6 REQUIRED_EXECUTION_FIELDS changes (campaignAiOrchestrator.ts)

**Before:**  
`target_audience`, `audience_professional_segment`, `communication_style`, `action_expectation`, `content_depth`, `topic_continuity`, `tentative_start`, `content_capacity`, `campaign_duration`, `platforms`, `platform_content_requests`, `exclusive_campaigns`, `key_messages`

**After:**  
`action_expectation`, `topic_continuity`, `platforms`, `platform_content_requests`, `exclusive_campaigns`, `key_messages`

`OPTIONAL_EXECUTION_FIELDS` is unchanged: `success_metrics`, `campaign_types`.

---

### 2.7 Prompt block changes — "REQUIRED INFO TO GATHER" (campaignAiOrchestrator.ts)

**Before (12 items):**  
1. target_audience — Who is your primary target audience?  
2. available_content — …  
3. available_content_allocation — …  
4. tentative_start — When do they want to start? …  
5. campaign_types — Which matter most …  
6. content_capacity — Per format …  
7. campaign_duration — How many weeks …  
8. platforms — …  
9. platform_content_requests — …  
10. exclusive_campaigns — …  
11. key_messages — …  
12. success_metrics — …

**After (7 items):**  
1. available_content — …  
2. available_content_allocation — …  
3. platforms — …  
4. platform_content_requests — …  
5. exclusive_campaigns — …  
6. key_messages — …  
7. success_metrics — …

All references to target_audience, tentative_start, campaign_types, content_capacity, and campaign_duration were removed from this list. The DURATION ASSESSMENT RULE and other rules that refer to “ALREADY KNOWN” still apply; when `execution_config` is present, duration/start/audience/etc. are in ALREADY KNOWN and the AI does not re-ask.

---

### 2.8 Prefilled injection — ALREADY KNOWN / execution_config (campaignAiOrchestrator.ts)

**1) Filter execution_config out of generic ALREADY KNOWN:**

```ts
.filter(([k]) => k !== 'preplanning_form_completed' && k !== 'recommended_topics' && k !== 'strategic_themes' && k !== 'execution_config')
```

**2) New block when `prefilledPlanning.execution_config` exists:**

```ts
const execConfig = input.prefilledPlanning?.execution_config as Record<string, unknown> | null | undefined;
const executionConfigBlock =
  execConfig && typeof execConfig === 'object' && !Array.isArray(execConfig)
    ? `
EXECUTION CONFIG (from Trend Execution Configuration bar — do NOT re-ask these):
- Target Audience: ${String(execConfig.target_audience ?? '—')}
- Professional Segment: ${String(execConfig.professional_segment ?? '—')}
- Communication Style: ${Array.isArray(execConfig.communication_style) ? execConfig.communication_style.join(', ') : String(execConfig.communication_style ?? '—')}
- Content Depth: ${String(execConfig.content_depth ?? '—')}
- Content Capacity: ${String(execConfig.content_capacity ?? '—')}
- Campaign Duration: ${String(execConfig.campaign_duration ?? '—')} weeks
- Tentative Start: ${String(execConfig.tentative_start ?? '—')}
- Campaign Goal: ${String(execConfig.campaign_goal ?? '—')}
`
    : '';
```

This string is appended to the ALREADY KNOWN block (after the generic entries). So when the campaign has `execution_config` in snapshot and it is returned in `prefilledPlanning`, the AI sees these as “do NOT re-ask.”

**3) buildPrefilledPlanning (orchestrator):**  
At the end of the function, before `return prefilled`:

```ts
const execConfig = (v?.campaign_snapshot as Record<string, unknown> | undefined)?.execution_config;
if (execConfig != null && typeof execConfig === 'object' && !Array.isArray(execConfig)) {
  prefilled.execution_config = execConfig;
}
```

So any path that builds prefilled from `versionRow`/`campaign_snapshot` (e.g. plan API or internal call) can pass `execution_config` through to the prompt.

---

### 2.9 Layout container change (TrendCampaignsTab.tsx)

**Structure change:** The toggleable content (collapsed summary vs. expanded grid) is wrapped in a fixed-height container so height does not change between states.

**Added wrapper:**

```tsx
<div className="relative min-h-[240px] transition-all duration-200">
  {executionCollapsed && (
    <div className="absolute inset-0 flex items-center">
      <div className="text-xs text-muted-foreground flex flex-wrap gap-2">
        {/* summary spans unchanged */}
      </div>
    </div>
  )}
  {!executionCollapsed && (
    <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
      {/* grid content unchanged */}
    </div>
  )}
</div>
```

- The outer `min-h-[240px]` reserves height so Strategic selectors and theme cards no longer jump when toggling.
- When collapsed, the summary is vertically centered inside this area via `absolute inset-0 flex items-center`.
- `transition-all duration-200` allows optional future animation; collapse/expand does not change the reserved height.

---

## 3. Confirmation: AI Chat no longer asks removed questions

- **GATHER_ORDER** no longer contains: target_audience, audience_professional_segment, communication_style, content_depth, content_capacity, campaign_duration, tentative_start, campaign_types. So the one-by-one questioning flow does not ask them.
- **REQUIRED_EXECUTION_FIELDS** no longer includes those keys, so validation and “required keys” logic do not demand them from the chat.
- **REQUIRED INFO TO GATHER** no longer lists those items; the prompt tells the model to gather only the 7 remaining items (available_content through success_metrics).
- When `prefilledPlanning.execution_config` is present, **EXECUTION CONFIG (from Trend Execution Configuration bar — do NOT re-ask these)** is added to ALREADY KNOWN with Target Audience, Professional Segment, Communication Style, Content Depth, Content Capacity, Campaign Duration, Tentative Start, Campaign Goal. The existing rule “NEVER re-ask for information already in ALREADY KNOWN” prevents the AI from re-asking those.

So the AI no longer asks the removed deterministic questions when execution_config is present; and it cannot ask them as part of the standard gather order in any case.

---

## 4. Confirmation: execution_config appears in campaign_snapshot

- **PUT path:** User clicks “Build Campaign Blueprint” with an existing campaign (from Generate Themes). Frontend sends `execution_config` in the body. `source-recommendation.ts` sets `updatedSnapshot.execution_config = body.execution_config` and updates the row with `campaign_snapshot: updatedSnapshot`. So the latest `campaign_versions.campaign_snapshot` includes `execution_config`.
- **POST path:** User clicks “Build Campaign Blueprint” without a pre-created campaign. Frontend sends `execution_config` in the POST body. `pages/api/campaigns/index.ts` sets `snapshotPayload.execution_config = execution_config` and inserts the first `campaign_versions` row with that `campaign_snapshot`. So the new campaign’s snapshot includes `execution_config`.

In both flows, `execution_config` is stored only as a key inside the existing snapshot object; no other snapshot or versioning logic was changed.

---

## 5. Confirmation: layout no longer shifts

- The Execution Configuration block now has an inner container with `min-h-[240px]`. Collapsed and expanded states both render inside this same height.
- Collapsed state uses `absolute inset-0 flex items-center` so the summary line is centered and does not change the container height.
- Strategic selectors, theme cards, and recommendation grid are below this container; their vertical position is stable when toggling Edit/Collapse, so there is no vertical jump.

---

## 6. TypeScript fixes

- **source-recommendation.ts:** No new types; `body` is `req.body`. We guard `execution_config` with `!= null`, `typeof ... === 'object'`, and `!Array.isArray(...)`, then assign as `execution_config as Record<string, unknown>`.
- **pages/api/campaigns/index.ts:** `snap` type extended to include `execution_config?: Record<string, unknown>` where prefilledPlanning is built. No other type changes.
- **campaignAiOrchestrator.ts:** `execConfig` for the prompt block is cast as `Record<string, unknown> | null | undefined`; we guard before use. `buildPrefilledPlanning` reads `(v?.campaign_snapshot as Record<string, unknown>)?.execution_config`. No new linter errors in the modified files.

---

## 7. Build status

- **Lint:** No linter errors in TrendCampaignsTab.tsx, source-recommendation.ts, index.ts (campaigns), or campaignAiOrchestrator.ts.
- **Build:** `npm run build` still fails due to an **existing** error in `components/recommendations/tabs/ActiveLeadsTab.tsx` (Lucide `CheckCircle` `title` prop), not in any of the Phase 2–modified files. Phase 2 changes do not introduce new build errors.

---

## 8. What was not modified

- Theme generation API and recommendation engine: unchanged.
- Weekly plan storage, twelve_week_plan, create-12week-plan: unchanged.
- campaign_versions versioning logic (e.g. approve-strategy, new version rows): unchanged.
- AI Chat plan API contract and persistence to twelve_week_plan: unchanged; only the gather order, required fields, prompt text, and prefilled/ALREADY KNOWN content were updated.

---

**End of report.**
