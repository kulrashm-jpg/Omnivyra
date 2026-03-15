# WIZARD STATE PERSISTENCE IMPLEMENTATION REPORT

**Date:** March 12, 2025  
**Scope:** Campaign pre-planning wizard state loss fix + draft autosave  
**Reference:** CAMPAIGN-FLOW-AUDIT-REPORT.md, user specification

---

## FILES CREATED

| Path | Purpose |
|------|---------|
| `utils/campaignWizardStorage.ts` | LocalStorage persistence for wizard state. Functions: `saveWizardState`, `loadWizardState`, `clearWizardState`. Key: `campaign_wizard_state_${campaignId}`. TTL: 24 hours. |
| `pages/api/campaigns/[id]/save-wizard-state.ts` | POST API to persist wizard state into `campaign_versions.campaign_snapshot.wizard_state`. Enforces company access via `enforceCompanyAccess`. |

---

## FILES MODIFIED

| Path | Change Summary |
|------|----------------|
| `pages/campaign-details/[id].tsx` | Added import for `campaignWizardStorage` utils. Added `hasRestoredWizardStateRef`, `wizardStateDbSaveTimeoutRef`. Restore logic in `loadCampaignDetails`: DB vs localStorage (use newer by `updatedAt`). Two `useEffect` hooks: localStorage autosave (500ms debounce), API autosave (5s debounce). Call `clearWizardState` when blueprint generation succeeds in `acceptDuration`. |
| `backend/db/campaignVersionStore.ts` | Added `updateWizardStateInSnapshot(input)` to merge `wizard_state` into the latest `campaign_versions` row's `campaign_snapshot`. |
| `pages/api/campaigns/index.ts` | Extended snapshot type to include `wizard_state`. Added `wizardState: snapshot?.wizard_state` to GET `type=campaign` response so the client can restore from DB. |

---

## LOCAL STORAGE STRUCTURE

**Key:** `campaign_wizard_state_${campaignId}`

```json
{
  "wizard_state_version": 1,
  "step": 2,
  "questionnaireAnswers": {
    "availableVideo": 0,
    "availablePost": 2,
    "availableBlog": 0,
    "availableSong": 0,
    "contentSuited": true,
    "videoPerWeek": 2,
    "postPerWeek": 3,
    "blogPerWeek": 0,
    "songPerWeek": 0,
    "inHouseNotes": ""
  },
  "plannedStartDate": "2025-04-01",
  "prePlanningResult": null,
  "updatedAt": "2025-03-12T14:30:00.000Z"
}
```

- **TTL:** 24 hours. Expired entries are removed on load.
- **Version:** `wizard_state_version: 1` for future migrations.

---

## DATABASE SNAPSHOT STRUCTURE

**Table:** `campaign_versions`  
**Column:** `campaign_snapshot` (JSONB)

**New field:** `campaign_snapshot.wizard_state`

```json
{
  "wizard_state_version": 1,
  "step": 3,
  "questionnaire_answers": {
    "availableVideo": 1,
    "availablePost": 2,
    "availableBlog": 0,
    "availableSong": 0,
    "contentSuited": true,
    "videoPerWeek": 2,
    "postPerWeek": 4,
    "blogPerWeek": 0,
    "songPerWeek": 0,
    "inHouseNotes": "Notes here"
  },
  "planned_start_date": "2025-04-15",
  "pre_planning_result": {
    "status": "NEGOTIATE",
    "requested_weeks": 12,
    "recommended_duration": 8,
    "explanation_summary": "..."
  },
  "updated_at": "2025-03-12T14:35:00.000Z"
}
```

- Uses snake_case keys to match API/DB conventions.
- Stored as part of the existing `campaign_snapshot`; no schema migration needed.

---

## RESTORE FLOW

1. **Load DB campaign:** `GET /api/campaigns?type=campaign&campaignId=&companyId=` returns `wizardState` from `campaign_snapshot.wizard_state`.

2. **Load localStorage:** `loadWizardState(campaignId)` reads `campaign_wizard_state_${campaignId}`.

3. **Choose source:** Compare `updated_at`:
   - If DB is present and `db.updated_at >= local.updated_at` → use DB.
   - If local is present and `local.updatedAt > db.updated_at` → use local.
   - Otherwise → use defaults.

4. **Apply state:** Call `setPrePlanningWizardStep`, `setQuestionnaireAnswers`, `setPlannedStartDate`, `setPrePlanningResult` with restored data.

5. **One-time restore:** `hasRestoredWizardStateRef` ensures restore runs only once per session; refresh creates a new session.

---

## AUTOSAVE TRIGGERS

- **LocalStorage (500ms debounce):** Runs when `prePlanningWizardStep`, `questionnaireAnswers`, `plannedStartDate`, or `prePlanningResult` change.

- **Database (5s debounce):** Same dependencies. Calls `POST /api/campaigns/[id]/save-wizard-state` with:
  - `step`
  - `questionnaire_answers`
  - `planned_start_date`
  - `pre_planning_result`
  - `updated_at`

- On each dependency change, previous timers are cleared and new ones started.

---

## API ENDPOINT DETAILS

**POST `/api/campaigns/[id]/save-wizard-state`**

- **Auth:** Uses `enforceCompanyAccess` with `companyId` from latest `campaign_versions` row.
- **Body:**
  ```json
  {
    "step": 2,
    "questionnaire_answers": { ... },
    "planned_start_date": "2025-04-01",
    "pre_planning_result": null,
    "updated_at": "2025-03-12T14:30:00.000Z"
  }
  ```
- **Response (200):** `{ success: true, campaign_id: "...", message: "Wizard state saved" }`
- **Errors:** 400 (missing campaignId), 404 (campaign not found), 405 (wrong method), 500 (DB/update error).

---

## TEST SCENARIOS

1. **Refresh page:** User completes steps 1–3, refreshes. Wizard restores to step 3 with same questionnaire values.
2. **Navigate away and return:** User fills step 2, goes to another page, returns. State restored from localStorage or DB, whichever is newer.
3. **Browser back button:** User leaves and returns via back. Same as (2); restore occurs on remount.
4. **Wizard completion clears draft:** User reaches step 6 and clicks “Accept & generate blueprint”. Blueprint generation succeeds. `clearWizardState(campaignId)` removes localStorage draft; next load shows no draft.

---

## EDGE CASES HANDLED

- **Expired localStorage:** Entries older than 24 hours are ignored and removed on load.
- **No wizard_state in DB:** Falls back to localStorage, then defaults.
- **Missing campaign_versions row:** Save API returns 404; client ignores save failures.
- **Multiple loadCampaignDetails calls:** Restore runs only once per mount via `hasRestoredWizardStateRef`.
- **Concurrent saves:** Debounce limits write frequency; last save wins.
- **Blueprint generation failure:** Draft is not cleared; user can retry or edit.
- **Version field:** `wizard_state_version: 1` allows future schema changes.
