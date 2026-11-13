# Billed AI clients → canonical helper + Idempotency-Key (tracker)

**Owner:** UI tab. **Coordinator:** e9. **Server side:** e1 (wirePhase2Route standard shape), 55 (C75 / Market Pulse).

**Why this exists (e9 ruling, 2026-11-13).** The billing enforcement flip is GATED on this list being EMPTY. No billed route may be enforced while a client calling it lacks:
1. **an `Idempotency-Key`**, minted once per user action, reused while it's in flight, and freed when it ends (`createBilledActionKeyGate` in `lib/idempotency.ts`). Without it a double-click double-charges.
2. **the canonical response mapping** (`classifyBilledResponse` / `billedOutcomeText` in `lib/billing/billedResponse.ts`). Without it users see raw codes and an `ALREADY_PROCESSED` success looks like an error.

**Standard server shape**, keyed on status + `code` only:
- 402 `{ error, code: INSUFFICIENT_CREDITS | NO_CREDIT_ACCOUNT | PRICING_UNAVAILABLE, required?, balance? }`
- 409 `{ error, code: ALREADY_PROCESSED }`: success; refresh.
- 500 `{ error, code: RECLAIM_CAP_EXHAUSTED, retryable: false }` (e1): our failure, nothing charged; offer "try again" with a NEW key. It replaces `ALREADY_RELEASED`, which never existed on main and is not handled.
- 503 `{ error, code: DAILY_LIMIT_UNVERIFIABLE | BUDGET_UNVERIFIABLE }` with a `Retry-After` header (6f, coming; e9 ruling 2026-11-13): "we couldn't confirm your spending limit right now; nothing was charged". Show a plain retry message ("We couldn't check your spending limit just now. Nothing was charged. Please try again in a moment."), honouring Retry-After if shown, and NEVER a top-up prompt. A retry uses a NEW key; the shared gate is unchanged (e9 retracted "same key"). The refusal happens before any hold, and 6f guarantees it records nothing against the key (no hold, no ledger row, no idempotency row), with a test. Part of the flip-gate list.

**A route is DONE when:** its server returns the standard shape (e1/55 confirm), AND every client file below sends the key and routes errors through the helper, AND a test pins both (pattern: `backend/tests/unit/billedResponseHelper.test.tsx`).

**Start condition for the batches below:** e1's `fix/phase2-route-wiring-token-actual-20261113` lands and returns the standard shape for the 18 wirePhase2Route routes plus `campaigns/[id]/virality/assess`.
For those routes, `PRICING_UNAVAILABLE` arrives as **503** `{ code: PRICING_UNAVAILABLE }` (a config gap). The helper keys on the code, so it is classified correctly and never shows "top up".

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
- [ ] `/api/campaigns/[id]/virality/assess`: `hooks/useCampaignDetailsHandlers.tsx` (:740). Billed per e1; joins the standard shape in e1's phase2 wiring.

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
- [ ] `/api/engagement/suggestions` (**GET**, surface `engagement.suggestions`): `components/engagement/AISuggestionPanel.tsx` (:34). Billed on e1's fix/engagement-replies-billed-20261113, dark until the flip. The key goes on a GET.
- [ ] `/api/blogs/[id]/repurpose`: `pages/company-blog/[slug].tsx`
  - **source=public now requires login and is charged to the caller's company** (owner ruling via e9; 55's fix/public-repurpose-rate-limit-20261113). The client must ALWAYS send `company_id` = the selected company, so multi-company users never get 400.
  - New responses on the public source, which the client must handle:
    - 401 `AUTH_REQUIRED` → prompt sign-in
    - 400 `COMPANY_REQUIRED` (several companies, none named)
    - 403 `NO_ACTIVE_COMPANY` / 403 company not theirs
    - 429 `RATE_LIMITED` (per-IP / global limit)
    - plus the shared billing 402s
  - Find and migrate the public-blog caller(s) too (re-run the caller grep on 55's branch).

### Batch 5: Creator
- [ ] `/api/creator-templates/chat-brief`: `components/creator/CreateWithAIChat.tsx`
- [ ] `/api/creator-templates/field-assist`: `components/creator/AssetCreationWorkspace.tsx`, `components/creator/workflow/useCreatorWorkflowActions.tsx`

### Batch 6: Admin blog (super-admin only)
- [ ] `/api/admin/blog/brief-suggestions`: `pages/admin/blog/content-refine.tsx`, `pages/admin/blog/generate.tsx`
- [ ] `/api/admin/blog/generate`: `pages/admin/blog/content-refine.tsx`, `lib/blog/hookAssessment.ts`, `lib/blog/runBlogGeneration.ts`

## Not billed (no helper, no Idempotency-Key needed)
- `/api/creator-intelligence/campaign-variant-estimate` (`components/variant-experience/CampaignVariantBillingEstimate.tsx`). e1 confirmed at main 9cecd075f: read-only, no charging and no AI call; a pure calculation from the persisted variant_strategy.

## Billed routes with NO client caller (nothing to migrate; listed so the flip review sees them)
- `/api/engagement/thread/bulk-ai-reply` (POST, surface `engagement.bulk-ai-reply`; e1's fix/engagement-replies-billed-20261113). No client caller at main 69dc5027f (`git grep bulk-ai` over components/hooks/lib/pages finds nothing; control: the same grep finds ConversationView's `thread/bulk-resolve`). Any future caller needs the gate + helper. The same key on a retry → 409 ALREADY_PROCESSED (nothing sent twice).
- `/api/admin/blog/rewrite-hook`
- `/api/campaigns/planner/suggest-update`
- `/api/ai/claude-chat`: its only caller, `components/MultiAIChat.tsx`, was dead code and is deleted (UI 55400bd54)

## How this list was produced (re-run before the flip)
- **Server billed routes:** files under `pages/api` referencing `wirePhase2Route` / `BilledAiNotExecutedError` / billed-AI wrappers.
- **Clients:** `grep -rlE "/api/<route>"` across `components hooks pages lib`, excluding `pages/api`.
- **Before the flip:** re-run both, and confirm every server route is listed here and that **Done** covers all of its client files.
