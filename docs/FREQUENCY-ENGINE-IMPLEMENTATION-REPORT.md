# FREQUENCY ENGINE IMPLEMENTATION REPORT

**Date:** March 12, 2025  
**Scope:** Frequency Calculation Engine + Early Limit Validation

---

## FILES CREATED

| Path | Purpose |
|------|---------|
| `lib/planning/campaignFrequencyEngine.ts` | Unified frequency calculation and validation. Exports `calculateCampaignFrequency()`, `validateCampaignFrequency()`. Reuses limits from contentDistributionIntelligence. |
| `pages/api/campaigns/validate-frequency.ts` | POST API for early frequency validation. Calls frequency engine + capacity validator, returns `frequency_summary` and `validation` with warnings/errors. |

---

## FILES MODIFIED

| Path | Change Summary |
|------|----------------|
| `pages/campaign-details/[id].tsx` | Added `crossPlatformSharingEnabled` state (default true), `frequencyValidation` state, `planDurationLimit` state. Distribution mode selector in step 4 (Unique vs Shared posting). Frequency validation useEffect (700ms debounce). Inline feedback panel (success/warning/error). Disabled Next/Proceed when errors exist. Pass `cross_platform_sharing` in planningContext. Persist `crossPlatformSharingEnabled` in wizard state. |
| `backend/services/capacityExpectationValidator.ts` | Added `validateCapacityForContentMix()` — converts content_mix + platforms to `platform_content_requests`, calls `validateCapacityVsExpectation`. Exposed for configuration-time checks. |
| `backend/services/campaignPlanningInputsService.ts` | Added `cross_platform_sharing_enabled` to type, get (from `planning_inputs`), and save. Stored in `recommendation_snapshot.planning_inputs`. |
| `lib/planning/contentDistributionIntelligence.ts` | Exported `PLATFORM_FREQUENCY_LIMITS` and `CONTENT_TYPE_FREQUENCY_LIMITS` for reuse. |
| `utils/campaignWizardStorage.ts` | Added `crossPlatformSharingEnabled` to `WizardState`, save/load. |
| `pages/api/campaigns/[id]/save-wizard-state.ts` | Accept and persist `cross_platform_sharing_enabled` in wizard_state. |
| `backend/db/campaignVersionStore.ts` | Added `cross_platform_sharing_enabled` to wizardState type. |

---

## FREQUENCY ENGINE FORMULA

**Input:** `duration_weeks`, `cross_platform_sharing_enabled`, `platforms[]`, `content_mix{ post_per_week, video_per_week, blog_per_week, reel_per_week, article_per_week, song_per_week }`

**Logic:**
- Content mix values are applied per platform.
- **Shared enabled:** `weekly_unique_content_required = MAX(post, video, blog, song)` across types.
- **Shared disabled:** `weekly_unique_content_required = (post + video + blog + song) × platformCount`.
- **total_content_required** = `weekly_unique_content_required × duration_weeks`.

**Example:**
- 3 LinkedIn posts, 3 Twitter posts.
- Shared enabled → unique = 3.
- Shared disabled → unique = 6.

---

## VALIDATION RULES IMPLEMENTED

1. **Platform frequency limits** — Reuses `PLATFORM_FREQUENCY_LIMITS` from contentDistributionIntelligence (LinkedIn 5, Twitter 10, default 15). Warns when total per-platform postings exceed limit.

2. **Content type limits** — Reuses `CONTENT_TYPE_FREQUENCY_LIMITS` (blog 3). Warns when blog + article total exceeds 3/week.

3. **Capacity validation** — Uses `validateCapacityForContentMix()` which builds `platform_content_requests` and calls `validateCapacityVsExpectation`. Errors when demand exceeds `available_content + weekly_capacity × duration`.

4. **Plan duration limits** — Fetches `max_campaign_duration_weeks` from `/api/company-plan-duration-limit`. Errors when `duration_weeks > max_campaign_duration_weeks`.

---

## API ENDPOINT STRUCTURE

**POST /api/campaigns/validate-frequency**

**Request:**
```json
{
  "companyId": "uuid",
  "duration_weeks": 12,
  "platforms": ["linkedin"],
  "cross_platform_sharing_enabled": true,
  "content_mix": {
    "post_per_week": 3,
    "video_per_week": 2,
    "blog_per_week": 0,
    "song_per_week": 0
  },
  "available_content": { "post": 0, "video": 0, "blog": 0 },
  "weekly_capacity": { "post": 3, "video": 2, "blog": 0 }
}
```

**Response:**
```json
{
  "frequency_summary": {
    "weekly_unique_content_required": 4,
    "total_content_required": 48,
    "weekly_total_posts": 3,
    "weekly_total_videos": 2,
    "weekly_total_blogs": 0
  },
  "validation": {
    "valid": true,
    "warnings": [],
    "errors": []
  }
}
```

---

## UI VALIDATION BEHAVIOR

- **Debounce:** 700ms after changes to videoPerWeek, postPerWeek, blogPerWeek, songPerWeek, crossPlatformSharingEnabled, requestedWeeksForPreplan, prefilledPlanning.

- **Inline feedback:**
  - **Success (green):** "Campaign requires X unique pieces/week (Y total)."
  - **Warning (amber):** Platform/content limit warnings.
  - **Error (red):** Duration limit, capacity violation.

- **Blocking:** Next (step 4→5) and "Proceed with X weeks" disabled when `errors.length > 0`.

- **Distribution selector:** Step 4 radio buttons — Unique posting (one post → one platform) vs Shared posting (one post → multiple platforms). Default: Shared.

---

## TEST SCENARIOS

1. **Valid frequency** — 3 posts/week, 2 videos/week, 12 weeks, shared enabled. Green message, Next enabled.

2. **Exceeding platform limits** — 6 posts/week on LinkedIn. Warning: "LinkedIn posting frequency exceeds recommended limit (5/week)."

3. **Exceeding content limits** — 5 blogs/week. Warning: "Blog content frequency is high (5/week). Consider reducing to 3 or fewer."

4. **Capacity violation** — Available 0, capacity 2 posts/week, demand 3 posts/week. Error: "Content demand for posts exceeds your team's capacity."

5. **Shared vs unique posting** — Same inputs, shared on → 3 unique; shared off → 6 unique. Validation reflects the difference.

---

## EDGE CASES HANDLED

- **No platforms** — Defaults to `['linkedin']`.
- **Missing plan duration limit** — Skips duration validation.
- **Missing available/capacity** — Capacity check skipped; platform/content limits still apply.
- **API failure** — `frequencyValidation` set to null; UI shows no feedback, Next not blocked.
- **Shared default** — `cross_platform_sharing_enabled` defaults to true (shared posting).
- **Wizard state persistence** — `crossPlatformSharingEnabled` saved in localStorage and `campaign_snapshot.wizard_state`.
