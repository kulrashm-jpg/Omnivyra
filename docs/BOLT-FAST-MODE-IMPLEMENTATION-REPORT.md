# BOLT (Fast Mode) Implementation Report

**Objective:** Duration override hardening; BOLT option on theme cards; Fast Mode flow (skip AI Chat, generate weekly plan directly, mark mode "fast", badge on campaign-details, keep draft); no changes to theme generation, weekly plan storage, or Blueprint flow.

---

## 1. Files Modified

| File | Changes |
|------|--------|
| `backend/services/campaignAiOrchestrator.ts` | Duration override order; durationFromExecConfig from snapshot (TypeScript fix) |
| `components/recommendations/cards/RecommendationBlueprintCard.tsx` | `onBuildCampaignFast` prop; ⚡ BOLT button in both Actions sections |
| `components/recommendations/tabs/TrendCampaignsTab.tsx` | `onBuildCampaignFast` handler: validate execution bar, PUT/POST with `mode: "fast"`, POST plan API, redirect |
| `pages/api/campaigns/[id]/source-recommendation.ts` | Set `updatedSnapshot.mode = 'fast'` when `body.mode === 'fast'` |
| `pages/api/campaigns/index.ts` | POST: set `snapshotPayload.mode` from `body.mode`; GET: return `mode` from snapshot |
| `pages/campaign-details/[id].tsx` | State `campaignMode`; set from API; render ⚡ Fast Mode badge next to campaign name |

---

## 2. Diff Snippets

### 2.1 Duration override (orchestrator)

**File:** `backend/services/campaignAiOrchestrator.ts`

- **Order change:** `sourcedDurationWeeks` now prefers explicit chat duration over execution_config:

```ts
// duration source of truth — explicit chat override wins over execution_config
const sourcedDurationWeeks =
  explicitConversationDuration ??
  durationFromExecConfig ??
  dbDuration ??
  recommendationSeed ??
  toValidWeeks(input.durationWeeks);
```

- **Source of durationFromExecConfig:** Replaced use of `input.prefilledPlanning` (not on `CampaignAiPlanInput`) with version snapshot so TypeScript compiles and behavior is unchanged:

```ts
const snapshot = versionRow?.campaign_snapshot as Record<string, unknown> | null | undefined;
const execConfig = snapshot?.execution_config as Record<string, unknown> | null | undefined;
const durationFromExecConfig =
  execConfig != null && typeof execConfig.campaign_duration === 'number'
    ? toValidWeeks(execConfig.campaign_duration)
    : null;
```

### 2.2 New BOLT button (RecommendationBlueprintCard)

**File:** `components/recommendations/cards/RecommendationBlueprintCard.tsx`

- **Prop type:** `onBuildCampaignFast?: () => Promise<void> | void;`
- **Destructure:** `onBuildCampaignFast` added to props.
- **Button (minimized and full Actions):**

```tsx
<button
  type="button"
  onClick={() => run(onBuildCampaignFast)}
  disabled={busy || !onBuildCampaignFast}
  className="px-4 py-2 text-sm font-medium rounded-lg border border-amber-400 bg-amber-50 text-amber-800 hover:bg-amber-100 disabled:opacity-50"
>
  ⚡ BOLT
</button>
```

### 2.3 Fast handler (TrendCampaignsTab)

**File:** `components/recommendations/tabs/TrendCampaignsTab.tsx`

- **Validation:** Same execution bar as Blueprint (companyId, targetAudience, contentDepth, contentCapacity, campaignDurationInput ≥ 4, tentativeStartDate, campaignGoal, communicationStyle). If missing: `setValidationError('Complete the execution bar ... to use BOLT.')`.
- **PUT path (generatedCampaignId set):** `PUT /api/campaigns/[id]/source-recommendation` with `source_recommendation_id`, `source_strategic_theme`, `execution_config`, **`mode: 'fast'`**.
- **POST path (else):** `POST /api/campaigns` with same payload as Blueprint (id, companyId, name, description, status: 'planning', current_stage: 'planning', build_mode: 'no_context', source_opportunity_id, recommendation_id, target_regions, source_strategic_theme, execution_config, **`mode: 'fast'`**). No planning_context.
- **Plan API call:** After campaign id is known:

```ts
const planRes = await fetchWithAuth('/api/campaigns/ai/plan', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    campaignId: createdCampaignId,
    companyId,
    mode: 'generate_plan',
    message: 'Generate my 12-week plan now.',
    messages: [],
    durationWeeks: executionConfigPayload.campaign_duration,
    collectedPlanningContext,
    recommendationContext: sourceStrategicTheme,
  }),
});
```

- **Redirect:** `router.push(\`/campaign-details/${createdCampaignId}?mode=fast\`)`. AI Chat is not opened.

### 2.4 Snapshot mode merge

**File:** `pages/api/campaigns/[id]/source-recommendation.ts` (PUT)

```ts
if (body.mode === 'fast') {
  updatedSnapshot.mode = 'fast';
}
```

**File:** `pages/api/campaigns/index.ts` (POST)

```ts
if (campaignData.mode != null && typeof campaignData.mode === 'string') {
  snapshotPayload.mode = campaignData.mode;
}
```

### 2.5 Badge render (campaign-details)

**File:** `pages/campaign-details/[id].tsx`

- **State:** `const [campaignMode, setCampaignMode] = useState<string | null>(null);`
- **Load:** `setCampaignMode(campaignData.mode ?? null);` in `loadCampaignDetails` after `setCampaign(c)`.
- **GET response:** `pages/api/campaigns/index.ts` (type=campaign): `mode: (snapshot as { mode?: string } | null)?.mode ?? undefined`.
- **Badge (next to campaign name):**

```tsx
{campaignMode === 'fast' && (
  <span className="ml-2 text-xs px-2 py-1 rounded bg-yellow-100 text-yellow-800">
    ⚡ Fast Mode
  </span>
)}
```

---

## 3. Confirmations

| Requirement | Status |
|-------------|--------|
| Blueprint flow unchanged | ✅ `onBuildCampaignBlueprint` unchanged; only `onBuildCampaignFast` added. Theme generation and Build Campaign Blueprint paths untouched. |
| Fast mode skips AI Chat | ✅ BOLT calls plan API once with a single message and empty `messages`, then redirects to campaign-details; no chat UI opened. |
| Weekly plan generated immediately | ✅ `POST /api/campaigns/ai/plan` with `mode: 'generate_plan'`, full `collectedPlanningContext` from execution bar, and `recommendationContext` (theme). |
| execution_config present in snapshot | ✅ PUT and POST both send `execution_config`; source-recommendation and index already merge it into snapshot. |
| mode present in snapshot | ✅ PUT sets `updatedSnapshot.mode = 'fast'` when `body.mode === 'fast'`; POST sets `snapshotPayload.mode = body.mode`. GET returns `mode` from snapshot. |
| Campaign stays draft/planning | ✅ POST body uses `status: 'planning'`, `current_stage: 'planning'`. No auto-activate logic added. |
| Theme generation not modified | ✅ No changes to theme generation or recommendation engine. |
| Weekly plan storage not modified | ✅ No changes to twelve_week_plan storage or weekly scheduling engine. |
| Required fields logic not modified | ✅ No changes to required-fields validation beyond Fast path validation (execution bar required for BOLT). |

---

## 4. TypeScript Fix (Orchestrator)

**Issue:** `CampaignAiPlanInput` does not define `prefilledPlanning`; duration logic previously used `input.prefilledPlanning?.execution_config`, causing a type error.

**Change:** `durationFromExecConfig` is now derived from `versionRow.campaign_snapshot.execution_config` (same source used later when building prefilled planning). Duration priority remains: explicitConversationDuration → durationFromExecConfig (snapshot) → dbDuration → recommendationSeed → input.durationWeeks.

---

## 5. Build Status

- **TypeScript (orchestrator, card, tab, API, campaign-details):** No linter errors in modified files.
- **Full build:** Fails in **`components/recommendations/tabs/ActiveLeadsTab.tsx`** (line 352) due to Lucide `CheckCircle` `title` prop type — **unrelated to this implementation.** BOLT/Fast Mode and duration override changes compile.

---

## 6. Not Touched (Per Requirements)

- Recommendation engine
- `twelve_week_plan` storage
- Weekly scheduling engine
- AI Chat blueprint flow (open chat, conversation, then plan)
- Required-fields logic outside BOLT
- Theme generation
