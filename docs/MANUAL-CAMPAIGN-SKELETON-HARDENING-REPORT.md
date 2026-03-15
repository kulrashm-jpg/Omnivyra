# Manual Campaign Skeleton Pipeline — Final Hardening Implementation Report

## FILES MODIFIED

| File | Changes |
|------|---------|
| `package.json` | Added `prebuild` (removes `.next/lock`), added `build:ci` (cleans `.next` + build) |
| `pages/api/campaigns/planner-finalize.ts` | FIX 2–10: atomic insert, duplicate protection, strict validation, platform/content-type normalization, empty-week check, structure hash, placeholder validation, rate limit |
| `backend/db/campaignPlanStore.ts` | Added `structure_hash` optional param to `saveStructuredCampaignPlan`; stored in blueprint JSON |

**Unchanged (per scope):**
- `ExecutionSetupPanel.tsx`
- `FinalizeSection.tsx`
- `ActivityCardWithControls.tsx`
- `/api/campaigns/ai/plan`
- `TrendCampaignsTab.tsx`
- `recommendationCampaignBuilder.ts`
- `/api/recommendations/*`

---

## NEW VALIDATIONS

| Fix | Validation | Location |
|-----|------------|----------|
| **FIX 4** | Strict calendar_plan: each activity must have `week_number`, `day`, `platform`, `content_type` | planner-finalize L207–215 |
| **FIX 7** | Week numbers must be 1–52; each week with activities must have at least one slot | planner-finalize L369–383 |
| **FIX 9** | Placeholder validation: each row `content` must parse to `{ placeholder: true }` | planner-finalize L411–418 |
| **FIX 10** | Rate limit: if existing campaign `status === 'execution_ready'` → 400 "Campaign already finalized" | planner-finalize L296–298 |

---

## TRANSACTION IMPLEMENTATION

**FIX 2 — Atomic slot insert**

Supabase JS client does not expose `begin`/`commit`/`rollback`. Transaction behavior is achieved via:

1. **Single bulk insert** — All `daily_content_plans` rows inserted in one `supabase.from('daily_content_plans').insert(rowsToInsert)` call.
2. **All-or-nothing** — If insert fails, no rows are written; error is thrown and propagated.

Replaced the previous per-week `saveWeekPlans` loop with one bulk insert.

---

## HASH STORAGE

**FIX 8 — Structure hash**

- **Compute:** `createHash('sha256').update(JSON.stringify(calendar_plan.activities)).digest('hex')`
- **Store:** Passed as `structure_hash` to `saveStructuredCampaignPlan`, which stores it in `blueprint.structure_hash` (JSONB column)
- **Purpose:** Detect skeleton changes (e.g. re-finalize with different activities)

---

## RECOMMENDED HUB SAFETY

| Asset | Status |
|-------|--------|
| `TrendCampaignsTab.tsx` | ✅ **UNTOUCHED** |
| `recommendationCampaignBuilder.ts` | ✅ **UNTOUCHED** |
| `/api/recommendations/*` | ✅ **UNTOUCHED** |
| `/api/campaigns/ai/plan` | ✅ **UNTOUCHED** (manual builder uses `preview_mode: true`) |

---

## FINAL BUILD STATUS

- **TypeCheck:** `tsc --noEmit` — ✅ Pass
- **Lint:** No linter errors in modified files
- **Build:** Run `npm run build` (prebuild clears `.next/lock`). For CI, use `npm run build:ci` (cleans entire `.next` before build)

---

## FIX SUMMARY

| Fix | Implemented |
|-----|-------------|
| FIX 1 — Build lock | ✅ `prebuild` removes `.next/lock`; `build:ci` for full clean |
| FIX 2 — Atomic insert | ✅ Bulk `supabase.from().insert(rowsToInsert)` |
| FIX 3 — Duplicate slot protection | ✅ Check existing rows before insert; 400 if any exist |
| FIX 4 — Strict calendar validation | ✅ Each activity must have week_number, day, platform, content_type |
| FIX 5 — Platform normalization | ✅ `normalizePlatform()` map (twitter→x, etc.) |
| FIX 6 — Content type standardization | ✅ `normalizeContentType()` map (text→post, reel→video, etc.) |
| FIX 7 — Prevent empty weeks | ✅ Week numbers 1–52; each week with activities has ≥1 slot |
| FIX 8 — Structure hash | ✅ SHA256 of activities stored in blueprint |
| FIX 9 — Placeholder validation | ✅ Parse `content` and assert `placeholder === true` before insert |
| FIX 10 — Finalize rate limit | ✅ 400 if campaign `status === 'execution_ready'` |
