# Recommendation Card System — Analysis Report

**Scope:** Campaign duration logic, role-based visibility, data flow integrity.  
**Constraint:** Analysis only; no code modifications.

---

## INVESTIGATION A — CAMPAIGN DURATION SOURCE

### 1. Where campaign duration is generated

Campaign duration (weeks) is **not** generated in one place. It is **sourced or defaulted** at several layers:

| Layer | File | Behavior |
|-------|------|----------|
| **Recommendation generate API** | `pages/api/recommendations/generate.ts` | Reads `durationWeeks` from request body; passes to engine. Not required; often omitted. |
| **Recommendation engine** | `backend/services/recommendationEngineService.ts` (1083–1086) | If `input.durationWeeks == null`, sets `durationWeeks = 12` with console warning: *"Campaign duration not explicitly set; inferring from weeks array."* |
| **Campaign strategy (fallback plan)** | `backend/services/campaignRecommendationService.ts` (281–284) | Same: `duration = input.durationWeeks ?? 12`. |
| **Blueprint build** | `backend/services/recommendationBlueprintService.ts` | `buildCampaignBlueprint(strategySequence, durationWeeks)` — receives duration from engine (already 12 when missing). |
| **Card enrichment** | `backend/services/recommendationCardEnrichmentService.ts` (234–237) | Sets card `duration_weeks` from: card → blueprintByTopic → `campaign_blueprint_validated.duration_weeks`. **Does not** inject 12; can remain `null` if blueprint has no duration. |
| **Campaign creation from recommendation** | `backend/services/recommendationCampaignBuilder.ts` (114) | `durationWeeks: durationWeeks ?? 12` when calling `runCampaignAiPlan`. |
| **Campaign AI orchestrator** | `backend/services/campaignAiOrchestrator.ts` (2378) | `effectiveDurationWeeks = durationWeeks ?? 12` for plan generation. |
| **Hierarchical navigation** | `pages/api/campaigns/hierarchical-navigation.ts` (64) | `durationWeeks = blueprint?.duration_weeks ?? weeklyRefinements?.length ?? (campaignDuration in 1–52 ? campaignDuration : 12)`. |
| **Create 12-week plan** | `pages/api/campaigns/create-12week-plan.ts` (121–124) | `durationWeeks = req ?? campaign.duration_weeks ?? 12`. |
| **Execute preemption** | `pages/api/campaigns/execute-preemption.ts` (124) | `requested_weeks = initiator.duration_weeks ?? 12`. |
| **Campaign recommendation extension** | `backend/services/campaignRecommendationExtensionService.ts` (54) | `durationWeeks = campaign?.duration_weeks ?? blueprint?.duration_weeks ?? weeks.length ?? 12`. |

**Enrichment (campaign cards, not recommendation cards):**  
`backend/services/campaignEnrichmentService.ts` **does not** default duration to 12; it uses `resolveDuration(input)` which returns one of `2 | 4 | 8 | 12` weeks based on topic complexity/reach. That output is used for **enriched recommendation guidance** (weekly_guidance, progression_model), not for the recommendation engine’s blueprint duration.

### 2. Whether duration comes from AI, backend, template, or UI

| Source | Yes/No | Detail |
|--------|--------|--------|
| **AI output/prompt** | Indirect | AI is instructed with a fixed week count (e.g. “Exactly N weeks”) after duration is already resolved; it does not “choose” 12. |
| **Backend defaults** | **Yes** | Multiple services default `durationWeeks` or `duration_weeks` to **12** when missing (see table above). |
| **Template engine** | No | No template engine sets duration. |
| **UI fallback rendering** | **Yes** | Dashboard and similar UIs show `campaign.duration_weeks ?? 12` (e.g. `components/DashboardPage.tsx` 889, 1204; `components/HierarchicalNavigation.tsx` 298). |

So: **backend defaults** and **UI fallback rendering** are the direct reasons “12 weeks” appears even when duration was never explicitly set.

### 3. Full data flow: recommendation generation → storage → rendering → execution

```
[CLIENT]
  Trend tab / Recommendations page
  → POST /api/recommendations/generate
  → body: { companyId, strategicPayload, ... }
  → durationWeeks: often OMITTED (TrendCampaignsTab sends durationWeeks: 12 explicitly; other callers may omit)

[API]
  generate.ts
  → enforceCompanyAccess, campaign–company check
  → generateRecommendations({ ..., durationWeeks })  // may be undefined

[ENGINE] recommendationEngineService.ts
  → durationWeeks = input.durationWeeks ?? 12   // FIRST DEFAULT
  → buildCampaignBlueprint(strategySequence, durationWeeks)  // blueprint.duration_weeks = 12
  → validateCampaignBlueprint → campaign_blueprint_validated
  → enrichRecommendationCards(result)  // each card gets duration_weeks from blueprint (12)
  → resolveExecutionBlueprint(result) → execution_blueprint_resolved

[STORAGE]
  → recommendation_snapshots: trend_topic, company_id, campaign_id, etc. (no duration_weeks column in snapshot)
  → Full result (trends_used with duration_weeks per card, campaign_blueprint_validated) returned in API response

[RENDERING]
  → Frontend receives result.trends_used[] (enriched cards with duration_weeks)
  → RecommendationBlueprintCard.tsx: shows "Duration: {blueprint.duration_weeks} weeks" when != null
  → So when engine defaulted to 12, blueprint has 12 → card shows "12 weeks"

[EXECUTION]
  → Create campaign from recommendation: POST .../create-campaign or create-campaign-from-group
  → runCampaignAiPlan(..., durationWeeks: body.durationWeeks ?? 12)
  → campaignAiOrchestrator: effectiveDurationWeeks = durationWeeks ?? 12
  → Plan/blueprint persisted with that duration
  → Downstream: hierarchical-navigation, create-12week-plan, execute-preemption, etc. use campaign/blueprint duration or 12
```

### 4. Is duration assumed when missing?

**Yes.** In the recommendation path:

- **Engine:** `durationWeeks == null` → set to **12** (recommendationEngineService, campaignRecommendationService).
- **Blueprint:** Built with that value, so `campaign_blueprint_validated.duration_weeks` is 12 when input had no duration.
- **Cards:** Get `duration_weeks` from blueprint (or null if no blueprint); no extra “12” in card enrichment when blueprint is absent.
- **UI (campaign/dashboard):** Multiple components render `duration_weeks ?? 12` for **campaign** display.

So the recommendation **card** shows “12 weeks” because the **engine** assumed 12 when the client did not send `durationWeeks`.

### 5. All default values related to campaign timeline

| Location | Default | Condition |
|----------|---------|-----------|
| `recommendationEngineService.ts` | 12 | `input.durationWeeks == null` |
| `campaignRecommendationService.ts` | 12 | `input.durationWeeks == null` |
| `campaignAiOrchestrator.ts` | 12 | `durationWeeks ?? 12` (effectiveDurationWeeks) |
| `recommendationCampaignBuilder.ts` | 12 | `durationWeeks ?? 12` for runCampaignAiPlan |
| `campaignRecommendationExtensionService.ts` | 12 | Last in chain: campaign → blueprint → weeks.length → 12 |
| `pages/api/campaigns/hierarchical-navigation.ts` | 12 | When blueprint and refinements don’t yield a valid duration |
| `pages/api/campaigns/create-12week-plan.ts` | 12 | When request and campaign have no valid duration |
| `pages/api/campaigns/execute-preemption.ts` | 12 | `initiator.duration_weeks ?? 12` |
| `components/DashboardPage.tsx` | 12 | Display: `campaign.duration_weeks ?? 12` |
| `components/HierarchicalNavigation.tsx` | 12 | `overview?.totalWeeks ?? 12` |
| `components/AIContentIntegration.tsx` | 12 | `durationWeeks ?? 12` |
| `pages/campaign-planning-hierarchical.tsx` | 12 | `(overview?.totalWeeks ?? displayPlans.length) || 12` |
| `pages/recommendations.tsx` | 12 / 6 | Create campaign body: `durationWeeks: 12` or `options?.draft ? 6 : 12` |
| `components/recommendations/tabs/TrendCampaignsTab.tsx` | 12 | Generate request: `durationWeeks: 12` |

**Allowed duration set (enrichment):**  
`campaignEnrichmentService.ts`: `ALLOWED_DURATION_WEEKS = [2, 4, 8, 12]`; `resolveDuration()` returns one of these based on input (no default “12” inside that function; it’s rule-based).

---

## INVESTIGATION B — ROLE-BASED VISIBILITY

### 1. All roles and content manager

| Role | Definition / notes |
|------|---------------------|
| **SUPER_ADMIN** | Backend `Role.SUPER_ADMIN`; full access; can access super-admin and recommendation audit APIs. |
| **COMPANY_ADMIN** | Company-scoped admin; create campaigns, manage team, generate recommendations, create campaign from recommendation (where allowed). |
| **CONTENT_CREATOR** | Can generate recommendations, view campaigns, create campaigns, use Trend tab. |
| **CONTENT_MANAGER** | In `rbacService.ts`, **normalized to CONTENT_CREATOR** (`normalizePermissionRole`). So for RBAC they are treated as CONTENT_CREATOR. |
| **CONTENT_REVIEWER** | Can view dashboard/analytics, create campaign, approve content. |
| **CONTENT_PUBLISHER** | Same as above + publish. |
| **VIEW_ONLY** | Dashboard/analytics view; no generate. |
| **Content Architect** | **Not** a standard RBAC role. Separate auth via cookie (`content_architect_session`). `userId === 'content_architect'`; used for content-architect search and company profile. Does **not** get COMPANY_ADMIN/CONTENT_CREATOR on recommendation APIs unless given company membership elsewhere. |

**Content Manager visibility:**  
Treated as CONTENT_CREATOR by RBAC. So they have the **same** recommendation visibility as CONTENT_CREATOR (generate, view, create campaign where that role is allowed). The only API that explicitly lists CONTENT_MANAGER in addition is `pages/api/recommendations/detected-opportunities.ts` (COMPANY_ADMIN, CONTENT_CREATOR, CONTENT_MANAGER, SUPER_ADMIN).

### 2. What data each role currently sees

There is **no role-based filtering of recommendation payload fields** in the backend. Access is gate-based:

- **Who can call generate:** `withRBAC(handler, [Role.COMPANY_ADMIN, Role.CONTENT_CREATOR])` on `pages/api/recommendations/generate.ts`. So only COMPANY_ADMIN and CONTENT_CREATOR get to generate; the response shape is the same for both.
- **Who can call other recommendation APIs:** Each route has its own withRBAC or enforceCompanyAccess. For example: used-by-company, refresh, strategy-history: COMPANY_ADMIN, CONTENT_CREATOR; create-campaign (single): SUPER_ADMIN, ADMIN; create-campaign-from-group: COMPANY_ADMIN, CONTENT_CREATOR, SUPER_ADMIN; state-map, prepare-plan: COMPANY_ADMIN, CONTENT_CREATOR, SUPER_ADMIN.
- **Data seen:** Once a user is allowed to call an endpoint, they receive the **full** response (trends_used with all enriched fields, company_context, strategy_dna, campaign_blueprint_validated, execution_blueprint_resolved, etc.). There is no “minimal view” or “expert view” by role.

So today:

- **Super admin:** Full access to recommendation and audit APIs; sees full payloads.
- **Company admin:** Can generate, view, create campaign from group; sees full payloads.
- **Content creator (and content manager):** Same as company admin for generate/view/group flow; sees full payloads.
- **Content architect:** Not in recommendation RBAC; typically no access to `/api/recommendations/*` unless given a company role; no separate “content architect view” of recommendations.
- **View-only / reviewer / publisher:** Can view dashboard/analytics (VIEW_ANALYTICS); no generate; if they ever get a recommendation result (e.g. shared link), they would see full payload because there is no field-level filtering.

### 3. Where role logic lives (backend vs frontend)

| Concern | Backend | Frontend |
|---------|---------|----------|
| **Who can call generate** | withRBAC + enforceCompanyAccess in generate.ts | — |
| **Who can create campaign from recommendation** | withRBAC on create-campaign (SUPER_ADMIN, ADMIN) vs create-campaign-from-group (COMPANY_ADMIN, CONTENT_CREATOR, SUPER_ADMIN) | recommendations.tsx: canCreateCampaignFromRecommendation, canPreparePlan, etc. by role string |
| **Who can shortlist/discard/state** | allowedRoles in state.ts, state-map.ts, etc. | Same roles used to show/hide buttons |
| **What data is returned** | No filtering by role; full result | — |
| **Visibility of UI sections** | — | recommendations.tsx: canGenerateThemes, canSeeDetectedOpportunities, canApproveRecommendation, canDiscardRecommendation derived from role |

So: **backend** = access control (which roles can call which endpoints); **frontend** = which actions (generate, approve, discard, create campaign) are shown. **Neither** currently restricts which **fields** of a recommendation/card are visible by role.

### 4. Permission-based UI rendering

- **Action visibility:** Buttons for “Generate Strategic Themes”, “Create campaign from recommendation”, “Prepare plan”, approve/discard, etc. are gated by role (e.g. COMPANY_ADMIN, CONTENT_CREATOR, CONTENT_MANAGER) in `pages/recommendations.tsx`.
- **Field-level visibility:** There is **no** permission-based hiding of specific fields (e.g. duration, blueprint, company_context) per role. All roles that can see a recommendation see the same card content.

---

## INVESTIGATION C — SYSTEM INFORMATION FLOW

### 1. All fields sent to execution pipelines

Execution here means: **creating a campaign from recommendations** and **running the campaign AI plan**, plus any flow that uses **execution_blueprint_resolved** or **campaign_blueprint_validated**.

**From recommendation result into execution:**

- **execution_blueprint_resolved** (or validated blueprint): `duration_weeks`, `weekly_plan[]` (week_number, stage, stage_objective, psychological_goal, momentum_level, primary_recommendations, supporting_recommendations, etc.). This is the only contract used by `blueprintExecutionResolver` and `checkExecutionBlueprintGuard`.
- **Create-campaign APIs** do **not** send the full recommendation result to the execution pipeline. They:
  - Create campaign + campaign_version (with build_mode, context_scope, campaign_types, etc.).
  - Build a **text context** from recommendation snapshot + decision state + team opinion + opportunity analysis (`buildRecommendationContext`).
  - Call `runCampaignAiPlan({ campaignId, mode: 'generate_plan', message, durationWeeks, collectedPlanningContext })`. So the **fields** that actually drive execution are: **durationWeeks** (from request body or default 12), **message** (string context), **collectedPlanningContext** (from getCampaignPlanningInputs: available_content, weekly_capacity, exclusive_campaigns, selected_platforms, platform_content_requests).

**Fields in the recommendation API response** (for context; not all go to execution):

- trends_used[]: topic, polished_title, summary, estimated_reach, formats, regions, aspect, facets, audience_personas, messaging_hooks, intelligence{}, execution{}, duration_weeks, progression_summary, primary_recommendations, supporting_recommendations, company_context_snapshot, alignment_score, final_alignment_score, strategy_modifier, strategy_mode, diamond_type, …
- campaign_blueprint_validated: duration_weeks, weekly_plan[], progression_summary
- execution_blueprint_resolved: same as validated (used for execution guard)
- company_context, strategy_dna, strategy_feedback, strategy_sequence, signals_source, etc.

### 2. Categorization: execution-critical vs UI-only vs system metadata

| Category | Examples |
|----------|----------|
| **Execution-critical** | `duration_weeks` (for blueprint and runCampaignAiPlan), `weekly_plan` (structure and content), `execution_blueprint_resolved` / `campaign_blueprint_validated`; for create-campaign: **durationWeeks** in request, **message** (recommendation context), **collectedPlanningContext**. |
| **UI-only** | Card labels (polished_title, summary, badges), alignment_score, final_alignment_score, strategy_modifier, diamond_type, progression_summary text, company_context_snapshot (for display), primary_recommendations / supporting_recommendations lists for card preview. |
| **System metadata** | signals_source, omnivyra_metadata, signal_quality, strategy_dna (mode), strategy_feedback, novelty_score, audit/snapshot ids. |

**Important:** `duration_weeks` is both **shown on the card** (UI) and **used to build the blueprint** and to drive **runCampaignAiPlan**. So it is execution-critical; hiding it in UI must not remove it from the payload used for execution.

### 3. Could hiding fields in UI affect execution?

- **If hiding is UI-only (e.g. not rendering some fields in the card):** Execution is **not** affected, because execution uses the same backend result and the same create-campaign/runCampaignAiPlan calls with duration and context. As long as the client does not **strip** those fields from the payload when calling create-campaign or when the backend builds the plan, execution stays correct.
- **If the backend were to filter response by role** (e.g. omit duration_weeks for VIEW_ONLY): Then any client that creates a campaign from the **same** recommendation (e.g. via snapshot id + server-side resolution) would need the backend to supply duration from snapshot/blueprint when the client doesn’t send it. Currently create-campaign uses **request body durationWeeks** or backend default 12, not the stored recommendation result, so a role-based filter on the **generate** response would not by itself break create-campaign. But if a future flow sent “use duration from last recommendation result” and that result had duration stripped, execution could get the wrong duration. So: **safe** to hide duration in UI only (don’t render it); **risky** to remove duration from API response for some roles without ensuring execution path still gets duration from somewhere.

---

## OUTPUT SUMMARY

### Root cause of “12 weeks”

- **Backend:** When `durationWeeks` is not sent (or is null), the recommendation engine sets it to **12** in `recommendationEngineService.ts`. The blueprint is then built with 12 weeks, so `campaign_blueprint_validated.duration_weeks === 12`. Card enrichment copies that to each card, so the card shows “Duration: 12 weeks”.
- **UI:** Some callers (e.g. TrendCampaignsTab) explicitly send `durationWeeks: 12`. Others omit it and rely on the backend default. Dashboard/campaign UIs also render `campaign.duration_weeks ?? 12`, which reinforces “12 weeks” when the campaign row has no duration set.

So the root cause is **backend default 12 when duration is missing**, plus **UI fallbacks to 12** for campaign display; the recommendation **card** shows 12 because the **engine** defaulted to 12 and put it in the blueprint.

### Role visibility matrix (role vs visible fields)

| Role | Can generate | Can create campaign (single) | Can create campaign (group) | Can approve/discard | Visible fields |
|------|----------------|-------------------------------|-----------------------------|----------------------|-----------------|
| SUPER_ADMIN | Yes* | Yes | Yes | Yes | Full response (no filtering) |
| COMPANY_ADMIN | Yes | No** | Yes | Yes | Full response |
| CONTENT_CREATOR | Yes | No** | Yes | No (UI) | Full response |
| CONTENT_MANAGER | Treated as CONTENT_CREATOR | No** | Yes | Yes (in UI) | Full response |
| CONTENT_REVIEWER / PUBLISHER | No | No | No | — | N/A (no recommendation generate) |
| VIEW_ONLY | No | No | No | — | N/A |
| Content Architect | No (separate auth) | No | No | — | N/A |

\* Via company access.  
\** create-campaign (single recommendation) is withRBAC(..., [Role.SUPER_ADMIN, Role.ADMIN]); create-campaign-from-group allows COMPANY_ADMIN, CONTENT_CREATOR, SUPER_ADMIN.

There is **no per-role field visibility**; “visible fields” = full API response for whoever is allowed to call the endpoint.

### Data flow diagram (text)

```
[Client]
  recommendations.tsx / TrendCampaignsTab
  → POST /api/recommendations/generate
  → body: { companyId, (durationWeeks?), strategicPayload, ... }

[generate.ts]
  → enforceCompanyAccess(companyId, campaignId?)
  → campaign_versions check if campaignId present
  → getStrategyHistoryForCompany(companyId)
  → generateRecommendations(companyId, campaignId, objective, durationWeeks, ...)

[recommendationEngineService]
  → durationWeeks = input.durationWeeks ?? 12
  → fetchExternalApis / profile / strategy / sequencing
  → buildCampaignBlueprint(strategySequence, durationWeeks)  → campaign_blueprint
  → validateCampaignBlueprint → campaign_blueprint_validated
  → enrichRecommendationCards(result)  → trends_used[].duration_weeks from blueprint
  → resolveExecutionBlueprint → execution_blueprint_resolved
  → return result (trends_used, campaign_blueprint_validated, execution_blueprint_resolved, ...)

[generate.ts]
  → recommendation_snapshots insert (per topic)
  → audit_logs
  → return result to client

[Client]
  → Renders RecommendationBlueprintCard for each trend; card shows duration_weeks when != null

[Execution]
  → POST /api/recommendations/:id/create-campaign or create-campaign-from-group
  → body: { durationWeeks?: number, ... }
  → Create campaign + campaign_version
  → buildRecommendationContext(snapshot, decision, teamOpinion, opportunityAnalysis)
  → runCampaignAiPlan({ campaignId, durationWeeks: body.durationWeeks ?? 12, message, collectedPlanningContext })
  → campaignAiOrchestrator: effectiveDurationWeeks = durationWeeks ?? 12 → plan generation
  → Blueprint/schedule persisted; downstream APIs use campaign.duration_weeks or 12
```

### Safe modification points for minimal/expert views

- **Frontend-only (safest):** In RecommendationBlueprintCard (or a wrapper), **hide** certain sections by role or “view mode” (e.g. don’t render “Duration”, “Campaign Blueprint Preview”, “Company context snapshot”) while still **keeping** the full object in React state and sending full payload to any create-campaign or prepare-plan call. Execution stays safe because backend and create-campaign still receive or use duration and context as today.
- **Backend response filtering:** If adding role-based field filtering (e.g. omit company_context_snapshot for VIEW_ONLY), keep **duration_weeks** and **execution_blueprint_resolved** (or at least duration + weekly_plan) for any path that can create a campaign or run a plan. Prefer a separate “minimal” response shape (e.g. query param) rather than removing execution-critical fields from existing roles.
- **Duration default:** To avoid “12 weeks” when user never chose it: (1) stop defaulting to 12 in the engine (or default only when creating a plan, not when returning cards); or (2) pass duration explicitly from UI (e.g. selector) and/or store “no duration” in blueprint and show “Duration: Not set” until user confirms. Safe modification points: `recommendationEngineService.ts` (durationWeeks fallback), `recommendationCardEnrichmentService` (could leave card.duration_weeks null when blueprint has none), and UI (stop rendering “12” when value is the backend default and not user-confirmed).

### Risks and coupling concerns

1. **Many 12-week defaults:** Changing “no duration” behavior requires touching multiple services and UIs; easy to leave one path still defaulting to 12 and inconsistent.
2. **Execution depends on request body for create-campaign:** Duration for the new campaign comes from `req.body.durationWeeks` or 12, not from the recommendation snapshot. So if you add “duration from recommendation” later, that must be stored or passed explicitly (e.g. from snapshot or from last generate result).
3. **No single source of truth for duration:** Campaign has `duration_weeks`; blueprint has `duration_weeks`; engine uses `durationWeeks`; create-campaign uses body. Reconciliation and consistency (e.g. after “negotiate duration”) need to be explicit.
4. **Role-based views:** Introducing minimal/expert views by **removing** fields in the API for some roles can break any client that assumes those fields exist. Prefer additive (new endpoints or query params) or UI-only hiding.
5. **Content architect:** Not in recommendation RBAC; adding them to recommendation visibility would require defining company scope and which endpoints they can call, and whether they see full or reduced payloads.

---

*End of report. No code was modified.*
