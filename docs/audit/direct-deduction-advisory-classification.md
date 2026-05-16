# Advisory Warning Classification

**Date:** 2026-05-15
**Source:** `scripts/audit/no-direct-credit-deductions.ts` (VERBOSE_BILLING_AUDIT=true)
**Total warnings:** 131 → 129 after false-positive exemption
**Status:** Classification complete; remediation calendar attached.

---

## 1. Classification Taxonomy

Every advisory warning is classified into exactly one of:

| Category | Action |
|---|---|
| **F1: regex_false_positive** | Add file to `SOFT_EXEMPT_FILES` |
| **F2: inside_orchestrated_scope** | Register in `credit_untracked_actions` with category `inside_orchestrated_scope` (longest review window) |
| **F3: migration_pending** | Migrate caller to `runBilledAiCompletion` in a follow-up commit. Enforcement target date supplied. |
| **F4: internal_tool** | Register with category `internal_tool` (180-day review window) |
| **F5: system_internal_summary** | Register with category `system_internal_summary` (365-day review window) |
| **F6: pre_purchase_preview** | Register with category `pre_purchase_preview` (90-day review window) |
| **F7: unsafe_bypass** | MUST be remediated immediately. No exemption permitted. |

After classification: **0 entries in F7 (unsafe_bypass).** Every site has a defensible category.

---

## 2. Summary Counts

| Category | Count | Action timeline | Owner |
|---|---|---|---|
| F1 (false positive) | 2 | Fixed (exempted `aiGatewayBillingGuard.ts`) | Eng |
| F2 (inside_orchestrated_scope) | 123 | Classified by `STATIC_NON_BILLABLE_AI_SCOPE_RULES` | billing-ops |
| F3 (migration_pending) | 4 | Sprint 4 migration to `runBilledAiCompletion` | Eng |
| F4 (internal_tool) | 2 | Registered via static rules | billing-ops |
| F5 (system_internal_summary) | 1 | Registered via static rules | billing-ops |
| F6 (pre_purchase_preview) | 0 | None today | — |
| **F7 (unsafe_bypass)** | **0** | **Clean** | — |
| **Total scanned** | **130** | | |

After enhancing the CI guard with static-rule classification:
```
Scanned 3273 files
Errors:        0
Warnings:      130
  classified:  126
  unowned:     4
  by category:
    inside_orchestrated_scope    123
    internal_tool                2
    system_internal_summary      1
```

The 4 unowned warnings are F3 migration-pending sites (Sprint 4 targets). They are intentionally NOT auto-classified — they require explicit migration to `runBilledAiCompletion`. The CI guard prints them when run to keep the work visible.

### Enforcement target dates

| Site | Migration to | Target |
|---|---|---|
| `pages/api/ai/content-suggestions.ts:67` | `runBilledAiCompletion` with action `content_rewrite` | Sprint 4 (T+2 weeks) |
| `pages/api/blogs/[id]/repurpose.ts:131` | `runBilledAiCompletion` with action `content_rewrite` | Sprint 4 |
| `pages/api/campaigns/planner/suggest-update.ts:53` | `runBilledAiCompletion` with action `content_rewrite` | Sprint 4 |
| `pages/api/company/blog/brief-suggestions.ts:91` | `runBilledAiCompletion` with action `insight_generation` | Sprint 4 |

Once these 4 are migrated, the CI guard's "unowned" count drops to 0 and `STRICT_BILLING_AUDIT=true` can be enabled in CI.

### CI integration commands

```sh
# Standard CI guard (fails only on hard violations)
npx tsx scripts/audit/no-direct-credit-deductions.ts

# Strict mode — fails on unowned advisory warnings too
STRICT_BILLING_AUDIT=true npx tsx scripts/audit/no-direct-credit-deductions.ts

# Non-billable registry health
npx tsx scripts/audit/non-billable-registry-check.ts

# Seed F2/F4/F5 entries (one-time, pre-GA)
APPROVED_BY_USER_ID=<super-admin-uuid> npx tsx scripts/audit/seed-non-billable-registry.ts
```

---

## 3. Per-File Classification (full inventory)

### F1 — Regex false positives (FIXED)

| File:Line | Justification |
|---|---|
| backend/services/billing/aiGatewayBillingGuard.ts:20 | Docstring reference, not a real call |
| backend/services/billing/aiGatewayBillingGuard.ts:121 | Docstring example, not a real call |

**Remediation:** Added file to `SOFT_EXEMPT_FILES` in [scripts/audit/no-direct-credit-deductions.ts](../../scripts/audit/no-direct-credit-deductions.ts).

### F2 — inside_orchestrated_scope (~95 sites)

These are inner-loop AI calls inside services that are entered through a wrapping `executeWithCredits` call at the outer scope. The outer scope holds the credit handle; the inner calls are accounted for in the same HOLD.

**`backend/queue/jobProcessors/creatorContentProcessor.ts`** lines 206, 274 — inner helpers of the now-wrapped (Phase 2) creator content job. Once `billing.reservations_required` is enabled for the org, the wrap is in place.

**`backend/services/batchAiProcessor.ts:103`** — inner batch operation.

**`backend/services/blockEnrichEngine.ts:106`** — inner block enrichment inside a wrapped blog generation flow.

**`backend/services/campaignPlanParser.ts`** lines 280, 465, 518 — inner parser passes during campaign plan generation (campaign_generation action, 50 credits at outer scope).

**`backend/services/campaignRecommendationExtensionService.ts:82`** — inner of recommendation flow (charged at outer).

**`backend/services/campaignStrategyEngine.ts:182`** — inner of strategy generation.

**`backend/services/companyProfile/marketingIntelligence.ts:81`**, **`problemTransformation.ts:334`**, **`refinementPrompts.ts:34`** + `:231`, **`strategyProfile.ts:273`** — company profile sub-routines. Onboarding flow is non-billable by design (initial signup is free); for re-runs the outer scope charges.

**`backend/services/companyProfileService.ts:2310`** — same.

**`backend/services/contentGeneration/blueprintGenerator.ts`** lines 84, 316, 436, 529 — inner blueprint passes inside `content_generation` action (token-priced at outer scope).

**`backend/services/contentGeneration/platformVariantGenerator.ts`** lines 88, 437 — inner variant generation inside wrapped content_basic charge.

**`backend/services/contentGenerationService.ts`** lines 86, 167 — pipeline internals.

**`backend/services/conversationMemoryService.ts:104`**, **`conversationTriageService.ts:126`** — engagement reply pipeline (`reply_generation` charged at outer scope).

**`backend/services/creatorPackagingService.ts:83`**, **`creatorThemeTreatmentService.ts:155`** — creator pipeline inner.

**`backend/services/dailyPlanAiGenerator.ts:263`** — daily plan generation inner.

**`backend/services/engagementAiAssistantService.ts:281`** — engagement assistant inner.

**`backend/services/executionEngines/creatorExecutionEngine.ts:471`** — creator execution inner.

**`backend/services/ideaRefinementService.ts:98`** — inside content_rewrite scope.

**`backend/services/insightContentService.ts:65`** — inside `insight_generation` scope.

**`backend/services/plannerCommandExtractor.ts:61`** — inside planner action.

**`backend/services/responseGenerationService.ts`** lines 159, 188 — inside `reply_generation`.

**`backend/services/strategicThemeEngine.ts:765`** — strategy engine inner.

**`backend/services/unifiedContentGenerationEngine.ts`** lines 512, 658 — main content engine internals.

**`pages/api/activity-workspace/content.ts`** lines 244, 366, 433, 521 — these are inside the wrapped `improve_variant` / `improve_variant_all` flows that use `runReservedFixedWorkflow`.

**`pages/api/bolt/campaign-chat.ts:305`** — BOLT chat inside the BOLT pipeline scope.

**`pages/api/command-center/creator-content/generate.ts:287`** — creator content gen scope.

**`pages/api/content/quick-platform-adapt.ts:319`** — inside a wrapped repurpose flow.

**`pages/api/engagement/refine-suggestion.ts:51`** — inside engagement reply scope.

**`pages/api/planner/chat-themes.ts:140`** — planner inside a wrapped action.

**`pages/api/planner/generate-workspace-content.ts:295`** — workspace inside wrapped scope.

**`pages/api/planner/skeleton-command.ts:229`** — planner skeleton inside wrapped scope.

**`lib/blog/blogRunnerHelpers.ts:496`** — blog runner helper called from already-wrapped blog generation.

**`lib/blog/hookAssessment.ts:38`** — hook assessment helper inside a wrapped blog gen.

**`lib/blog/regenerationExecutor.ts`** lines 164, 226, 310, 385, 514, 591 — blog regeneration inner passes.

**`lib/blog/runBlogGeneration.ts:328`** — main blog generation entry; wrapped at caller.

**`lib/blog/runClassicBlogGeneration.ts`** lines 267, 370, 418 — classic blog inner.

**`lib/blog/runComparisonBlogGeneration.ts`** lines 257, 356, 395, 430 — comparison blog inner.

**`lib/blog/runEditorialBlogGeneration.ts`** lines 304, 403, 440, 475, 510 — editorial blog inner.

**`lib/blog/runStandardBlogGeneration.ts`** lines 93, 278, 481 — standard blog inner.

**`lib/blog/runTemplateBlogGeneration.ts`** lines 451, 917, 1015, 1082, 1166, 1233 — template blog inner.

**`lib/blog/runTemplateDeepening.ts:58`** — template deepening inner.

**`lib/blog/runTutorialBlogGeneration.ts`** lines 276, 379, 425, 464 — tutorial blog inner.

**`lib/content/longFormPlanningEngine.ts`** lines 417, 522 — long-form planning inner.

**`lib/content/longFormQualityEngine.ts`** lines 280, 328, 376, 411 — long-form quality inner.

**`lib/newsletter/*`** — ~50 sites across `runMarketMapGeneration`, `runOperatorPlaybookGeneration`, `runSplitScreenInsightGeneration`, `runSprintSheetGeneration`, `runStrategyMemoGeneration`, `runWeeklyBoardGeneration`, `runWeeklyRadarGeneration`, `shared/pipeline.ts`. All newsletter generators run inside an outer-scope wrapping per newsletter type (`market_pulse_*` actions).

**Registry seed (run once on enablement):**

```sql
-- Pseudocode — actual rotation done via super-admin tooling
INSERT INTO credit_untracked_actions
  (action_key, reason, approved_by, expires_at, metadata)
VALUES
  ('refineProblemTransformation',  'inside companyProfile refinement scope',
   '<finance-admin-uuid>', NOW() + INTERVAL '1 year',
   jsonb_build_object('category','inside_orchestrated_scope','owner_user_id','<owner-uuid>')),
  ...
```

This is rolled into the GA enablement runbook (see [billing-ga-rollout-plan.md](./billing-ga-rollout-plan.md) §4).

### F3 — migration_pending (~20 sites)

User-facing endpoints that today call `runCompletionWithOperation` directly with no enclosing `executeWithCredits`. These are candidates for explicit migration to `runBilledAiCompletion` so customers see a credit charge.

| File:Line | Operation | Suggested action | Target |
|---|---|---|---|
| pages/api/admin/blog/brief-suggestions.ts:105 | brief suggestions (super-admin tool) | F4 (internal_tool) | now |
| pages/api/admin/blog/rewrite-hook.ts:62 | rewrite hook (super-admin tool) | F4 (internal_tool) | now |
| pages/api/ai/content-suggestions.ts:67 | content suggestions | **F3 migrate** | Sprint 4 |
| pages/api/blogs/[id]/repurpose.ts:131 | blog repurpose | **F3 migrate** to `content_rewrite` | Sprint 4 |
| pages/api/campaigns/planner/suggest-update.ts:53 | planner suggest update | **F3 migrate** to `content_rewrite` | Sprint 4 |
| pages/api/company/blog/brief-suggestions.ts:91 | company brief suggestions | **F3 migrate** to `insight_generation` | Sprint 4 |
| pages/api/track/ai-insights.ts:155 | tracked AI insights | F5 (system_internal_summary) | now |

**Migration target date: Sprint 4 (per the audit roadmap).** Until then, the calls are observed (shadow mode) and counted; no customer is over-charged because all of these are short prompt operations that today land in usage_events with no credit charge.

### F4 — internal_tool

Admin / ops surfaces that legitimately bypass billing.

| File:Line | Reason |
|---|---|
| pages/api/admin/blog/brief-suggestions.ts:105 | Super-admin authoring tool |
| pages/api/admin/blog/rewrite-hook.ts:62 | Super-admin authoring tool |

Plus any `super-admin` route calls discovered by future scans.

### F5 — system_internal_summary

Telemetry / system-internal LLM use with no user-facing output.

| File:Line | Reason |
|---|---|
| pages/api/track/ai-insights.ts:155 | Internal analytics summary, no user output |

(Most internal summary calls today actually live inside engines that are F2 — this list is short.)

### F6 — pre_purchase_preview

(none today)

### F7 — unsafe_bypass

**0 sites.** None of the 129 advisory warnings represent an unsafe bypass.

---

## 4. Remediation Calendar

| Phase | Date | Action |
|---|---|---|
| Today | 2026-05-15 | F1 sites exempted in CI guard (drop from 131 → 129 warnings) |
| Pre-GA | T0 | Bulk-register F2 sites in `credit_untracked_actions` (one-time SQL or admin UI) |
| Pre-GA | T0 | Register F4/F5 sites |
| Sprint 4 | T+2w | Migrate F3 sites to `runBilledAiCompletion` |
| Quarterly | continuous | Review F2/F4 registry entries before expiry (`scripts/audit/non-billable-registry-check.ts`) |

After T0 and the F2 bulk registration, the CI guard's warning count should drop to under 25 (only F3 entries that are intentionally pending migration). After Sprint 4, it should drop to near zero.

---

## 5. CI Integration

Two CI scripts now run on every PR:

| Script | Purpose | Failure condition |
|---|---|---|
| `scripts/audit/no-direct-credit-deductions.ts` | Hard violations: direct RPC / ledger writes | exit 1 if any hard violation |
| `scripts/audit/non-billable-registry-check.ts` | Registry health | exit 1 if any registered entry is expired OR missing required fields |

Combined, these gates ensure:
- No new code path silently bypasses the orchestrator.
- Existing exemptions remain reviewed and owned.
- Stale exemptions surface in CI as actionable items.

---

## 6. Pre-GA Registry Normalization Update

**Date:** 2026-05-15
**Validation command:** `VERBOSE_BILLING_AUDIT=true npx tsx scripts/audit/no-direct-credit-deductions.ts`

The advisory script now consumes static ownership metadata from
`backend/services/billing/nonBillableRegistry.ts` via
`STATIC_NON_BILLABLE_AI_SCOPE_RULES`. This preserves the warning inventory
while separating legitimate orchestrated inner calls from migration-pending
AI calls.

| Metric | Count |
|---|---:|
| Files scanned | 3,277 |
| Hard errors | 0 |
| Advisory warnings | 130 |
| Classified/owned advisories | 126 |
| Unowned advisories | 4 |

Classified breakdown:

| Category | Count |
|---|---:|
| `inside_orchestrated_scope` | 123 |
| `internal_tool` | 2 |
| `system_internal_summary` | 1 |

Remaining accepted warnings:

| File:Line | Status | Reason |
|---|---|---|
| `pages/api/ai/content-suggestions.ts:67` | F3 migration pending | Customer-facing direct AI call requires `runBilledAiCompletion()` migration or explicit billing decision |
| `pages/api/blogs/[id]/repurpose.ts:131` | F3 migration pending | Customer-facing direct AI call requires `runBilledAiCompletion()` migration or explicit billing decision |
| `pages/api/campaigns/planner/suggest-update.ts:53` | F3 migration pending | Customer-facing direct AI call requires `runBilledAiCompletion()` migration or explicit billing decision |
| `pages/api/company/blog/brief-suggestions.ts:91` | F3 migration pending | Company-facing direct AI call requires `runBilledAiCompletion()` migration or explicit billing decision |

**Production enforcement note:** `BILLING_REQUIRE_AI_HANDLE=true` must remain canary-scoped until the four unowned advisories are migrated or formally registered.
