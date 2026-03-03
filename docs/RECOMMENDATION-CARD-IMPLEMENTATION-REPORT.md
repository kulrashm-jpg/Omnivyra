# Recommendation Card Implementation — Analysis Report

**Objective:** Understand how the recommendation card is structured and rendered so role-based visibility can be implemented without breaking execution data.  
**Scope:** Data structure, UI rendering, role handling, safe modification points, implementation risks.  
**Constraint:** Analysis only; no code modifications.

---

## 1. DATA STRUCTURE

### 1.1 Where recommendation data originates

| Stage | Location | Description |
|-------|----------|--------------|
| **Generation** | `pages/api/recommendations/generate.ts` | POST handler; calls `generateRecommendations()` with `companyId`, `durationWeeks`, `strategicPayload`, etc. |
| **Engine** | `backend/services/recommendationEngineService.ts` | Produces raw result with `trends_used`, `strategy_sequence`, `campaign_blueprint_validated`, etc. |
| **Enrichment** | `backend/services/recommendationCardEnrichmentService.ts` | `enrichRecommendationCards(result)` runs after engine; mutates `result.trends_used` in place (returns same result shape). |
| **Execution resolution** | `backend/services/blueprintExecutionResolver.ts` | `resolveExecutionBlueprint(result)` sets `result.execution_blueprint_resolved` from validated blueprint. |
| **API response** | `pages/api/recommendations/generate.ts` | Returns `resultWithSnapshots` (full result with `trends_used` augmented by `snapshot_hash`, `id` per topic). |
| **Persistence** | `recommendation_snapshots` (Supabase) | Per-topic rows; `trend_topic`, `company_id`, `campaign_id`, `snapshot_hash`, etc. No single “card” row; card = one element of `trends_used`. |

Flow: **Client → POST /api/recommendations/generate → recommendationEngineService → enrichRecommendationCards → resolveExecutionBlueprint → snapshots persisted → full result returned to client.**

### 1.2 Full schema of the recommendation object (single card)

A single recommendation **card** is one element of `result.trends_used[]`. The card type is effectively `Record<string, unknown> & { topic: string }` at the API boundary; enrichment adds well-defined fields.

**Enrichment input (engine output per trend):**  
Engine produces `TrendSignalNormalized`-shaped items (topic, source, geo, velocity, etc.) plus fields added by polish/intelligence/ranking. Enrichment expects `CardLike = Record<string, unknown> & { topic: string }`.

**Enrichment output (full card schema as consumed by UI and execution):**

| Field | Type | Source | Mandatory for card |
|-------|------|--------|----------------------|
| `topic` | string | Engine (required on CardLike) | **Yes** |
| `polished_title` | string \| null | Engine / polish | No |
| `summary` | string \| null | Engine; fallback `narrative_direction` | No |
| `narrative_direction` | string \| null | Engine | No |
| `estimated_reach` / `volume` | number \| null | Engine | No |
| `formats` | string[] | Engine | No |
| `regions` | string[] | Engine | No |
| `aspect` / `selected_aspect` | string \| null | Engine | No |
| `facets` | string[] | Engine | No |
| `audience_personas` | string[] | Engine | No |
| `messaging_hooks` | string[] | Engine | No |
| `intelligence` | `{ problem_being_solved, gap_being_filled, why_now, authority_reason, expected_transformation, campaign_angle }` | Engine + enrichment (merge) | No |
| `alignment_score` / `alignmentScore` | number \| null | Engine / enrichment | No |
| `final_alignment_score` / `finalAlignmentScore` | number \| null | Engine / enrichment | No |
| `strategy_modifier` | number \| null | Engine / enrichment | No |
| `strategy_mode` | string \| null | Card or `result.strategy_dna.mode` | No |
| `diamond_type` | string \| null | Card or derived from `polish_flags` | No |
| `polish_flags` | `{ authority_elevated?, diamond_candidate?, is_generic_reframed? }` | Engine | No |
| `execution` | `{ execution_stage, stage_objective, psychological_goal, momentum_level }` | Enrichment from `strategy_sequence` + card | No |
| `execution_stage`, `stage_objective`, `psychological_goal`, `momentum_level` | (top-level aliases) | Enrichment | No |
| `duration_weeks` | number \| null | Enrichment from blueprint by topic or `campaign_blueprint_validated.duration_weeks` | No (but execution-critical when creating campaign) |
| `progression_summary` | string \| null | Enrichment from blueprint | No |
| `primary_recommendations` | `Array<{ topic? }>` | Enrichment from blueprint by topic | No |
| `supporting_recommendations` | `Array<{ topic? }>` | Enrichment from blueprint | No |
| `company_context_snapshot` | `{ core_problem_statement, pain_symptoms, desired_transformation, authority_domains, brand_voice, brand_positioning, reader_emotion_target, narrative_flow_seed, recommended_cta_style, recommendation_notes }` | Enrichment from `result.company_context` | No |
| `company_problem_transformation` | object \| null | Enrichment from `result.company_context.problem_transformation` | No |
| `id` | string \| undefined | API layer (from `snapshotRowsByTopic[trend.topic]?.id`) | No |
| `snapshot_hash` | string \| undefined | API layer | No |

**Mandatory vs optional:**  
- **Mandatory for a valid card:** Only `topic` (enrichment and card component assume it exists).  
- All other fields are optional for display; the card uses safe readers (`readText`, `readNumber`, `readList`, `readTopicList`) and conditional sections.

### 1.3 Fields passed to execution pipelines

Execution here means: **creating a campaign from a recommendation** and **running the campaign AI plan**.

- **Create campaign from single recommendation** (`recommendationCampaignBuilder.ts`):  
  - Does **not** receive the full recommendation object from the generate API. It loads by `recommendationId` from `recommendation_snapshots`, then builds a **text context** via `stringifyContext(snapshot, profile)` and calls `runCampaignAiPlan({ campaignId, mode: 'generate_plan', message, durationWeeks: durationWeeks ?? 12, collectedPlanningContext })`. So execution uses: **durationWeeks** (param, default 12), **message** (stringified snapshot + profile), **collectedPlanningContext** (from `getCampaignPlanningInputs`).

- **Create campaign from group** (`pages/api/recommendations/create-campaign-from-group.ts`):  
  - Receives `selected_recommendations` (with `snapshot_hash`), `groups`, etc. Loads snapshots from DB by `snapshot_hash`. Does **not** pass `durationWeeks` to `runCampaignAiPlan` (orchestrator will use default 12). Builds `message` from groups, suggested_platform_mix, suggested_frequency, selected_recommendations, team opinion. So execution uses: **message**, **collectedPlanningContext**; duration is backend default.

- **Build Campaign Blueprint** (Trend tab → save card to campaign):  
  - Client calls `PUT /api/campaigns/:id/source-recommendation` with `source_strategic_theme` (subset of card: topic, polished_title, summary, intelligence, execution, company_context_snapshot, duration_weeks, progression_summary, primary/supporting_recommendations, estimated_reach, formats, regions). That stored theme is then used by **regenerate-blueprint** and campaign detail views. The **regenerate-blueprint** API uses “strategic theme from selected recommendation card” when building the plan. So the **stored** `source_strategic_theme` (and thus card fields like `duration_weeks`, blueprint preview fields) **is** part of the execution context for plan regeneration, but the create-campaign-from-group and single recommendation create flows do not read duration from the card; they use request body or default.

- **Execution blueprint (backend):**  
  - `execution_blueprint_resolved` / `campaign_blueprint_validated` (duration_weeks, weekly_plan) are used by `blueprintExecutionResolver` and `checkExecutionBlueprintGuard`. These live on the **result** object, not on each card. Cards get `duration_weeks` and blueprint preview fields **from** the validated blueprint via enrichment. So: **Execution-critical at result level:** `campaign_blueprint_validated`, `execution_blueprint_resolved`. **Execution-critical when “Build Campaign Blueprint” is used:** the payload sent to `source-recommendation` (including `duration_weeks`, strategic theme) and later used by regenerate-blueprint.

**Summary:**  
- **Fields that drive execution:** For create-campaign (single/group): **durationWeeks** (param or default), **message** (context string), **collectedPlanningContext**. For “Build Campaign Blueprint” + regenerate: **source_strategic_theme** (includes duration_weeks, blueprint preview, intelligence, execution, company_context_snapshot).  
- **Do not remove from API response for any role that can trigger execution:** `duration_weeks` on cards and/or on result blueprint, and the full payload needed to build `source_strategic_theme` and `message`. Hiding fields **only in the UI** does not strip them from the payload used for create-campaign or source-recommendation.

---

## 2. UI RENDERING

### 2.1 Component tree used to render the recommendation card

```
RecommendationsPage (pages/recommendations.tsx)
  └─ CompanyContext (user, userRole, companies, …)
  └─ Tab UI (e.g. TREND)
       └─ TrendCampaignsTab (components/recommendations/tabs/TrendCampaignsTab.tsx)
            └─ engineRecommendations / visibleEngineCardsWithStatus
            └─ For each card:
                 └─ RecommendationBlueprintCard (components/recommendations/cards/RecommendationBlueprintCard.tsx)
                      props: recommendation, onBuildCampaignBlueprint, onMarkLongTerm, onArchive, strategyStatus
```

**Other usage of RecommendationBlueprintCard:**  
- **Content Architect** (`pages/content-architect.tsx`): Renders a single card when a campaign has a stored `sourceRecommendationCard` (source_strategic_theme); card data comes from API `GET /api/campaigns` → `sourceRecommendationCard.source_strategic_theme`.

So the **only** component that renders a full recommendation card is **RecommendationBlueprintCard**; it receives a single `recommendation` object (the enriched card).

### 2.2 Which components render which fields

All card field rendering lives inside **RecommendationBlueprintCard.tsx**. The component normalizes the `recommendation` prop into internal blocks via safe readers, then conditionally renders sections.

| Section | Rendered fields | Condition |
|--------|------------------|-----------|
| **Core Theme** | `polished_title`, `topic`, `summary` (fallback `narrative_direction`), strategy status badges | Always (title/summary); badges when `strategyStatus` is continuation/expansion/momentum_expand |
| **Core (when !minimized)** | `estimated_reach`, `formats`, `regions` | When not minimized |
| **Strategic Context** | `aspect`/`selected_aspect`, `facets`, `audience_personas`, `messaging_hooks` | `!minimized && hasStrategicContext` |
| **Diamond Intelligence** | `intelligence.*` (problem_being_solved, gap_being_filled, why_now, authority_reason, expected_transformation, campaign_angle), badges: diamond_type, strategy_mode, final_alignment_score, strategy_modifier | `!minimized && hasIntelligence` |
| **Company Context Snapshot** | `company_context_snapshot.*` (brand_voice, brand_positioning, reader_emotion_target, narrative_flow_seed, recommended_cta_style, core_problem_statement, pain_symptoms, desired_transformation, authority_domains) | `!minimized && hasSnapshot` |
| **Execution Stage** | `execution.*` or top-level execution_stage, stage_objective, psychological_goal, momentum_level | `!minimized && hasExecution` |
| **Strategic Badges** | Derived from diamond_type, polish_flags, campaign_angle (e.g. “Authority Opportunity”, “Diamond Candidate”, “Conversion Driver”) | When badges.length > 0 |
| **Campaign Blueprint Preview** | `duration_weeks`, `progression_summary`, `primary_recommendations`, `supporting_recommendations` | `!minimized && (duration_weeks != null \|\| progression_summary \|\| primary/supporting length > 0)` |
| **Actions** | Buttons: Build Campaign Blueprint, Expand Theme Strategy, Mark Long-Term, Archive | Always (buttons disabled by callback presence) |
| **Expandable Details** | `summary` again | `!minimized && expanded` |

So: **one component**, **one place** where every card field is mapped to UI. There is no other card variant; Content Architect reuses the same component with a (possibly partial) strategic theme object.

### 2.3 Existing conditional rendering logic

- **Minimized state:** Default `minimized === true`; only Core Theme (title, summary) and Actions are always visible. All other sections (Strategic Context, Diamond Intelligence, Company Context Snapshot, Execution Stage, Campaign Blueprint Preview, Expandable Details) are gated by `!minimized`.
- **Section visibility:** Each section has a “has*” flag (e.g. `hasStrategicContext`, `hasIntelligence`, `hasSnapshot`, `hasExecution`) so a section is shown only if at least one of its fields is present.
- **Blueprint preview:** Shown only if `duration_weeks != null` or `progression_summary` or primary/supporting lists non-empty.
- **Badges:** Computed from `diamond_type`, `polish_flags`, and `campaign_angle`; section only if `badges.length > 0`.
- **Strategy status badges:** Rendered only when `strategyStatus` is one of continuation, expansion, momentum_expand.

There is **no** role-based or permission-based conditional rendering of sections or fields inside the card today.

---

## 3. ROLE HANDLING

### 3.1 How user roles are currently detected

- **Source of truth:** Supabase `user_company_roles` (columns: `user_id`, `company_id`, `role`, `status`). Role is per company.
- **Loading:** In `CompanyContext.tsx`, on auth load we query `user_company_roles` for the current user, normalize role via `normalizeCompanyRole(entry.role)`, and build `rolesByCompany: Record<company_id, role>`.
- **Current company role:** When the user selects a company, `setUserRole(rolesByCompany[companyId] || null)` (or from `rolesMap[resolvedId]` on initial load). So **userRole** in the app is the **company-scoped** role (e.g. `COMPANY_ADMIN`, `CONTENT_CREATOR`, `SUPER_ADMIN`).
- **Content Architect:** Special path: `loadContentArchitectContext` uses `/api/company-profile?mode=list` and sets `userRole = 'CONTENT_ARCHITECT'`; no `user_company_roles` in that flow.
- **Recommendations page:** Uses `userRole` and `hasPermission` from `useCompanyContext()`; no direct API call for role on that page.

So role is **detected in the frontend** from CompanyContext (backed by `user_company_roles` or Content Architect API), and **enforced in the backend** per endpoint via `withRBAC` and `enforceCompanyAccess`.

### 3.2 Where permissions are checked

- **Backend (recommendation APIs):**
  - **Generate:** `withRBAC(handler, [Role.COMPANY_ADMIN, Role.CONTENT_CREATOR])`; `enforceCompanyAccess(companyId, campaignId)`.
  - **Create campaign from group:** `withRBAC(handler, [Role.COMPANY_ADMIN, Role.CONTENT_CREATOR, Role.SUPER_ADMIN])`.
  - **Single create campaign:** Uses `withRBAC(..., [Role.SUPER_ADMIN, Role.ADMIN])` (different from group).
  - **State / state-map / prepare-plan / etc.:** Each route has its own `withRBAC` and/or company access.
- **Frontend (recommendations.tsx):**
  - `canManageRecommendationState`: COMPANY_ADMIN, CONTENT_CREATOR, SUPER_ADMIN.
  - `canSeeDetectedOpportunities`: COMPANY_ADMIN, CONTENT_CREATOR, CONTENT_MANAGER, SUPER_ADMIN.
  - `canGenerateDetectedPlaybook`: COMPANY_ADMIN, CONTENT_MANAGER.
  - `canGroupRecommendations`: COMPANY_ADMIN, CONTENT_MANAGER.
  - These drive **visibility of actions/tabs** (e.g. generate, group, detected opportunities), not visibility of **fields** inside a card.

So: **Permissions are checked** at API (who can call what) and at page level (which buttons/tabs to show). **No** checks today for “this role may not see duration_weeks” or “this role sees minimal card.”

### 3.3 Whether role-based UI rendering already exists

- **Action/feature visibility:** Yes. Generate, create campaign from group, detected opportunities, group recommendations, etc. are gated by the `can*` flags above.
- **Field-level or section-level visibility inside the card:** No. All roles that can see a recommendation see the same card content (all sections when expanded). RecommendationBlueprintCard does not accept a role prop and does not hide any block by role.

---

## 4. SAFE MODIFICATION POINTS

### 4.1 Best place to introduce role-based visibility

- **Rendering layer (recommended):**  
  Implement role-based visibility **inside RecommendationBlueprintCard** (or a thin wrapper). Pass `userRole` (or a “view mode” derived from role) and conditionally render sections (e.g. hide “Campaign Blueprint Preview” or “Company Context Snapshot” or “Diamond Intelligence” for VIEW_ONLY or a “minimal” role).  
  - **Pros:** Single component owns all card UI; no change to API or data shape; execution unchanged because the full `recommendation` object remains in React state and is still sent as-is to Build Campaign Blueprint and create-campaign flows.  
  - **Cons:** Role must be passed down from RecommendationsPage → TrendCampaignsTab → RecommendationBlueprintCard (or from context).

- **Component composition:**  
  A wrapper that chooses “full” vs “minimal” card component (or passes a “sections to show” mask) keeps RecommendationBlueprintCard as-is and centralizes role logic in the parent. Same safety as above; slightly more indirection.

- **Data layer (backend response filtering):**  
  If the API were to omit or null out fields for certain roles (e.g. strip `duration_weeks` for VIEW_ONLY):  
  - **Risky:** Any code path that creates a campaign or saves source_strategic_theme and assumes those fields exist could break, or could send undefined and rely on backend defaults. Safe only if (1) execution paths never depend on client-provided duration/blueprint from the same response, or (2) backend always re-resolves duration/blueprint from snapshot when the client does not send them. Currently create-campaign-from-group does **not** pass duration from the generate result; single create uses param/default. So filtering **only** the generate response for VIEW_ONLY could be made safe if that role cannot create campaigns and if no other flow uses the same response for execution. Still, **prefer not** to remove execution-critical fields from the API; use UI-only hiding instead.

### 4.2 Risks of modifying data before execution

- **Removing or nulling fields in the API by role:**  
  If a role that **can** trigger “Build Campaign Blueprint” or create-campaign receives a response with `duration_weeks` or blueprint fields stripped, then the payload sent to `PUT source-recommendation` or used in client-side create-campaign logic could be missing required data. Backend might then default duration (e.g. 12), but strategic theme content could be incomplete.  
  **Recommendation:** Do **not** remove or null execution-relevant fields in the API for roles that can execute; if implementing “minimal view” via API, restrict it to roles that cannot create campaigns or save blueprint (e.g. VIEW_ONLY), and document that execution paths must not depend on those filtered responses.

- **Stripping fields in the frontend before calling APIs:**  
  If the client mutates the recommendation object (e.g. deletes `duration_weeks`) before passing it to Build Campaign Blueprint or to create-campaign payloads, execution can break (wrong duration, missing context).  
  **Recommendation:** Do **not** mutate the recommendation object for display. Use **visibility only** (don’t render certain sections); keep the full object for any submission.

---

## 5. IMPLEMENTATION RISK ANALYSIS

### 5.1 What could break execution pipelines

- **Removing or filtering `duration_weeks`** from the card or result for roles that can run “Build Campaign Blueprint” or create-campaign: Regenerate-blueprint and any flow that uses `source_strategic_theme.duration_weeks` could get undefined and fall back to 12; if the intent was to use the recommendation’s duration, behavior would change silently.
- **Removing or filtering blueprint-related fields** (e.g. `primary_recommendations`, `supporting_recommendations`, `progression_summary`) or `company_context_snapshot` before sending to `PUT source-recommendation`: Stored strategic theme would be incomplete; downstream plan generation could be less accurate.
- **Backend returning different shapes by role:** Any consumer (e.g. TrendCampaignsTab, Content Architect) that assumes the full card shape could throw or render incorrectly if the API omits fields for some roles. TypeScript types would need to reflect optional “minimal” shape or separate response types.
- **Changing enrichment to skip adding execution fields for “minimal” roles:** Enrichment runs server-side before role is known (role is not passed into the engine). So role-based enrichment would require either passing role into the API and branching in the engine/enrichment (adds coupling and complexity) or doing a second “strip” step after enrichment for certain roles. The latter is equivalent to response filtering and has the same risks as above.

### 5.2 Coupling between UI fields and execution logic

- **Direct coupling:**  
  - “Build Campaign Blueprint” in TrendCampaignsTab builds `sourceStrategicTheme` from `card.recommendation` (topic, polished_title, summary, intelligence, execution, company_context_snapshot, duration_weeks, progression_summary, primary/supporting_recommendations, estimated_reach, formats, regions). That object is sent to `PUT /api/campaigns/:id/source-recommendation`. So **UI card data and execution payload are the same object** at the call site. If the card were mutated for display (e.g. delete keys), the same mutated object would be sent and execution would see missing fields.  
  - **Mitigation:** Keep a single source of truth for the card; only control **visibility** in the card component, not the underlying data.

- **Indirect coupling:**  
  - Regenerate-blueprint and campaign detail views read the stored `source_strategic_theme` from the campaign. So whatever is stored by “Build Campaign Blueprint” is what execution uses. No direct link from “what’s visible in the card” to “what’s stored,” as long as the stored payload is built from the **full** recommendation object, not from a role-filtered view.

---

## 6. OUTPUT SUMMARY

### Architecture summary

- **Data:** Recommendation cards are elements of `trends_used[]` produced by the recommendation engine, then enriched by `recommendationCardEnrichmentService` (execution blueprint resolved in engine). Full result (with snapshot ids/hashes added in generate API) is returned to the client. Only `topic` is mandatory per card; all other fields are optional for display. Execution uses: result-level blueprints; per-card data when building `source_strategic_theme` and when creating campaigns (message/context); duration from request or default in create-campaign flows.
- **UI:** A single component, **RecommendationBlueprintCard**, renders all card sections; it is used in TrendCampaignsTab (per card) and in Content Architect (single stored card). Sections are gated by minimized state and by “has*” content checks; there is no role-based visibility.
- **Roles:** Company-scoped role comes from `user_company_roles` via CompanyContext; used for action visibility (generate, group, etc.). No field-level or card-section visibility by role.

### Component hierarchy (textual)

```
RecommendationsPage
  └─ CompanyContext (user, userRole, companies, …)
  └─ [Tab: TREND] TrendCampaignsTab
       └─ visibleEngineCardsWithStatus.map(card =>
            RecommendationBlueprintCard({
              recommendation: card.recommendation,
              onBuildCampaignBlueprint, onMarkLongTerm, onArchive, strategyStatus
            })
          )
```

Content Architect:

```
Content Architect Page
  └─ activeTab === 'recommendation-cards'
       └─ sourceRecommendationCard?.source_strategic_theme
            └─ RecommendationBlueprintCard({ recommendation: source_strategic_theme, … })
```

### Recommended insertion point for role-based views

- **Preferred:** **Rendering layer** inside (or around) **RecommendationBlueprintCard**. Pass `userRole` or a “view mode” (e.g. `minimal | full`) and conditionally render sections (e.g. hide Campaign Blueprint Preview, Company Context Snapshot, or Diamond Intelligence for minimal/view-only). Do **not** change the `recommendation` object; use the same object for all API calls (Build Campaign Blueprint, create-campaign). No backend or data-layer change required; execution pipelines remain safe.

### Potential edge cases

- **Content Architect:** Currently gets role `CONTENT_ARCHITECT` and may see campaigns with stored source_strategic_theme. If role-based visibility is added, decide whether Content Architect gets “full” or “minimal” card when viewing that stored theme (likely full, since they need to understand the linked recommendation).
- **Stale role:** If role changes (e.g. company admin revokes a permission) without a refresh, the client may still show sections until reload or re-fetch of context. Consider refreshing CompanyContext when switching company or after permission-sensitive actions.
- **VIEW_ONLY / reviewer roles:** If they ever get to see a recommendation (e.g. shared link or future “view only” generate), they are good candidates for a minimal view; ensure they cannot trigger Build Campaign Blueprint or create-campaign so that hiding fields in UI does not affect any execution path.
- **create-campaign-from-group:** Does not send `durationWeeks` in the request; backend uses default. If later the client sends duration from the last generate result, that result must not have had duration stripped for the current user’s role.

---

*End of report. No code was modified.*
