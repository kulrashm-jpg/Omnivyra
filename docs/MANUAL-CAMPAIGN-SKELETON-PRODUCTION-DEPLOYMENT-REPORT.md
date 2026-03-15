# MANUAL CAMPAIGN SKELETON PIPELINE — PRODUCTION DEPLOYMENT REPORT

## BUILD STATUS

**FAILED** — Deployment blocked.

```
npm run build:ci
```

**Result:**
- `prebuild`: OK — `.next` and `.next/lock` cleanup ran
- TypeScript: **Failed to compile**
- Error location: `backend/services/boltContentGenerationForSchedule.ts:183`
- Error: `')' expected`
- Cause: Syntax error in `Promise.all` / `map` chain (outside Manual Skeleton scope)

**Manual Skeleton pipeline code:** Typechecks and lints clean. Build failure is in `boltContentGenerationForSchedule.ts`, which is **not** part of the Manual Campaign Builder scope.

**Action:** Resolve `boltContentGenerationForSchedule.ts` syntax before full production deploy.

---

## DATABASE CHECK

**Required tables:**

| Table | Purpose |
|-------|---------|
| `campaigns` | Campaign metadata, start_date, duration_weeks |
| `campaign_versions` | Company–campaign linkage |
| `twelve_week_plan` | Blueprint + structure_hash (JSONB) |
| `daily_content_plans` | Slot rows (week_number, day_of_week, content) |

**Schema verification SQL:**

```sql
-- Run in Supabase SQL Editor
SELECT column_name
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'daily_content_plans'
ORDER BY ordinal_position;
```

**Required columns for Manual Skeleton:**

| Column | Required | Notes |
|--------|----------|-------|
| campaign_id | Yes | FK to campaigns |
| week_number | Yes | 1–52 |
| day_of_week | Yes | Monday–Sunday |
| date | Yes | YYYY-MM-DD |
| platform | Yes | Normalized (e.g. x, linkedin) |
| content_type | Yes | Normalized (e.g. post, video, carousel) |
| content | Yes | JSON: `{ "placeholder": true, "label": "platform content_type" }` |
| status | Yes | Default 'planned' |

**Verification script:** `database/manual_skeleton_deployment_verify.sql`

---

## API HEALTH

**Endpoint:** `POST /api/campaigns/planner-finalize`

**Request body:**
```json
{
  "companyId": "<required>",
  "strategy_context": { "planned_start_date": "2025-03-20", "duration_weeks": 4, ... },
  "idea_spine": { "title": "...", "refined_title": "...", "selected_angle": "..." },
  "calendar_plan": {
    "activities": [
      { "week_number": 1, "day": "Monday", "platform": "linkedin", "content_type": "video", ... }
    ]
  }
}
```

**Behavior:**

| Check | Status | Evidence |
|-------|--------|----------|
| Uses calendar_plan.activities | Yes | L357, L387 — builds rows from activities |
| Creates placeholder slots | Yes | L404–408 — `content: { placeholder: true, label }` |
| Stores structure_hash | Yes | L313–316, L323 — sha256(activities) in blueprint |

---

## LIVE FLOW RESULT

**Scenario:** start_date 2025-03-20, duration 4 weeks, video:2 text:3 carousel:1 → Generate Skeleton → Move slot → Finalize.

**Expected:**
- `campaigns.start_date` = 2025-03-20
- `daily_content_plans` row count = 24

**Verification SQL:**
```sql
SELECT COUNT(*)
FROM daily_content_plans
WHERE campaign_id = '<campaign_id>';
-- Expected: 24
```

**Status:** Run manually after deployment. Blocked by build until `boltContentGenerationForSchedule.ts` is fixed.

---

## PLACEHOLDER VALIDATION

**Query:**
```sql
SELECT content
FROM daily_content_plans
WHERE campaign_id = '<campaign_id>'
LIMIT 5;
```

**Expected format:**
```json
{
  "placeholder": true,
  "label": "linkedin video"
}
```

Variants: `"linkedin text"`, `"linkedin carousel"`, etc.

---

## RECOMMENDED HUB CHECK

**No changes applied to:**

| Component | Status |
|-----------|--------|
| TrendCampaignsTab.tsx | Unmodified |
| recommendationCampaignBuilder.ts | Unmodified |
| /api/recommendations/* | Unmodified |

**Manual builder vs Recommended Hub:**
- Manual: `preview_mode: true`, `campaignId: null` → `/api/campaigns/ai/plan`
- Manual: Finalize → `/api/campaigns/planner-finalize`
- Recommended: Uses `/api/recommendations/*` and `/api/campaigns` (POST/PUT)

**Recommended campaign creation:** Unchanged and unaffected.

---

## MONITORING STATUS

**Suggested monitoring (24h post-deploy):**

| Metric | Query / Source |
|--------|----------------|
| planner-finalize errors | Log: `Planner finalize error:` |
| daily_content_plans inserts | Log: `daily_content_plans insert failed` |
| Duplicate finalize | 400: "Slots already exist" or "Campaign already finalized" |
| Recent inserts | `SELECT COUNT(*) FROM daily_content_plans WHERE created_at > NOW() - INTERVAL '24 hours';` |

---

## DEPLOYMENT RESULT

| Criterion | Status |
|-----------|--------|
| Build success | Blocked — unrelated TS error in boltContentGenerationForSchedule |
| Manual Skeleton code | Ready |
| Database schema | Verify with provided SQL |
| API behavior | Implemented per design |
| Recommended Hub | Unaffected |

**Recommendation:** Fix `boltContentGenerationForSchedule.ts:183` (add missing `)` in Promise.all/map chain), re-run `npm run build:ci`, then complete live flow tests and deploy.
