# Recommendations Feature – End-to-End Audit

## 1. UI Components and Routes

### Main page
- **`/recommendations`** → `pages/recommendations.tsx` (single large page, no nested route components; all sections in one file).

### Related pages (separate routes)
- **`/recommendations/analytics`** → `pages/recommendations/analytics.tsx` – analytics dashboard.
- **`/recommendations/policy`** → `pages/recommendations/policy.tsx` – policy weights + scenario simulation.
- **`/recommendations/audit`** → `pages/recommendations/audit.tsx` – audit view (linked from policy).

### Sections on `pages/recommendations.tsx`

| Section | Purpose | Data source | User action | Generates or displays? |
|--------|---------|-------------|--------------|------------------------|
| **Scenario Simulation** | Checkbox “Scenario simulation”; when checked, generate runs in simulate-only mode (no snapshots persisted). | Same as Generate; `simulate: true` in `/api/recommendations/generate`. | User checks “Scenario simulation” then clicks **Generate**. | **Generates** (simulated result only; not persisted). |
| **Refresh Recommendations** | Re-run recommendation flow after “refresh” (e.g. profile update) and then generate again. | POST `/api/recommendations/refresh` (mode `company` returns message; no server-side refresh). Then calls **Generate**. | User clicks “🔄 Refresh Recommendations”. | **Generates** (via refresh then generate). |
| **Analytics** | Navigate to analytics dashboard. | N/A on this page. | Admin clicks “Analytics” → navigates to `/recommendations/analytics`. | **Displays** (on analytics page). |
| **Detected Market Opportunities** | Show read-only opportunities from external signals; “Recommended to Execute This Week”; per-opportunity “Generate Playbook” / “Evaluate with AI”. | GET `/api/recommendations/detected-opportunities?companyId=&campaignId=`. Uses `recommendation_snapshots`, `audit_logs`, company profile, and engine **simulate** run. | Page load when company + campaign selected; “Evaluate with AI” triggers generate + optional state update; “Generate Playbook” opens manual topic flow. | **Displays** (list). “Evaluate with AI” **generates** (and can shortlist/discard). |
| **Content Manager Workspace (All / Shortlisted / Discarded)** | Tabs to filter recommendations by state; Keep/Discard/Restore, Create Campaign, Draft 12-Week Plan; optional multi-select for “Create Campaign from Selected”. | **Display**: `engineResult.trends_used` (from last Generate). **State**: GET `/api/recommendations/state-map?companyId=&snapshot_hashes=…` (from `audit_logs` + `recommendation_snapshots`). | Generate first; then Keep/Discard/Restore, Create Campaign, Draft 12-Week Plan, or group selection. | **Displays** (from last generate + state-map). State **persisted** via POST `/api/recommendations/[id]/state`. |
| **External API selection** | Choose which external APIs feed into generate / multi-region run. | GET `/api/external-apis/access?companyId=`. | User toggles APIs in list; selection sent in generate/run payloads. | **Displays** options; **affects** generate/run. |
| **Region / Global controls** | Multi-region job: regions (e.g. IN, US, GB or GLOBAL), goal/keyword, “Use company profile”, Run. | POST `/api/recommendations/run`; status GET `/api/recommendations/[jobId]/status`; result GET `/api/recommendations/[jobId]/result`. Tables: `recommendation_jobs`, `recommendation_raw_signals`, `recommendation_analysis`. | User sets regions/goal and clicks “Run multi-region”; UI polls status then fetches result. | **Generates** (async job); **displays** consolidated recommendation and region-wise differences. |

---

## 2. Backend API Routes

### Invoked from recommendations UI

| Route | Method | Purpose | Request payload / query | Response schema (success) |
|-------|--------|---------|---------------------------|----------------------------|
| **`/api/recommendations/generate`** | POST | Generate recommendations (and optionally persist snapshots). | Body: `companyId`, `campaignId?`, `simulate?`, `chat?`, `selected_api_ids?`, `manual_context?`, `regions?`, `enrichmentEnabled?`, `objective?`, `durationWeeks?`. | `RecommendationEngineResult` (trends_used, trends_ignored, weekly_plan, daily_plan, confidence_score, explanation, sources, persona_summary?, scenario_outcomes?, scoring_adjustments?, signal_quality?, chat_meta?, opportunity_analysis?); when !simulate, trends_used include `snapshot_hash`. |
| **`/api/recommendations/refresh`** | POST | “Refresh” entry point; company mode only returns message and does not run backend refresh. | Body: `mode` ('company' \| 'weekly'), `companyId`. | `{ success, message? }`. For `company`: message says use Generate. |
| **`/api/recommendations/analytics`** | GET | Analytics for recommendations. | Query: `fromDate?`, `toDate?`, `campaignId?`, `companyId?`. | `RecommendationAnalytics`: totals, by_platform, by_trend_source, by_policy, timeline. |
| **`/api/recommendations/detected-opportunities`** | GET | Detected opportunities for company + campaign. | Query: `companyId`, `campaignId`. | `{ opportunities: DetectedOpportunity[] }`. |
| **`/api/recommendations/state-map`** | GET | State (shortlisted/discarded/active) and summaries per recommendation. | Query: `companyId`, `snapshot_hashes?` (comma-separated). | `{ states, details, summaries, detailsBySnapshot, recommendations }` (snapshot_hash → recommendation id map). |
| **`/api/recommendations/[id]/state`** | POST | Set recommendation state (shortlisted / discarded / active). | Body: `state`, `opinion_note?`, `confidence_rating?`, `accept_preview?`. | `{ success: true }`. |
| **`/api/recommendations/run`** | POST | Start multi-region recommendation job. | Body: `companyId`, `selected_api_ids?`, `regions`, `keyword?`, `goal?`, `use_company_profile?`. | `201`: `{ jobId, status, created_at }`. |
| **`/api/recommendations/[id]/status`** | GET | Job status (id = jobId). | Query: `id` or `jobId`. | `{ jobId, status, regions?, signals_count?, signals_by_region?, partial_signals? }`. |
| **`/api/recommendations/[id]/result`** | GET | Job result (id = jobId). | Query: `id` or `jobId`. | `{ jobId, status, result?, consolidated_recommendation?, disclaimer_text?, divergence_score?, confidence_score?, message? }`. |
| **`/api/recommendations/[id]/preview-strategy`** | POST | 12-week strategy preview for a recommendation (or preview_context-only when no id). | Body: `preview_context?`, `company_id?`, `preview_overrides?`. Query: `id` = recommendation id. | `{ preview, confidence, platform_mix, content_frequency, recommendation_id?, snapshot_hash? }`. |
| **`/api/recommendations/[id]/prepare-plan`** | POST | Prepare planning context for campaign-planning. | Body: `draft?`, `priority_bucket?`. | Planning context JSON; client stores in sessionStorage and redirects to campaign-planning. |
| **`/api/recommendations/[id]/create-campaign`** | POST | Create campaign from one recommendation. | Body: `durationWeeks?`. | `{ campaign_id }`; redirect to campaign-planning. |
| **`/api/recommendations/group-preview`** | POST | Preview grouping of selected recommendations. | Body: `company_id`, `selected_recommendations` (array with snapshot_hash). | LLM grouping JSON: groups, suggested_platform_mix, suggested_frequency. |
| **`/api/recommendations/create-campaign-from-group`** | POST | Create campaign from grouped selection. | Body: `company_id`, `selected_recommendations`, `groups`, `suggested_platform_mix?`, `suggested_frequency?`. | `{ campaign_id, snapshot_hash?, omnivyre_decision? }`. |

### Used from policy / analytics pages

| Route | Method | Purpose | Request | Response |
|-------|--------|---------|---------|----------|
| **`/api/recommendations/simulate`** | POST | Policy simulation (baseline vs draft weights). | Body: `companyId?`, `campaignId?`, `draftPolicyWeights`. | `{ baseline_recommendations, simulated_recommendations, compared_with? }`. |
| **`/api/recommendation-policy`** | GET/POST | Load/update recommendation policy weights. | GET; POST body: `id`, `weights`. | Policy object. |
| **`/api/recommendations/audit/[id]`** | GET | Audit snapshot for a recommendation. | Query: id = recommendation id. | `{ audit }`. |

### Other recommendation APIs (not wired from main recommendations page in audit)

- **`/api/recommendations/merge`** – POST; merge snapshot_ids into a summary (audit only; not called from `recommendations.tsx`).
- **`/api/recommendations/[id]/archive`**, **`/api/recommendations/[id]/share`** – exist; usage not traced in this audit.

---

## 3. Storage (Database)

### Tables that persist recommendations

| Table | Purpose |
|-------|--------|
| **`recommendation_snapshots`** | One row per trend snapshot: company_id, campaign_id, snapshot_hash, trend_topic, category, audience, geo, platforms, promotion_mode, effort_score, success_projection, final_score, scores, confidence, explanation, refresh_source, refreshed_at, created_at; lifecycle: status, regions, source_signals_count, signals_source. |
| **`recommendation_jobs`** | Multi-region jobs: company_id, created_by_user_id, selected_api_ids, regions, keyword, goal, use_company_profile, status (QUEUED → RUNNING → READY_FOR_ANALYSIS → COMPLETED/FAILED), created_at, updated_at. |
| **`recommendation_raw_signals`** | Per (job, region, api): job_id, region_code, api_id, normalized_trends_json, raw_payload_json, latency_ms, status. |
| **`recommendation_analysis`** | One row per job: job_id, consolidated_recommendation_json, divergence_score, disclaimer_text, confidence_score. |
| **`recommendation_policies`** | Policy name, is_active, weights (JSONB). |
| **`recommendation_audit_logs`** | Detailed audit: recommendation_id, campaign_id, company_id, input_snapshot_hash, trend_sources_used, platform_strategies_used, company_profile_used, scores_breakdown, final_score, confidence, policy_id, policy_weights_used. |

### How “shortlisted” and “discarded” are stored

- **Not** stored on `recommendation_snapshots`. They are stored only in **`audit_logs`**.
- Action: `RECOMMENDATION_STATE_CHANGED`.
- Metadata: `recommendation_id`, `snapshot_hash`, `state` ('shortlisted' | 'discarded' | 'active'), `previous_state`, `actor_user_id`, `actor_role`, `opinion_note?`, `confidence_rating?`, etc.
- **State-map** (GET `/api/recommendations/state-map`) derives current state and summaries by reading `audit_logs` (and optionally joining to `recommendation_snapshots` for priority). Company Admin’s last decision is used as the “final” state when present.

---

## 4. Flow Map: User Action → API → DB → UI

### Generate (main flow)

1. User selects company (and optionally campaign), optionally checks “Scenario simulation”, optionally selects external APIs.
2. User clicks **Generate**.
3. **POST** `/api/recommendations/generate` with companyId, campaignId, simulate, chat, selected_api_ids.
4. Backend: `recommendationEngineService.generateRecommendations()` (and company profile, external APIs); if !simulate, insert into **`recommendation_snapshots`**, write **`audit_logs`** (e.g. RECOMMENDATION_GENERATED, TREND_SIGNAL_MERGE_COMPLETE).
5. Response: engine result with `trends_used` (and `snapshot_hash` when !simulate).
6. UI: `setEngineResult(data)`; if has snapshot hashes, **GET** `/api/recommendations/state-map?companyId=&snapshot_hashes=…` → fill states/summaries/by-snapshot map.
7. Content Manager Workspace and result cards show trends; Workspace tabs filter by state from state-map.

### Refresh

1. User clicks **Refresh Recommendations**.
2. **POST** `/api/recommendations/refresh` (mode: company, companyId) → backend returns message (no DB change for company mode).
3. UI then calls **Generate** (same as above). So “refresh” is effectively “generate again” from UI’s perspective.

### Shortlist / Discard

1. User clicks **Keep** or **Discard** (or **Restore** in Discarded tab) in Content Manager Workspace.
2. **POST** `/api/recommendations/[id]/state` with `state` (shortlisted | discarded | active).
3. Backend: insert **`audit_logs`** with action `RECOMMENDATION_STATE_CHANGED` and metadata (recommendation_id, snapshot_hash, state, actor, etc.).
4. UI: **GET** `/api/recommendations/state-map` again → states/summaries refresh; Workspace re-renders.

### Multi-region

1. User sets regions (or GLOBAL), goal, checks “Use company profile”, selects APIs if desired; clicks **Run multi-region**.
2. **POST** `/api/recommendations/run` → insert **`recommendation_jobs`**; background job writes **`recommendation_raw_signals`**, then **`recommendation_analysis`**.
3. UI polls **GET** `/api/recommendations/[jobId]/status` until COMPLETED/FAILED.
4. **GET** `/api/recommendations/[jobId]/result` → read **`recommendation_analysis`**.
5. UI shows consolidated recommendation, region-wise differences, disclaimer, divergence/confidence.

### Detected opportunities

1. On load (company + campaign selected), **GET** `/api/recommendations/detected-opportunities?companyId=&campaignId=` → backend runs engine in simulate mode + company profile + **`recommendation_snapshots`** / **`audit_logs`** for history, returns `opportunities`.
2. UI displays list; “Evaluate with AI” → **Generate** with `manual_context: { type: 'detected_opportunity', topic, source }` then optionally **POST** state.
3. “Generate Playbook” opens manual topic/narrative flow; submit can call **Generate** with manual_context.

### Draft 12-Week Plan / Preview

1. User clicks **Draft 12-Week Plan** for a recommendation (with snapshot_hash).
2. **POST** `/api/recommendations/[id]/preview-strategy` (id = recommendation id).
3. Backend uses **`recommendation_snapshots`** + company profile, calls AI → returns preview JSON.
4. UI shows preview; user can submit opinion/confidence and **POST** `/api/recommendations/[id]/state` (optional accept_preview); “Proceed to planning” → **GET** `/api/recommendations/[id]/prepare-plan` then redirect to campaign-planning with context.

### Create campaign (single / group)

- **Single**: **POST** `/api/recommendations/[id]/create-campaign` → creates campaign, redirect to campaign-planning.
- **Group**: Select ≥2 in Workspace → **POST** `/api/recommendations/group-preview` → then **POST** `/api/recommendations/create-campaign-from-group` with groups → creates campaign, links snapshots, runs AI plan, redirect.

### Analytics

1. User clicks **Analytics** → navigate to `/recommendations/analytics`.
2. **GET** `/api/recommendations/analytics?companyId=` (and optional filters).
3. Backend: **`recommendationAnalyticsService.getRecommendationAnalytics()`** reads **`recommendation_snapshots`**, **`recommendation_audit_logs`**, **`performance_feedback`**, **`recommendation_policies`**.
4. UI displays totals, by_platform, by_trend_source, by_policy, timeline.

### Scenario simulation (policy page)

1. User opens **Adjust Policy / Simulate** → `/recommendations/policy`; optionally sets campaign/recommendation and edits weights.
2. **POST** `/api/recommendations/simulate` with companyId, campaignId, draftPolicyWeights.
3. Backend: `recommendationSimulationService.simulateRecommendations()` (uses policy service); no snapshot writes.
4. Policy page shows baseline vs simulated recommendations.

---

## 5. Overlaps with “Recommendation Possibilities”

- The codebase does **not** use the phrase “Recommendation Possibilities” anywhere. So “Recommendation Possibilities” is treated here as a **new concept** you may introduce.
- Possible overlaps with the **current** feature set:
  - **Detected Market Opportunities**: read-only, curated list of opportunities (with “Evaluate with AI” / “Generate Playbook”). A “Possibilities” concept could sit here (e.g. pre-decided set of candidate recommendations before commitment).
  - **Content Manager Workspace (All / Shortlisted / Discarded)**: already a triage (active → shortlisted/discarded). “Possibilities” could map to “candidates not yet shortlisted/discarded,” or to a separate pipeline stage.
  - **Generate + Scenario simulation**: produces possibilities without persisting; “Possibilities” could be the artifact of a simulate-only or “proposal” run that is later promoted to full recommendations.

---

## 6. Unused or Redundant Features to Repurpose

- **Refresh (company mode)**: Does not perform any server-side refresh; it only returns a message and the UI then calls Generate. Either implement a real “refresh” (e.g. re-pull signals, profile-based invalidation) or remove/simplify the button to “Generate again.”
- **`/api/recommendations/merge`**: Not called from the main recommendations page. Could be used to combine multiple snapshots into one “possibility” or merged recommendation, or deprecated if not needed.
- **`/api/recommendations/manual/preview-strategy`**: **Referenced in UI** (e.g. for “preview for detected opportunity” when there is no recommendation id yet) but **this route does not exist** (only `[id]/preview-strategy` exists). Either add a `manual/preview-strategy` route that accepts only body (company_id + preview_context) or call a dedicated endpoint (e.g. placeholder id or new path) so “Draft 12-Week Plan” from a detected opportunity works.
- **Scenario simulation checkbox** vs **Policy page simulation**: Main page “Scenario simulation” only sets `simulate: true` on generate (no persistence). Policy page “Simulate” runs a separate flow with policy weights. The two are independent; could be unified (e.g. “run as possibility” vs “run as committed recommendation”) if you introduce Recommendation Possibilities.
- **recommendation_audit_logs**: Used by analytics and possibly policy/audit; not populated by the main generate flow (which writes to `audit_logs` and `recommendation_snapshots`). Clarify whether recommendation_audit_logs is the source of truth for recommendation-level audit or if audit_logs is sufficient; avoid duplicate or unused tables.

---

## 7. Summary Diagram

```
User actions on /recommendations
├── Generate (with optional Scenario simulation)
│   └── POST /api/recommendations/generate → recommendation_snapshots (if !simulate), audit_logs
│       → state-map → Content Manager Workspace
├── Refresh Recommendations
│   └── POST refresh (no-op for company) → Generate (same as above)
├── Keep / Discard / Restore
│   └── POST /api/recommendations/[id]/state → audit_logs (RECOMMENDATION_STATE_CHANGED)
│       → GET state-map → Workspace
├── Run multi-region
│   └── POST run → recommendation_jobs → raw_signals → recommendation_analysis
│       → GET status → GET result → UI
├── Detected opportunities
│   └── GET detected-opportunities (simulate + history) → Display; Evaluate → generate + state
├── Draft 12-Week / Create Campaign (single or group)
│   └── preview-strategy, prepare-plan, create-campaign, group-preview, create-campaign-from-group
├── Analytics / Adjust Policy
│   └── Navigate to /recommendations/analytics, /recommendations/policy
└── External API selection
    └── GET /api/external-apis/access → used in generate and run payloads
```

---

*Audit completed; no code was changed. Fix for missing `manual/preview-strategy` and any repurposing of refresh/merge should be done with your permission.*
