# Campaign Plan API: Performance and Validation

## Multi-tenant safety (multiple companies)

The plan API is safe for production with **multiple companies**:

- **Access is enforced before any heavy work**: The API verifies the authenticated user has access to the campaign’s company and the campaign itself (same pattern as `strategy-status` and other campaign APIs).
- **Company is never taken from the client**: `company_id` is always resolved from the database (campaign → latest campaign_version → company_id). The request body’s `companyId` is **not** used for authorization or for choosing which company’s data to load or write.
- **Checks performed** (in order, fail-fast):
  1. `getSupabaseUserFromRequest(req)` → 401 if not authenticated.
  2. Load campaign’s `company_id` from `campaign_versions` by `campaign_id` → 404 if campaign/version not found.
  3. `getUserRole(user.id, resolvedCompanyId)` → 403 if `COMPANY_ACCESS_DENIED` or no role.
  4. `resolveEffectiveCampaignRole(user.id, campaignId, resolvedCompanyId)` → 403 if `CAMPAIGN_ROLE_REQUIRED`.
- **Persistence** uses only `resolvedCompanyId` (from DB) for `saveCampaignPlanningInputs`, so one company cannot write into another company’s planning inputs.

So we do **not** rely on a single company or a single user; every request is scoped to the campaign’s company and the user’s access to that company and campaign.

## No loops

The campaign plan flow does **not** create any infinite or unbounded loops.

- **LLM calls** are at most **three** in the worst case, each a single attempt:
  1. Initial `generateCampaignPlan` (weekly plan).
  2. **Parse repair** (one retry if output fails to parse and we have a deterministic skeleton).
  3. **Validation repair** (one retry if plan violates skeleton constraints).
  4. **Alignment regeneration** (one retry if alignment score is below threshold; **skipped on fast path**).

- All `for`/`while` usages in the orchestrator iterate over fixed arrays (weeks, slots, platforms, etc.); none are unbounded.

## Required inputs (X) and fail-fast

Before any heavy work (company profile, snapshot, LLM), the backend now validates:

| Requirement | When checked | If missing |
|-------------|----------------|------------|
| Campaign row | Right after `campaigns` + version fetch | Throw: "Campaign not found. Please save the campaign and try again." |
| Campaign version | Same | Throw: "Campaign version not found. Please save the campaign and try again." |

So we **do not** wait on missing X: we fail fast with a clear error instead of running the full pipeline and then failing or timing out.

## Fast path ("Yes, proceed with N weeks")

When the user message looks like a plan confirmation (e.g. "Yes, proceed with 4 weeks") and there is conversation history:

1. **Company profile is skipped** — We do not call `getProfile` on the fast path, so we avoid that latency and load.
2. **Snapshot + virality assessment are skipped** — We use `createLightweightContext` (no `buildCampaignSnapshotWithHash`, no `assessVirality`).
3. **Baseline context is not resolved** — We set `baselineContext = { unavailable: true }`.
4. **Alignment regeneration is skipped** — After the first LLM response we do not run the extra alignment pass that can trigger a second/third LLM call.

So the fast path does **one** LLM call for plan generation (plus at most one parse or validation repair if needed), and no company profile or snapshot work.

## Flow summary

```
API handler
  → validate campaignId, mode, message
  → getCampaignPlanningInputs, build finalCollectedPlanningContext
  → runCampaignAiPlan
      → Fetch campaign + version (parallel)
      → Fail fast if generate_plan and (no campaign or no version)
      → Compute useFastPath from conversation + last user message
      → If !useFastPath: load company profile (getProfile)
      → If useFastPath: createLightweightContext (no profile, no snapshot)
      → Else: tryFullPipeline (snapshot, assessVirality, getPlatformStrategies) or fallback to lightweight
      → Build prefilledPlanning, qaState, planSkeleton
      → runWithContext
          → If not readyToGenerate: return next question (no LLM)
          → buildPromptContext → generateCampaignPlan (1st LLM)
          → Parse; if fail and have skeleton: repair (2nd LLM)
          → Validate vs skeleton; if fail: repair (2nd/3rd LLM)
          → If !fastPath and alignment low: regeneration (3rd LLM)
          → Enrich, normalize, return plan
```

## Making it quick and accurate

- **Quick**: Fail fast on missing campaign/version; fast path skips profile + snapshot + alignment regeneration; at most one LLM call on fast path (plus optional parse/validation repair).
- **Accurate**: Full path still runs when the message is not a simple confirmation; validation and skeleton repair keep the plan structurally correct; alignment regeneration still runs on the full path when alignment score is low.

## Strategic theme card → week plan (campaign from themes)

When a campaign is created from a recommendation/theme card (Build Campaign Blueprint), the plan API must receive the full theme so the week plan aligns with it:

1. **GET /api/campaigns** (campaign-details load): `recommendationContext.context_payload` is built by merging `campaign_snapshot.context_payload` with `campaign_snapshot.source_strategic_theme`, so the plan API gets progression_summary, themes, duration_weeks, intelligence, etc.
2. **Orchestrator** `mapRecommendationContextToGatherKeys`: maps from `recommendationContext.context_payload` into `prefilledPlanning` — including `strategic_themes`, `strategic_theme_progression`, `strategic_theme_duration_weeks`, `strategic_theme_intelligence`. These feed the prompt so the LLM aligns weekly themes and duration to the card.
3. **User answers** (e.g. “aligned to the theme”, “Yes, proceed with 4 weeks”) are merged in the plan API from conversation history and `collectedPlanningContext`, so key_messages and duration are preserved.

If the theme is not reflected in the generated plan, verify that the campaign has `source_strategic_theme` on the latest version’s `campaign_snapshot` and that the client sends `recommendationContext` (and conversation history) when calling the plan API.

## Timeout (5–10 minutes by weeks)

Plan generation can take several minutes depending on number of weeks and complexity. The frontend request timeout scales with requested duration:

- **Base**: 5 minutes.
- **Per week**: +45 seconds per week (e.g. 4 weeks → ~8 min, 12 weeks → capped at 10 min).
- **Cap**: 10 minutes.

So 4-week plans get ~8 minutes to reduce “took too long” on the theme-based flow; 12-week plans get the full 10 minutes. The timeout message suggests picking a duration and clicking Submit to retry, or saying **continue** to retry with the same settings.

## Restore on retry (no reprocessing when unchanged)

When the user retries after a timeout or says "continue" / "try again" with the **same** duration as an existing draft:

1. The API checks for a **restore point**: latest draft plan for the campaign (`twelve_week_plan` with `status = 'draft'`).
2. If the draft’s week count matches the requested `durationWeeks`, the API **returns that draft** without calling the orchestrator or the LLM.
3. The client receives the same plan as before, so there is no duplicate processing when nothing has changed.

So: first run may time out; user says "continue" (or picks the same duration and Submit). If a draft for that duration was already saved (e.g. from an earlier successful run), the next request is served from the restore point. True “resume from mid-generation” (e.g. saving partial weeks and continuing later) would require week-by-week generation and checkpointing in the orchestrator and is not implemented here.
