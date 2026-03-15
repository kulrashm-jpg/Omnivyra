# Product Optimization Analysis — Speed, Accuracy, Performance

**Scope:** AI chat in recommendation/campaign flow, and product-wide optimization opportunities.

---

## 1. AI Chat in Recommendation → Campaign Flow

### Entry Points

| Flow | Trigger | Components |
|------|---------|------------|
| **Recommendations → Build Blueprint** | TrendCampaignsTab → RecommendationBlueprintCard `onBuildCampaignBlueprint` | Creates/updates campaign → `router.push` to campaign-details → CampaignAIChat |
| **BOLT Fast** | `onBuildCampaignFast` | Same destination, skips AI chat; weekly plan generated server-side |
| **Campaign Details** | User opens AI chat on existing campaign | CampaignAIChat with `campaignId`, `recommendationContext`, `prefilledPlanning` |
| **Planner** | AIPlanningAssistantTab / StrategyAssistantPanel | Calls `/api/campaigns/ai/plan` with `preview_mode`, planner_command, or generate_plan |

### Identified Optimizations

#### 1.1 CampaignAIChat — Waterfall Fetches on Mount

**Current:** Four separate `useEffect` hooks, all keyed on `resolvedCompanyId`, fire sequential requests:

```
resolvedCompanyId changes
  → useEffect 1: /api/company-profile
  → useEffect 2: /api/company-plan-duration-limit  
  → useEffect 3: /api/platform-intelligence/catalog
  → useEffect 4: /api/company/platform-config
```

**Optimization:** Batch into a single effect with `Promise.all`:

```ts
useEffect(() => {
  if (!resolvedCompanyId) return;
  let cancelled = false;
  Promise.all([
    fetchWithAuth(`/api/company-profile?companyId=${encodeURIComponent(resolvedCompanyId)}`).then(r => r.ok ? r.json() : null),
    fetchWithAuth(`/api/company-plan-duration-limit?companyId=${encodeURIComponent(resolvedCompanyId)}`).then(r => r.ok ? r.json() : null),
    fetchWithAuth(`/api/platform-intelligence/catalog?companyId=${encodeURIComponent(resolvedCompanyId)}&activeOnly=true&strict=false`).then(r => r.ok ? r.json() : null),
    fetchWithAuth(`/api/company/platform-config?companyId=${encodeURIComponent(resolvedCompanyId)}`).then(r => r.ok ? r.json() : null),
  ]).then(([profile, durationLimit, catalog, platformConfig]) => {
    if (cancelled) return;
    // setCompanyKeyMessages, setPlanDurationLimit, setPlatformCatalogPlatforms, setCompanyConfiguredPlatforms
  });
  return () => { cancelled = true; };
}, [resolvedCompanyId]);
```

**Impact:** Faster time-to-interactive when opening AI chat (single round-trip instead of 4 sequential).

---

#### 1.2 Duplicate `retrieve-plan` Refetches

**Current:** After `create-12week-plan` and `schedule-structured-plan`, the code explicitly refetches `retrieve-plan`:

```ts
const refetchRes = await fetch(`/api/campaigns/retrieve-plan?campaignId=...`);
```

**Optimization:** Return the updated plan from the create/schedule API responses instead of a second round-trip. Or use a shared `useRetrievePlan(campaignId)` hook with `invalidate` on success.

**Impact:** One fewer request per plan creation / schedule action.

---

#### 1.3 Recommendation Prefill Gap (from BOLT audit)

**Current:** When navigating with only `recommendationId` (no `sourceTheme` in URL), `source_theme` is null. The planner does not fetch the recommendation by ID to prefill `CampaignContextBar`.

**Optimization:** Add `useEffect` in campaign-planner or `CampaignContextBar` to fetch `GET /api/recommendations/[id]` when `recommendationId` is present and `source_theme` is null; populate context from response.

**Impact:** Better accuracy — AI receives full recommendation context; fewer redundant questions.

---

#### 1.4 Duplicate `onBackToRecommendation` Prop (Bug)

**File:** `pages/campaign-details/[id].tsx` (lines ~4052–4061)

**Current:** `onBackToRecommendation` is passed twice to `CampaignAIChat`.

**Optimization:** Remove the duplicate prop.

**Impact:** Cleaner code; no behavioral change.

---

#### 1.5 AI Plan API — Sequential Auth/DB Calls

**File:** `pages/api/campaigns/ai/plan.ts`

**Current flow:**
1. `versionForAccess` (DB) → get `company_id`
2. `getUserCompanyRole`
3. `getCompanyRoleIncludingInvited` (if no role)
4. `resolveEffectiveCampaignRole` (if not override)
5. `getCampaignPlanningInputs`

**Optimization:** After `versionForAccess`, run in parallel:
- `getUserCompanyRole` + `getCampaignPlanningInputs` (planning inputs do not depend on role)
- Then `getCompanyRoleIncludingInvited` and `resolveEffectiveCampaignRole` only if needed.

**Impact:** Slightly faster plan API latency on the cold path.

---

#### 1.6 Plan Generation — Non-Streaming

**Current:** Plan generation is non-streaming. `AIGenerationProgress` shows estimated timing based on `getWeeklyPlanTimingByWeeks` only.

**Optimization:** Add SSE streaming for plan generation (chunked week-by-week) so the UI can show partial results and perceived latency drops.

**Impact:** Better perceived performance; user sees progress earlier.

---

#### 1.7 CampaignAIChat Component Size

**Current:** ~8,400 lines in a single component.

**Optimization:**
- Extract hooks: `useCampaignChatState`, `usePlatformOptions`, `useQuickPickConfig`, `useChatMessages`
- Extract subcomponents: `QuickPickPanel`, `FormattedAIMessage`, `CommandPalette`
- Lazy-load heavy features (e.g. audit report, forecast) via `React.lazy`

**Impact:** Faster initial load, easier maintenance, fewer re-renders from localized state.

---

## 2. Product-Wide Optimizations (Already Applied or Recommended)

### 2.1 Campaign Store Consolidation ✅ (Done)

- `getCampaignStatus`, `getCampaignById`, `getCampaignsByIds`, `getCampaignCount` in `backend/db/campaignStore.ts`
- Replaced duplicate `supabase.from('campaigns')` reads across viralityGateService, GovernanceMetricsService, CampaignPrePlanningService, campaignAiOrchestrator, PortfolioConstraintEvaluator, recommendations API, system overview, planner-finalize, create-12week-plan

### 2.2 Community AI Duplication (Recommended)

- **getCommunityAiActionById:** Duplicate in `actions/execute.ts` and `actions/approve.ts` — add `backend/db/communityAiActionStore.ts`
- **getCommunityAiConnectorCallbackUrl:** Repeated in 10 connector auth/callback files — add to `connectors/utils.ts`
- **extractAccessToken:** Duplicated in 7+ files — export from `supabaseAuthService` and reuse

### 2.3 Backend Parallelization Patterns

Many services already use `Promise.all`:
- `viralityGateService` — readiness, diagnostics, status
- `CampaignPrePlanningService` — contentAssets, campaignVersion, profile, campaign
- `GovernanceMetricsService` — logs, campaigns, requests
- `communityAiForecastInsightsService` — forecast, trend, kpis, content summary
- `campaign-details` — statusRes, eventsRes, analyticsRes, driftRes

Continue this pattern where multiple independent I/O steps exist.

---

## 3. Accuracy Optimizations

### 3.1 Recommendation Context Propagation

**Current:** `recommendationContext` (target_regions, context_payload, source_opportunity_id, topic_from_card) is passed into CampaignAIChat and merged into `collectedPlanningContext` for the plan API.

**Verify:** Ensure `target_regions` and `context_payload` flow through to `runCampaignAiPlan` and are included in the prompt. Audit `campaignAiOrchestrator` and `buildCompanyContext` for these fields.

### 3.2 Moderation Layer

**Current:** `validateAndModerateUserMessage` runs on every plan API message via `moderateChatMessage` (aiGateway). Uses gpt-4o-mini with temperature 0 and JSON output.

**Optimization:** Consider caching or batching for repeated/similar messages if moderation becomes a bottleneck. Low priority given the cost/latency profile.

### 3.3 Planning Inputs Merge Order

**Current:** `deterministicPlanningContext` (from DB) is merged with `collectedPlanningContext` (client) and `campaign_direction`. Order: `existingCollectedPlanningContext` → `deterministicPlanningContext` → `campaign_direction`.

**Verify:** Order matches product intent (DB inputs override client, except for `campaign_direction`).

---

## 4. Performance Quick Wins (by Effort)

| Optimization | Effort | Impact | Location |
|--------------|--------|--------|----------|
| Parallelize CampaignAIChat company fetches | Low | Medium | CampaignAIChat.tsx |
| Remove duplicate onBackToRecommendation | Low | Low | campaign-details/[id].tsx |
| Add getCommunityAiActionById | Low | Low | community-ai actions |
| Export extractAccessToken | Low | Low | supabaseAuthService |
| Recommendation prefill when recommendationId only | Medium | Medium | campaign-planner / CampaignContextBar |
| Eliminate retrieve-plan refetch | Medium | Low | CampaignAIChat + create/schedule APIs |
| Split CampaignAIChat into hooks/components | High | Medium | CampaignAIChat.tsx |
| Stream plan generation | High | High | ai/plan, campaignAiOrchestrator |

---

## 5. Summary

**Highest impact:**
1. Parallelizing CampaignAIChat’s initial fetches (simple, noticeable for chat open time).
2. Recommendation prefill when entering from recommendations without `sourceTheme`.
3. Streaming plan generation (larger change, best perceived performance).

**Accuracy:**
- Confirm recommendation context (target_regions, context_payload) is used end-to-end in the plan pipeline.
- Fix duplicate `onBackToRecommendation` prop.

**Consolidation (already in progress):**
- Campaign store consolidation is done.
- Community AI store and connector/utils helpers are the next logical step.
