# Billed AI clients → canonical helper + Idempotency-Key (tracker)

**Owner:** UI tab. **Coordinator:** e9. **Server side:** e1 (wirePhase2Route standard shape), 55 (C75 / Market Pulse).

**Why this exists (e9 ruling, 2026-11-13).** The billing enforcement flip is GATED on this list being EMPTY. No billed route may be enforced while a client calling it lacks:
1. **an `Idempotency-Key`**, minted once per user action, reused while it's in flight, and freed when it ends (`createBilledActionKeyGate` in `lib/idempotency.ts`). Without it a double-click double-charges.
2. **the canonical response mapping** (`classifyBilledResponse` / `billedOutcomeText` in `lib/billing/billedResponse.ts`). Without it users see raw codes and an `ALREADY_PROCESSED` success looks like an error.

**Standard server shape**, keyed on status + `code` only:
- 402 `{ error, code: INSUFFICIENT_CREDITS | NO_CREDIT_ACCOUNT | PRICING_UNAVAILABLE, required?, balance? }`
- 409 `{ error, code: ALREADY_PROCESSED }`: success; refresh.
- 409 `{ error, code: ALREADY_RELEASED }`: earlier attempt failed and wasn't charged; offer "try again" with a NEW key.

**A route is DONE when:** its server returns the standard shape (e1/55 confirm), AND every client file below sends the key and routes errors through the helper, AND a test pins both (pattern: `backend/tests/unit/billedResponseHelper.test.tsx`).

**Start condition for the batches below:** e1's `fix/phase2-route-wiring-token-actual` lands and returns the standard shape.

## Done

| Route | Client files | Commit |
|---|---|---|
| `/api/market-pulse/run` | `components/recommendations/tabs/MarketPulseTabV2Controller.tsx` | e82d21f8c |
| `/api/ai/blog-card-chat` | `components/blog/AIBlogCardModal.tsx` | e82d21f8c |
| `/api/content/regenerate` | `components/campaign-ai/useCampaignAiOps.ts` | e82d21f8c |
| `/api/activity-workspace/content` (`refine_variant`) | `hooks/useActivityWorkspaceRefinementOps.ts` | e82d21f8c |
| `/api/content/suggest` | `components/content/SuggestWithAIPanel.tsx` | e82d21f8c |

## To migrate (wirePhase2Route-billed), in planned batches

Batches group screens that share a feature, so each one can be reviewed and checked as a unit. They're ordered by customer exposure.

### Batch 1: Recommendations & trend campaigns (high traffic)
- [ ] `/api/recommendations/generate`: `components/recommendations/hooks/useTrendCampaigns.ts`, `components/recommendations/tabs/useTrendCampaignsHandlers.tsx`, `hooks/useRecommendationsState.tsx`
- [ ] `/api/recommendations/[id]/preview-strategy`: `hooks/useCampaignPlanningState.tsx`, `hooks/useRecommendationsState.tsx`
- [ ] `/api/recommendations/detected-opportunities`: `hooks/useRecommendationsState.tsx`
- [ ] `/api/recommendations/group-preview`: `hooks/useRecommendationsState.tsx`

### Batch 2: Campaign planning
- [ ] `/api/campaigns/run-preplanning`: `hooks/useCampaignDetailsHandlers.tsx`, `lib/campaign-details/usePrePlanningActions.ts`
- [ ] `/api/campaigns/suggest-duration`: `hooks/useCampaignDetailsCore.tsx`, `lib/campaign-details/usePrePlanningActions.ts`
- [ ] `/api/planner/chat-themes`: `components/planner/StrategyAIChat.tsx`
- [ ] `/api/planner/skeleton-command`: `components/planner/SkeletonBuilderPanel.tsx`
- [ ] `/api/campaign-content/assist`: `components/planner/ContentWorkspace.tsx`

### Batch 3: BOLT
- [ ] `/api/bolt/campaign-chat`: `components/bolt/BoltCampaignChat.tsx`, `components/BoltCreatorViewMain.tsx`, `components/command-center/BoltCombinedStrategyMain.tsx`

### Batch 4: Content & engagement
- [ ] `/api/company/blog/brief-suggestions` (shared fetcher first, then pages):
  - `components/content/managed-intelligence/briefSuggestionsFetcher.ts`
  - `components/blog/intelligence/useBlogIntelligence.ts`
  - `components/content/ManagedSuggestionsPage.tsx`
  - `pages/articles/generate.tsx`, `pages/blogs/generate.tsx`, `pages/blogs/suggestions.tsx`
  - `pages/case-studies/generate.tsx`, `pages/guides/generate.tsx`
  - `pages/newsletters/generate.tsx`, `pages/newsletters/suggestions.tsx`
  - `pages/stories/generate.tsx`, `pages/whitepapers/generate.tsx`
- [ ] `/api/content/quick-platform-adapt`: `components/blog/blogsNewMain.tsx`, `components/content/PromotionWorkspace.tsx`, `components/MultiPlatformSchedulerController.tsx`
- [ ] `/api/ai/content-suggestions`: `components/activity-workspace/AISuggestionPanel.tsx`
- [ ] `/api/engagement/refine-suggestion`: `components/engagement/AISuggestionPanel.tsx`
- [ ] `/api/blogs/[id]/repurpose`: `pages/company-blog/[slug].tsx`

### Batch 5: Creator
- [ ] `/api/creator-templates/chat-brief`: `components/creator/CreateWithAIChat.tsx`
- [ ] `/api/creator-templates/field-assist`: `components/creator/AssetCreationWorkspace.tsx`, `components/creator/workflow/useCreatorWorkflowActions.tsx`
- [ ] `/api/creator-intelligence/campaign-variant-estimate`: `components/variant-experience/CampaignVariantBillingEstimate.tsx` (an estimate: confirm with e1 whether it's actually billed)

### Batch 6: Admin blog (super-admin only)
- [ ] `/api/admin/blog/brief-suggestions`: `pages/admin/blog/content-refine.tsx`, `pages/admin/blog/generate.tsx`
- [ ] `/api/admin/blog/generate`: `pages/admin/blog/content-refine.tsx`, `lib/blog/hookAssessment.ts`, `lib/blog/runBlogGeneration.ts`

## Billed routes with NO client caller (nothing to migrate; listed so the flip review sees them)
- `/api/admin/blog/rewrite-hook`
- `/api/campaigns/planner/suggest-update`
- `/api/ai/claude-chat`: its only caller, `components/MultiAIChat.tsx`, was dead code and is deleted (UI 55400bd54)

## How this list was produced (re-run before the flip)
- **Server billed routes:** files under `pages/api` referencing `wirePhase2Route` / `BilledAiNotExecutedError` / billed-AI wrappers.
- **Clients:** `grep -rlE "/api/<route>"` across `components hooks pages lib`, excluding `pages/api`.
- **Before the flip:** re-run both, and confirm every server route is listed here and that **Done** covers all of its client files.
