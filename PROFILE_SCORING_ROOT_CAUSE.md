# PROFILE_SCORING_ROOT_CAUSE.md

Phase 16E · Phase 1 — root cause of unscored profiles (`overall_confidence = 0`,
`last_refined_at = null`). Evidence from the code path.

## Lifecycle trace

| Stage | Code | Behavior |
|---|---|---|
| Profile creation | onboarding / `savePayload.ts` | inserts row with `overall_confidence ?? 0`, `last_refined_at` from source; **created profiles are not scored** |
| Scoring trigger | `getProfile(companyId, { autoRefine: true })` → `companyProfileService.ts:2079` | refines **only when the profile is READ** with `autoRefine` |
| Refine gate | `shouldRefineProfile(last_refined_at)` (`:1798`) | `null → true` (so a never-refined profile *would* refine on read) |
| Scoring | `refineProfileWithAI` → `runProfileRefinement` (AI extraction) | sets `overall_confidence`, `last_refined_at = now` |

## Root cause (confirmed)

**Profile scoring is LAZY — triggered on read (`getProfile` with `autoRefine`), not eagerly
at profile creation.** `shouldRefineProfile(null)` correctly returns `true`, so the gate is
not the problem. The problem is that **nothing reads these profiles through the
auto-refining path**: a profile created during onboarding is only ever scored if/when someone
later calls `getProfile(autoRefine = true)` for that company. For companies whose profile is
never read through that path, `overall_confidence` stays 0 and `last_refined_at` stays null —
indefinitely.

This is a **genuine PRODUCT_FLOW bug** (not data corruption): the rows are valid and contain
field data; the scoring step simply never fires.

## Affected (customer-only)

3 of 5 customers (Embrosales, Afrost, Infitoo) — profile rows present with field data,
`confidence 0`, `refined null`. (Plus ~23 QA/test profiles, out of scope.)

## Exact failing path

`backend/services/companyProfileService.ts` — scoring is gated behind `getProfile(... autoRefine)`
(`:2079`); there is **no eager scoring at profile creation** (`savePayload.ts` writes the row
without invoking refinement). The fix is to make scoring eager/idempotent-backfill — see the
fix report.
