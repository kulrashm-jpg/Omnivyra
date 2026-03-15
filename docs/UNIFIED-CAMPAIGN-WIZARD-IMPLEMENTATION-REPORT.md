# UNIFIED CAMPAIGN WIZARD IMPLEMENTATION REPORT

**Date:** March 12, 2025  
**Scope:** Unify campaign-details wizard and campaign-planner into a single wizard architecture

---

## FILES CREATED

| Path | Purpose |
|------|---------|
| `store/campaignWizardStore.ts` | Zustand store: single source of truth for wizard state. Persists per campaign via `campaign_wizard_state_v2_${campaignId}`. Exports `useCampaignWizard`, `useCampaignWizardStore`, `createCampaignWizardStore`. |
| `lib/wizard/campaignWizardAdapter.ts` | Migration layer: `hydrateWizardFromSnapshot()`, `hydrateWizardFromPlannerSession()`, `exportWizardToPlanningContext()`, `exportWizardToSaveWizardStatePayload()`. |
| `config/featureFlags.ts` | Feature flag `ENABLE_UNIFIED_CAMPAIGN_WIZARD` — reads from `NEXT_PUBLIC_ENABLE_UNIFIED_CAMPAIGN_WIZARD` or `ENABLE_UNIFIED_CAMPAIGN_WIZARD`. |

---

## FILES MODIFIED

| Path | Change Summary |
|------|----------------|
| `pages/campaign-details/[id].tsx` | When `ENABLE_UNIFIED_CAMPAIGN_WIZARD`: Uses `useCampaignWizard` for step, questionnaireAnswers, crossPlatformSharingEnabled, plannedStartDate, prePlanningResult. Legacy state retained with `*Legacy` suffix; unified variables switch based on flag. Hydrates wizard store from snapshot on load. DB save uses `exportWizardToSaveWizardStatePayload`; skips localStorage save (Zustand persist). Frequency validation writes to wizard store. `collectedPlanningContext` merges `exportWizardToPlanningContext` when flag enabled. |
| `components/planner/plannerSessionStore.ts` | On load: when flag enabled, hydrates wizard store from restored planner session. On state change: mirrors planner `strategy_context` into wizard store via `hydrateWizardFromPlannerSession`. |
| `components/planner/CalendarPlannerStep.tsx` | When `ENABLE_UNIFIED_CAMPAIGN_WIZARD`: Sends `cross_platform_sharing` from wizard store in planner-finalize request body. |
| `pages/api/campaigns/ai/plan.ts` | No changes — receives `collectedPlanningContext` from client; client now uses `exportWizardToPlanningContext` when flag enabled. |
| `pages/api/campaigns/planner-finalize.ts` | Already accepts `cross_platform_sharing`; no additional changes. |

---

## WIZARD STORE STRUCTURE

```ts
interface CampaignWizardState {
  campaignId?: string;
  step: number;
  durationWeeks: number;
  platforms: string[];
  contentMix: { post_per_week, video_per_week, blog_per_week, reel_per_week };
  crossPlatformSharingEnabled: boolean;
  questionnaireAnswers: WizardQuestionnaireAnswers;
  plannedStartDate: string;
  prePlanningResult: Record<string, unknown> | null;
  frequencySummary?: WizardFrequencySummary;
  validation?: WizardValidation;
}
```

**Actions:** `setStep`, `setDurationWeeks`, `setPlatforms`, `setContentMix`, `setDistributionMode`, `setQuestionnaireAnswers`, `setPlannedStartDate`, `setPrePlanningResult`, `setValidation`, `setFrequencySummary`, `resetWizard`.

**Persistence:** Zustand `persist` middleware; key `campaign_wizard_state_v2_${campaignId}`. Per-campaign stores via `getOrCreateStore(campaignId)`.

---

## MIGRATION LAYER

| Function | Purpose |
|----------|---------|
| `hydrateWizardFromSnapshot(snapshot)` | Converts `campaign_snapshot` (wizard_state, cross_platform_sharing, context_payload, execution_config) → `Partial<CampaignWizardState>`. |
| `hydrateWizardFromPlannerSession(session)` | Converts planner session (strategy_context, idea_spine) → `Partial<CampaignWizardState>`. |
| `exportWizardToPlanningContext(wizard)` | Converts wizard state → planning context for ai/plan (duration_weeks, platforms, content_mix, cross_platform_sharing, available_content, weekly_capacity, etc.). |
| `exportWizardToSaveWizardStatePayload(wizard)` | Converts wizard state → save-wizard-state API payload (step, questionnaire_answers, planned_start_date, cross_platform_sharing_enabled). |

---

## STATE FLOW

**Path A (campaign-details):**

1. User opens campaign-details/[id].
2. Load: API returns `wizardState`, `prefilledPlanning`.
3. When flag: `hydrateWizardFromSnapshot` → wizard store.
4. UI reads from `useCampaignWizard(id)`.
5. Changes → store → Zustand persist (localStorage).
6. DB save: 5s debounce → `exportWizardToSaveWizardStatePayload` → POST save-wizard-state.
7. AI Chat: `collectedPlanningContext` = `exportWizardToPlanningContext(store.getState())`.

**Path B (campaign-planner):**

1. User opens campaign-planner.
2. Load: `loadPersistedSession` restores planner state.
3. When flag: `hydrateWizardFromPlannerSession(restored)` → wizard store.
4. Planner changes → mirror effect: `hydrateWizardFromPlannerSession(state)` → wizard store.
5. Finalize: `cross_platform_sharing` from wizard store in POST planner-finalize.

---

## API INTEGRATION

| API | Usage |
|-----|-------|
| **POST /api/campaigns/ai/plan** | Client passes `collectedPlanningContext` built with `exportWizardToPlanningContext` when flag enabled. |
| **POST /api/campaigns/planner-finalize** | Client sends `cross_platform_sharing` from wizard store when flag enabled. |
| **POST /api/campaigns/[id]/save-wizard-state** | Client sends payload from `exportWizardToSaveWizardStatePayload(store.getState())` when flag enabled. |

---

## FEATURE FLAG BEHAVIOR

| `ENABLE_UNIFIED_CAMPAIGN_WIZARD` | Behavior |
|----------------------------------|----------|
| **false** (default) | Legacy: campaign-details uses `campaignWizardStorage` (localStorage) + local state. Planner uses existing session. No wizard store. |
| **true** | Unified: campaign-details and planner use `campaignWizardStore`. Zustand persist replaces wizard localStorage. Planner mirrors into wizard store. |

**Set via env:** `NEXT_PUBLIC_ENABLE_UNIFIED_CAMPAIGN_WIZARD=true` or `ENABLE_UNIFIED_CAMPAIGN_WIZARD=true`.

---

## TEST SCENARIOS

1. **campaign-details flow (flag off):** Create campaign from recommendation → wizard steps → localStorage save → DB save. Legacy behavior unchanged.
2. **campaign-details flow (flag on):** Same flow → wizard store used → Zustand persist → DB save via exportWizardToSaveWizardStatePayload.
3. **campaign-planner flow (flag on):** Strategy step → planner session persists → mirror into wizard store → finalize sends cross_platform_sharing.
4. **Refresh during wizard:** campaign-details: Zustand rehydrates from localStorage. planner: planner session rehydrates, then wizard store hydrated from it.
5. **Switching pages mid-wizard:** campaign-details A → campaign-planner (different campaignId) → each uses own store. campaign-details B → uses store for B.
6. **Finalizing campaign (planner):** POST planner-finalize with strategy_context + cross_platform_sharing from wizard store when flag on.

---

## EDGE CASES HANDLED

- **No campaignId (planner before finalize):** Global wizard store used; no campaign-scoped persist.
- **Planner has no distribution UI:** Wizard store defaults `crossPlatformSharingEnabled: true`; planner finalize sends shared mode.
- **Hydrate with partial data:** Adapter merges partial updates; missing fields left default.
- **Legacy localStorage vs DB:** When flag off, existing logic: DB vs local by timestamp. When flag on, hydrate from DB/latest; Zustand persist overwrites localStorage for that campaign.
- **Type alignment:** QuestionnaireAnswers shape aligned between store, adapter, and campaignWizardStorage for compatibility.
